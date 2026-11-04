export const AI_PROVIDER_IDS = ["gemini", "anthropic", "openai", "openrouter"] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export type ProviderErrorCode =
  | "auth"
  | "permission"
  | "rate_limit"
  | "quota"
  | "bad_request"
  | "not_found"
  | "server"
  | "network"
  | "timeout"
  | "invalid_response"
  | "safety_block"
  | "not_configured";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly provider: string;

  constructor(provider: string, code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.code = code;
    this.status = status;
    this.retryable = code === "rate_limit" || code === "server" || code === "network" || code === "timeout";
  }
}

export const PROVIDER_ERROR_MESSAGES: Record<ProviderErrorCode, string> = {
  auth: "The API key was rejected. Check that it is correct and active.",
  permission: "The API key doesn't have access to this model or API.",
  rate_limit: "The provider is rate limiting requests. Try again shortly.",
  quota: "The provider account has exhausted its quota or billing limit.",
  bad_request: "The provider rejected the request. Check the model name.",
  not_found: "The model or endpoint was not found. Check the model name.",
  server: "The provider had a temporary server error.",
  network: "Couldn't reach the provider.",
  timeout: "The provider took too long to respond.",
  invalid_response: "The provider returned a response that couldn't be used.",
  safety_block: "The provider blocked the response with its safety filters.",
  not_configured: "No AI provider is configured.",
};

export interface GenerateRequest {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  models: string[];
  message: string;
}

export interface AIProviderAdapter {
  id: AIProviderId;
  label: string;
  /** Validates the key and lists models available to it. */
  testConnection(apiKey: string): Promise<ConnectionTestResult>;
  /** Generates text expected to be a single JSON object. */
  generateJSON(req: GenerateRequest): Promise<GenerateResult>;
}

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  description: string;
  keyPlaceholder: string;
  keyHelpUrl: string;
  modelPlaceholder: string;
}

export const AI_PROVIDERS: AIProviderInfo[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini API (Google AI Studio key).",
    keyPlaceholder: "AIza…",
    keyHelpUrl: "https://aistudio.google.com/app/apikey",
    modelPlaceholder: "Select after testing the connection",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    description: "Claude Messages API.",
    keyPlaceholder: "sk-ant-…",
    keyHelpUrl: "https://console.anthropic.com/settings/keys",
    modelPlaceholder: "Select after testing the connection",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "OpenAI Chat Completions API.",
    keyPlaceholder: "sk-…",
    keyHelpUrl: "https://platform.openai.com/api-keys",
    modelPlaceholder: "Select after testing the connection",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "OpenAI-compatible gateway to many models.",
    keyPlaceholder: "sk-or-…",
    keyHelpUrl: "https://openrouter.ai/keys",
    modelPlaceholder: "e.g. vendor/model-name",
  },
];
