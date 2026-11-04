"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/app/field";
import { TagInput } from "@/components/app/tag-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { CHANNEL_LABELS, OUTREACH_CHANNELS, type ProjectInput } from "@/lib/domain/project";
import { createProject, updateProject } from "@/server/actions/projects";

const COUNTRY_SUGGESTIONS = ["United States", "United Kingdom", "Canada", "Australia", "Ireland", "New Zealand", "Germany", "France", "Netherlands", "Spain"];

export const EMPTY_PROJECT: ProjectInput = {
  name: "", product_name: "", product_description: "", website: "", target_industry: "", target_countries: [], target_cities: [],
  ideal_customer_profile: "", qualification_criteria: "", exclusion_criteria: "", preferred_channel: "instagram",
  messaging_tone: "", ai_instructions: "", outreach_objective: "", qualification_threshold: 60, status: "active",
};

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-col gap-0.5">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export function ProjectForm({ projectId, initial, readOnly }: { projectId?: string; initial: ProjectInput; readOnly?: boolean }) {
  const [v, setV] = useState<ProjectInput>(initial);
  const router = useRouter();
  const set = <K extends keyof ProjectInput>(k: K, value: ProjectInput[K]) => setV((s) => ({ ...s, [k]: value }));
  const create = useAction(createProject, { onSuccess: (d) => router.push(`/projects/${d.id}`) });
  const update = useAction(updateProject.bind(null, projectId ?? ""));
  const pending = create.pending || update.pending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (projectId) update.execute(v);
        else create.execute(v);
      }}
    >
      <fieldset disabled={readOnly || pending} className="flex flex-col gap-4">
        <Section title="Product" description="What this project sells. Used in qualification and messaging prompts.">
          <Field label="Project name" htmlFor="name">
            <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} />
          </Field>
          <Field label="Product or service name" htmlFor="product_name">
            <Input id="product_name" value={v.product_name} onChange={(e) => set("product_name", e.target.value)} maxLength={120} />
          </Field>
          <Field label="Product description" htmlFor="product_description" className="sm:col-span-2">
            <Textarea id="product_description" value={v.product_description} onChange={(e) => set("product_description", e.target.value)} rows={3} maxLength={2000} />
          </Field>
          <Field label="Website" htmlFor="website" optional>
            <Input id="website" type="url" placeholder="https://" value={v.website} onChange={(e) => set("website", e.target.value)} />
          </Field>
          <Field label="Status" htmlFor="status">
            <NativeSelect id="status" value={v.status} onChange={(e) => set("status", e.target.value as ProjectInput["status"])}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </NativeSelect>
          </Field>
        </Section>

        <Section title="Targeting" description="Who you want to find. Discovery uses these as defaults.">
          <Field label="Target industry" htmlFor="target_industry" className="sm:col-span-2">
            <Input id="target_industry" value={v.target_industry} onChange={(e) => set("target_industry", e.target.value)} placeholder="e.g. Tattoo studios" />
          </Field>
          <Field label="Target countries" htmlFor="target_countries" hint="Press Enter or comma to add.">
            <TagInput id="target_countries" value={v.target_countries} onChange={(x) => set("target_countries", x)} suggestions={COUNTRY_SUGGESTIONS} placeholder="Add a country" />
          </Field>
          <Field label="Target cities" htmlFor="target_cities" optional hint="Leave empty to search nationally.">
            <TagInput id="target_cities" value={v.target_cities} onChange={(x) => set("target_cities", x)} placeholder="Add a city" />
          </Field>
          <Field label="Ideal customer profile" htmlFor="icp" className="sm:col-span-2">
            <Textarea id="icp" value={v.ideal_customer_profile} onChange={(e) => set("ideal_customer_profile", e.target.value)} rows={3} />
          </Field>
        </Section>

        <Section title="Qualification" description="How the agent should assess fit. Scores are internal estimates, not purchase probabilities.">
          <Field label="Qualification criteria" htmlFor="qc" className="sm:col-span-2">
            <Textarea id="qc" value={v.qualification_criteria} onChange={(e) => set("qualification_criteria", e.target.value)} rows={3} />
          </Field>
          <Field label="Exclusion criteria" htmlFor="ec" className="sm:col-span-2">
            <Textarea id="ec" value={v.exclusion_criteria} onChange={(e) => set("exclusion_criteria", e.target.value)} rows={3} />
          </Field>
          <Field label="Qualified threshold" htmlFor="threshold" hint="Recommendations below this score are sent to review instead.">
            <Input id="threshold" type="number" min={0} max={100} value={v.qualification_threshold} onChange={(e) => set("qualification_threshold", Number(e.target.value))} />
          </Field>
        </Section>

        <Section title="Messaging" description="Guidance for personalized first-touch messages. Messages are always reviewed and sent by a person.">
          <Field label="Preferred outreach channel" htmlFor="channel">
            <NativeSelect id="channel" value={v.preferred_channel} onChange={(e) => set("preferred_channel", e.target.value as ProjectInput["preferred_channel"])}>
              {OUTREACH_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Outreach objective" htmlFor="objective">
            <Input id="objective" value={v.outreach_objective} onChange={(e) => set("outreach_objective", e.target.value)} placeholder="e.g. Invite them to a free trial" />
          </Field>
          <Field label="Messaging tone" htmlFor="tone" className="sm:col-span-2">
            <Input id="tone" value={v.messaging_tone} onChange={(e) => set("messaging_tone", e.target.value)} placeholder="e.g. Friendly, concise, peer-to-peer" />
          </Field>
          <Field label="AI instructions" htmlFor="ai" className="sm:col-span-2" hint="Additional rules for the agent, e.g. length limits or details to reference.">
            <Textarea id="ai" value={v.ai_instructions} onChange={(e) => set("ai_instructions", e.target.value)} rows={3} />
          </Field>
        </Section>
      </fieldset>

      {!readOnly && (
        <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-border bg-canvas/90 px-1 py-3 backdrop-blur">
          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>{projectId ? "Save changes" : "Create project"}</Button>
        </div>
      )}
    </form>
  );
}
