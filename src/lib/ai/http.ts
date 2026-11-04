import { ProviderError, type ProviderErrorCode } from "./types";

export type FetchLike = typeof fetch;

/** Maps an HTTP status (and provider error text) to a normalized error code. */
export function classifyHttpError(status: number, body: string): ProviderErrorCode {
  const text = body.toLowerCase();
  if (status === 401) return "auth";
  if (status === 403) return text.includes("api key") && text.includes("invalid") ? "auth" : "permission";
  if (status === 404) return "not_found";
  if (status === 429) {
    return /quota|billing|insufficient|credit|exceeded your current/.test(text) ? "quota" : "rate_limit";
  }
  if (status === 402) return "quota";
  if (status === 400) {
    if (/api[_ ]key not valid|invalid api key|api_key_invalid/.test(text)) return "auth";
    return "bad_request";
  }
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "server";
  return "bad_request";
}

/** Extracts a short, secret-free message from a provider error body. */
export function providerMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const msg = typeof json.error === "string" ? json.error : json.error?.message ?? json.message;
    if (msg) return msg.slice(0, 300);
  } catch {
    // not JSON
  }
  return body.slice(0, 200);
}

export async function requestJSON<T>(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number },
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const { timeoutMs = 60_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetchImpl(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ProviderError(provider, "timeout", "Request timed out");
    }
    throw new ProviderError(provider, "network", "Network error contacting provider");
  }
  const body = await res.text();
  if (!res.ok) {
    throw new ProviderError(provider, classifyHttpError(res.status, body), providerMessage(body), res.status);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ProviderError(provider, "invalid_response", "Provider returned non-JSON response", res.status);
  }
}

/** Pulls the first JSON object out of model output (handles code fences and preambles). */
export function extractJSONObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("No JSON object found in model output");
  }
}
