/**
 * Pure helpers for web-search discovery: query planning and turning raw search results into
 * research candidates. Nothing here performs I/O, and nothing here ever produces a "verified"
 * Instagram account — verification only happens when a business's own website links to it.
 */
import { normalizeInstagramUsername, normalizeWebsiteDomain, parseLooseUrl } from "@/lib/identity/normalize";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebQueryPlan {
  query: string;
  /** "web" finds business websites; "instagram" finds profiles via site:instagram.com */
  kind: "web" | "instagram";
}

/** Directories, marketplaces, media and review sites that list many businesses. */
const DIRECTORY_HOSTS = [
  "yelp.com", "yelp.ca", "yelp.co.uk", "tripadvisor.com", "tripadvisor.co.uk", "tripadvisor.ca", "yellowpages.com",
  "yellowpages.ca", "yell.com", "bbb.org", "mapquest.com", "foursquare.com", "nextdoor.com", "thumbtack.com",
  "angi.com", "houzz.com", "groupon.com", "reddit.com", "quora.com", "medium.com", "wikipedia.org", "tattoodo.com",
  "booksy.com", "fresha.com", "vagaro.com", "inkedmag.com", "timeout.com", "eventbrite.com", "indeed.com",
  "glassdoor.com", "linkedin.com", "facebook.com", "tiktok.com", "youtube.com", "pinterest.com", "x.com",
  "twitter.com", "threads.net", "apple.com", "google.com", "bing.com", "yahoo.com", "amazon.com", "etsy.com",
  "cylex.us.com", "cylex-uk.co.uk", "manta.com", "superpages.com", "chamberofcommerce.com", "birdeye.com",
  "trustpilot.com", "freeindex.co.uk", "scoot.co.uk", "canpages.ca", "411.ca", "goldenpages.ie", "hotfrog.com",
  "zaubee.com", "inkbook.io", "tattoofilter.com", "bestprosintown.com", "expertise.com", "threebestrated.com",
  "top-rated.online", "restaurantji.com", "storeboard.com", "brownbook.net", "n49.com", "wheree.com",
];

const INDEX_WORDS = /\b(best|top \d+|top ten|top-rated|\d+ best|near me|directory|list of|guide to|reviews of)\b/i;

function hostOf(url: string): string | null {
  const u = parseLooseUrl(url);
  return u ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
}

export function isDirectoryHost(host: string): boolean {
  return DIRECTORY_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Builds a bounded list of search queries for one location. Alternates website-oriented and
 * Instagram-oriented queries so both discovery paths are used.
 */
export function planQueries(input: { keywords: string; industry?: string; city?: string; country?: string }): WebQueryPlan[] {
  const kw = input.keywords.trim();
  const place = [input.city, input.country].filter(Boolean).join(", ");
  const loc = place ? ` ${place}` : "";
  const industry = input.industry && !kw.toLowerCase().includes(input.industry.toLowerCase()) ? ` ${input.industry}` : "";
  const variants = [
    `${kw}${industry}${loc}`,
    `site:instagram.com ${kw}${loc}`,
    `${kw}${loc} book appointment`,
    `site:instagram.com ${kw}${industry}${loc}`,
    `independent ${kw}${loc}`,
    `${kw}${loc} official website`,
    `site:instagram.com ${kw}${loc} booking`,
    `custom ${kw}${loc}`,
  ];
  const seen = new Set<string>();
  const out: WebQueryPlan[] = [];
  for (const v of variants) {
    const q = v.replace(/\s+/g, " ").trim();
    if (!seen.has(q.toLowerCase())) {
      seen.add(q.toLowerCase());
      out.push({ query: q, kind: q.startsWith("site:instagram.com") ? "instagram" : "web" });
    }
  }
  return out;
}

export interface ResearchCandidate {
  /** Homepage to research (business-owned website). */
  website: string;
  domain: string;
  /** Instagram handle seen in search results; must be confirmed by the website to be verified. */
  hintedInstagram: string | null;
  searchTitle: string;
  searchSnippet: string;
  sourceUrl: string;
}

export interface InstagramOnlyCandidate {
  username: string;
  searchTitle: string;
  searchSnippet: string;
  sourceUrl: string;
}

const DOMAIN_IN_TEXT = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|co\.uk|ca|net|org|studio|art|ink|tattoo|shop|store|uk|us|io|co|biz|info|me))\b/gi;

