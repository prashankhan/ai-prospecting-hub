/**
 * Identity normalization. Pure functions — no I/O — so they can be shared by the server,
 * discovery providers, CSV import and tests. Original source values are always preserved
 * separately; these helpers only produce comparison keys and canonical display values.
 */

const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "igshid", "igsh", "si", "ref", "ref_src", "mc_cid", "mc_eid",
  "_ga", "hsctatracking", "yclid", "ttclid", "srsltid",
]);

/** Instagram paths that are not profiles. */
const INSTAGRAM_RESERVED = new Set([
  "p", "reel", "reels", "tv", "explore", "stories", "accounts", "direct", "about", "developer", "legal",
  "web", "challenge", "privacy", "help", "api", "oauth", "s", "tags", "locations", "directory", "ar",
  "emails", "session", "login", "signup", "share", "invites", "graphql",
]);

/** Hosts whose domain does not identify a single business. */
const SHARED_HOSTS = [
  "instagram.com", "facebook.com", "fb.com", "fb.me", "m.me", "linktr.ee", "linkin.bio", "lnk.bio", "beacons.ai",
  "google.com", "goo.gl", "g.page", "g.co", "maps.app.goo.gl", "yelp.com", "yelp.ca", "yelp.co.uk",
  "tiktok.com", "twitter.com", "x.com", "youtube.com", "youtu.be", "pinterest.com", "threads.net",
  "booksy.com", "vagaro.com", "fresha.com", "tattoodo.com", "squareup.com", "setmore.com", "calendly.com",
  "acuityscheduling.com", "schedulicity.com", "genbook.com", "mindbodyonline.com", "bit.ly", "tinyurl.com",
  "linkedin.com", "wa.me", "whatsapp.com", "etsy.com", "amazon.com",
];

/** Hosting platforms where each business gets its own subdomain — the full host is the identity. */
const SUBDOMAIN_HOSTS = [
  "wixsite.com", "square.site", "squarespace.com", "myshopify.com", "business.site", "wordpress.com",
  "blogspot.com", "carrd.co", "godaddysites.com", "webflow.io", "netlify.app", "vercel.app", "weebly.com",
  "github.io", "framer.website", "mystrikingly.com", "jimdosite.com",
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function stripDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Parses a user/provider supplied URL, adding https:// when the scheme is missing. */
export function parseLooseUrl(input: string | null | undefined): URL | null {
  if (!input) return null;
  let raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  if (raw.startsWith("//")) raw = `https:${raw}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

/** Removes tracking parameters and fragments; lowercases the host. Returns null for invalid URLs. */
export function cleanUrl(input: string | null | undefined): string | null {
  const url = parseLooseUrl(input);
  if (!url) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (k.startsWith("utm_") || TRACKING_PARAMS.has(k)) url.searchParams.delete(key);
  }
  let out = url.toString();
  if (url.pathname === "/" && !url.search) out = out.replace(/\/$/, "");
  return out;
}

/**
 * Website domain used as an identity key: lowercase host without "www." and port.
 * Shared platforms (social networks, link-in-bio, booking marketplaces) return null because
 * they do not identify a business; per-business subdomain hosts keep their full host.
 */
export function normalizeWebsiteDomain(input: string | null | undefined): string | null {
  const url = parseLooseUrl(input);
  if (!url) return null;
  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return null;

  const subdomainPlatform = SUBDOMAIN_HOSTS.find((d) => hostMatches(host, d));
  if (subdomainPlatform) {
    // e.g. "studio.square.site" identifies a business; bare "wixsite.com/user" does not.
    return host === subdomainPlatform ? null : host;
  }
  if (SHARED_HOSTS.some((d) => hostMatches(host, d))) return null;
  return host;
}

/**
 * Normalizes an Instagram handle or profile URL to a lowercase username.
 * Returns null when the input is not a valid profile reference — never guesses.
 */
export function normalizeInstagramUsername(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim();
  if (!value) return null;

  const looksLikeUrl = /instagram\.com|instagr\.am/i.test(value) || /^https?:\/\//i.test(value);
  if (looksLikeUrl) {
    const url = parseLooseUrl(value);
    if (!url) return null;
    const host = url.hostname.toLowerCase();
    if (!hostMatches(host, "instagram.com") && !hostMatches(host, "instagr.am")) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    // Profile URLs are /{username}/ optionally followed by a tab such as /reels/ or /tagged/
    value = segments[0];
    if (segments.length > 1 && !["reels", "tagged", "guides", "igtv", "channel", "related_profiles"].includes(segments[1].toLowerCase())) {
      return null;
    }
  }

  value = value.replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(value)) return null;
  if (value.startsWith(".") || value.endsWith(".") || value.includes("..")) return null;
  if (/^[._]+$/.test(value) || /^\d+$/.test(value) && value.length < 3) return null;
  if (INSTAGRAM_RESERVED.has(value)) return null;
  return value;
}

export function instagramProfileUrl(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

const LEGAL_SUFFIXES = /\b(llc|l\.l\.c|ltd|limited|inc|incorporated|corp|corporation|co|company|plc|llp|pty|gmbh|sarl)\b\.?/g;

/** Business name comparison key. Conservative: keeps descriptive words like "tattoo" and "studio". */
export function normalizeBusinessName(input: string | null | undefined): string {
  if (!input) return "";
  let v = stripDiacritics(input).toLowerCase();
  v = v.replace(/&/g, " and ").replace(/['’`]/g, "");
  v = v.replace(LEGAL_SUFFIXES, " ");
  v = v.replace(/[^a-z0-9]+/g, " ");
  v = collapseWhitespace(v);
  v = v.replace(/^the /, "");
  return v;
}

