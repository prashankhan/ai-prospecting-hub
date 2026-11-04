import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { registerJobWorker, runJobTick } from "@/server/jobs";

export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = serverEnv().cronSecret;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Background job worker endpoint. Called with `Authorization: Bearer $CRON_SECRET` by the
 * Supabase pg_cron scheduler (every minute, only while jobs are pending) and by a daily
 * Vercel Cron sweep. Processes job slices for up to ~50 seconds.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  await registerJobWorker(db);
  const started = Date.now();
  const results: { jobId?: string; status?: string }[] = [];
  while (Date.now() - started < 45_000) {
    const res = await runJobTick(db, { budgetMs: Math.max(5_000, 45_000 - (Date.now() - started)) });
    if (!res.claimed) break;
    results.push({ jobId: res.jobId, status: res.status });
  }
  return NextResponse.json({ processed: results.length, results });
}
