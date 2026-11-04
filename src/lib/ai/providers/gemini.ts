import { requestJSON, type FetchLike } from "../http";
import { ProviderError, type AIProviderAdapter } from "../types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  thought?: boolean;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
interface GeminiModelList {
  models?: { name: string; supportedGenerationMethods?: string[] }[];
  nextPageToken?: string;
}

export function createGeminiAdapter(fetchImpl: FetchLike = fetch): AIProviderAdapter {
  return {
    id: "gemini",
    label: "Google Gemini",

    async testConnection(apiKey) {
      const models: string[] = [];
      let pageToken: string | undefined;
      for (let i = 0; i < 5; i++) {
        const qs = new URLSearchParams({ pageSize: "100" });
        if (pageToken) qs.set("pageToken", pageToken);
        const data = await requestJSON<GeminiModelList>(
          "gemini",
          `${BASE}/models?${qs}`,
          { method: "GET", headers: { "x-goog-api-key": apiKey }, timeoutMs: 15_000 },
          fetchImpl,
        );
        for (const m of data.models ?? []) {
          if (m.supportedGenerationMethods?.includes("generateContent")) models.push(m.name.replace(/^models\//, ""));
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
      return { ok: true, models: models.sort(), message: `Connected. ${models.length} models available.` };
    },

    async generateJSON({ apiKey, model, system, prompt, maxOutputTokens = 4096, temperature = 0.4 }) {
      const data = await requestJSON<GeminiResponse>(
        "gemini",
        `${BASE}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens, responseMimeType: "application/json" },
          }),
        },
        fetchImpl,
      );
      if (data.promptFeedback?.blockReason) {
        throw new ProviderError("gemini", "safety_block", `Prompt blocked: ${data.promptFeedback.blockReason}`);
      }
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason === "SAFETY") throw new ProviderError("gemini", "safety_block", "Response blocked");
      const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      if (!text) {
        throw new ProviderError("gemini", "invalid_response", `Empty response (${candidate?.finishReason ?? "no candidate"})`);
      }
      return {
        text,
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
      };
    },
  };
}