export function normalizeCity(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = collapseWhitespace(stripDiacritics(input).toLowerCase().replace(/[^a-z0-9 ]+/g, " "));
  return v || null;
}

const COUNTRY_ALIASES: Record<string, string> = {
  us: "US", usa: "US", "u s": "US", "u s a": "US", "united states": "US", "united states of america": "US", america: "US",
  uk: "GB", "u k": "GB", gb: "GB", "great britain": "GB", britain: "GB", "united kingdom": "GB", england: "GB",
  scotland: "GB", wales: "GB", "northern ireland": "GB",
  ca: "CA", canada: "CA",
};

let regionIndex: Map<string, string> | null = null;
function regionNameIndex(): Map<string, string> {
  if (regionIndex) return regionIndex;
  regionIndex = new Map();
  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        name = undefined;
      }
      if (name && name !== code) regionIndex.set(normalizeCity(name) ?? "", code);
    }
  }
  return regionIndex;
}

/** ISO 3166-1 alpha-2 code for a country name or code; null when unknown. */
export function toCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const key = normalizeCity(input.replace(/\./g, " "));
  if (!key) return null;
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  if (/^[a-z]{2}$/.test(key)) {
    const code = key.toUpperCase();
    return [...regionNameIndex().values()].includes(code) ? code : null;
  }
  return regionNameIndex().get(key) ?? null;
}

export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** E.164-style phone key. Only applied when the country calling code is unambiguous. */
export function normalizePhone(input: string | null | undefined, countryCode?: string | null): string | null {
  if (!input) return null;
  const hasPlus = input.trim().startsWith("+");
  let digits = input.replace(/[^0-9]/g, "");
  if (input.trim().startsWith("00")) {
    digits = digits.slice(2);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (hasPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  const cc = countryCode?.toUpperCase();
  if (cc === "US" || cc === "CA") {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return null;
  }
  if (cc === "GB") {
    if (digits.startsWith("44") && digits.length >= 11 && digits.length <= 13) return `+${digits}`;
    if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 11) return `+44${digits.slice(1)}`;
    return null;
  }
  return null;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
  return /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/.test(v) ? v : null;
}
