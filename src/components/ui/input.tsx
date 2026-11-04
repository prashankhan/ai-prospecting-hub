import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "flex h-8 w-full min-w-0 rounded-md border border-input bg-surface px-2.5 text-sm text-foreground shadow-xs transition-colors placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(inputClass, "file:mr-2 file:border-0 file:bg-transparent file:text-sm file:font-medium", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(inputClass, "h-auto min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={cn(inputClass, "appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8", "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]", className)} {...props} />;
}
