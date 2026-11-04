import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv/format";
import { createClient } from "@/lib/supabase/server";
import { authorize, getCurrentProject } from "@/server/session";
import { prospectFiltersSchema, prospectQuery } from "@/server/queries/prospects";

const COLUMNS = [
  "business_name", "category", "country", "city", "address", "website", "phone", "email", "instagram_username", "instagram_url",
  "instagram_match_status", "source", "discovered_at", "last_researched_at", "qualification_score", "qualification_status",
  "qualification_summary", "outreach_status", "last_contacted_at", "last_response_at", "do_not_contact",
] as const;

export async function GET(request: NextRequest) {
  const project = await getCurrentProject();
  if (!project) return NextResponse.json({ error: "No project" }, { status: 404 });
  let user;
  try {
    user = await authorize("prospects.export", project.id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const filters = prospectFiltersSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const supabase = await createClient();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await prospectQuery(supabase, project.id, filters, user.id, COLUMNS.join(", ")).range(from, from + 999);
    if (error) return NextResponse.json({ error: "Export failed" }, { status: 500 });
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  const headers = [...COLUMNS.map((c) => (c === "qualification_score" ? "ai_qualification_score" : c === "qualification_summary" ? "ai_qualification_summary" : c))];
  const csv = toCsv(headers, rows.map((r) => COLUMNS.map((c) => r[c])));
  const name = `${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
