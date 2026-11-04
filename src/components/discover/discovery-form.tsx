"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, Radar } from "lucide-react";
import { Confirm } from "@/components/app/confirm";
import { Field } from "@/components/app/field";
import { TagInput } from "@/components/app/tag-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { startDiscovery, startWebDiscovery } from "@/server/actions/jobs";

export interface DiscoveryProviderOption {
  id: "gemini_search" | "serper" | "brave" | "google_places";
  label: string;
  mode: "web" | "places";
  ready: boolean;
  recommended?: boolean;
}

/** Mirrors searchBudget() in src/server/web-discovery.ts (shown before starting). */
function webSearchBudget(target: number) {
  return Math.min(60, Math.max(4, Math.ceil(target / 2) + 3));
}

function ToggleRow({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <span className="text-sm">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function DiscoveryForm({
  projectId, defaults, providers, maxResults, remainingRequests,
}: {
  projectId: string;
  defaults: { industry: string; countries: string[]; cities: string[] };
  providers: DiscoveryProviderOption[];
  maxResults: number;
  remainingRequests: number;
}) {
  const router = useRouter();
  const firstReady = providers.find((p) => p.ready && p.mode === "web") ?? providers.find((p) => p.ready) ?? providers[0];
  const [providerId, setProviderId] = useState(firstReady?.id ?? "gemini_search");
  const provider = providers.find((p) => p.id === providerId) ?? firstReady;
  const isWeb = provider?.mode === "web";

  const [keywords, setKeywords] = useState(defaults.industry);
  const [industry, setIndustry] = useState(defaults.industry);
  const [country, setCountry] = useState(defaults.countries[0] ?? "");
  const [cities, setCities] = useState<string[]>(defaults.cities.slice(0, 1));
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [limit, setLimit] = useState(Math.min(10, maxResults));
  const [requireVerified, setRequireVerified] = useState(true);
  const [autoQualify, setAutoQualify] = useState(true);
  const [autoGenerate, setAutoGenerate] = useState(true);

  const web = useAction(startWebDiscovery, { onSuccess: (d) => router.push(`/discover/jobs/${d.jobId}`), refresh: false });
  const places = useAction(startDiscovery, { onSuccess: (d) => router.push(`/discover/jobs/${d.jobId}`), refresh: false });

  const targets = cities.length ? cities : [undefined];
  const perJob = isWeb ? webSearchBudget(limit) : Math.ceil(limit / 20);
  const totalRequests = perJob * targets.length;
  const valid = keywords.trim().length >= 2 && limit >= 1 && limit <= maxResults && Boolean(provider?.ready);

  return (
    <Card>
      <CardHeader className="flex-col gap-0.5">
        <CardTitle>New search</CardTitle>
        <CardDescription>
          {isWeb
            ? "The agent searches the web, opens each business's own website, keeps only businesses whose website links to their Instagram, validates them with AI and removes duplicates."
            : "Searches Google Places for businesses, then normalizes and deduplicates every result before adding it to the project."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Discovery provider" htmlFor="provider" className="sm:col-span-2" hint={provider && !provider.ready ? <>Not configured. <Link className="text-accent hover:underline" href="/settings/discovery">Set it up in Settings → Discovery providers</Link>.</> : undefined}>
          <NativeSelect id="provider" value={providerId} onChange={(e) => setProviderId(e.target.value as DiscoveryProviderOption["id"])}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}{p.mode === "web" ? " — web search + Instagram verification" : " — Google Maps listings"}{p.ready ? "" : " (not configured)"}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Keywords" htmlFor="kw" className="sm:col-span-2" hint="What a customer would search for, e.g. “tattoo studio” or “custom tattoo shop”.">
          <Input id="kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Industry" htmlFor="industry" optional>
          <Input id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Country" htmlFor="country">
          <NativeSelect id="country" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Any</option>
            {[...new Set([...defaults.countries, country].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Cities" htmlFor="city" optional hint="Each city runs as its own job. One city per job keeps results local and relevant.">
          <TagInput id="city" value={cities} onChange={setCities} suggestions={defaults.cities} placeholder="e.g. Austin" />
        </Field>
        <Field label="Exclude results containing" htmlFor="excl" optional hint="Matched against name, category and website.">
          <TagInput id="excl" value={exclusions} onChange={setExclusions} placeholder="e.g. removal, supply" />
        </Field>
        <Field
          label={isWeb ? "Prospects to find (per city)" : "Result limit"}
          htmlFor="limit"
          hint={isWeb
            ? `Stops when this many new prospects are added, or after ${webSearchBudget(limit)} searches. ${remainingRequests} discovery requests left today.`
            : `Up to ${maxResults} per search. Uses up to ${perJob} paid request${perJob === 1 ? "" : "s"} per city · ${remainingRequests} left today.`}
        >
          <Input id="limit" type="number" min={1} max={maxResults} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </Field>
        {isWeb ? (
          <div className="flex flex-col gap-2">
            <ToggleRow title="Only businesses with a verified Instagram" hint="Verified means the business's own website links to the profile." checked={requireVerified} onChange={setRequireVerified} />
            <ToggleRow title="Qualify new prospects with AI" hint="Scores each new prospect against the project criteria." checked={autoQualify} onChange={(v) => { setAutoQualify(v); if (!v) setAutoGenerate(false); }} />
            <ToggleRow title="Draft messages for qualified prospects" hint="Drafts wait for your review in Outreach. Nothing is sent." checked={autoGenerate} onChange={(v) => { setAutoGenerate(v); if (v) setAutoQualify(true); }} />
          </div>
        ) : (
          <ToggleRow title="Research & qualify new results" hint="Queues an AI qualification job when discovery finishes." checked={autoQualify} onChange={setAutoQualify} />
        )}
      </CardContent>
      <CardFooter className="justify-between">
        {!provider?.ready ? (
          <p className="text-sm text-warning">This provider isn&apos;t configured. <Link href="/settings/discovery" className="underline">Configure discovery</Link> or <Link href="/prospects/import" className="underline">import a CSV</Link>.</p>
        ) : isWeb && requireVerified ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><BadgeCheck className="size-3.5 text-success" /> Unverified Instagram matches are never added as verified.</span>
        ) : <span />}
        <Confirm
          trigger={<Button variant="primary" disabled={!valid}><Radar /> Start discovery</Button>}
          title="Start discovery?"
          description={
            <div className="flex flex-col gap-1.5">
              <p>“{keywords}”{cities.length ? ` in ${cities.join(", ")}` : ""}{country ? `, ${country}` : ""} via {provider?.label}.</p>
              {isWeb ? (
                <>
                  <p>Finds up to {limit} new prospect{limit === 1 ? "" : "s"} per city using at most {totalRequests} search request{totalRequests === 1 ? "" : "s"} in total.</p>
                  <p>Uses about one AI request per business website examined{autoQualify ? ", plus qualification" : ""}{autoGenerate ? " and message drafts" : ""}. All within your daily limits.</p>
                </>
              ) : (
                <p>Up to {limit} results per city · up to {totalRequests} billable Google Places request{totalRequests === 1 ? "" : "s"}{autoQualify ? ", plus AI qualification of new results" : ""}.</p>
              )}
              {provider?.recommended && <Badge tone="accent" className="self-start">Uses your Gemini key</Badge>}
            </div>
          }
          confirmLabel="Start"
          onConfirm={async () => {
            for (const city of targets) {
              const query = { keywords: keywords.trim(), industry: industry.trim() || undefined, country: country || undefined, city, exclusions };
              const res = isWeb
                ? await web.execute(projectId, {
                    provider: providerId as "gemini_search" | "serper" | "brave",
                    query,
                    target_count: limit,
                    require_verified_instagram: requireVerified,
                    auto_qualify: autoQualify,
                    auto_generate: autoGenerate,
                  })
                : await places.execute(projectId, { provider: "google_places", query, max_results: limit, auto_qualify: autoQualify });
              if (!res.ok) break;
            }
          }}
        />
      </CardFooter>
    </Card>
  );
}
