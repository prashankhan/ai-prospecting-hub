#!/usr/bin/env node
/**
 * TEST HARNESS ONLY — never deploy.
 *
 * A minimal stand-in for Supabase Auth (GoTrue) and PostgREST, backed by a local PostgreSQL
 * database that has `supabase/tests/local_auth_stub.sql` and all migrations applied. It lets the
 * real application, real migrations and real RLS policies be exercised end to end in
 * environments where the Supabase CLI/containers are unavailable. Only the subset of the APIs
 * used by this application is implemented.
 *
 *   DATABASE_URL=postgres://... node tests/e2e/fake-supabase.mjs   (listens on :54321)
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import pg from "pg";

const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54321);
export const JWT_SECRET = "local-e2e-secret-not-for-production-0123456789";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// ---------------------------------------------------------------------------- JWT
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export function signJwt(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = (token ?? "").split(".");
  if (!h || !b || !s) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${h}.${b}`).digest("base64url");
  if (expected !== s) return null;
  const payload = JSON.parse(Buffer.from(b, "base64url").toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}
export const ANON_KEY = signJwt({ role: "anon", iss: "fake-supabase" });
export const SERVICE_KEY = signJwt({ role: "service_role", iss: "fake-supabase" });

// ---------------------------------------------------------------------------- schema cache
let columnTypes = null;
let fkIndex = null;
let fnIndex = null;
async function loadSchema() {
  if (columnTypes) return;
  const cols = await pool.query(`select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema='public'`);
  columnTypes = {};
  for (const c of cols.rows) (columnTypes[c.table_name] ??= {})[c.column_name] = c.data_type === "ARRAY" ? `${c.udt_name.slice(1)}[]` : c.udt_name;
  const fks = await pool.query(`select con.conname, cl.relname as tbl, rel.relname as ref,
      (select a.attname::text from pg_attribute a where a.attrelid=con.conrelid and a.attnum=con.conkey[1]) as col,
      (select a.attname::text from pg_attribute a where a.attrelid=con.confrelid and a.attnum=con.confkey[1]) as refcol
    from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_class rel on rel.oid=con.confrelid
    join pg_namespace n on n.oid=cl.relnamespace where con.contype='f' and n.nspname='public'`);
  fkIndex = Object.fromEntries(fks.rows.map((r) => [r.conname, r]));
  const fns = await pool.query(`select p.proname, p.proretset, format_type(p.prorettype,null) as ret,
      p.proargnames::text[] as names, array(select format_type(t,null) from unnest(p.proargtypes) t) as types
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`);
  fnIndex = Object.fromEntries(fns.rows.map((r) => [r.proname, r]));
}

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw httpError(400, "PGRST100", `Invalid identifier ${s}`);
  return `"${s}"`;
};
function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code, httpError: true });
}

function splitTop(s, sep = ",") {
  const out = [];
  let depth = 0, cur = "", quote = false;
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === sep) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function coerce(table, col, value) {
  const t = columnTypes[table]?.[col];
  if (value === null || value === undefined) return null;
  if (t === "jsonb" || t === "json") return JSON.stringify(value);
  return value;
}

function parseInList(v) {
  return splitTop(v.replace(/^\(|\)$/g, "")).map((x) => x.replace(/^"|"$/g, ""));
}

/** Translates one PostgREST filter (col, "op.value") into SQL. */
function filterSql(table, col, expr, params, alias = "t") {
  let negate = false;
  if (expr.startsWith("not.")) { negate = true; expr = expr.slice(4); }
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  const c = `${alias}.${ident(col)}`;
  const p = (v) => { params.push(v); return `$${params.length}`; };
  let sql;
  switch (op) {
    case "eq": sql = `${c} = ${p(val)}`; break;
    case "neq": sql = `${c} <> ${p(val)}`; break;
    case "gt": sql = `${c} > ${p(val)}`; break;
    case "gte": sql = `${c} >= ${p(val)}`; break;
    case "lt": sql = `${c} < ${p(val)}`; break;
    case "lte": sql = `${c} <= ${p(val)}`; break;
    case "like": sql = `${c}::text like ${p(val.replace(/\*/g, "%"))}`; break;
    case "ilike": sql = `${c}::text ilike ${p(val.replace(/\*/g, "%"))}`; break;
    case "is": sql = `${c} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`; break;
    case "in": sql = `${c} = any(${p(parseInList(val))})`; break;
    default: throw httpError(400, "PGRST100", `Unsupported operator ${op}`);
  }
  void table;
  return negate ? `not (${sql})` : sql;
}

