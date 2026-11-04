"use client";
import { X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Accessible tag entry: type and press Enter or comma; Backspace removes the last tag. */
export function TagInput({ id, value, onChange, placeholder, suggestions = [] }: { id?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft("");
  };
  const listId = id ? `${id}-suggestions` : undefined;
  return (
    <div className={cn("flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-surface px-1.5 py-1 shadow-xs focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15")}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-sm bg-surface-muted px-1.5 py-0.5 text-xs">
          {tag}
          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        list={listId}
        value={draft}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft && add(draft)}
        placeholder={value.length ? "" : placeholder}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-subtle-foreground"
      />
      {listId && suggestions.length > 0 && (
        <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      )}
    </div>
  );
}
