import { normalizeEmail, normalizeInstagramUsername } from "@/lib/identity/normalize";

/** Pure HTML extraction helpers (no I/O). Content is treated strictly as data. */

const ENTITY_MAP: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITY_MAP[n.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  try {
    return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
}

export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
}

export function extractSiteName(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:site_name["']/i);
  return m ? decodeEntities(m[1]).trim().slice(0, 200) || null : null;
}

export function extractMetaDescription(html: string): string | null {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  return m ? decodeEntities(m[1]).trim().slice(0, 500) || null : null;
}

/** Visible text with scripts/styles/comments removed, whitespace collapsed. */
export function extractVisibleText(html: string, maxChars = 4000): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return sanitizeUntrustedText(decodeEntities(text)).slice(0, maxChars);
}

/** Strips control/zero-width characters and collapses whitespace. */
export function sanitizeUntrustedText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = decodeEntities(m[1].trim());
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) continue;
    try {
      out.add(new URL(href, baseUrl).toString());
    } catch {
      // ignore malformed links
    }
  }
  return [...out];
}

export interface ExtractedFacts {
  instagram_usernames: string[];
  instagram_links: string[];
  emails: string[];
  social_links: Record<string, string[]>;
}

const SOCIAL_HOSTS: Record<string, RegExp> = {
  facebook: /(^|\.)facebook\.com$/i,
  tiktok: /(^|\.)tiktok\.com$/i,
  x: /(^|\.)(twitter|x)\.com$/i,
  youtube: /(^|\.)youtube\.com$/i,
};

/** Extracts published Instagram profile links, mailto: emails and other social links. */
export function extractFacts(html: string, baseUrl: string): ExtractedFacts {
  const links = extractLinks(html, baseUrl);
  const igLinks: string[] = [];
  const usernames = new Set<string>();
  const emails = new Set<string>();
  const social: Record<string, Set<string>> = {};

  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (url.protocol === "mailto:") {
      const e = normalizeEmail(url.pathname);
      if (e) emails.add(e);
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (/(^|\.)instagram\.com$/.test(host) || host === "instagr.am") {
      const u = normalizeInstagramUsername(link);
      if (u) {
        usernames.add(u);
        igLinks.push(link);
      }
      continue;
    }
    for (const [name, re] of Object.entries(SOCIAL_HOSTS)) {
      if (re.test(host)) (social[name] ??= new Set()).add(link);
    }
  }
  return {
    instagram_usernames: [...usernames],
    instagram_links: [...new Set(igLinks)].slice(0, 10),
    emails: [...emails].slice(0, 5),
    social_links: Object.fromEntries(Object.entries(social).map(([k, v]) => [k, [...v].slice(0, 3)])),
  };
}

/** Minimal robots.txt evaluation for a single path (User-agent "*" and our bot token). */
export function isAllowedByRobots(robotsTxt: string, path: string, botToken = "aiprospectinghubbot"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && botToken.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = applicable.flatMap((g) => g.rules);
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    const pattern = r.path.replace(/\*/g, "");
    const anchored = r.path.endsWith("$");
    const p = anchored ? pattern.slice(0, -1) : pattern;
    const matches = anchored ? path === p : path.startsWith(p);
    if (matches && (!best || p.length > best.len || (p.length === best.len && r.allow))) {
      best = { allow: r.allow, len: p.length };
    }
  }
  return best ? best.allow : true;
}
