import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { asUser, createUser, describeDb, pool } from "./helpers";

describeDb("database job worker scheduler", () => {
  let db: pg.Pool;
  beforeAll(() => {
    db = pool();
  });
  afterAll(async () => {
    await db.end();
  });

  it("validates the registration input", async () => {
    await expect(db.query("select public.register_job_worker('http://insecure.example', 'x'.repeat(20))".replace("'x'.repeat(20)", "repeat('x', 20)"))).rejects.toThrow(/https URL/);
    await expect(db.query("select public.register_job_worker('https://app.example.com', 'short')")).rejects.toThrow(/16 characters/);
    const { rows } = await db.query("select public.register_job_worker('https://app.example.com', repeat('s', 24)) as ok");
    expect(typeof rows[0].ok).toBe("boolean");
    const stored = await db.query("select app_url from private.job_worker");
    expect(stored.rows[0].app_url).toBe("https://app.example.com");
  });

  it("is not callable by signed-in users", async () => {
    const user = await createUser(db, "admin");
    await expect(
      asUser(db, user, (c) => c.query("select public.register_job_worker('https://evil.example.com', repeat('s', 24))")),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, user, (c) => c.query("select * from private.job_worker"))).rejects.toThrow(/permission denied/);
  });

  it("ping is a safe no-op without pending jobs or extensions", async () => {
    await db.query("select private.ping_job_worker()");
  });
});