function orSql(table, value, params) {
  const parts = splitTop(value.replace(/^\(|\)$/g, "")).map((part) => {
    const dot = part.indexOf(".");
    return filterSql(table, part.slice(0, dot), part.slice(dot + 1), params);
  });
  return `(${parts.join(" or ")})`;
}

function buildWhere(table, search, params) {
  const clauses = [];
  for (const [k, v] of search) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    if (k === "or") clauses.push(orSql(table, v, params));
    else clauses.push(filterSql(table, k, v, params));
  }
  return clauses.length ? `where ${clauses.join(" and ")}` : "";
}

function buildSelect(table, select) {
  const items = splitTop(select || "*");
  return items.map((item) => {
    let alias = null;
    let rest = item;
    const m = item.match(/^([a-z_][a-z0-9_]*):(.*)$/i);
    if (m && !m[2].startsWith(":")) { alias = m[1]; rest = m[2]; }
    const emb = rest.match(/^([a-z_][a-z0-9_]*)(?:!([a-z0-9_]+))?\((.*)\)$/i);
    if (emb) {
      const [, rel, fkName, inner] = emb;
      const fk = fkName ? fkIndex[fkName] : Object.values(fkIndex).find((f) => f.tbl === table && f.ref === rel);
      if (!fk || fk.tbl !== table) throw httpError(400, "PGRST200", `Unsupported embed ${rest}`);
      const cols = buildSelect(rel, inner).replace(/\bt\./g, "e.");
      return `(select to_jsonb(x) from (select ${cols} from public.${ident(rel)} e where e.${ident(fk.refcol)} = t.${ident(fk.col)}) x) as ${ident(alias ?? rel)}`;
    }
    if (rest === "*") return "t.*";
    return alias ? `t.${ident(rest)} as ${ident(alias)}` : `t.${ident(rest)}`;
  }).join(", ");
}

function buildOrder(order) {
  if (!order) return "";
  return `order by ${splitTop(order).map((o) => {
    const [col, ...mods] = o.split(".");
    const dir = mods.includes("desc") ? "desc" : "asc";
    const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
    return `t.${ident(col)} ${dir}${nulls}`;
  }).join(", ")}`;
}

