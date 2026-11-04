import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { ProspectFull } from "./types";

const SOURCE_LABELS: Record<string, string> = {
  google_places: "Google Places",
  csv: "CSV import",
  web_gemini_search: "Agent discovery · Gemini Google Search",
  web_serper: "Agent discovery · Serper",
  web_brave: "Agent discovery · Brave Search",
};

/** Source data (as obtained from providers, imports or the business's own website). */
export function BusinessFacts({ p }: { p: ProspectFull }) {
  const sd = (p.source_data ?? {}) as { attribution?: string; google_maps_uri?: string | null };
  const rows: [string, React.ReactNode][] = [
    ["Category", p.category],
    ["Location", [p.city, p.country].filter(Boolean).join(", ") || null],
    ["Address", p.address],
    ["Website", p.website && <a href={p.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline">{p.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}<ExternalLink className="size-3" /></a>],
    ["Public phone", p.phone],
    ["Public email", p.email],
    ["Source", <span key="s" className="inline-flex items-center gap-1.5">{SOURCE_LABELS[p.source] ?? p.source}{sd.attribution && <Badge tone="outline">{sd.attribution}</Badge>}{sd.google_maps_uri && <a href={sd.google_maps_uri} target="_blank" rel="noreferrer noopener" className="text-xs text-accent hover:underline">View on Google Maps</a>}</span>],
    ["Discovered", formatDate(p.discovered_at)],
    ["Last researched", formatDate(p.last_researched_at)],
    ["Last contacted", formatDate(p.last_contacted_at)],
    ["Last response", formatDate(p.last_response_at)],
  ];
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v || <span className="text-subtle-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
