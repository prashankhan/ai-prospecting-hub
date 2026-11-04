"use client";
import { useMemo, useState } from "react";
import { ExternalLink, KeyRound, PlugZap, Star } from "lucide-react";
import { Confirm } from "@/components/app/confirm";
import { Field } from "@/components/app/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/utils";
import { removeProviderCredential, saveProviderConfig, setDefaultAIProvider, testProviderConnection } from "@/server/actions/providers";
import type { SafeProviderConfig } from "@/server/providers";

export function ProviderStatusBadge({ config }: { config?: SafeProviderConfig | null }) {
  if (!config?.has_secret) return <Badge>Not configured</Badge>;
  if (config.status === "verified") return <Badge tone="success">Connection verified</Badge>;
  if (config.status === "error") return <Badge tone="danger">Connection failed</Badge>;
  return <Badge tone="warning">Key saved · not tested</Badge>;
}

export function ProviderCard({
  kind, id, label, description, keyPlaceholder, keyHelpUrl, needsModel, config, encryptionReady, notes,
}: {
  kind: "ai" | "discovery";
  id: string;
  label: string;
  description: string;
  keyPlaceholder?: string;
  keyHelpUrl?: string;
  needsModel: boolean;
  config: SafeProviderConfig | null;
  encryptionReady: boolean;
  notes?: string[];
}) {
  const storedModels = useMemo(() => {
    const s = (config?.settings ?? {}) as { models?: string[] };
    return Array.isArray(s.models) ? s.models : [];
  }, [config]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(config?.model ?? "");
  const [enabled, setEnabled] = useState(config?.is_enabled ?? false);
  const [models, setModels] = useState<string[]>(storedModels);
  const [customModel, setCustomModel] = useState(Boolean(config?.model && storedModels.length && !storedModels.includes(config.model)));

  const save = useAction(saveProviderConfig, { onSuccess: () => setApiKey("") });
  const test = useAction(testProviderConnection.bind(null, kind, id), {
    success: (d) => d.message,
    onSuccess: (d) => {
      if (d.models.length) setModels(d.models);
    },
  });
  const remove = useAction(removeProviderCredential.bind(null, kind, id));
  const makeDefault = useAction(setDefaultAIProvider.bind(null, id));

  const modelOptions = model && !models.includes(model) ? [model, ...models] : models;

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-md font-semibold">{label}</h3>
            <ProviderStatusBadge config={config} />
            {config?.is_default && <Badge tone="accent"><Star /> Default</Badge>}
            {config?.is_enabled && !config.is_default && <Badge tone="info">Enabled</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-enabled`} className="text-sm text-muted-foreground">Enabled</label>
          <Switch id={`${id}-enabled`} checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field
          label={config?.has_secret ? "Replace API key" : "API key"}
          htmlFor={`${id}-key`}
          hint={
            <>
              {config?.has_secret ? <>Stored key <span className="font-mono">{config.secret_hint}</span>. Leave empty to keep it. </> : "Encrypted on the server; never shown again. "}
              {keyHelpUrl && <a href={keyHelpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">Get a key <ExternalLink className="size-3" /></a>}
            </>
          }
        >
          <Input
            id={`${id}-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={config?.has_secret ? "••••••••" : keyPlaceholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={!encryptionReady}
          />
        </Field>
        {needsModel && (
          <Field label="Model" htmlFor={`${id}-model`} hint={models.length ? `${models.length} models available to this key.` : "Test the connection to load available models, or enter a model ID."}>
            {models.length > 0 && !customModel ? (
              <NativeSelect id={`${id}-model`} value={model} onChange={(e) => (e.target.value === "__custom" ? setCustomModel(true) : setModel(e.target.value))}>
                <option value="">Select a model</option>
                {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="__custom">Enter a model ID…</option>
              </NativeSelect>
            ) : (
              <Input id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="model-id" spellCheck={false} />
            )}
          </Field>
        )}
        {config?.last_tested_at && (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Last tested {formatDateTime(config.last_tested_at)}
            {config.status === "error" && config.last_error && <span className="mt-0.5 block text-danger">{config.last_error}</span>}
          </p>
        )}
        {notes && notes.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground sm:col-span-2">
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-between">
        <div className="flex gap-2">
          {config?.has_secret && (
            <Confirm
              destructive
              trigger={<Button variant="danger-ghost" size="sm"><KeyRound /> Remove key</Button>}
              title={`Remove the ${label} key?`}
              description="The provider will be disabled. Running jobs that need it will fail."
              confirmLabel="Remove key"
              onConfirm={() => remove.execute()}
            />
          )}
          {kind === "ai" && config?.is_enabled && !config.is_default && (
            <Button size="sm" variant="ghost" loading={makeDefault.pending} onClick={() => makeDefault.execute()}><Star /> Make default</Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" loading={test.pending} disabled={!encryptionReady || (!apiKey && !config?.has_secret)} onClick={() => test.execute(apiKey || undefined)}>
            <PlugZap /> Test connection
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={save.pending}
            disabled={!encryptionReady}
            onClick={() => save.execute({ kind, provider: id, apiKey: apiKey || undefined, model: needsModel ? model : undefined, enabled })}
          >
            Save
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