async function withRole(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const role = ["anon", "authenticated", "service_role"].includes(claims?.role) ? claims.role : "anon";
    await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [claims?.sub ?? "", role]);
    await client.query(`set local role ${role}`);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function handleRest(req, url, body, claims) {
  await loadSchema();
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  const search = [...url.searchParams.entries()];
  const prefer = req.headers["prefer"] ?? "";
  const accept = req.headers["accept"] ?? "";
  const wantObject = accept.includes("vnd.pgrst.object");
  const headers = { "content-type": "application/json" };

  if (path.startsWith("rpc/")) {
    const name = path.slice(4);
    const fn = fnIndex[name];
    if (!fn) throw httpError(404, "PGRST202", `Function ${name} not found`);
    const args = body ?? {};
    const params = [];
    const named = Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => {
      const idx = (fn.names ?? []).indexOf(k);
      const type = fn.types[idx] ?? "text";
      params.push(type === "jsonb" || type === "json" ? JSON.stringify(v) : v);
      return `${ident(k)} := $${params.length}::${type}`;
    });
    return withRole(claims, async (c) => {
      if (fn.proretset) {
        const r = await c.query(`select * from public.${ident(name)}(${named.join(", ")})`, params);
        return { status: 200, headers, body: JSON.stringify(r.rows) };
      }
      const r = await c.query(`select public.${ident(name)}(${named.join(", ")}) as r`, params);
      return { status: 200, headers, body: fn.ret === "void" ? "" : JSON.stringify(r.rows[0].r) };
    });
  }

  const table = path;
  if (!columnTypes[table]) throw httpError(404, "42P01", `relation ${table} does not exist`);
  const select = url.searchParams.get("select");
  const returning = prefer.includes("return=representation");

  return withRole(claims, async (c) => {
    if (req.method === "GET" || req.method === "HEAD") {
      const params = [];
      const where = buildWhere(table, search, params);
      let count = null;
      if (prefer.includes("count=")) {
        const r = await c.query(`select count(*)::int n from public.${ident(table)} t ${where}`, params);
        count = r.rows[0].n;
      }
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      let rows = [];
      if (req.method === "GET") {
        const sql = `select ${buildSelect(table, select)} from public.${ident(table)} t ${where} ${buildOrder(url.searchParams.get("order"))} ${limit ? `limit ${Number(limit)}` : ""} ${offset ? `offset ${Number(offset)}` : ""}`;
        rows = (await c.query(sql, params)).rows;
      }
      const start = Number(offset ?? 0);
      if (count !== null) headers["content-range"] = `${rows.length ? `${start}-${start + rows.length - 1}` : "*"}/${count}`;
      if (wantObject) {
        if (rows.length !== 1) return { status: 406, headers, body: JSON.stringify({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null }) };
        return { status: 200, headers, body: JSON.stringify(rows[0]) };
      }
      return { status: 200, headers, body: req.method === "HEAD" ? "" : JSON.stringify(rows) };
    }

    const project = (rows) => {
      if (!select || select === "*") return rows;
      const cols = splitTop(select);
      return rows.map((r) => Object.fromEntries(cols.map((k) => [k, r[k]])));
    };
    const respond = (rows) => {
      if (!returning) return { status: 201, headers, body: "" };
      const out = project(rows);
      if (wantObject) {
        if (out.length !== 1) return { status: 406, headers, body: JSON.stringify({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: "", hint: null }) };
        return { status: 201, headers, body: JSON.stringify(out[0]) };
      }
      return { status: 201, headers, body: JSON.stringify(out) };
    };

    if (req.method === "POST") {
      const items = Array.isArray(body) ? body : [body];
      const out = [];
      const onConflict = url.searchParams.get("on_conflict");
      for (const item of items) {
        const keys = Object.keys(item).filter((k) => item[k] !== undefined);
        const params = keys.map((k) => coerce(table, k, item[k]));
        let sql = `insert into public.${ident(table)} (${keys.map(ident).join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`;
        if (prefer.includes("resolution=")) {
          const target = onConflict ? onConflict.split(",").map(ident).join(", ") : '"id"';
          sql += prefer.includes("ignore-duplicates")
            ? ` on conflict (${target}) do nothing`
            : ` on conflict (${target}) do update set ${keys.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`;
        }
        const r = await c.query(`${sql} returning *`, params);
        out.push(...r.rows);
      }
      return respond(out);
    }
    if (req.method === "PATCH") {
      const keys = Object.keys(body ?? {}).filter((k) => body[k] !== undefined);
      const params = keys.map((k) => coerce(table, k, body[k]));
      const sets = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(", ");
      const where = buildWhere(table, search, params);
      const r = await c.query(`update public.${ident(table)} t set ${sets} ${where} returning *`, params);
      const res = respond(r.rows);
      return { ...res, status: returning ? 200 : 204 };
    }
    if (req.method === "DELETE") {
      const params = [];
      const where = buildWhere(table, search, params);
      const r = await c.query(`delete from public.${ident(table)} t ${where} returning *`, params);
      const res = respond(r.rows);
      return { ...res, status: returning ? 200 : 204 };
    }
    throw httpError(405, "PGRST", "Method not allowed");
  });
}

// ---------------------------------------------------------------------------- auth
async function ensureAuthTables() {
  await pool.query(`create schema if not exists fake_auth;
    create table if not exists fake_auth.secrets (user_id uuid primary key, password_hash text, banned boolean default false, metadata jsonb default '{}');
    create table if not exists fake_auth.refresh (token text primary key, user_id uuid);
    create table if not exists fake_auth.otp (token_hash text primary key, user_id uuid, type text);`);
}
const hash = (p) => createHash("sha256").update(`fake:${p}`).digest("hex");

async function userObject(id) {
  const { rows } = await pool.query("select u.id, u.email, u.raw_user_meta_data, s.banned from auth.users u left join fake_auth.secrets s on s.user_id=u.id where u.id=$1", [id]);
  if (!rows[0]) return null;
  const u = rows[0];
  const now = new Date().toISOString();
  return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: now, phone: "", confirmed_at: now, last_sign_in_at: now, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data ?? {}, identities: [], created_at: now, updated_at: now, banned: u.banned };
}
async function session(userId) {
  const user = await userObject(userId);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = signJwt({ sub: userId, role: "authenticated", aud: "authenticated", email: user.email, exp, iat: Math.floor(Date.now() / 1000), session_id: randomUUID(), is_anonymous: false });
  const refresh = randomBytes(24).toString("hex");
  await pool.query("insert into fake_auth.refresh (token, user_id) values ($1,$2)", [refresh, userId]);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user };
}
async function createAuthUser({ email, password, user_metadata }) {
  const existing = await pool.query("select id from auth.users where lower(email)=lower($1)", [email]);
  if (existing.rows[0]) throw httpError(422, "email_exists", "A user with this email address has already been registered");
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, email, JSON.stringify(user_metadata ?? {})]);
  await pool.query("insert into fake_auth.secrets (user_id, password_hash) values ($1,$2)", [id, password ? hash(password) : null]);
  return id;
}

