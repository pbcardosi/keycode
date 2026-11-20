import type { ModelCapabilities, Provider } from "../contracts/provider.js";
import type { Settings } from "../storage/schema.js";
import { KeycodeError } from "../util/errors.js";
import { capabilitiesFrom } from "./capabilities.js";
import { resolveCredential } from "./credentials.js";
import { FakeProvider, parseFakeScript, type FakeScript } from "./fake.js";
import { OpenAiCompatibleProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { getPreset, type ProviderPreset } from "./presets.js";
import { RetryingProvider, type RetryOptions } from "./retry.js";

const ALIASES: Record<string, string> = {
  google: "gemini",
  "google-gemini": "gemini",
  "lm-studio": "lmstudio",
  lm_studio: "lmstudio",
  "llama.cpp": "llamacpp",
  llama_cpp: "llamacpp",
  "github-models": "github",
  "github_models": "github",
};

export function canonicalProviderId(id: string): string {
  const lower = id.toLowerCase();
  return ALIASES[lower] ?? lower;
}

function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export interface CreateProviderOptions {
  id: string;
  home: string;
  settings?: Settings | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  fetchImpl?: typeof fetch | undefined;
  retry?: RetryOptions | undefined;
  fakeScript?: FakeScript | undefined;
}

export interface ResolvedProvider {
  provider: Provider;
  id: string;
  preset: ProviderPreset | undefined;
  defaultModel: string;
  free: boolean;
  local: boolean;
  capabilities: ModelCapabilities;
  contextWindow: number;
}

export function createProvider(options: CreateProviderOptions): ResolvedProvider {
  const env = options.env ?? process.env;
  const id = canonicalProviderId(options.id);
  const preset = getPreset(id);
  const config = options.settings?.providers?.[id];

  if (id === "fake" || config?.kind === "fake") {
    let script = options.fakeScript;
    if (script === undefined && env.KEYCODE_FAKE_SCRIPT) {
      script = parseFakeScript(env.KEYCODE_FAKE_SCRIPT);
    }
    const fake = new FakeProvider({
      script,
      model: env.KEYCODE_FAKE_MODEL ?? options.settings?.model,
      ...(options.settings?.autoCompactThreshold === undefined
        ? {}
        : { contextWindow: options.settings.autoCompactThreshold }),
    });
    return {
      provider: new RetryingProvider(fake, options.retry ?? { attempts: 1 }),
      id,
      preset: undefined,
      defaultModel: env.KEYCODE_FAKE_MODEL ?? "fake-model",
      free: true,
      local: true,
      capabilities: capabilitiesFrom(undefined),
      contextWindow: 128_000,
    };
  }

  if (!preset && !config) {
    throw new KeycodeError(
      "PROVIDER_NOT_FOUND",
      `Unknown provider "${options.id}". Known providers: ${availableProviderIds().join(", ")}.`,
    );
  }

  const baseUrl = config?.baseUrl ?? preset?.baseUrl;
  if (!baseUrl) {
    throw new KeycodeError("CONFIG_INVALID", `Provider "${id}" needs a baseUrl`);
  }

  const kind = config?.kind ?? preset?.kind ?? "openai-compatible";
  const apiKeyEnv = config?.apiKeyEnv === undefined ? preset?.apiKeyEnv ?? null : config.apiKeyEnv;
  const local = preset?.local ?? isLoopbackUrl(baseUrl);
  const free = preset?.free ?? local;

  const credential = resolveCredential({
    providerId: id,
    apiKeyEnv,
    apiKey: config?.apiKey,
    apiKeyHelper: config?.apiKeyHelper,
    helperTtlMs: config?.helperTtlMs,
    home: options.home,
    env,
  });

  if (!local && !credential.key) {
    const setup = apiKeyEnv
      ? `Set ${apiKeyEnv} or run "keycode auth set ${id}".`
      : `Run "keycode auth set ${id}".`;
    throw new KeycodeError("PROVIDER_AUTH", `No API key for ${id}. ${setup}`);
  }

  const defaultModel =
    config?.defaultModel ?? preset?.defaultModel ?? options.settings?.model ?? "default";
  const common = {
    apiKey: credential.key,
    headers: { ...preset?.headers, ...config?.headers },
    models: config?.models ?? preset?.models,
    defaultModel,
    contextWindow: config?.contextWindow ?? preset?.contextWindow,
    maxOutputTokens: config?.maxOutputTokens ?? preset?.maxOutputTokens,
    capabilities: config?.capabilities,
    fetchImpl: options.fetchImpl,
  };

  const inner: Provider =
    kind === "anthropic"
      ? new AnthropicProvider({ id, baseUrl, ...common })
      : new OpenAiCompatibleProvider({ id, baseUrl, ...common });

  const provider = new RetryingProvider(inner, options.retry ?? { attempts: 3 });

  return {
    provider,
    id,
    preset,
    defaultModel,
    free,
    local,
    capabilities: capabilitiesFrom(config?.capabilities ?? preset?.capabilities),
    contextWindow: config?.contextWindow ?? preset?.contextWindow ?? 128_000,
  };
}

export function availableProviderIds(): string[] {
  return [
    "gemini",
    "groq",
    "openrouter",
    "cerebras",
    "mistral",
    "github",
    "ollama",
    "lmstudio",
    "llamacpp",
    "anthropic",
    "fake",
  ];
}
