import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { candidate, createProject, createUser, describeDb, ingest, pool, uid } from "./helpers";

describeDb("database duplicate prevention", () => {
  let db: pg.Pool;
  beforeAll(() => {
    db = pool();
  });
  afterAll(async () => {
    await db.end();
  });

  it("creates a business once and skips it on re-discovery in the same project", async () => {
    const project = await createProject(db);
    const ig = `studio_${uid()}`;
    const first = await ingest(db, project, candidate("Ink House", [{ type: "instagram_username", value: ig }]));
    const second = await ingest(db, project, candidate("Ink House", [{ type: "instagram_username", value: ig }]));
    expect(first.outcome).toBe("new");
    expect(second.outcome).toBe("skipped_existing");
    expect(second.identity_id).toBe(first.identity_id);
    const { rows } = await db.query("select count(*)::int n from project_prospects where project_id = $1", [project]);
    expect(rows[0].n).toBe(1);
  });

  it("matches on any shared strong key and attaches new keys", async () => {
    const project = await createProject(db);
    const place = `place_${uid()}`;
    const ig = `ig_${uid()}`;
    const a = await ingest(db, project, candidate("North Star Tattoo", [{ type: "place_id", value: place }]));
    const b = await ingest(db, project, candidate("North Star Tattoo", [
      { type: "place_id", value: place }, { type: "instagram_username", value: ig },
    ]));
    expect(b.outcome).toBe("skipped_existing");
    const { rows } = await db.query("select identity_id from identity_keys where key_type = 'instagram_username' and key_value = $1", [ig]);
    expect(rows[0].identity_id).toBe(a.identity_id);
  });

  it("is safe under concurrent ingestion of the same business", async () => {
    const project = await createProject(db);
    const domain = `${uid()}.example.com`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ingest(db, project, candidate("Parallel Ink", [{ type: "domain", value: domain }]))),
    );
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes.filter((o) => o === "new")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "skipped_existing")).toHaveLength(9);
    const { rows } = await db.query(
      "select count(distinct identity_id)::int ids, count(*)::int n from project_prospects where project_id = $1", [project],
    );
    expect(rows[0]).toEqual({ ids: 1, n: 1 });
  });

  it("keeps project membership separate while recognizing the global identity", async () => {
    const p1 = await createProject(db);
    const p2 = await createProject(db);
    const ig = `shared_${uid()}`;
    const a = await ingest(db, p1, candidate("Shared Studio", [{ type: "instagram_username", value: ig }]));
    const b = await ingest(db, p2, candidate("Shared Studio", [{ type: "instagram_username", value: ig }]));
    expect(a.outcome).toBe("new");
    expect(b.outcome).toBe("known_added");
    expect(b.identity_id).toBe(a.identity_id);
    expect(b.prospect_id).not.toBe(a.prospect_id);
  });

  it("never merges uncertain identities automatically", async () => {
    const project = await createProject(db);
    const name = `Same Name ${uid()}`;
    // Same name and city, no shared keys → review
    await ingest(db, project, candidate(name, []));
    const weak = await ingest(db, project, candidate(name, []));
    expect(weak.outcome).toBe("ambiguous");

    // Shared domain but a different name → review
    const domain = `${uid()}.example.org`;
    await ingest(db, project, candidate("Alpha Tattoo", [{ type: "domain", value: domain }]));
    const diffName = await ingest(db, project, candidate("Beta Piercing", [{ type: "domain", value: domain }]));
    expect(diffName.outcome).toBe("ambiguous");

    // Keys that point at two different identities → review
    const ig1 = `one_${uid()}`;
    const ig2 = `two_${uid()}`;
    await ingest(db, project, candidate("One", [{ type: "instagram_username", value: ig1 }]));
    await ingest(db, project, candidate("Two", [{ type: "instagram_username", value: ig2 }]));
    const multi = await ingest(db, project, candidate("One", [
      { type: "instagram_username", value: ig1 }, { type: "place_id", value: `p_${uid()}` },
      { type: "phone", value: "+15550000000" },
    ]));
    expect(["skipped_existing", "ambiguous"]).toContain(multi.outcome);
    const conflict = await ingest(db, project, candidate("Mixed", [
      { type: "instagram_username", value: ig1 }, { type: "instagram_username", value: ig2 },
    ]));
    expect(conflict.outcome).toBe("ambiguous");

    // Same domain, but the identity already has a different place id → conflicting identifiers (chain locations)
    const chain = `${uid()}.chain.com`;
    await ingest(db, project, candidate("Chain Ink", [{ type: "domain", value: chain }, { type: "place_id", value: `a_${uid()}` }]));
    const otherBranch = await ingest(db, project, candidate("Chain Ink", [{ type: "domain", value: chain }, { type: "place_id", value: `b_${uid()}` }]));
    expect(otherBranch.outcome).toBe("ambiguous");
  });

  it("resolves an ambiguous match as a separate business", async () => {
    const project = await createProject(db);
    const user = await createUser(db, "admin");
    const name = `Twin ${uid()}`;
    await ingest(db, project, candidate(name, []));
    const amb = await ingest(db, project, candidate(name, []));
    const { rows } = await db.query("select public.resolve_ambiguous_match($1, 'separate', null, $2) r", [amb.ambiguous_id, user]);
    expect(rows[0].r.outcome).toBe("separate");
    const again = db.query("select public.resolve_ambiguous_match($1, 'dismiss', null, $2)", [amb.ambiguous_id, user]);
    await expect(again).rejects.toThrow(/already resolved/);
  });

  it("suppresses do-not-contact businesses globally", async () => {
    const p1 = await createProject(db);
    const p2 = await createProject(db);
    const p3 = await createProject(db);
    const user = await createUser(db, "admin");
    const ig = `dnc_${uid()}`;
    const a = await ingest(db, p1, candidate("Quiet Studio", [{ type: "instagram_username", value: ig }]));
    const b = await ingest(db, p2, candidate("Quiet Studio", [{ type: "instagram_username", value: ig }]));
    await db.query("select public.set_do_not_contact($1, 'Asked not to be contacted', true, $2)", [a.prospect_id, user]);
    const { rows } = await db.query("select do_not_contact, outreach_status from project_prospects where id = $1", [b.prospect_id]);
    expect(rows[0]).toEqual({ do_not_contact: true, outreach_status: "do_not_contact" });
    const c = await ingest(db, p3, candidate("Quiet Studio", [{ type: "instagram_username", value: ig }]));
    expect(c.outcome).toBe("suppressed");
  });

  it("blocks repeat outreach at the database level", async () => {
    const project = await createProject(db);
    const r = await ingest(db, project, candidate("Once Only", [{ type: "domain", value: `${uid()}.once.com` }]));
    await db.query("update project_prospects set last_contacted_at = now(), outreach_status = 'contacted' where id = $1", [r.prospect_id]);
    await expect(
      db.query("update project_prospects set last_contacted_at = now() + interval '1 day' where id = $1", [r.prospect_id]),
    ).rejects.toThrow(/Repeat outreach is blocked/);
  });

  it("records job statistics atomically", async () => {
    const project = await createProject(db);
    const { rows } = await db.query("insert into jobs (project_id, type) values ($1, 'discovery') returning id", [project]);
    const job = rows[0].id;
    const ig = `job_${uid()}`;
    await ingest(db, project, candidate("Stat Studio", [{ type: "instagram_username", value: ig }]), job);
    await ingest(db, project, candidate("Stat Studio", [{ type: "instagram_username", value: ig }]), job);
    const stats = await db.query("select processed, new_count, known_count, skipped_count from jobs where id = $1", [job]);
    expect(stats.rows[0]).toEqual({ processed: 2, new_count: 1, known_count: 1, skipped_count: 1 });
  });
});
