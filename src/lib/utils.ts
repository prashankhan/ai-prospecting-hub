import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  return formatDate(value, { dateStyle: "medium", timeStyle: "short" });
}

export function formatRelative(value: string | null | undefined) {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(-Math.round(diff / ms), unit);
  }
  return "just now";
}

export function formatNumber(n: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(n ?? 0);
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
}
