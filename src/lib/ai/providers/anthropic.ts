import { requestJSON, type FetchLike } from "../http";
import { ProviderError, type AIProviderAdapter } from "../types";

const BASE = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";

interface AnthropicMessage {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}
interface AnthropicModelList {
  data?: { id: string }[];
  has_more?: boolean;
  last_id?: string;
}

export function createAnthropicAdapter(fetchImpl: FetchLike = fetch): AIProviderAdapter {
  const headers = (apiKey: string) => ({
    "x-api-key": apiKey,
    "anthropic-version": VERSION,
    "content-type": "application/json",
  });
  return {
    id: "anthropic",
    label: "Anthropic Claude",

    async testConnection(apiKey) {
      const data = await requestJSON<AnthropicModelList>(
        "anthropic",
        `${BASE}/models?limit=100`,
        { method: "GET", headers: headers(apiKey), timeoutMs: 15_000 },
        fetchImpl,
      );
      const models = (data.data ?? []).map((m) => m.id);
      return { ok: true, models, message: `Connected. ${models.length} models available.` };
    },

    async generateJSON({ apiKey, model, system, prompt, maxOutputTokens = 4096 }) {
      const data = await requestJSON<AnthropicMessage>(
        "anthropic",
        `${BASE}/messages`,
        {
          method: "POST",
          headers: headers(apiKey),
          body: JSON.stringify({
            model,
            max_tokens: maxOutputTokens,
            system: `${system}\n\nRespond with a single JSON object only.`,
            messages: [{ role: "user", content: prompt }],
          }),
        },
        fetchImpl,
      );
      if (data.stop_reason === "refusal") throw new ProviderError("anthropic", "safety_block", "Model declined");
      const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      if (!text) throw new ProviderError("anthropic", "invalid_response", "Empty response");
      return { text, inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens };
    },
  };
}
