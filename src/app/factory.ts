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
import {
  CommandHookDispatcher,
  mergeHookConfigs,
  parseHookConfig,
  type HookConfig,
} from "../extensions/hooks.js";
import { collectPluginHooks, enabledPluginDirs } from "../extensions/plugins.js";
import { AutoMemoryStore } from "../storage/autoMemory.js";
import { projectDir } from "../util/paths.js";
import { discoverCommands, type CommandDefinition } from "../extensions/commands.js";
import { discoverSkills, type SkillMetadata } from "../extensions/skills.js";
import { discoverAgents, type AgentDefinition } from "../extensions/customAgents.js";
import { discoverStyles, findStyle, type OutputStyle } from "../extensions/styles.js";
import { createSkillTool } from "../tools/skill.js";
import { createAgentTool } from "../tools/agent.js";
import { narrowPermissionMode, type SubagentRunner } from "./subagent.js";
import { buildSystemPrompt, promptHash, type SystemPromptOptions } from "../core/context.js";
import { createCoreTools, toolSpecs } from "../tools/index.js";
import { BudgetGuard, type Pricing } from "../providers/budget.js";
import { isTrusted } from "./trust.js";
import { Agent } from "./agent.js";
import type { Provider } from "../contracts/provider.js";
import type { Question, QuestionResult, Tool } from "../contracts/tool.js";
import { McpClient } from "../mcp/client.js";
import { createMcpTools } from "../mcp/tools.js";
import type { McpServerSettings } from "../mcp/management.js";
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
  autoCompactThreshold?: number | undefined;
  hooks?: HookConfig | undefined;
  outputStyle?: string | undefined;
  restricted?: boolean | undefined;
  safeMode?: boolean | undefined;
  bare?: boolean | undefined;
  allowedTools?: string[] | undefined;
  allowRules?: string[] | undefined;
  denyRules?: string[] | undefined;
  askRules?: string[] | undefined;
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
  commands: CommandDefinition[];
  skills: SkillMetadata[];
  agents: AgentDefinition[];
  styles: OutputStyle[];
  outputStyle: string;
  autoMemory: AutoMemoryStore;
  mcpClients: McpClient[];
}

function parseMcpServerSettings(
  raw: unknown,
): Array<{ name: string; config: McpServerSettings }> {
  if (raw === null || typeof raw !== "object") return [];
  const result: Array<{ name: string; config: McpServerSettings }> = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (record.enabled === false) continue;
    const command = typeof record.command === "string" ? record.command : undefined;
    const url = typeof record.url === "string" ? record.url : undefined;
    if (!command && !url) continue;
    const type =
      record.type === "sse" || record.type === "http" || record.type === "stdio"
        ? record.type
        : url
          ? "http"
          : "stdio";
    result.push({
      name,
      config: {
        type,
        ...(command === undefined ? {} : { command }),
        ...(Array.isArray(record.args) ? { args: record.args.map(String) } : {}),
        ...(url === undefined ? {} : { url }),
        ...(typeof record.timeoutMs === "number" ? { timeoutMs: record.timeoutMs } : {}),
      },
    });
  }
  return result;
}

