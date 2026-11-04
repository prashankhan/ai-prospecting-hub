import { requestJSON, type FetchLike } from "../http";
import { ProviderError, type AIProviderAdapter, type AIProviderId } from "../types";

interface ChatCompletion {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
interface ModelList {
  data?: { id: string }[];
}

interface Options {
  id: Extract<AIProviderId, "openai" | "openrouter">;
  label: string;
  baseUrl: string;
  /** Endpoint used to verify the key (OpenRouter's model list is public, so it has a key endpoint). */
  verifyPath: string;
  extraHeaders?: Record<string, string>;
  tokenParam: "max_completion_tokens" | "max_tokens";
}

function createAdapter(opts: Options, fetchImpl: FetchLike): AIProviderAdapter {
  const headers = (apiKey: string) => ({
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    ...opts.extraHeaders,
  });
  return {
    id: opts.id,
    label: opts.label,

    async testConnection(apiKey) {
      await requestJSON<unknown>(opts.id, `${opts.baseUrl}${opts.verifyPath}`, {
        method: "GET", headers: headers(apiKey), timeoutMs: 15_000,
      }, fetchImpl);
      const list = await requestJSON<ModelList>(opts.id, `${opts.baseUrl}/models`, {
        method: "GET", headers: headers(apiKey), timeoutMs: 15_000,
      }, fetchImpl);
      const models = (list.data ?? []).map((m) => m.id).sort();
      return { ok: true, models, message: `Connected. ${models.length} models available.` };
    },

    async generateJSON({ apiKey, model, system, prompt, maxOutputTokens = 4096 }) {
      const data = await requestJSON<ChatCompletion>(opts.id, `${opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: `${system}\n\nRespond with a single JSON object only.` },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          [opts.tokenParam]: maxOutputTokens,
        }),
      }, fetchImpl);
      const choice = data.choices?.[0];
      if (choice?.message?.refusal) throw new ProviderError(opts.id, "safety_block", "Model declined");
      if (choice?.finish_reason === "content_filter") throw new ProviderError(opts.id, "safety_block", "Content filtered");
      const text = choice?.message?.content ?? "";
      if (!text) throw new ProviderError(opts.id, "invalid_response", "Empty response");
      return { text, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens };
    },
  };
}

export function createOpenAIAdapter(fetchImpl: FetchLike = fetch) {
  return createAdapter(
    { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", verifyPath: "/models", tokenParam: "max_completion_tokens" },
    fetchImpl,
  );
}

export function createOpenRouterAdapter(fetchImpl: FetchLike = fetch) {
  return createAdapter(
    {
      id: "openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      verifyPath: "/key",
      tokenParam: "max_tokens",
      extraHeaders: { "X-Title": "AI Prospecting Hub" },
    },
    fetchImpl,
  );
}
