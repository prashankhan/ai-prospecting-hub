"use client";
import Link from "next/link";
import Papa from "papaparse";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Field } from "@/components/app/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { guessMapping, IMPORT_FIELD_LABELS, IMPORT_FIELDS, type ImportField } from "@/lib/csv/import";
import { importCsv } from "@/server/actions/prospects";

export function CsvImport({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { execute, pending } = useAction(importCsv.bind(null, projectId), { success: false });
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof importCsv>> | null>(null);

  const onFile = (f: File | null) => {
    setSummary(null);
    setError(null);
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return setError("The file is larger than 2 MB.");
    setFile(f);
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const h = res.meta.fields ?? [];
        setHeaders(h);
        setPreview(res.data.slice(0, 5));
        setRowCount(res.data.length);
        setMapping(guessMapping(h));
        if (res.data.length > 1000) setError("The file has more than 1,000 rows. Split it into smaller files.");
      },
      error: () => setError("Couldn't read this file as CSV."),
    });
  };

  if (summary?.ok) {
    const s = summary.data;
    return (
      <Card>
        <CardHeader className="flex-col gap-0.5">
          <CardTitle>Import complete</CardTitle>
          <CardDescription>{s.total} rows processed with database duplicate checks.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[["New", s.new], ["Already known", s.known], ["Skipped", s.skipped], ["Needs review", s.ambiguous], ["Failed", s.failed]].map(([l, v]) => (
              <div key={l} className="rounded-md border border-border px-3 py-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>
            ))}
          </dl>
          {s.errors.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-danger">{s.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
          )}
        </CardContent>
        <CardFooter>
          {s.ambiguous > 0 && <Button asChild><Link href="/discover/review">Review matches</Link></Button>}
          <Button asChild><Link href={`/discover/jobs/${s.jobId}`}>View import details</Link></Button>
          <Button variant="primary" asChild><Link href="/prospects">Go to prospects</Link></Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-col gap-0.5">
          <CardTitle>1. Choose a file</CardTitle>
          <CardDescription>Import businesses you&apos;ve legitimately collected into {projectName}. Up to 1,000 rows, 2 MB, UTF-8 CSV with a header row.</CardDescription>
        </CardHeader>
        <CardContent>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0] ?? null); }}
            className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-muted/50 px-4 py-8 text-sm text-muted-foreground hover:border-accent hover:text-foreground"
          >
            <FileUp className="size-5" />
            {file ? <span className="font-medium text-foreground">{file.name} · {rowCount} rows</span> : "Drop a CSV here or click to choose"}
          </button>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader className="flex-col gap-0.5">
            <CardTitle>2. Map columns</CardTitle>
            <CardDescription>Instagram handles from a CSV are marked “likely match — review required” until verified by the business website or a team member.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {IMPORT_FIELDS.map((f) => (
              <Field key={f} label={IMPORT_FIELD_LABELS[f]} htmlFor={`map-${f}`} optional={f !== "business_name"}>
                <NativeSelect id={`map-${f}`} value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || undefined }))}>
                  <option value="">Don&apos;t import</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </NativeSelect>
              </Field>
            ))}
          </CardContent>
          {preview.length > 0 && (
            <Table>
              <THead><TR>{IMPORT_FIELDS.filter((f) => mapping[f]).map((f) => <TH key={f}>{IMPORT_FIELD_LABELS[f]}</TH>)}</TR></THead>
              <TBody>
                {preview.map((row, i) => (
                  <TR key={i}>{IMPORT_FIELDS.filter((f) => mapping[f]).map((f) => <TD key={f} className="max-w-48 truncate">{row[mapping[f]!] || <span className="text-subtle-foreground">—</span>}</TD>)}</TR>
                ))}
              </TBody>
            </Table>
          )}
          <CardFooter>
            <Button
              variant="primary"
              loading={pending}
              disabled={!file || !mapping.business_name || Boolean(error)}
              onClick={async () => {
                const fd = new FormData();
                fd.set("file", file!);
                fd.set("mapping", JSON.stringify(mapping));
                setSummary(await execute(fd));
              }}
            >
              Import {rowCount} rows
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