function displayProviderAuthError(): KeycodeError {
  return new KeycodeError(
    "PROVIDER_AUTH",
    [
      "No model provider is configured.",
      "Free options:",
      "  - Gemini: set GEMINI_API_KEY (https://aistudio.google.com/apikey)",
      "  - Groq: set GROQ_API_KEY (https://console.groq.com/keys)",
      "  - Ollama: install from https://ollama.com and run `ollama pull gemma4:e2b`",
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
  const allowCustomizations = options.safeMode !== true;
  const pluginDirs = enabledPluginDirs(home);
  const skills = allowCustomizations
    ? discoverSkills({ cwd, home, trusted, extraDirs: pluginDirs.map((dir) => join(dir, "skills")) })
    : [];
  const agentDefinitions = allowCustomizations
    ? discoverAgents({ cwd, home, trusted, extraDirs: pluginDirs.map((dir) => join(dir, "agents")) })
    : [];
  const styles = discoverStyles({ cwd, home, trusted });
  const styleName = options.outputStyle ?? settings.outputStyle ?? "default";
  const activeStyle = findStyle(styles, styleName);

  const mcpClients: McpClient[] = [];
  const mcpTools: Tool[] = [];
  for (const entry of parseMcpServerSettings(settings.mcpServers)) {
    let client: McpClient | undefined;
    try {
      client = new McpClient(entry.name, { ...entry.config, cwd });
      await client.connect();
      const tools = await createMcpTools(client);
      mcpClients.push(client);
      mcpTools.push(...tools);
    } catch (error) {
      await client?.close();
      warnings.push(`MCP ${entry.name}: ${(error as Error).message}`);
    }
  }

  let subagentRunner: SubagentRunner | undefined;
  const baseTools = [...(options.tools ?? createCoreTools()), ...mcpTools];
  const withExtensions = baseTools.some((tool) => tool.name === "Skill")
    ? baseTools
    : [...baseTools, createSkillTool(skills)];
  const managedDenied = managedDeniedTools(home, env);
  const restrictedDenied = new Set(["Bash", "PowerShell", "Agent", "WebFetch", "CodeMode"]);
  const allowedByFlag = options.allowedTools ?? [];
  const tools = [
    ...withExtensions,
    createAgentTool(agentDefinitions, async (spec, ctx) => {
      if (!subagentRunner) {
        throw new KeycodeError("CONFIG_INVALID", "Subagent runner is not available");
      }
      return subagentRunner(spec, ctx);
    }),
  ]
    .filter((tool) => !managedDenied.includes(tool.name))
    .filter(
      (tool) =>
        options.restricted !== true ||
        !restrictedDenied.has(tool.name) ||
        allowedByFlag.includes(tool.name),
    );
  const specs = toolSpecs(tools);

  const roots = [cwd, ...(options.addDirs ?? []).map((dir) => resolve(cwd, dir))];
  const commands = allowCustomizations
    ? discoverCommands({
        cwd,
        home,
        trusted,
        extraDirs: pluginDirs.map((dir) => join(dir, "commands")),
      })
    : [];
  const memory = loadMemory({
    cwd,
    home,
    ...(options.noMemory === true || options.bare === true ? { noMemory: true } : {}),
  });
  warnings.push(...memory.warnings);
  const autoMemory = new AutoMemoryStore(join(projectDir(home, cwd), "memory.json"));
  const recalled = autoMemory.recall();
  const memoryText = [
    memory.text,
    recalled.length > 0 ? `# Auto-memory\n\n${recalled.map((entry) => `- ${entry.text}`).join("\n")}` : "",
  ]
    .filter((section) => section.trim().length > 0)
    .join("\n\n");

  const promptOptions: SystemPromptOptions = {
    cwd,
    model,
    provider: providerId,
    memoryText,
    tools: specs,
    ...(options.systemPrompt === undefined ? {} : { basePrompt: options.systemPrompt }),
    ...(options.appendSystemPrompt === undefined ? {} : { appendPrompt: options.appendSystemPrompt }),
    ...(activeStyle?.body ? { outputStyle: activeStyle.body } : {}),
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
  const rules: PermissionRule[] = [
    ...rulesFromPermissionSettings(permissions),
    ...(options.denyRules ?? []).map((raw) => parseRule(raw, "session", "deny")),
    ...(options.askRules ?? []).map((raw) => parseRule(raw, "session", "ask")),
    ...(options.allowRules ?? []).map((raw) => parseRule(raw, "session", "allow")),
  ];
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
    onPromptUnavailable: "deny",
  });

  const checkpoints = new CheckpointStore(home, cwd, store);
  const hookConfig =
    options.bare === true || options.safeMode === true
      ? {}
      : mergeHookConfigs(
          options.hooks ?? (trusted ? parseHookConfig(settings.hooks) : {}),
          collectPluginHooks(home),
        );
  const hooks =
    Object.keys(hookConfig).length > 0
      ? new CommandHookDispatcher(hookConfig, { cwd, home, env })
      : undefined;
  const autoCompactThreshold = options.autoCompactThreshold ?? settings.autoCompactThreshold;
  const maxBudget = options.maxBudgetUsd ?? settings.maxBudgetUsd;
  const budget = maxBudget === undefined ? undefined : new BudgetGuard(maxBudget, options.pricing);

  let fallback = options.fallback;
  if (!fallback && options.fallbackModel) {
    fallback = { provider: resolved.provider, model: options.fallbackModel };
  }

  const logger = options.logger ?? (options.debug === true ? createLogger({ debug: true }) : silentLogger);

  subagentRunner = async (spec, ctx) => {
    const childHeader = store.create({
      provider: providerId,
      model: spec.model ?? model,
      parentId: sessionId,
      ...(spec.name === undefined ? {} : { name: spec.name }),
    });
    const childTools = tools.filter(
      (tool) => tool.name !== "Agent" && (spec.tools === undefined || spec.tools.includes(tool.name)),
    );
    const childMode = narrowPermissionMode(mode, spec.permissionMode);
    const childPermissions = new PermissionService({
      mode: childMode,
      rules,
      cwd,
      roots,
      audit,
      sessionId: childHeader.id,
      managedDenyTools: managedDeniedTools(home, env),
      trusted,
      ...(options.prompter === undefined ? {} : { prompter: options.prompter }),
    });
    const childSystemPrompt =
      spec.body === undefined
        ? systemPrompt
        : `${systemPrompt}\n\n# Subagent instructions\n\n${spec.body}`;
    const childAgent = new Agent({
      sessionId: childHeader.id,
      store,
      provider: resolved.provider,
      providerId,
      model: spec.model ?? model,
      tools: childTools,
      permissions: childPermissions,
      home,
      cwd,
      workspaceRoots: roots,
      systemPrompt: childSystemPrompt,
      buildPrompt,
      ...(budget === undefined ? {} : { budget }),
      ...(options.pricing === undefined ? {} : { pricing: options.pricing }),
      ...(resolved.capabilities === undefined ? {} : { capabilities: resolved.capabilities }),
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      checkpointStore: checkpoints,
      ...(hooks === undefined ? {} : { hooks }),
      ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
      logger,
    });
    await hooks?.run("SubagentStart", {
      session_id: childHeader.id,
      hook_event_name: "SubagentStart",
      cwd,
    });
    const childResult = await childAgent.runTurn(spec.prompt, ctx.signal);
    await hooks?.run("SubagentStop", {
      session_id: childHeader.id,
      hook_event_name: "SubagentStop",
      cwd,
      stop_reason: childResult.stopReason,
    });
    return { sessionId: childHeader.id, text: childResult.text };
  };

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
    ...(autoCompactThreshold === undefined ? {} : { autoCompactThreshold }),
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    ...(fallback === undefined ? {} : { fallback }),
    checkpointStore: checkpoints,
    ...(options.askQuestions === undefined ? {} : { askQuestions: options.askQuestions }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(hooks === undefined ? {} : { hooks }),
    logger,
  });

  await hooks?.run("SessionStart", {
    session_id: sessionId,
    hook_event_name: "SessionStart",
    cwd,
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
    commands,
    skills,
    agents: agentDefinitions,
    styles,
    outputStyle: activeStyle?.name ?? "default",
    autoMemory,
    mcpClients,
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
