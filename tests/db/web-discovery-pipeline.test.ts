/**
 * Runs the real web-discovery job pipeline (job leasing, search → website research → Instagram
 * verification → Gemini validation → atomic ingestion → dedup) against PostgreSQL through the
 * test Supabase harness. Only external HTTP (search API, business websites, Gemini) is stubbed,
 * so these results are test fixtures — not real discoveries.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type pg from "pg";
import { createProject, createUser, DB_URL, describeDb, pool } from "./helpers";

vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

const PORT = 54331;
const SITES: Record<string, string> = {
  "inkhouse.example": `<html><head><title>Ink House Tattoo | Austin</title><meta name="description" content="Custom tattoo studio in Austin"></head>
    <body><h1>Ink House Tattoo</h1><p>Custom tattoo studio in Austin, Texas. Walk-ins and bookings.</p>
    <a href="https://www.instagram.com/inkhouse/">Instagram</a><a href="mailto:hello@inkhouse.example">Email</a></body></html>`,
  "noinsta.example": `<html><head><title>No Insta Tattoo</title></head><body><p>Tattoo studio in Austin.</p></body></html>`,
  "needlethread-austin.com": `<html><head><title>Needle &amp; Thread Tattoo</title><meta property="og:site_name" content="Needle &amp; Thread"></head>
    <body><p>Tattoo shop, Austin.</p><a href="https://instagram.com/needlethreadatx">IG</a></body></html>`,
};
const fetchedPages: string[] = [];
let geminiCalls = 0;

function stubFetch(realFetch: typeof fetch) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(`http://localhost:${PORT}`)) return realFetch(input, init);
    const u = new URL(url);
    if (u.hostname === "google.serper.dev") {
      return new Response(JSON.stringify({
        organic: [
          { title: "Ink House Tattoo", link: "https://inkhouse.example/", snippet: "Austin tattoo studio" },
          { title: "No Insta Tattoo", link: "https://noinsta.example/", snippet: "Austin" },
          { title: "THE 10 BEST Tattoo Shops in Austin", link: "https://www.yelp.com/x", snippet: "" },
          { title: "Needle & Thread (@needlethreadatx) • Instagram photos and videos", link: "https://www.instagram.com/needlethreadatx/", snippet: "Book at needlethread-austin.com" },
        ],
      }));
    }
    if (u.hostname === "generativelanguage.googleapis.com") {
      geminiCalls++;
      // Deliberately returns a name that is NOT on the page: the pipeline must not use it.
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          is_business_website: true, matches_target: true, business_name: "Totally Invented Studio",
          category: "Tattoo studio", city: "Austin", country: "Atlantis", reason: "A tattoo studio in Austin.",
        }) }] }, finishReason: "STOP" }],
      }));
    }
    if (SITES[u.hostname] !== undefined) {
      if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
      fetchedPages.push(u.hostname);
      return new Response(SITES[u.hostname], { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`Unexpected outbound request in test: ${url}`);
  });
}

describeDb("web discovery pipeline (fixtures)", () => {
  let db: pg.Pool;
  let harness: ChildProcess;
  let projectId: string;
  let adminId: string;
  let runJobTick: typeof import("@/server/jobs").runJobTick;
  let admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

  beforeAll(async () => {
    db = pool();
    harness = spawn(process.execPath, ["tests/e2e/fake-supabase.mjs"], { env: { ...process.env, DATABASE_URL: DB_URL, FAKE_SUPABASE_PORT: String(PORT) } });
    const keys = await new Promise<{ anon: string; service: string }>((resolve, reject) => {
      let out = "";
      harness.stdout!.on("data", (d) => {
        out += d;
        const anon = out.match(/ANON_KEY=(\S+)/)?.[1];
        const service = out.match(/SERVICE_KEY=(\S+)/)?.[1];
        if (anon && service) resolve({ anon, service });
      });
      harness.on("exit", (c) => reject(new Error(`harness exited ${c}`)));
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = `http://localhost:${PORT}`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = keys.anon;
    process.env.SUPABASE_SERVICE_ROLE_KEY = keys.service;
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    vi.stubGlobal("fetch", stubFetch(globalThis.fetch));

    ({ runJobTick } = await import("@/server/jobs"));
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { encryptSecret } = await import("@/lib/security/crypto");
    admin = createAdminClient();

    await db.query("update jobs set status = 'completed' where status in ('queued','running')");
    await db.query("delete from provider_configs");
    adminId = await createUser(db, "admin");
    projectId = await createProject(db);
    await db.query(
      `insert into provider_configs (kind, provider, model, encrypted_secret, is_enabled, is_default, status) values
       ('ai', 'gemini', 'gemini-test', $1, true, true, 'verified'),
       ('discovery', 'serper', null, $2, true, false, 'verified')`,
      [encryptSecret("test-gemini-key"), encryptSecret("test-serper-key")],
    );
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    harness?.kill();
    await db.end();
  });

  async function runJob() {
    const params = {
      provider: "serper",
      query: { keywords: "tattoo studio", country: "United States", city: "Austin", exclusions: [] },
      target_count: 5, max_searches: 3, require_verified_instagram: true, auto_qualify: false, auto_generate: false,
    };
    const { rows } = await db.query("insert into jobs (project_id, type, provider, params, total, created_by) values ($1, 'discovery', 'serper', $2, 5, $3) returning id", [projectId, params, adminId]);
    const jobId = rows[0].id as string;
    for (let i = 0; i < 20; i++) {
      const res = await runJobTick(admin, { jobId, budgetMs: 20_000 });
      if (!res.claimed || res.status === "completed" || res.status === "failed") break;
    }
    return (await db.query("select * from jobs where id = $1", [jobId])).rows[0];
  }

  it("adds only businesses whose own website links their Instagram, marked verified", async () => {
    const job = await runJob();
    expect(job.status).toBe("completed");
    const { rows } = await db.query(
      "select business_name, website, city, country, instagram_username, instagram_match_status, last_researched_at, source from project_prospects where project_id = $1 order by business_name",
      [projectId],
    );
    expect(rows.map((r) => [r.instagram_username, r.instagram_match_status])).toEqual([
      ["inkhouse", "verified"],
      ["needlethreadatx", "verified"],
    ]);
    // AI-invented values that are not on the page are never stored.
    expect(rows.map((r) => r.business_name)).toEqual(["Ink House Tattoo", "Needle & Thread"]);
    expect(rows.every((r) => r.country === "United States" && r.city === "Austin" && r.last_researched_at && r.source === "web_serper")).toBe(true);
    const research = await db.query("select count(*)::int n from research_results where project_id = $1", [projectId]);
    expect(research.rows[0].n).toBe(2);
    const rejected = await db.query("select key_value, reason from discovery_rejections where project_id = $1", [projectId]);
    expect(rejected.rows).toEqual([{ key_value: "noinsta.example", reason: "No Instagram profile linked on the business website" }]);
    expect(job.new_count).toBe(2);
  }, 60_000);

  it("re-running the search researches nothing again and adds no duplicates", async () => {
    fetchedPages.length = 0;
    const before = geminiCalls;
    const job = await runJob();
    expect(job.status).toBe("completed");
    expect(fetchedPages).toEqual([]);
    expect(geminiCalls).toBe(before);
    const { rows } = await db.query("select count(*)::int n from project_prospects where project_id = $1", [projectId]);
    expect(rows[0].n).toBe(2);
    const events = await db.query("select outcome, count(*)::int n from job_events where job_id = $1 group by outcome order by outcome", [job.id]);
    expect(Object.fromEntries(events.rows.map((r) => [r.outcome, r.n]))).toMatchObject({ skipped_existing: 2, excluded: 1 });
  }, 60_000);
});
