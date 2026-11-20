import type { ModelCapabilities } from "../contracts/provider.js";

export interface ProviderPreset {
  id: string;
  displayName: string;
  kind: "openai-compatible" | "anthropic";
  baseUrl: string;
  apiKeyEnv: string | null;
  defaultModel: string;
  models: string[];
  headers: Record<string, string>;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  free: boolean;
  local: boolean;
  notes?: string | undefined;
}

const ALL: ModelCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  jsonSchema: true,
  thinking: false,
};

export const PRESETS: Record<string, ProviderPreset> = {
  gemini: {
    id: "gemini",
    displayName: "Google Gemini (free tier)",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    headers: {},
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    capabilities: ALL,
    free: true,
    local: false,
  },
  groq: {
    id: "groq",
    displayName: "Groq (free tier)",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
    headers: {},
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    capabilities: { ...ALL, vision: false, jsonSchema: false },
    free: true,
    local: false,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter (free models)",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: "qwen/qwen3-coder:free",
    models: ["qwen/qwen3-coder:free", "deepseek/deepseek-r1:free"],
    headers: { "HTTP-Referer": "https://github.com/keycode", "X-Title": "keycode" },
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    capabilities: { ...ALL, jsonSchema: false },
    free: true,
    local: false,
  },
  cerebras: {
    id: "cerebras",
    displayName: "Cerebras (free tier)",
    kind: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    defaultModel: "llama-3.3-70b",
    models: ["llama-3.3-70b", "qwen-3-32b"],
    headers: {},
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    capabilities: { ...ALL, vision: false, jsonSchema: false },
    free: true,
    local: false,
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral (free tier)",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    defaultModel: "mistral-small-latest",
    models: ["mistral-small-latest", "codestral-latest"],
    headers: {},
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    capabilities: ALL,
    free: true,
    local: false,
  },
  github: {
    id: "github",
    displayName: "GitHub Models",
    kind: "openai-compatible",
    baseUrl: "https://models.github.ai/inference",
    apiKeyEnv: "GITHUB_TOKEN",
    defaultModel: "openai/gpt-4o-mini",
    models: ["openai/gpt-4o-mini", "openai/gpt-4.1"],
    headers: {},
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    capabilities: { ...ALL, jsonSchema: false },
    free: true,
    local: false,
  },
  ollama: {
    id: "ollama",
    displayName: "Ollama (local)",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKeyEnv: null,
    defaultModel: "qwen3-coder",
    models: ["qwen3-coder", "llama3.1", "qwen2.5-coder"],
    headers: {},
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    capabilities: { ...ALL, vision: false, jsonSchema: false },
    free: true,
    local: true,
  },
  lmstudio: {
    id: "lmstudio",
    displayName: "LM Studio (local)",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKeyEnv: null,
    defaultModel: "local-model",
    models: [],
    headers: {},
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    capabilities: { ...ALL, vision: false, jsonSchema: false },
    free: true,
    local: true,
  },
  llamacpp: {
    id: "llamacpp",
    displayName: "llama.cpp (local)",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKeyEnv: null,
    defaultModel: "local-model",
    models: [],
    headers: {},
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    capabilities: { ...ALL, vision: false, jsonSchema: false },
    free: true,
    local: true,
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic (optional, paid)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-5",
    models: ["claude-sonnet-4-5", "claude-haiku-4-5"],
    headers: {},
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    capabilities: { ...ALL, thinking: true },
    free: false,
    local: false,
  },
};

export const FREE_PRESET_IDS = Object.values(PRESETS)
  .filter((preset) => preset.free)
  .map((preset) => preset.id);

export function getPreset(id: string): ProviderPreset | undefined {
  return PRESETS[id];
}
