"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Radar } from "lucide-react";
import { Confirm } from "@/components/app/confirm";
import { Field } from "@/components/app/field";
import { TagInput } from "@/components/app/tag-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { startDiscovery } from "@/server/actions/jobs";

export function DiscoveryForm({
  projectId, defaults, providerReady, maxResults, remainingRequests,
}: {
  projectId: string;
  defaults: { industry: string; countries: string[]; cities: string[] };
  providerReady: boolean;
  maxResults: number;
  remainingRequests: number;
}) {
  const router = useRouter();
  const [keywords, setKeywords] = useState(defaults.industry);
  const [industry, setIndustry] = useState(defaults.industry);
  const [country, setCountry] = useState(defaults.countries[0] ?? "");
  const [cities, setCities] = useState<string[]>(defaults.cities.slice(0, 1));
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [limit, setLimit] = useState(Math.min(20, maxResults));
  const [autoQualify, setAutoQualify] = useState(false);
  const { execute } = useAction(startDiscovery, { onSuccess: (d) => router.push(`/discover/jobs/${d.jobId}`), refresh: false });
  const requests = Math.ceil(limit / 20);
  const valid = keywords.trim().length >= 2 && limit >= 1 && limit <= maxResults;

  return (
    <Card>
      <CardHeader className="flex-col gap-0.5">
        <CardTitle>New search</CardTitle>
        <CardDescription>Searches Google Places for businesses, then normalizes and deduplicates every result before adding it to the project.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Keywords" htmlFor="kw" className="sm:col-span-2" hint="What you'd type into Google Maps, e.g. “tattoo studio” or “custom tattoo shop”.">
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
        <Field label="City" htmlFor="city" optional hint="One city per search keeps results relevant. Add more to run them one after another.">
          <TagInput id="city" value={cities} onChange={setCities} suggestions={defaults.cities} placeholder="e.g. Austin" />
        </Field>
        <Field label="Exclude results containing" htmlFor="excl" optional hint="Matched against name, category and website.">
          <TagInput id="excl" value={exclusions} onChange={setExclusions} placeholder="e.g. removal, supply" />
        </Field>
        <Field label="Result limit" htmlFor="limit" hint={`Up to ${maxResults} per search. Uses up to ${requests} paid request${requests === 1 ? "" : "s"} per city · ${remainingRequests} left today.`}>
          <Input id="limit" type="number" min={1} max={maxResults} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </Field>
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <span className="text-sm">
            <span className="block font-medium">Research &amp; qualify new results</span>
            <span className="block text-xs text-muted-foreground">Queues an AI qualification job when discovery finishes.</span>
          </span>
          <Switch checked={autoQualify} onCheckedChange={setAutoQualify} />
        </label>
      </CardContent>
      <CardFooter className="justify-between">
        {!providerReady ? (
          <p className="text-sm text-warning">Google Places isn&apos;t configured. <Link href="/settings/discovery" className="underline">Add a key</Link> or <Link href="/prospects/import" className="underline">import a CSV</Link>.</p>
        ) : <span />}
        <Confirm
          trigger={<Button variant="primary" disabled={!providerReady || !valid}><Radar /> Start discovery</Button>}
          title="Start discovery?"
          description={
            <div className="flex flex-col gap-1">
              <p>“{keywords}”{cities.length ? ` in ${cities.join(", ")}` : ""}{country ? `, ${country}` : ""}.</p>
              <p>Up to {limit} results per {cities.length > 1 ? "city" : "search"} · up to {requests * Math.max(1, cities.length)} billable Google Places request{requests * Math.max(1, cities.length) === 1 ? "" : "s"}{autoQualify ? ", plus AI qualification of new results" : ""}.</p>
            </div>
          }
          confirmLabel="Start"
          onConfirm={async () => {
            const targets = cities.length ? cities : [undefined];
            for (const city of targets) {
              const res = await execute(projectId, {
                provider: "google_places",
                query: { keywords: keywords.trim(), industry: industry.trim() || undefined, country: country || undefined, city, exclusions },
                max_results: limit,
                auto_qualify: autoQualify,
              });
              if (!res.ok) break;
            }
          }}
        />
      </CardFooter>
    </Card>
  );
}