/** Websites mentioned in an Instagram result's title/snippet (link in bio), excluding shared hosts. */
export function websitesInText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(DOMAIN_IN_TEXT)) {
    const domain = normalizeWebsiteDomain(m[1]);
    if (domain && !isDirectoryHost(domain) && !domain.endsWith("instagram.com")) out.add(domain);
  }
  return [...out];
}

/** Pulls "@handle" out of Instagram result titles like "Ink House (@inkhouse) • Instagram photos". */
export function handleFromInstagramTitle(title: string): string | null {
  const m = title.match(/\(@([a-z0-9._]{1,30})\)/i) ?? title.match(/@([a-z0-9._]{1,30})\b/i);
  return m ? normalizeInstagramUsername(m[1]) : null;
}

/**
 * Splits raw results into business websites to research and Instagram profiles found by search.
 * Directory/listicle pages and social networks other than Instagram are dropped.
 */
export function classifyResults(results: WebSearchResult[]): { websites: ResearchCandidate[]; instagram: InstagramOnlyCandidate[]; dropped: { url: string; reason: string }[] } {
  const websites = new Map<string, ResearchCandidate>();
  const instagram = new Map<string, InstagramOnlyCandidate>();
  const dropped: { url: string; reason: string }[] = [];

  for (const r of results) {
    const host = hostOf(r.url);
    if (!host) {
      dropped.push({ url: r.url, reason: "Invalid URL" });
      continue;
    }
    if (host === "instagram.com" || host.endsWith(".instagram.com")) {
      const username = normalizeInstagramUsername(r.url) ?? handleFromInstagramTitle(r.title);
      if (!username) {
        dropped.push({ url: r.url, reason: "Instagram post or non-profile page" });
        continue;
      }
      const sites = websitesInText(`${r.title} ${r.snippet}`);
      if (sites.length === 1) {
        const domain = sites[0];
        if (!websites.has(domain)) {
          websites.set(domain, { website: `https://${domain}`, domain, hintedInstagram: username, searchTitle: r.title, searchSnippet: r.snippet, sourceUrl: r.url });
        }
      } else if (!instagram.has(username)) {
        instagram.set(username, { username, searchTitle: r.title, searchSnippet: r.snippet, sourceUrl: r.url });
      }
      continue;
    }
    if (isDirectoryHost(host)) {
      dropped.push({ url: r.url, reason: "Directory or social site" });
      continue;
    }
    const domain = normalizeWebsiteDomain(r.url);
    if (!domain) {
      dropped.push({ url: r.url, reason: "Shared or non-business host" });
      continue;
    }
    if (INDEX_WORDS.test(r.title) && /\b(\d+|best|top)\b/i.test(r.title)) {
      dropped.push({ url: r.url, reason: "Listicle or index page" });
      continue;
    }
    if (!websites.has(domain)) {
      const u = parseLooseUrl(r.url)!;
      websites.set(domain, { website: `${u.protocol}//${u.host}`, domain, hintedInstagram: null, searchTitle: r.title, searchSnippet: r.snippet, sourceUrl: r.url });
    }
  }
  return { websites: [...websites.values()], instagram: [...instagram.values()], dropped };
}

/**
 * Decides the Instagram outcome for a researched website. Verified only when the business's own
 * site links to exactly one profile; a search hint that the site does not confirm is never verified.
 */
export function instagramOutcome(siteHandles: string[], hinted: string | null): { status: "verified" | "likely" | "conflicting" | "not_found"; username: string | null } {
  const unique = [...new Set(siteHandles)];
  if (unique.length === 1) return { status: "verified", username: unique[0] };
  if (unique.length > 1) {
    // Sites often link artists' or partners' accounts too; which one is the business's own
    // needs a human decision, even if search pointed at one of them.
    if (hinted && unique.includes(hinted)) return { status: "likely", username: hinted };
    return { status: "conflicting", username: null };
  }
  return { status: "not_found", username: null };
}

/** Normalized token check used to make sure an AI-extracted value actually appears in the sources. */
export function appearsIn(value: string | null | undefined, haystack: string): boolean {
  if (!value) return false;
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const v = norm(value);
  return v.length >= 2 && ` ${norm(haystack)} `.includes(` ${v} `);
}
