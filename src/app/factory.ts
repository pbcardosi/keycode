import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Settings } from "../storage/schema.js";
import type { PermissionMode, PermissionRule } from "../contracts/permissions.js";
import { loadSettings, permissionSettings } from "../storage/settings.js";
import { keycodeHome, managedSettingsPath } from "../util/paths.js";
import { KeycodeError } from "../util/errors.js";
import { createLogger, silentLogger, type Logger } from "../util/logger.js";
import { createProvider, canonicalProviderId, type ResolvedProvider } from "../providers/registry.js";
import { getPreset, PRESETS } from "../providers/presets.js";
import { SessionStore } from "../storage/session.js";
import { CheckpointStore } from "../storage/checkpoints.js";
import { AuditLog } from "../permissions/audit.js";
import {
  PermissionService,
  rulesFromPermissionSettings,
  type PermissionPrompter,
} from "../permissions/pipeline.js";
import { loadMemory } from "../storage/memory.js";
import { parseRule } from "../permissions/rules.js";
import type { RuleScope } from "../contracts/permissions.js";
import { buildSystemPrompt, promptHash, type SystemPromptOptions } from "../core/context.js";
import { createCoreTools, toolSpecs } from "../tools/index.js";
import { BudgetGuard, type Pricing } from "../providers/budget.js";
import { isTrusted } from "./trust.js";
import { Agent } from "./agent.js";
import type { Provider } from "../contracts/provider.js";
import type { Question, QuestionResult } from "../contracts/tool.js";
import type { AgentEvent } from "./agent.js";
import { atomicWrite } from "../util/fsx.js";

export interface AgentSetupOptions {
  cwd: string;
  home?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  fallbackModel?: string | undefined;
  fallback?: { provider: Provider; model: string } | undefined;
  sessionId?: string | undefined;
  resume?: string | true | undefined;
  continue?: boolean | undefined;
  forkSession?: boolean | undefined;
  name?: string | undefined;
  permissionMode?: PermissionMode | undefined;
  maxBudgetUsd?: number | undefined;
  pricing?: Pricing | undefined;
  systemPrompt?: string | undefined;
  appendSystemPrompt?: string | undefined;
  noMemory?: boolean | undefined;
  addDirs?: string[] | undefined;
  prompter?: PermissionPrompter | undefined;
  askQuestions?: ((questions: Question[]) => Promise<QuestionResult>) | undefined;
  onEvent?: ((event: AgentEvent) => void) | undefined;
  debug?: boolean | undefined;
  logger?: Logger | undefined;
  fetchImpl?: typeof fetch | undefined;
  tools?: ReturnType<typeof createCoreTools> | undefined;
  trust?: boolean | undefined;
}

export interface AgentSetup {
  agent: Agent;
  store: SessionStore;
  sessionId: string;
  sessionName: string;
  providerId: string;
  model: string;
  settings: Settings;
  warnings: string[];
  home: string;
  permissionMode: PermissionMode;
  checkpoints: CheckpointStore;
  toolNames: string[];
}

function displayProviderAuthError(): KeycodeError {
  return new KeycodeError(
    "PROVIDER_AUTH",
    [
      "No model provider is configured.",
      "Free options:",
      "  - Gemini: set GEMINI_API_KEY (https://aistudio.google.com/apikey)",
      "  - Groq: set GROQ_API_KEY (https://console.groq.com/keys)",
      "  - Ollama: install from https://ollama.com and run `ollama pull qwen3-coder`",
      "Then run `keycode --provider gemini` or `keycode --provider ollama`.",
    ].join("\n"),
  );
}

