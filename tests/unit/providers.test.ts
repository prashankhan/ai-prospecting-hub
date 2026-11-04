import { describe, expect, it } from "vitest";
import { classifyHttpError } from "@/lib/ai/http";
import { getAIAdapter } from "@/lib/ai/providers";
import { ProviderError } from "@/lib/ai/types";

function mockFetch(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (capture) {
      capture.url = String(url);
      capture.init = init;
    }
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("provider error handling", () => {
  it("classifies HTTP failures", () => {
    expect(classifyHttpError(401, "")).toBe("auth");
    expect(classifyHttpError(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}')).toBe("auth");
    expect(classifyHttpError(429, "Rate limit reached")).toBe("rate_limit");
    expect(classifyHttpError(429, "You exceeded your current quota")).toBe("quota");
    expect(classifyHttpError(404, "")).toBe("not_found");
    expect(classifyHttpError(503, "")).toBe("server");
  });

  it.each(["gemini", "anthropic", "openai", "openrouter"] as const)("%s maps auth failures to ProviderError", async (id) => {
    const adapter = getAIAdapter(id, mockFetch(401, { error: { message: "invalid x-api-key" } }));
    const err = await adapter.generateJSON({ apiKey: "k", model: "m", system: "s", prompt: "p" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("auth");
    expect(err.retryable).toBe(false);
  });

  it("marks server errors and network failures retryable", async () => {
    const adapter = getAIAdapter("gemini", mockFetch(503, "unavailable"));
    const err = await adapter.generateJSON({ apiKey: "k", model: "m", system: "s", prompt: "p" }).catch((e) => e);
    expect(err.code).toBe("server");
    expect(err.retryable).toBe(true);
    const offline = getAIAdapter("openai", (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    const netErr = await offline.generateJSON({ apiKey: "k", model: "m", system: "s", prompt: "p" }).catch((e) => e);
    expect(netErr.code).toBe("network");
  });

  it("gemini sends the key in a header, never in the URL, and ignores thought parts", async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    const adapter = getAIAdapter("gemini", mockFetch(200, {
      candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: '{"ok":true}' }] }, finishReason: "STOP" }],
    }, cap));
    const res = await adapter.generateJSON({ apiKey: "secret-key", model: "gemini-x", system: "s", prompt: "p" });
    expect(res.text).toBe('{"ok":true}');
    expect(cap.url).not.toContain("secret-key");
    expect((cap.init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
  });

  it("gemini reports safety blocks", async () => {
    const adapter = getAIAdapter("gemini", mockFetch(200, { promptFeedback: { blockReason: "SAFETY" } }));
    const err = await adapter.generateJSON({ apiKey: "k", model: "m", system: "s", prompt: "p" }).catch((e) => e);
    expect(err.code).toBe("safety_block");
  });

  it("gemini lists generateContent models on connection test", async () => {
    const adapter = getAIAdapter("gemini", mockFetch(200, {
      models: [
        { name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding", supportedGenerationMethods: ["embedContent"] },
      ],
    }));
    const res = await adapter.testConnection("k");
    expect(res.models).toEqual(["gemini-b"]);
  });

  it("anthropic and openai parse successful responses", async () => {
    const a = getAIAdapter("anthropic", mockFetch(200, { content: [{ type: "text", text: '{"x":1}' }] }));
    expect((await a.generateJSON({ apiKey: "k", model: "m", system: "s", prompt: "p" })).text).toBe('{"x":1}');
    const o = getAIAdapter("openai", mockFetch(200, { choices: [{ message: { content: '{"y":2}' } }] }));
    expect((await o.generateJSON({ apiKey: "k", model: "m", system: "s", prompt: "p" })).text).toBe('{"y":2}');
  });

  it("rejects empty responses", async () => {
    const o = getAIAdapter("openrouter", mockFetch(200, { choices: [{ message: { content: "" } }] }));
    const err = await o.generateJSON({ apiKey: "k", model: "m", system: "s", prompt: "p" }).catch((e) => e);
    expect(err.code).toBe("invalid_response");
  });
});
