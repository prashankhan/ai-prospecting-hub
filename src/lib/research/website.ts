import "server-only";
import { safeFetchText } from "@/lib/security/safe-fetch";
import {
  extractFacts,
  extractMetaDescription,
  extractTitle,
  extractVisibleText,
  isAllowedByRobots,
  type ExtractedFacts,
} from "./extract";

export interface WebsiteResearch {
  source_url: string;
  http_status: number | null;
  title: string | null;
  description: string | null;
  text: string;
  facts: ExtractedFacts;
  error: string | null;
}

const EMPTY_FACTS: ExtractedFacts = { instagram_usernames: [], instagram_links: [], emails: [], social_links: {} };

/** Fetches a business homepage (robots.txt respected) and extracts published facts. */
export async function researchWebsite(website: string, timeoutMs: number): Promise<WebsiteResearch> {
  const base: WebsiteResearch = {
    source_url: website, http_status: null, title: null, description: null, text: "", facts: EMPTY_FACTS, error: null,
  };
  let url: URL;
  try {
    url = new URL(website);
  } catch {
    return { ...base, error: "Invalid website URL" };
  }

  try {
    const robots = await safeFetchText(new URL("/robots.txt", url).toString(), {
      timeoutMs: Math.min(timeoutMs, 4000), maxBytes: 100_000, accept: "text/plain",
    }).catch(() => null);
    if (robots && robots.status === 200 && !isAllowedByRobots(robots.body, url.pathname || "/")) {
      return { ...base, error: "Blocked by the site's robots.txt" };
    }

    const page = await safeFetchText(url.toString(), { timeoutMs });
    if (page.status >= 400) return { ...base, source_url: page.url, http_status: page.status, error: `HTTP ${page.status}` };
    if (!/html|text\/plain/i.test(page.contentType)) {
      return { ...base, source_url: page.url, http_status: page.status, error: "Not an HTML page" };
    }
    return {
      source_url: page.url,
      http_status: page.status,
      title: extractTitle(page.body),
      description: extractMetaDescription(page.body),
      text: extractVisibleText(page.body),
      facts: extractFacts(page.body, page.url),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    return { ...base, error: message.slice(0, 300) };
  }
}