async function ollamaHealthy(fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl("http://127.0.0.1:11434/v1/models", {
      signal: AbortSignal.timeout(400),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function autodetectProvider(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<string> {
  if (await ollamaHealthy(fetchImpl)) return "ollama";
  const order: Array<[string, string]> = [
    ["GEMINI_API_KEY", "gemini"],
    ["GROQ_API_KEY", "groq"],
    ["OPENROUTER_API_KEY", "openrouter"],
    ["CEREBRAS_API_KEY", "cerebras"],
    ["MISTRAL_API_KEY", "mistral"],
    ["GITHUB_TOKEN", "github"],
    ["ANTHROPIC_API_KEY", "anthropic"],
  ];
  for (const [envName, id] of order) {
    if (env[envName] && env[envName]?.length > 0) return id;
  }
  throw displayProviderAuthError();
}

export function managedDeniedTools(home: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const path = managedSettingsPath(env);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { permissions?: { deny?: unknown } };
    const deny = Array.isArray(raw.permissions?.deny) ? raw.permissions.deny : [];
    return deny
      .filter((value): value is string => typeof value === "string")
      .filter((value) => !value.includes("("))
      .map((value) => value.trim());
  } catch {
    return [];
  }
}

function persistAllowRule(cwd: string, raw: string): void {
  const path = join(cwd, ".keycode", "settings.local.json");
  let current: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      current = {};
    }
  }
  const permissions = (current.permissions ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  if (!allow.includes(raw)) allow.push(raw);
  current.permissions = { ...permissions, allow };
  atomicWrite(path, `${JSON.stringify(current, null, 2)}\n`);
}

export async function createAgentSetup(options: AgentSetupOptions): Promise<AgentSetup> {
  const env = options.env ?? process.env;
  const home = options.home ?? keycodeHome(env);
  const cwd = resolve(options.cwd);
  const warnings: string[] = [];
  const trusted = options.trust ?? isTrusted(home, cwd);
  const loaded = loadSettings({ cwd, home, env, projectLayers: trusted });
  const settings = loaded.settings;
  warnings.push(...loaded.warnings);
  const store = new SessionStore(home, cwd);

  let existing = null;
  if (options.resume !== undefined) {
    const meta = options.resume === true ? store.latest() : store.resolve(options.resume);
    if (!meta) throw new KeycodeError("SESSION_CORRUPT", "No session to resume in this directory");
    existing = store.use(meta.id);
    if (options.forkSession === true) {
      existing = store.use(store.fork(meta.id, options.name).id);
    }
  } else if (options.continue === true) {
    const meta = store.latest();
    if (!meta) throw new KeycodeError("SESSION_CORRUPT", "No session to continue in this directory");
    existing = store.use(meta.id);
    if (options.forkSession === true) {
      existing = store.use(store.fork(meta.id, options.name).id);
    }
  }

  const providerId = canonicalProviderId(
    options.provider ??
      existing?.header.provider ??
      settings.provider ??
      env.KEYCODE_PROVIDER ??
      (await autodetectProvider(env, options.fetchImpl ?? fetch)),
  );

  const preset = getPreset(providerId);
  const model =
    options.model ??
    existing?.header.model ??
    settings.model ??
    preset?.defaultModel ??
    (providerId === "fake" ? "fake-model" : undefined);
  if (!model) throw new KeycodeError("CONFIG_INVALID", `No model configured for provider ${providerId}`);

  const resolved: ResolvedProvider = createProvider({
    id: providerId,
    home,
    settings,
    env,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });

  let sessionId: string;
  let sessionName: string;
  if (existing) {
    sessionId = existing.header.id;
    sessionName = existing.name;
  } else {
    const header = store.create({
      provider: providerId,
      model,
      ...(options.sessionId === undefined ? {} : { id: options.sessionId }),
      ...(options.name === undefined ? {} : { name: options.name }),
    });
    sessionId = header.id;
    sessionName = header.name ?? header.id.slice(0, 8);
  }

  const view = store.load(sessionId);
  const tools = (options.tools ?? createCoreTools()).filter(
    (tool) => !managedDeniedTools(home, env).includes(tool.name),
  );
  const specs = toolSpecs(tools);

  const roots = [cwd, ...(options.addDirs ?? []).map((dir) => resolve(cwd, dir))];
  const memory = loadMemory({ cwd, home, ...(options.noMemory === true ? { noMemory: true } : {}) });
  warnings.push(...memory.warnings);

  const promptOptions: SystemPromptOptions = {
    cwd,
    model,
    provider: providerId,
    memoryText: memory.text,
    tools: specs,
    ...(options.systemPrompt === undefined ? {} : { basePrompt: options.systemPrompt }),
    ...(options.appendSystemPrompt === undefined ? {} : { appendPrompt: options.appendSystemPrompt }),
    ...(settings.outputStyle === undefined ? {} : { outputStyle: settings.outputStyle }),
  };
  const buildPrompt = (): string => buildSystemPrompt(promptOptions);

  let systemPrompt: string;
  if (view.systemPrompt && view.summaries.length === 0) {
    systemPrompt = view.systemPrompt;
  } else {
    systemPrompt = buildPrompt();
    store.appendContext(sessionId, systemPrompt, promptHash(systemPrompt));
  }

  const permissions = permissionSettings(settings);
  const mode = options.permissionMode ?? permissions.defaultMode;
  const rules: PermissionRule[] = rulesFromPermissionSettings(permissions);
  const audit = new AuditLog(home);
  const permissionService = new PermissionService({
    mode,
    rules,
    cwd,
    roots,
    ...(options.prompter === undefined ? {} : { prompter: options.prompter }),
    audit,
    sessionId,
    managedDenyTools: managedDeniedTools(home, env),
    persistRule: (raw) => persistAllowRule(cwd, raw),
    trusted,
  });

  const checkpoints = new CheckpointStore(home, cwd, store);
  const maxBudget = options.maxBudgetUsd ?? settings.maxBudgetUsd;
  const budget = maxBudget === undefined ? undefined : new BudgetGuard(maxBudget, options.pricing);

  let fallback = options.fallback;
  if (!fallback && options.fallbackModel) {
    fallback = { provider: resolved.provider, model: options.fallbackModel };
  }

  const logger = options.logger ?? (options.debug === true ? createLogger({ debug: true }) : silentLogger);
  const agent = new Agent({
    sessionId,
    store,
    provider: resolved.provider,
    providerId,
    model,
    tools,
    permissions: permissionService,
    home,
    cwd,
    workspaceRoots: roots,
    systemPrompt,
    buildPrompt,
    ...(budget === undefined ? {} : { budget }),
    ...(options.pricing === undefined ? {} : { pricing: options.pricing }),
    ...(resolved.capabilities === undefined ? {} : { capabilities: resolved.capabilities }),
    ...(settings.autoCompactThreshold === undefined
      ? {}
      : { autoCompactThreshold: settings.autoCompactThreshold }),
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    ...(fallback === undefined ? {} : { fallback }),
    checkpointStore: checkpoints,
    ...(options.askQuestions === undefined ? {} : { askQuestions: options.askQuestions }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    logger,
  });

  return {
    agent,
    store,
    sessionId,
    sessionName,
    providerId,
    model,
    settings,
    warnings,
    home,
    permissionMode: mode,
    checkpoints,
    toolNames: tools.map((tool) => tool.name),
  };
}

export function applySettingsEnv(settings: Settings, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, ...(settings.env ?? {}) };
}

export function parseScopeRule(
  raw: string,
  scope: RuleScope,
  behavior: "allow" | "deny" | "ask",
): PermissionRule {
  return parseRule(raw, scope, behavior);
}

export function knownProviderIds(): string[] {
  return Object.keys(PRESETS);
}
