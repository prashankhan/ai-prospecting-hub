import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetches public web pages for research with SSRF protection: http(s) only, standard ports,
 * every redirect hop re-validated, private/loopback/link-local/metadata addresses rejected,
 * response size and time bounded. Retrieved content is untrusted data.
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") ||
    v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in URLs are not allowed");
  if (url.port && !["80", "443"].includes(url.port)) throw new UnsafeUrlError("Non-standard ports are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new UnsafeUrlError("Local hosts are not allowed");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError("Host resolves to a private address");
  }
  return url;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

export const RESEARCH_USER_AGENT = "AIProspectingHubBot/1.0 (+business research; respects robots.txt)";

export async function safeFetchText(
  raw: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; accept?: string } = {},
): Promise<SafeFetchResult> {
  const { timeoutMs = 8000, maxBytes = 600_000, maxRedirects = 3, accept = "text/html,text/plain;q=0.9" } = opts;
  let current = raw;
  const deadline = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: "manual",
      signal: deadline,
      headers: { "user-agent": RESEARCH_USER_AGENT, accept },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new Error(`Redirect without location (${res.status})`);
      current = new URL(location, url).toString();
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.body) return { url: url.toString(), status: res.status, contentType, body: "", truncated: false };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    return { url: url.toString(), status: res.status, contentType, body, truncated };
  }
  throw new Error("Too many redirects");
}
