import type { FetchLike } from "../http";
import type { AIProviderAdapter, AIProviderId } from "../types";
import { createAnthropicAdapter } from "./anthropic";
import { createGeminiAdapter } from "./gemini";
import { createOpenAIAdapter, createOpenRouterAdapter } from "./openai-compatible";

export function getAIAdapter(id: AIProviderId, fetchImpl: FetchLike = fetch): AIProviderAdapter {
  switch (id) {
    case "gemini":
      return createGeminiAdapter(fetchImpl);
    case "anthropic":
      return createAnthropicAdapter(fetchImpl);
    case "openai":
      return createOpenAIAdapter(fetchImpl);
    case "openrouter":
      return createOpenRouterAdapter(fetchImpl);
  }
}
