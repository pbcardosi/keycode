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
import { createSandboxPolicy, sandboxFallbackWarning } from "../sandbox/index.js";
import type { SandboxPolicy } from "../sandbox/index.js";
import {
  CommandHookDispatcher,
  mergeHookConfigs,
  parseHookConfig,
  type HookConfig,
} from "../extensions/hooks.js";
import { collectPluginHooks, enabledPluginDirs } from "../extensions/plugins.js";
import { AutoMemoryStore, extractMemory } from "../storage/autoMemory.js";
import { Notifier, terminalChannel, webhookChannel, type NotificationChannel } from "../notifications/index.js";
import { OtelExporter } from "../telemetry/otel.js";
import { telemetryEnabled } from "../privacy/index.js";
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
import { createLspTool } from "../tools/lsp.js";
import { createArtifactTool } from "../tools/artifact.js";
import { ArtifactStore } from "../artifacts/store.js";
import { createBrowserTool, type BrowserDriver } from "../integrations/browser.js";
import { createPlaywrightDriver } from "../integrations/playwrightDriver.js";
import { pathToFileURL } from "node:url";
import { BudgetGuard, type Pricing } from "../providers/budget.js";
import { trustStatus, trustWorkspace } from "./trust.js";
import { buildTrustManifest, type TrustManifest, type TrustState } from "./trustManifest.js";
import { Agent, type TurnResult } from "./agent.js";
import type { Provider } from "../contracts/provider.js";
import type { Question, QuestionResult, Tool } from "../contracts/tool.js";
import type { PermissionDecision, PermissionRequest } from "../contracts/tool.js";
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
  trustPrompt?: ((manifest: TrustManifest) => Promise<boolean>) | undefined;
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
  sandbox?: boolean | undefined;
  sandboxNetwork?: boolean | undefined;
  sandboxAllowedHosts?: string[] | undefined;
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
  sandbox?: SandboxPolicy | undefined;
  lsp?: ReturnType<typeof createLspTool> | undefined;
  artifacts?: ReturnType<typeof createArtifactTool> | undefined;
  browser?: ReturnType<typeof createBrowserTool> | undefined;
  trust: TrustState;
  telemetry?: { flush(): Promise<boolean> } | undefined;
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
  const manifest = buildTrustManifest(cwd);
  let trusted: boolean;
  let changed = false;
  if (options.trust !== undefined) {
    trusted = options.trust;
  } else {
    const status = trustStatus(home, cwd, manifest.fingerprint);
    trusted = status === "trusted";
    changed = status === "changed";
    if (!trusted && manifest.items.length > 0 && options.trustPrompt !== undefined) {
      const approved = await options.trustPrompt(manifest);
      if (approved) {
        trustWorkspace(home, cwd, manifest.fingerprint);
        trusted = true;
        changed = false;
      }
    }
    if (manifest.items.length === 0) {
      trusted = true;
      changed = false;
    }
  }
  const loaded = loadSettings({ cwd, home, env, projectLayers: trusted });
  const settings = loaded.settings;
  warnings.push(...loaded.warnings);
  if (!trusted && manifest.items.length > 0) {
    warnings.push(
      "Project settings are ignored until this workspace is trusted. Run with --trust or approve the workspace in the UI.",
    );
  }
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
  const toolRoots = [cwd, ...(options.addDirs ?? []).map((dir) => resolve(cwd, dir))];
  const lspServers =
    options.bare === true || options.safeMode === true
      ? {}
      : trusted
        ? (settings.lsp ?? {})
        : {};
  const codeModeEnabled = trusted && settings.codeMode === true;
  const lspTool =
    Object.keys(lspServers).length > 0
      ? createLspTool({ servers: lspServers, cwd, roots: toolRoots })
      : undefined;
  const toolRegistry: Tool[] = [];
  const coreTools =
    options.tools ??
    createCoreTools({
      codeMode: { enabled: codeModeEnabled, tools: toolRegistry },
    });
  const artifactsTool =
    options.bare === true || options.safeMode === true || settings.artifacts?.enabled === false
      ? undefined
      : createArtifactTool({ store: new ArtifactStore(join(home, "artifacts")) });
  let browserTool: ReturnType<typeof createBrowserTool> | undefined;
  const browserSettings = trusted ? settings.browser : undefined;
  const browserEnabled =
    browserSettings !== undefined &&
    browserSettings.enabled !== false &&
    (browserSettings.enabled === true || typeof browserSettings.driver === "string");
  if (options.bare !== true && options.safeMode !== true && browserEnabled) {
    try {
      let driver: BrowserDriver | undefined;
      if (typeof browserSettings.driver === "string") {
        const module = (await import(
          pathToFileURL(resolve(cwd, browserSettings.driver)).href
        )) as {
          createBrowserDriver?: (options: unknown) => BrowserDriver | Promise<BrowserDriver>;
          default?: BrowserDriver;
        };
        driver =
          module.createBrowserDriver !== undefined
            ? await module.createBrowserDriver({})
            : module.default;
        if (driver === undefined) {
          warnings.push(
            "Browser driver module exports neither createBrowserDriver nor a default driver.",
          );
        }
      } else {
        driver = await createPlaywrightDriver({
          ...(browserSettings.channel === undefined ? {} : { channel: browserSettings.channel }),
          ...(browserSettings.executablePath === undefined
            ? {}
            : { executablePath: browserSettings.executablePath }),
          ...(browserSettings.headless === undefined ? {} : { headless: browserSettings.headless }),
          ...(browserSettings.timeoutMs === undefined ? {} : { timeoutMs: browserSettings.timeoutMs }),
        });
      }
      if (driver !== undefined) {
        browserTool = createBrowserTool({
          driver,
          allowedDomains: browserSettings.allowedDomains ?? [],
        });
      }
    } catch (error) {
      warnings.push(`Browser: ${(error as Error).message}`);
    }
  }
  const baseTools = [
    ...coreTools,
    ...(lspTool === undefined ? [] : [lspTool]),
    ...(artifactsTool === undefined ? [] : [artifactsTool]),
    ...(browserTool === undefined ? [] : [browserTool]),
    ...mcpTools,
  ];
  const withExtensions = baseTools.some((tool) => tool.name === "Skill")
    ? baseTools
    : [...baseTools, createSkillTool(skills)];
  const managedDenied = managedDeniedTools(home, env);
  const restrictedDenied = new Set([
    "Bash",
    "PowerShell",
    "Agent",
    "WebFetch",
    "CodeMode",
    "LSP",
    "Browser",
  ]);
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
  toolRegistry.push(...tools);
  const specs = toolSpecs(tools);

  const roots = toolRoots;
  const sandboxSettings = trusted ? settings.sandbox : undefined;
  const sandboxEnabled = options.sandbox ?? sandboxSettings?.enabled ?? false;
  const sandbox = sandboxEnabled
    ? createSandboxPolicy({
        roots,
        allowNetwork: options.sandboxNetwork ?? sandboxSettings?.allowNetwork ?? false,
        allowedHosts: options.sandboxAllowedHosts ?? sandboxSettings?.allowedHosts ?? [],
      })
    : undefined;
  if (sandbox !== undefined) {
    const fallback = sandboxFallbackWarning(process.platform);
    if (fallback !== null) warnings.push(fallback);
  }
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
  const notificationChannels: NotificationChannel[] = [];
  if (settings.notifications?.enabled !== false && settings.notifications !== undefined) {
    if (typeof settings.notifications.webhook === "string") {
      notificationChannels.push(webhookChannel(settings.notifications.webhook, options.fetchImpl ?? fetch));
    }
    if (settings.notifications.terminal === true) {
      notificationChannels.push(terminalChannel((text) => process.stderr.write(text)));
    }
  }
  const notifier =
    notificationChannels.length === 0
      ? undefined
      : new Notifier({
          channels: notificationChannels,
          ...(settings.notifications?.dedupeMs === undefined
            ? {}
            : { dedupeMs: settings.notifications.dedupeMs }),
          ...(settings.notifications?.idleThresholdMs === undefined
            ? {}
            : { idleThresholdMs: settings.notifications.idleThresholdMs }),
        });
  const otelExporter =
    settings.otel !== undefined && telemetryEnabled(home, env)
      ? new OtelExporter(settings.otel, options.fetchImpl ?? fetch)
      : undefined;
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
  const permissionPrompter =
    options.prompter === undefined || notifier === undefined
      ? options.prompter
      : {
          ask: async (request: PermissionRequest, decision: PermissionDecision) => {
            void notifier
              .notify(
                "permission_required",
                `${request.tool} needs approval: ${decision.reason}`,
              )
              .catch(() => undefined);
            return await options.prompter!.ask(request, decision);
          },
        };
  const askQuestions =
    options.askQuestions === undefined || notifier === undefined
      ? options.askQuestions
      : async (items: Question[]) => {
          void notifier
            .notify("input_needed", items[0]?.question ?? "Input needed")
            .catch(() => undefined);
          return await options.askQuestions!(items);
        };
  const permissionService = new PermissionService({
    mode,
    rules,
    cwd,
    roots,
    ...(permissionPrompter === undefined ? {} : { prompter: permissionPrompter }),
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
      ...(permissionPrompter === undefined ? {} : { prompter: permissionPrompter }),
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
      ...(sandbox === undefined ? {} : { sandbox }),
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

  const memoryEvery = settings.autoMemoryEvery ?? 5;
  const memoryEnabled =
    settings.autoMemory !== false && options.bare !== true && options.safeMode !== true;
  let completedTurns = 0;
  const onTurnComplete = async (result: TurnResult, signal: AbortSignal): Promise<void> => {
    completedTurns += 1;
    if (notifier !== undefined) {
      void notifier
        .notify(
          "task_complete",
          result.text.trim().length > 0 ? result.text.slice(0, 200) : "Turn complete",
        )
        .catch(() => undefined);
    }
    if (otelExporter !== undefined) {
      const attributes = { provider: providerId, model, status: result.stopReason };
      otelExporter.record({ name: "keycode.turns", value: 1, attributes });
      otelExporter.record({
        name: "keycode.tokens.input",
        value: result.usage.inputTokens,
        unit: "token",
        attributes,
      });
      otelExporter.record({
        name: "keycode.tokens.output",
        value: result.usage.outputTokens,
        unit: "token",
        attributes,
      });
      otelExporter.record({
        name: "keycode.cost.usd",
        value: result.costUsd,
        unit: "USD",
        attributes,
      });
      otelExporter.record({
        name: "keycode.tool_calls",
        value: result.toolCalls,
        attributes,
      });
      void otelExporter.flush();
    }
    if (
      !memoryEnabled ||
      signal.aborted ||
      autoMemory.paused ||
      completedTurns % memoryEvery !== 0
    ) {
      return;
    }
    try {
      const view = store.load(sessionId);
      const memoryMessages = view.messages
        .filter((message) => message.content.every((block) => block.type === "text"))
        .slice(-30);
      const fact = await extractMemory(
        resolved.provider,
        model,
        memoryMessages,
        signal,
      );
      if (fact !== null && !signal.aborted) autoMemory.add(fact);
    } catch (error) {
      logger.warn("Auto-memory extraction failed", { error: (error as Error).message });
    }
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
    ...(sandbox === undefined ? {} : { sandbox }),
    systemPrompt,
    buildPrompt,
    ...(budget === undefined ? {} : { budget }),
    ...(options.pricing === undefined ? {} : { pricing: options.pricing }),
    ...(resolved.capabilities === undefined ? {} : { capabilities: resolved.capabilities }),
    ...(autoCompactThreshold === undefined ? {} : { autoCompactThreshold }),
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    ...(fallback === undefined ? {} : { fallback }),
    checkpointStore: checkpoints,
    ...(askQuestions === undefined ? {} : { askQuestions }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(hooks === undefined ? {} : { hooks }),
    onTurnComplete,
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
    ...(sandbox === undefined ? {} : { sandbox }),
    ...(lspTool === undefined ? {} : { lsp: lspTool }),
    ...(artifactsTool === undefined ? {} : { artifacts: artifactsTool }),
    ...(browserTool === undefined ? {} : { browser: browserTool }),
    trust: {
      trusted,
      changed,
      items: manifest.items,
      fingerprint: manifest.fingerprint,
    },
    ...(otelExporter === undefined ? {} : { telemetry: { flush: () => otelExporter.flush() } }),
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