async function handleAuth(req, url, body, claims) {
  const p = url.pathname.replace(/^\/auth\/v1/, "");
  const json = (status, obj) => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });
  const err = (status, code, msg) => json(status, { code: status, error_code: code, msg, message: msg });

  if (p === "/token" && url.searchParams.get("grant_type") === "password") {
    const { rows } = await pool.query("select u.id, s.password_hash, s.banned from auth.users u join fake_auth.secrets s on s.user_id=u.id where lower(u.email)=lower($1)", [body.email]);
    if (!rows[0] || rows[0].password_hash !== hash(body.password)) return err(400, "invalid_credentials", "Invalid login credentials");
    if (rows[0].banned) return err(400, "user_banned", "User is banned");
    return json(200, await session(rows[0].id));
  }
  if (p === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const { rows } = await pool.query("delete from fake_auth.refresh where token=$1 returning user_id", [body.refresh_token]);
    if (!rows[0]) return err(400, "refresh_token_not_found", "Invalid Refresh Token");
    return json(200, await session(rows[0].user_id));
  }
  if (p === "/user" && req.method === "GET") {
    if (!claims?.sub) return err(401, "no_authorization", "Invalid JWT");
    const u = await userObject(claims.sub);
    return u ? json(200, u) : err(404, "user_not_found", "User not found");
  }
  if (p === "/user" && req.method === "PUT") {
    if (!claims?.sub) return err(401, "no_authorization", "Invalid JWT");
    if (body.password) await pool.query("update fake_auth.secrets set password_hash=$2 where user_id=$1", [claims.sub, hash(body.password)]);
    return json(200, await userObject(claims.sub));
  }
  if (p === "/logout") return { status: 204, headers: {}, body: "" };
  if (p === "/verify" && req.method === "POST") {
    const { rows } = await pool.query("delete from fake_auth.otp where token_hash=$1 returning user_id", [body.token_hash]);
    if (!rows[0]) return err(403, "otp_expired", "Token has expired or is invalid");
    return json(200, await session(rows[0].user_id));
  }

  // Admin endpoints require the service role key.
  if (claims?.role !== "service_role") return err(403, "not_admin", "User not allowed");
  if (p === "/admin/users" && req.method === "POST") {
    const id = await createAuthUser(body);
    return json(200, await userObject(id));
  }
  const m = p.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
  if (m && req.method === "PUT") {
    if (body.ban_duration) await pool.query("update fake_auth.secrets set banned=$2 where user_id=$1", [m[1], body.ban_duration !== "none"]);
    return json(200, await userObject(m[1]));
  }
  if (p === "/invite") {
    const id = await createAuthUser({ email: body.email, user_metadata: body.data });
    return json(200, await userObject(id));
  }
  if (p === "/admin/generate_link") {
    const id = await createAuthUser({ email: body.email, user_metadata: body.data });
    const tokenHash = randomBytes(16).toString("hex");
    await pool.query("insert into fake_auth.otp (token_hash, user_id, type) values ($1,$2,$3)", [tokenHash, id, body.type]);
    const user = await userObject(id);
    return json(200, { ...user, action_link: `http://localhost/verify?token=${tokenHash}`, email_otp: "000000", hashed_token: tokenHash, redirect_to: body.redirect_to ?? "", verification_type: body.type });
  }
  return err(404, "not_found", `Unsupported auth endpoint ${req.method} ${p}`);
}

// ---------------------------------------------------------------------------- server
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const claims = verifyJwt(bearer) ?? verifyJwt(req.headers.apikey);
  try {
    const out = url.pathname.startsWith("/auth/v1") ? await handleAuth(req, url, body ?? {}, claims) : await handleRest(req, url, body, claims);
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  } catch (e) {
    const status = e.httpError ? e.status : e.code === "42501" ? 403 : e.code === "23505" || e.code === "23503" ? 409 : 400;
    if (process.env.FAKE_SUPABASE_DEBUG) console.error(req.method, url.pathname + url.search, e.message);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: e.code ?? "PGRST", message: e.message, details: e.detail ?? null, hint: e.hint ?? null }));
  }
});

await ensureAuthTables();
server.listen(PORT, () => {
  console.log(`fake-supabase listening on http://localhost:${PORT}`);
  console.log(`ANON_KEY=${ANON_KEY}`);
  console.log(`SERVICE_KEY=${SERVICE_KEY}`);
});
