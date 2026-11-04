import pg from "pg";
import { randomUUID } from "node:crypto";

export const DB_URL = process.env.TEST_DATABASE_URL;
export const describeDb = DB_URL ? (await import("vitest")).describe : (await import("vitest")).describe.skip;

export function pool() {
  return new pg.Pool({ connectionString: DB_URL, max: 12 });
}

export async function createUser(db: pg.Pool, role: "admin" | "operator" = "operator") {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
  if (role === "admin") await db.query("update public.profiles set app_role = 'admin' where id = $1", [id]);
  return id;
}

export async function createProject(db: pg.Pool, name = `Project ${randomUUID().slice(0, 8)}`) {
  const { rows } = await db.query("insert into public.projects (name) values ($1) returning id", [name]);
  return rows[0].id as string;
}

export async function addMember(db: pg.Pool, projectId: string, userId: string) {
  await db.query("insert into public.project_members (project_id, user_id) values ($1, $2)", [projectId, userId]);
}

/** Runs `fn` inside a transaction as an authenticated end user (RLS applies). */
export async function asUser<T>(db: pg.Pool, userId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [userId]);
    await c.query("set local role authenticated");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export interface TestCandidate {
  business_name: string;
  normalized_name: string;
  country_code?: string | null;
  city_normalized?: string | null;
  source?: string;
  keys: { type: string; value: string }[];
  [k: string]: unknown;
}

export function candidate(name: string, keys: { type: string; value: string }[], extra: Partial<TestCandidate> = {}): TestCandidate {
  return {
    business_name: name,
    normalized_name: name.toLowerCase(),
    country_code: "US",
    city_normalized: "austin",
    source: "test",
    keys,
    ...extra,
  };
}

export async function ingest(db: pg.Pool | pg.PoolClient, projectId: string, c: TestCandidate, jobId: string | null = null) {
  const { rows } = await db.query("select public.ingest_prospect_candidate($1, $2::jsonb, $3, null) as r", [projectId, JSON.stringify(c), jobId]);
  return rows[0].r as { outcome: string; prospect_id: string | null; identity_id: string | null; ambiguous_id: string | null };
}

export const uid = () => randomUUID().slice(0, 8);
