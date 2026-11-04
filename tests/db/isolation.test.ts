import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { addMember, asUser, candidate, createProject, createUser, describeDb, ingest, pool, uid } from "./helpers";

describeDb("project isolation and permissions (RLS)", () => {
  let db: pg.Pool;
  let projectA: string;
  let projectB: string;
  let operator: string;
  let admin: string;
  let prospectA: string;
  let prospectB: string;

  beforeAll(async () => {
    db = pool();
    projectA = await createProject(db);
    projectB = await createProject(db);
    operator = await createUser(db, "operator");
    admin = await createUser(db, "admin");
    await addMember(db, projectA, operator);
    prospectA = (await ingest(db, projectA, candidate("Visible Studio", [{ type: "domain", value: `${uid()}.a.com` }]))).prospect_id!;
    prospectB = (await ingest(db, projectB, candidate("Hidden Studio", [{ type: "domain", value: `${uid()}.b.com` }]))).prospect_id!;
  });
  afterAll(async () => {
    await db.end();
  });

  it("operators only see projects and prospects they belong to", async () => {
    await asUser(db, operator, async (c) => {
      const projects = await c.query("select id from projects");
      expect(projects.rows.map((r) => r.id)).toEqual([projectA]);
      const prospects = await c.query("select id from project_prospects");
      expect(prospects.rows.map((r) => r.id)).toEqual([prospectA]);
      const b = await c.query("select id from project_prospects where id = $1", [prospectB]);
      expect(b.rowCount).toBe(0);
    });
  });

  it("cannot read global identities or provider credentials", async () => {
    await asUser(db, operator, async (c) => {
      expect((await c.query("select * from business_identities")).rowCount).toBe(0);
      expect((await c.query("select * from identity_keys")).rowCount).toBe(0);
      expect((await c.query("select * from provider_configs")).rowCount).toBe(0);
    });
  });

  it("cannot call privileged functions directly", async () => {
    await expect(
      asUser(db, operator, (c) => c.query("select ingest_prospect_candidate($1, '{}'::jsonb)", [projectA])),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, operator, (c) => c.query("select * from claim_job()"))).rejects.toThrow(/permission denied/);
  });

  it("cannot update prospects in other projects", async () => {
    const res = await asUser(db, operator, (c) =>
      c.query("update project_prospects set business_name = 'x' where id = $1", [prospectB]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("cannot move a prospect to another project", async () => {
    await expect(
      asUser(db, operator, (c) => c.query("update project_prospects set project_id = $1 where id = $2", [projectB, prospectA])),
    ).rejects.toThrow();
  });

  it("cannot attach notes to another project's prospect", async () => {
    await expect(
      asUser(db, operator, (c) =>
        c.query("insert into prospect_notes (project_id, prospect_id, author_id, body) values ($1, $2, $3, 'x')", [projectA, prospectB, operator]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("operators cannot create projects or escalate their own role", async () => {
    await expect(asUser(db, operator, (c) => c.query("insert into projects (name) values ($1)", [`Nope ${uid()}`]))).rejects.toThrow(
      /row-level security/,
    );
    await expect(
      asUser(db, operator, (c) => c.query("update profiles set app_role = 'admin' where id = $1", [operator])),
    ).rejects.toThrow(/Not allowed/);
  });

  it("operators cannot lift do-not-contact; admins can", async () => {
    await db.query("update project_prospects set do_not_contact = true where id = $1", [prospectA]);
    await expect(
      asUser(db, operator, (c) => c.query("update project_prospects set do_not_contact = false where id = $1", [prospectA])),
    ).rejects.toThrow(/Only administrators/);
    const res = await asUser(db, admin, (c) =>
      c.query("update project_prospects set do_not_contact = false, outreach_status = 'new' where id = $1", [prospectA]),
    );
    expect(res.rowCount).toBe(1);
  });

  it("outreach activity is append-only for end users", async () => {
    await asUser(db, operator, (c) =>
      c.query("insert into outreach_activities (project_id, prospect_id, actor_id, type) values ($1, $2, $3, 'status_change')", [projectA, prospectA, operator]),
    );
    const res = await asUser(db, operator, (c) =>
      c.query("delete from outreach_activities where prospect_id = $1", [prospectA]).catch((e: Error) => e),
    );
    expect(res instanceof Error || (res as pg.QueryResult).rowCount === 0).toBe(true);
  });

  it("disabled users lose access", async () => {
    const user = await createUser(db, "operator");
    await addMember(db, projectA, user);
    await db.query("update profiles set status = 'disabled' where id = $1", [user]);
    const rows = await asUser(db, user, (c) => c.query("select id from project_prospects"));
    expect(rows.rowCount).toBe(0);
  });

  it("job leasing respects the concurrency limit", async () => {
    await db.query("update jobs set status = 'completed' where status in ('queued','running')");
    const p = await createProject(db);
    await db.query("insert into jobs (project_id, type) values ($1, 'discovery'), ($1, 'discovery'), ($1, 'discovery')", [p]);
    const claims = await Promise.all([1, 2, 3].map(() => db.query("select * from claim_job(null, 60, 2)")));
    expect(claims.reduce((n, r) => n + (r.rowCount ?? 0), 0)).toBe(2);
    await db.query("update jobs set status = 'completed' where project_id = $1", [p]);
  });
});

describeDb("database-enforced workflow rules for direct API access", () => {
  let db: pg.Pool;
  let project: string;
  let operator: string;
  let prospect: string;
  beforeAll(async () => {
    db = pool();
    project = await createProject(db);
    operator = await createUser(db, "operator");
    await addMember(db, project, operator);
    prospect = (await ingest(db, project, candidate("Rules Studio", [{ type: "domain", value: `${uid()}.rules.com` }]))).prospect_id!;
  });
  afterAll(async () => {
    await db.end();
  });

  it("operators cannot create jobs (paid usage) directly", async () => {
    await expect(
      asUser(db, operator, (c) => c.query("insert into jobs (project_id, type, created_by) values ($1, 'discovery', $2)", [project, operator])),
    ).rejects.toThrow(/row-level security/);
  });

  it("operators cannot assign prospects directly", async () => {
    await expect(
      asUser(db, operator, (c) => c.query("update project_prospects set assigned_to = $1 where id = $2", [operator, prospect])),
    ).rejects.toThrow(/Only administrators can assign/);
  });

  it("outcomes cannot be recorded before contact, and contact requires an approved message", async () => {
    await expect(
      asUser(db, operator, (c) => c.query("update project_prospects set outreach_status = 'interested' where id = $1", [prospect])),
    ).rejects.toThrow(/approved message/);
    await expect(
      asUser(db, operator, (c) => c.query("update project_prospects set outreach_status = 'contacted', last_contacted_at = now() where id = $1", [prospect])),
    ).rejects.toThrow(/approved message/);
    await asUser(db, operator, async (c) => {
      await c.query("insert into message_drafts (project_id, prospect_id, version, body, status, origin) values ($1, $2, 1, 'Hello there', 'approved', 'manual')", [project, prospect]);
      await c.query("update project_prospects set outreach_status = 'approved' where id = $1", [prospect]);
      await c.query("update project_prospects set outreach_status = 'contacted', last_contacted_at = now() where id = $1", [prospect]);
    });
    await expect(
      asUser(db, operator, (c) => c.query("update project_prospects set outreach_status = 'approved' where id = $1", [prospect])),
    ).rejects.toThrow(/cannot return to a pre-contact/);
    const ok = await asUser(db, operator, (c) => c.query("update project_prospects set outreach_status = 'responded' where id = $1", [prospect]));
    expect(ok.rowCount).toBe(1);
  });
});
