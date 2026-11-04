"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { OUTREACH_STATUSES, OUTREACH_STATUS_LABELS } from "@/lib/domain/outreach";
import { INSTAGRAM_LABELS } from "@/components/app/status-badges";

export function ProspectFilters({ members }: { members: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) update("q", q || null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = ["q", "status", "qual", "ig", "assigned", "source", "job"].some((k) => params.get(k));
  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground" />
        <Input aria-label="Search prospects" placeholder="Search name, city, handle, website" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
      </div>
      <NativeSelect aria-label="Outreach status" className="w-auto" value={params.get("status") ?? ""} onChange={(e) => update("status", e.target.value || null)}>
        <option value="">All statuses</option>
        {OUTREACH_STATUSES.map((s) => <option key={s} value={s}>{OUTREACH_STATUS_LABELS[s]}</option>)}
      </NativeSelect>
      <NativeSelect aria-label="Qualification" className="w-auto" value={params.get("qual") ?? ""} onChange={(e) => update("qual", e.target.value || null)}>
        <option value="">Any qualification</option>
        <option value="qualified">Qualified</option>
        <option value="needs_review">Needs review</option>
        <option value="disqualified">Disqualified</option>
        <option value="pending">Not assessed</option>
      </NativeSelect>
      <NativeSelect aria-label="Instagram" className="w-auto" value={params.get("ig") ?? ""} onChange={(e) => update("ig", e.target.value || null)}>
        <option value="">Any Instagram</option>
        {Object.entries(INSTAGRAM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </NativeSelect>
      <NativeSelect aria-label="Assignee" className="w-auto" value={params.get("assigned") ?? ""} onChange={(e) => update("assigned", e.target.value || null)}>
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </NativeSelect>
      {active && (
        <Button variant="ghost" size="sm" onClick={() => { setQ(""); start(() => router.replace(pathname)); }}>
          <X /> Clear
        </Button>
      )}
    </div>
  );
}
