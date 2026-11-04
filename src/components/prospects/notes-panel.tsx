"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { formatRelative } from "@/lib/utils";
import { addNote } from "@/server/actions/prospects";
import type { Note } from "./types";

export function NotesPanel({ prospectId, notes, names }: { prospectId: string; notes: Note[]; names: Record<string, string> }) {
  const [body, setBody] = useState("");
  const { execute, pending } = useAction(addNote, { onSuccess: () => setBody("") });
  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); execute(prospectId, body); }}>
        <Textarea aria-label="Add a note" placeholder="Add a note or follow-up…" value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={5000}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (body.trim()) execute(prospectId, body); } }} />
        <div className="flex items-center justify-between">
          <span className="text-xs text-subtle-foreground">⌘/Ctrl + Enter to save</span>
          <Button size="sm" type="submit" loading={pending} disabled={!body.trim()}>Add note</Button>
        </div>
      </form>
      {notes.length === 0 ? <p className="text-sm text-muted-foreground">No notes yet.</p> : (
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-border px-3 py-2">
              <p className="text-sm whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{n.author_id ? names[n.author_id] ?? "Team member" : "Unknown"} · {formatRelative(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
