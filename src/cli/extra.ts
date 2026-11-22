import { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stdout } from "node:process";
import { PERMISSION_MODES, type PermissionMode } from "../contracts/permissions.js";
import type { ToolContext } from "../contracts/tool.js";
import { createAgentSetup, type AgentSetupOptions } from "../app/factory.js";
import { trustWorkspace, untrustWorkspace } from "../app/trust.js";
import { PRESETS } from "../providers/presets.js";
import {
  credentialStatus,
  removeStoredCredential,
  setStoredCredential,
} from "../providers/credentials.js";
import { canonicalProviderId } from "../providers/registry.js";
import { ProviderConfigSchema } from "../storage/schema.js";
import { atomicWrite } from "../util/fsx.js";
import { fingerprint } from "../util/ids.js";
import { keycodeHome, projectDir } from "../util/paths.js";
import { silentLogger } from "../util/logger.js";
import { systemClock } from "../util/clock.js";
import { KeycodeError } from "../util/errors.js";
import { runCommand } from "../tools/bash.js";
import { VERSION } from "../version.js";
import { createCodeModeTool } from "../tools/codemode.js";
import { createBrowserTool, type BrowserDriver } from "../integrations/browser.js";
import { BackgroundSessions } from "../integrations/background.js";
import { IdeBridge } from "../integrations/ide.js";
import {
  startRemoteControl,
  defaultWebDir,
  type RemoteProviderStatus,
} from "../integrations/remote.js";
import { PermissionBroker } from "../permissions/broker.js";
import { QuestionBroker } from "../questions/broker.js";
import type { PromptChoice } from "../permissions/pipeline.js";
import { createWorktree, listWorktrees, removeWorktree } from "../integrations/worktrees.js";
import {
  buildPrComment,
  getPullRequestDiff,
  reviewDiff,
  securityReview,
} from "../integrations/pr.js";
import { postIssueComment } from "../integrations/github.js";
import { importConfigs } from "../integrations/import.js";
import { checkForUpdate } from "../updates/index.js";
import { startGateway } from "../gateway/index.js";
import { ArtifactStore, startPreview } from "../artifacts/store.js";
import { EXAMPLE_ARTIFACT_HTML, EXAMPLE_ARTIFACT_NAME } from "../artifacts/example.js";
import { LspClient } from "../lsp/client.js";
import { AutoMemoryStore } from "../storage/autoMemory.js";
import { runWorkflow } from "../extensions/workflows.js";
import { LoopManager } from "../extensions/loops.js";
import { Notifier, webhookChannel, type NotificationChannel } from "../notifications/index.js";
import { OtelExporter } from "../telemetry/otel.js";
import {
  addMcpServer,
  listMcpServers,
  oauthRefresh,
  reconnectMcp,
  removeMcpServer,
  setMcpEnabled,
  type McpScope,
  type McpServerSettings,
} from "../mcp/management.js";
import {
  installPlugin,
  listPlugins,
  pinPlugin,
  removePlugin,
  setPluginEnabled,
} from "../extensions/plugins.js";

function opts(cmd: Command): Record<string, unknown> {
  const parent = cmd.parent;
  return { ...(parent ? parent.opts() : {}), ...cmd.opts() };
}

function emit(value: unknown, json: unknown): void {
  if (json === true) {
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (typeof value === "string") {
    stdout.write(`${value}\n`);
  } else {
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

function arrayOption(value: unknown, label: string): string[] | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const raw = value.trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
  } catch {
    // Fall through to the comma-separated form.
  }
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
  if (inner.trim().length === 0) return [];
  const parts = inner
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter((entry) => entry.length > 0);
  if (parts.length > 0) return parts;
  throw new KeycodeError("CONFIG_INVALID", `${label} must be a JSON array or a comma-separated list`);
}

function scopeOption(value: unknown): McpScope {
  return value === "project" || value === "local" ? value : "user";
}

function toolContext(home: string, cwd: string): ToolContext {
  return {
    sessionId: "cli",
    cwd,
    workspaceRoots: [cwd],
    signal: new AbortController().signal,
    permissions: { check: async () => ({ behavior: "allow" as const, reason: "CLI" }) },
    logger: silentLogger,
    clock: systemClock,
    state: { readFiles: new Set<string>(), todos: [], metadata: new Map<string, unknown>() },
    home,
  };
}

function keepAlive(close: () => Promise<void>): void {
  const shutdown = (): void => {
    void close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function openBrowser(url: string): void {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    // Browser launch is best effort; the URL is always printed as well.
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Ignore a missing launcher and keep the server running.
  }
}

export function registerExtraCommands(program: Command): void {
  program
    .command("mcp <action> [name]")
    .description("Manage MCP servers: list, add, remove, enable, disable, reconnect, oauth")
    .option("--command <command>", "stdio command")
    .option("--args <json>", "stdio arguments as JSON")
    .option("--url <url>", "HTTP or SSE URL")
    .option("--scope <scope>", "user, project, or local", "user")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [action, name] = cmd.args;
      const home = keycodeHome();
      const cwd = process.cwd();
      if (action === "list") {
        const servers = listMcpServers(home, cwd);
        emit(
          options.json === true
            ? servers
            : servers.length === 0
              ? "No MCP servers."
              : servers
                  .map(
                    (server) =>
                      `${server.name}  ${server.scope}  ${server.enabled ? "enabled" : "disabled"}  ${server.config.type ?? (server.config.url ? "http" : "stdio")}`,
                  )
                  .join("\n"),
          options.json,
        );
        return;
      }
      if (!name) throw new KeycodeError("CONFIG_INVALID", `mcp ${action} requires a server name`);
      if (action === "add") {
        const type = options.url !== undefined ? "http" : "stdio";
        const argsList = arrayOption(options.args, "--args");
        const config: McpServerSettings = {
          type,
          ...(typeof options.command === "string" ? { command: options.command } : {}),
          ...(argsList === undefined ? {} : { args: argsList }),
          ...(typeof options.url === "string" ? { url: options.url } : {}),
        };
        addMcpServer(home, cwd, name, config, scopeOption(options.scope));
        emit(`Added MCP server ${name}.`, options.json);
        return;
      }
      if (action === "remove") {
        emit(removeMcpServer(home, cwd, name) ? `Removed ${name}.` : `Not found: ${name}`, options.json);
        return;
      }
      if (action === "enable" || action === "disable") {
        const ok = setMcpEnabled(home, cwd, name, action === "enable");
        emit(ok ? `${action}d ${name}.` : `Not found: ${name}`, options.json);
        return;
      }
      if (action === "reconnect") {
        emit(await reconnectMcp(home, cwd, name), options.json);
        return;
      }
      if (action === "oauth") {
        emit(oauthRefresh(home, cwd, name) ? `Refreshed OAuth for ${name}.` : `Not found: ${name}`, options.json);
        return;
      }
      throw new KeycodeError("CONFIG_INVALID", `Unknown mcp action: ${action}`);
    });

  program
    .command("plugins <action> [target]")
    .description("Manage plugins: list, install, enable, disable, remove, pin")
    .option("--version <version>", "pin to a version")
    .option("--json", "emit JSON")
    .action((...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [action, target] = cmd.args;
      const home = keycodeHome();
      if (action === "list") {
        const plugins = listPlugins(home);
        emit(
          options.json === true
            ? plugins
            : plugins.length === 0
              ? "No plugins."
              : plugins
                  .map(
                    (plugin) =>
                      `${plugin.name}  ${plugin.pinnedVersion ?? plugin.version}  ${plugin.enabled ? "enabled" : "disabled"}  ${plugin.trusted ? "trusted" : "untrusted"}`,
                  )
                  .join("\n"),
          options.json,
        );
        return;
      }
      if (!target) throw new KeycodeError("CONFIG_INVALID", `plugins ${action} requires a target`);
      if (action === "install") {
        emit(installPlugin(home, resolve(process.cwd(), target), { trusted: true }), options.json);
        return;
      }
      if (action === "enable" || action === "disable") {
        const record = setPluginEnabled(home, target, action === "enable");
        emit(record ?? `Not found: ${target}`, options.json);
        return;
      }
      if (action === "remove") {
        emit(removePlugin(home, target) ? `Removed ${target}.` : `Not found: ${target}`, options.json);
        return;
      }
      if (action === "pin") {
        if (typeof options.version !== "string") {
          throw new KeycodeError("CONFIG_INVALID", "plugins pin requires --version");
        }
        emit(pinPlugin(home, target, options.version) ?? `Not found: ${target}`, options.json);
        return;
      }
      throw new KeycodeError("CONFIG_INVALID", `Unknown plugins action: ${action}`);
    });

  program
    .command("import")
    .description("Import Codex, Gemini, and Cursor configuration")
    .option("--dry-run", "report without writing")
    .option("--codex <path>", "Codex config path")
    .option("--gemini <path>", "Gemini config path")
    .option("--cursor <path>", "Cursor rules directory")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const result = await importConfigs({
        home: keycodeHome(),
        cwd: process.cwd(),
        dryRun: options.dryRun === true,
        ...(typeof options.codex === "string" ? { codexPath: options.codex } : {}),
        ...(typeof options.gemini === "string" ? { geminiPath: options.gemini } : {}),
        ...(typeof options.cursor === "string" ? { cursorPath: options.cursor } : {}),
      });
      emit(result, options.json);
    });

  program
    .command("update")
    .description("Check the release feed for an update")
    .option("--feed <url>", "release feed URL")
    .option("--channel <channel>", "stable or latest", "stable")
    .option("--current <version>", "current version", VERSION)
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      if (typeof options.feed !== "string") {
        throw new KeycodeError("CONFIG_INVALID", "update requires --feed <url>");
      }
      const check = await checkForUpdate({
        feedUrl: options.feed,
        channel: options.channel === "latest" ? "latest" : "stable",
        currentVersion: typeof options.current === "string" ? options.current : VERSION,
      });
      emit(check, options.json);
    });

  program
    .command("worktree <action> [name]")
    .description("Create, list, or remove git worktrees")
    .option("--base-dir <dir>", "worktree base directory")
    .option("--force", "force removal")
    .option("--json", "emit JSON")
    .action((...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [action, name] = cmd.args;
      const repo = process.cwd();
      if (action === "list") {
        emit(listWorktrees(repo), options.json);
        return;
      }
      if (!name) throw new KeycodeError("CONFIG_INVALID", `worktree ${action} requires a name`);
      if (action === "create") {
        emit(
          createWorktree(repo, name, {
            ...(typeof options.baseDir === "string" ? { baseDir: options.baseDir } : {}),
          }),
          options.json,
        );
        return;
      }
      if (action === "remove") {
        removeWorktree(repo, resolve(repo, name), { force: options.force === true });
        emit(`Removed ${name}.`, options.json);
        return;
      }
      throw new KeycodeError("CONFIG_INVALID", `Unknown worktree action: ${action}`);
    });

  program
    .command("bg <action> [id]")
    .description("Manage background sessions: start, list, logs, stop, rm, respawn")
    .option("--name <name>", "session name")
    .option("--command <command>", "command to run")
    .option("--args <json>", "arguments as JSON")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [action, id] = cmd.args;
      const home = keycodeHome();
      const manager = new BackgroundSessions(join(home, "background"));
      if (action === "start") {
        if (typeof options.command !== "string") {
          throw new KeycodeError("CONFIG_INVALID", "bg start requires --command");
        }
        const argsList = arrayOption(options.args, "--args") ?? [];
        emit(
          manager.start({
            ...(typeof options.name === "string" ? { name: options.name } : {}),
            command: options.command,
            args: argsList,
            cwd: process.cwd(),
          }),
          options.json,
        );
        return;
      }
      if (action === "list") {
        emit(manager.list(), options.json);
        return;
      }
      if (!id) throw new KeycodeError("CONFIG_INVALID", `bg ${action} requires an id`);
      if (action === "logs") {
        emit(manager.logs(id), options.json);
        return;
      }
      if (action === "stop") {
        emit(manager.stop(id), options.json);
        return;
      }
      if (action === "rm") {
        emit(manager.remove(id) ? `Removed ${id}.` : `Not found: ${id}`, options.json);
        return;
      }
      if (action === "respawn") {
        emit(manager.respawn(id), options.json);
        return;
      }
      throw new KeycodeError("CONFIG_INVALID", `Unknown bg action: ${action}`);
    });

  program
    .command("ide")
    .description("Start the IDE bridge and write its discovery file")
    .option("--token <token>", "pairing token")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const bridge = new IdeBridge({
        home: keycodeHome(),
        cwd: process.cwd(),
        ...(typeof options.token === "string" ? { token: options.token } : {}),
      });
      const started = await bridge.start();
      stdout.write(
        `IDE bridge listening on 127.0.0.1:${started.port}\nDiscovery: ${started.discoveryFile}\nToken: ${started.token}\n`,
      );
      keepAlive(() => bridge.stop());
    });

  program
    .command("remote")
    .description("Start Remote Control on loopback with a pairing token")
    .option("--token <token>", "pairing token")
    .option("--open", "open the web UI in the default browser")
    .option("--provider <id>", "provider id")
    .option("--model <id>", "model id")
    .option("--permission-mode <mode>", "permission mode", "manual")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const broker = new PermissionBroker();
      const questions = new QuestionBroker();
      let currentProvider =
        typeof options.provider === "string" ? options.provider : undefined;
      let currentModel = typeof options.model === "string" ? options.model : undefined;
      let currentPermissionMode = options.permissionMode as PermissionMode;
      const buildOptions = (overrides: Partial<AgentSetupOptions> = {}): AgentSetupOptions => ({
        cwd: process.cwd(),
        ...(currentProvider === undefined ? {} : { provider: currentProvider }),
        ...(currentModel === undefined ? {} : { model: currentModel }),
        permissionMode: currentPermissionMode,
        prompter: broker,
        askQuestions: (items) => questions.ask(items),
        ...overrides,
      });
      const eventListeners = new Set<(event: unknown) => void>();
      const dispatch = (event: unknown): void => {
        for (const listener of eventListeners) listener(event);
      };
      let setup = await createAgentSetup(buildOptions());
      currentProvider = setup.providerId;
      currentModel = setup.model;
      let unsubscribeAgent = setup.agent.subscribe(dispatch);
      let controller = new AbortController();

      const describe = (current: typeof setup): {
        provider: string;
        model: string;
        sessionId: string;
        permissionMode: PermissionMode;
      } => ({
        provider: current.providerId,
        model: current.model,
        sessionId: current.sessionId,
        permissionMode: current.permissionMode,
      });

      const sessionList = (): ReturnType<typeof setup.store.list> =>
        setup.store.list().slice(0, 50);

      const activate = async (overrides: Partial<AgentSetupOptions>) => {
        broker.cancelAll();
        questions.cancelAll();
        unsubscribeAgent();
        controller.abort();
        setup.lsp?.stop();
        setup.artifacts?.stop();
        await setup.telemetry?.flush();
        await setup.browser?.stop();
        await Promise.all(setup.mcpClients.map((client) => client.close()));
        setup = await createAgentSetup(buildOptions(overrides));
        currentProvider = setup.providerId;
        currentModel = setup.model;
        currentPermissionMode = setup.permissionMode;
        unsubscribeAgent = setup.agent.subscribe(dispatch);
        controller = new AbortController();
        return describe(setup);
      };

      const providerCatalog = () => {
        const custom = setup.settings.providers ?? {};
        const ids = [
          ...new Set([
            ...Object.keys(PRESETS),
            ...Object.keys(custom),
            ...(currentProvider === undefined ? [] : [currentProvider]),
          ]),
        ];
        return ids.map((id) => {
          const preset = PRESETS[id];
          const config = custom[id];
          return {
            id,
            name: preset?.displayName ?? config?.displayName ?? id,
            models: preset?.models ?? config?.models ?? (id === currentProvider && currentModel ? [currentModel] : []),
            defaultModel:
              preset?.defaultModel ??
              config?.defaultModel ??
              (id === currentProvider ? (currentModel ?? "") : ""),
            free: preset?.free ?? config?.free ?? true,
            local: preset?.local ?? config?.local ?? id === "fake",
          };
        });
      };

      const providerStatuses = (): RemoteProviderStatus[] => {
        const custom = setup.settings.providers ?? {};
        return providerCatalog().map((provider) => {
          const preset = PRESETS[provider.id];
          const config = custom[provider.id];
          const stored = credentialStatus(setup.home, provider.id);
          const apiKeyEnv = preset?.apiKeyEnv ?? config?.apiKeyEnv ?? null;
          const envKey = apiKeyEnv === null ? undefined : process.env[apiKeyEnv];
          const source: RemoteProviderStatus["source"] = provider.local
            ? null
            : envKey !== undefined && envKey.length > 0
              ? "env"
              : stored.configured
                ? "keychain"
                : config?.apiKey !== undefined && config.apiKey.length > 0
                  ? "config"
                  : config?.apiKeyHelper !== undefined
                    ? "helper"
                    : null;
          const visibleKey = envKey ?? config?.apiKey ?? null;
          return {
            ...provider,
            configured:
              provider.local ||
              source !== null,
            source,
            fingerprint:
              stored.fingerprint ?? (visibleKey === null ? null : fingerprint(visibleKey)),
            apiKeyEnv,
            current: provider.id === setup.providerId,
          };
        });
      };

      const providerStatusesAfterKey = (
        provider: string,
        key: string,
      ): RemoteProviderStatus[] => {
        const id = canonicalProviderId(provider);
        if (!providerCatalog().some((entry) => entry.id === id)) {
          throw new KeycodeError("PROVIDER_NOT_FOUND", `Unknown provider "${id}"`);
        }
        const value = key.trim();
        if (value.length === 0) {
          throw new KeycodeError("CONFIG_INVALID", "API key is empty");
        }
        setStoredCredential(setup.home, id, value);
        return providerStatuses();
      };

      const providerStatusesAfterRemove = (provider: string): RemoteProviderStatus[] => {
        removeStoredCredential(setup.home, canonicalProviderId(provider));
        return providerStatuses();
      };

      const addProviderConfig = (
        provider: string,
        config: Record<string, unknown>,
        key?: string | undefined,
      ): RemoteProviderStatus[] => {
        const id = canonicalProviderId(provider);
        if (!/^[a-z0-9][a-z0-9-_]*$/.test(id)) {
          throw new KeycodeError(
            "CONFIG_INVALID",
            "Provider id must start with a letter or digit and contain only letters, digits, dashes, or underscores.",
          );
        }
        if (PRESETS[id] !== undefined || setup.settings.providers?.[id] !== undefined) {
          throw new KeycodeError("CONFIG_INVALID", `Provider "${id}" already exists.`);
        }
        const parsed = ProviderConfigSchema.parse(config);
        if (parsed.kind === "fake") {
          throw new KeycodeError("CONFIG_INVALID", "The fake provider cannot be added from the UI.");
        }
        const kind: "openai-compatible" | "anthropic" =
          parsed.kind === "anthropic" ? "anthropic" : "openai-compatible";
        const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "";
        if (baseUrl.length === 0) {
          throw new KeycodeError("CONFIG_INVALID", "Base URL is required.");
        }
        let url: URL;
        try {
          url = new URL(baseUrl);
        } catch {
          throw new KeycodeError("CONFIG_INVALID", "Base URL must be a valid URL.");
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new KeycodeError("CONFIG_INVALID", "Base URL must use http or https.");
        }
        const models = [
          ...new Set(
            (parsed.models ?? [])
              .map((model) => model.trim())
              .filter((model) => model.length > 0),
          ),
        ];
        if (models.length === 0) {
          throw new KeycodeError("CONFIG_INVALID", "At least one model is required.");
        }
        const requestedDefault =
          typeof parsed.defaultModel === "string" ? parsed.defaultModel.trim() : "";
        const defaultModel = requestedDefault.length > 0 ? requestedDefault : models[0] ?? "";
        if (!models.includes(defaultModel)) models.unshift(defaultModel);
        const nextConfig = {
          kind,
          displayName:
            typeof parsed.displayName === "string" && parsed.displayName.trim().length > 0
              ? parsed.displayName.trim()
              : id,
          baseUrl,
          apiKeyEnv: parsed.apiKeyEnv ?? null,
          models,
          defaultModel,
          ...(parsed.contextWindow === undefined ? {} : { contextWindow: parsed.contextWindow }),
          ...(parsed.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: parsed.maxOutputTokens }),
          free: parsed.free ?? true,
          local: parsed.local ?? false,
          ...(parsed.capabilities === undefined ? {} : { capabilities: parsed.capabilities }),
        };
        const settingsPath = join(setup.home, "settings.json");
        let raw: Record<string, unknown> = {};
        if (existsSync(settingsPath)) {
          try {
            raw = JSON.parse(readFileSync(settingsPath, "utf8").replace(/^\uFEFF/, "")) as Record<
              string,
              unknown
            >;
          } catch {
            throw new KeycodeError("CONFIG_INVALID", "settings.json is not valid JSON.");
          }
        }
        const existingProviders =
          raw.providers !== null &&
          typeof raw.providers === "object" &&
          !Array.isArray(raw.providers)
            ? (raw.providers as Record<string, unknown>)
            : {};
        atomicWrite(
          settingsPath,
          `${JSON.stringify(
            { ...raw, providers: { ...existingProviders, [id]: nextConfig } },
            null,
            2,
          )}\n`,
        );
        setup.settings.providers = {
          ...(setup.settings.providers ?? {}),
          [id]: nextConfig,
        };
        if (key !== undefined && key.trim().length > 0) {
          setStoredCredential(setup.home, id, key.trim());
        }
        return providerStatuses();
      };

      const remotePermission = (): {
        id: string;
        tool: string;
        reason: string;
        preview?: string;
        diff?: string;
      } | null => {
        const pending = broker.current;
        if (!pending) return null;
        return {
          id: pending.id,
          tool: pending.request.tool,
          reason: pending.decision.reason,
          ...(pending.request.preview === undefined ? {} : { preview: pending.request.preview }),
          ...(pending.request.diff === undefined ? {} : { diff: pending.request.diff }),
        };
      };

      const server = await startRemoteControl({
        ...(typeof options.token === "string" ? { token: options.token } : {}),
        staticDir: defaultWebDir(),
        handler: {
          info: () => describe(setup),
          trust: () => setup.trust,
          setTrust: async (accept) => {
            const sessionId = setup.sessionId;
            if (accept) {
              trustWorkspace(setup.home, setup.store.cwd, setup.trust.fingerprint);
            } else {
              untrustWorkspace(setup.home, setup.store.cwd);
            }
            return activate({
              resume: sessionId,
              provider: setup.providerId,
              model: setup.model,
              trust: accept,
            });
          },
          subscribe: (listener) => {
            eventListeners.add(listener);
            return () => {
              eventListeners.delete(listener);
            };
          },
          onPrompt: async (prompt) => {
            const result = await setup.agent.runTurn(prompt, controller.signal);
            return result.text;
          },
          onStop: () => {
            controller.abort();
            broker.cancelAll();
            questions.cancelAll();
            controller = new AbortController();
          },
          sessions: () =>
            sessionList().map((session) => ({
              id: session.id,
              name: session.name,
              messageCount: session.messageCount,
              createdAt: session.createdAt,
              provider: session.provider,
              model: session.model,
              ...(session.parentId === undefined || session.parentId === null
                ? {}
                : { parentId: session.parentId }),
            })),
          history: () => setup.store.load(setup.sessionId).messages,
          artifacts: () => setup.artifacts?.list() ?? [],
          artifactPreview: async (id, version) =>
            (await setup.artifacts?.preview(id, version)) ?? null,
          createExampleArtifact: () => {
            if (setup.artifacts === undefined) {
              throw new KeycodeError("CONFIG_INVALID", "Artifacts are disabled.");
            }
            setup.artifacts.create(EXAMPLE_ARTIFACT_NAME, EXAMPLE_ARTIFACT_HTML);
            return setup.artifacts.list();
          },
          createArtifact: (name, html) => {
            if (setup.artifacts === undefined) {
              throw new KeycodeError("CONFIG_INVALID", "Artifacts are disabled.");
            }
            if (name.length > 120) {
              throw new KeycodeError(
                "CONFIG_INVALID",
                "Artifact names are limited to 120 characters.",
              );
            }
            const created = setup.artifacts.create(name, html);
            return { artifacts: setup.artifacts.list(), id: created.id };
          },
          deleteArtifact: (id) => {
            if (setup.artifacts === undefined) {
              throw new KeycodeError("CONFIG_INVALID", "Artifacts are disabled.");
            }
            if (!setup.artifacts.remove(id)) {
              throw new KeycodeError("CONFIG_INVALID", `Artifact not found: ${id}`);
            }
            return setup.artifacts.list();
          },
          resume: async (id) => {
            if (id === null) return activate({});
            const meta = setup.store.resolve(id);
            return activate({ resume: meta.id, provider: meta.provider, model: meta.model });
          },
          catalog: () => providerCatalog(),
          providerStatuses: () => providerStatuses(),
          setProviderKey: (provider, key) => providerStatusesAfterKey(provider, key),
          removeProviderKey: (provider) => providerStatusesAfterRemove(provider),
          addProvider: (provider, config, key) => addProviderConfig(provider, config, key),
          setModel: async (provider, model) => {
            const sessionId = setup.sessionId;
            setup.store.setModel(sessionId, provider, model);
            return activate({ resume: sessionId, provider, model });
          },
          setPermissionMode: async (mode) => {
            if (!(PERMISSION_MODES as readonly string[]).includes(mode)) {
              throw new KeycodeError("CONFIG_INVALID", `Unknown permission mode "${mode}".`);
            }
            const sessionId = setup.sessionId;
            return activate({
              resume: sessionId,
              provider: setup.providerId,
              model: setup.model,
              permissionMode: mode as PermissionMode,
            });
          },
          renameSession: (id, name) => {
            setup.store.rename(id, name.trim().length === 0 ? id.slice(0, 8) : name.trim());
            return sessionList().map((session) => ({
              id: session.id,
              name: session.name,
              messageCount: session.messageCount,
              createdAt: session.createdAt,
              provider: session.provider,
              model: session.model,
              ...(session.parentId === undefined || session.parentId === null
                ? {}
                : { parentId: session.parentId }),
            }));
          },
          forkSession: async (id, name) => {
            const header = setup.store.fork(id, name);
            const view = setup.store.load(header.id);
            return activate({
              resume: header.id,
              provider: view.header.provider,
              model: view.header.model,
            });
          },
          deleteSession: (id) => {
            setup.store.delete(id);
          },
        },
        permissions: {
          current: remotePermission,
          subscribe: (listener) => broker.subscribe(() => listener(remotePermission())),
          resolve: (id, choice) => {
            const behaviors: readonly string[] = [
              "allow_once",
              "allow_always",
              "allow_session",
              "deny",
              "cancel",
            ];
            if (!behaviors.includes(choice)) return false;
            return broker.resolveById(id, {
              behavior: choice as PromptChoice["behavior"],
            });
          },
        },
        questions: {
          current: () => {
            const pending = questions.current;
            if (!pending) return null;
            return { id: pending.id, questions: pending.questions };
          },
          subscribe: (listener) => questions.subscribe(() => listener(
            questions.current === null
              ? null
              : { id: questions.current.id, questions: questions.current.questions },
          )),
          resolve: (id, result) => questions.resolveById(id, result),
        },
      });
      stdout.write(`Remote Control: ${server.url}/#token=${server.token}\n`);
      stdout.write(`Token: ${server.token}\nSession: ${setup.sessionId}\n`);
      if (options.open === true) openBrowser(`${server.url}/#token=${server.token}`);
      keepAlive(async () => {
        broker.cancelAll();
        questions.cancelAll();
        unsubscribeAgent();
        setup.lsp?.stop();
        setup.artifacts?.stop();
        await setup.telemetry?.flush();
        await setup.browser?.stop();
        await Promise.all(setup.mcpClients.map((client) => client.close()));
        await server.close();
      });
    });

  program
    .command("gateway")
    .description("Start the local provider gateway")
    .option("--api-key <key>", "provider API key to inject")
    .option("--client-token <token>", "allowed client token (repeatable)", (value: string, previous: string[]) => [...previous, value], [] as string[])
    .option("--rate <requests>", "requests per window", "60")
    .option("--window <ms>", "rate-limit window in ms", "60000")
    .option("--allow-private", "allow private upstream targets")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      if (typeof options.apiKey !== "string") {
        throw new KeycodeError("CONFIG_INVALID", "gateway requires --api-key");
      }
      const clientTokens = Array.isArray(options.clientToken) ? (options.clientToken as string[]) : [];
      if (clientTokens.length === 0) {
        throw new KeycodeError("CONFIG_INVALID", "gateway requires at least one --client-token");
      }
      const server = await startGateway({
        apiKey: options.apiKey,
        clientTokens,
        rateLimit: {
          requests: Number(options.rate ?? 60),
          windowMs: Number(options.window ?? 60_000),
        },
        allowPrivate: options.allowPrivate === true,
      });
      stdout.write(`Gateway listening on ${server.url}\n`);
      keepAlive(() => server.close());
    });

  program
    .command("pr <action> [number]")
    .description("Review a pull request diff")
    .option("--repo <owner/name>", "repository")
    .option("--security", "only high-severity findings")
    .option("--comment", "post the review as a comment")
    .option("--token <token>", "GitHub token for posting")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [action, numberRaw] = cmd.args;
      if (action !== "review") throw new KeycodeError("CONFIG_INVALID", `Unknown pr action: ${action}`);
      if (typeof options.repo !== "string") {
        throw new KeycodeError("CONFIG_INVALID", "pr review requires --repo");
      }
      const number = Number(numberRaw);
      const diff = await getPullRequestDiff({ repo: options.repo, number });
      const findings = options.security === true ? securityReview(diff) : reviewDiff(diff);
      const comment = buildPrComment(findings);
      let posted: { ok: boolean; status: number } | null = null;
      if (options.comment === true) {
        if (typeof options.token !== "string") {
          throw new KeycodeError("CONFIG_INVALID", "pr review --comment requires --token");
        }
        posted = await postIssueComment({
          token: options.token,
          repo: options.repo,
          issueNumber: number,
          body: comment,
        });
      }
      emit(options.json === true ? { findings, comment, posted } : comment, options.json);
    });

  program
    .command("artifacts <action> [id]")
    .description("Create, publish, preview, inspect, remove, or annotate local artifacts")
    .option("--name <name>", "artifact name")
    .option("--file <path>", "HTML file")
    .option("--version <n>", "version")
    .option("--text <text>", "comment text")
    .option("--key <key>", "data key")
    .option("--value <value>", "data value")
    .option("--token <token>", "preview token", "preview")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [action, id] = cmd.args;
      const home = keycodeHome();
      const store = new ArtifactStore(join(home, "artifacts"));
      const version = options.version === undefined ? undefined : Number(options.version);
      if (action === "create") {
        if (typeof options.name !== "string" || typeof options.file !== "string") {
          throw new KeycodeError("CONFIG_INVALID", "artifacts create requires --name and --file");
        }
        const artifact = store.create(options.name, readFileSync(resolve(process.cwd(), options.file), "utf8"));
        emit({ id: artifact.id, version: 1 }, options.json);
        return;
      }
      if (action === "list") {
        emit(store.list(), options.json);
        return;
      }
      if (!id) throw new KeycodeError("CONFIG_INVALID", `artifacts ${action} requires an id`);
      if (action === "remove" || action === "delete") {
        emit(store.remove(id) ? "Artifact removed." : "Artifact not found.", options.json);
        return;
      }
      if (action === "publish") {
        if (typeof options.file !== "string") {
          throw new KeycodeError("CONFIG_INVALID", "artifacts publish requires --file");
        }
        const artifact = store.publish(id, readFileSync(resolve(process.cwd(), options.file), "utf8"));
        emit({ id: artifact.id, version: artifact.versions.length }, options.json);
        return;
      }
      if (action === "inspect") {
        emit(store.inspect(id, version), options.json);
        return;
      }
      if (action === "comment") {
        if (typeof options.text !== "string") {
          throw new KeycodeError("CONFIG_INVALID", "artifacts comment requires --text");
        }
        const targetVersion = version ?? store.get(id)?.version ?? 1;
        emit(store.comment(id, targetVersion, options.text) ? "Comment added." : "Artifact not found.", options.json);
        return;
      }
      if (action === "data") {
        if (typeof options.key !== "string") {
          throw new KeycodeError("CONFIG_INVALID", "artifacts data requires --key");
        }
        const targetVersion = version ?? store.get(id)?.version ?? 1;
        emit(
          store.setData(id, targetVersion, options.key, options.value ?? "") ? "Data set." : "Artifact not found.",
          options.json,
        );
        return;
      }
      if (action === "preview") {
        const server = await startPreview(store, {
          token: typeof options.token === "string" ? options.token : "preview",
        });
        const versionPath = version === undefined ? "" : `/${version}`;
        stdout.write(
          `Preview: ${server.url}/artifacts/${id}${versionPath}?token=${String(options.token ?? "preview")}\n`,
        );
        keepAlive(() => server.close());
        return;
      }
      throw new KeycodeError("CONFIG_INVALID", `Unknown artifacts action: ${action}`);
    });

  program
    .command("codemode [code]")
    .description("Evaluate JavaScript in an opt-in persistent Code Mode session")
    .option("--file <path>", "read code from a file")
    .option("--reset", "reset the session state")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [codeArg] = cmd.args;
      const code =
        typeof options.file === "string"
          ? readFileSync(resolve(process.cwd(), options.file), "utf8")
          : codeArg;
      if (!code) throw new KeycodeError("CONFIG_INVALID", "codemode requires code or --file");
      const tool = createCodeModeTool({ enabled: true });
      const result = await tool.execute(
        { code, ...(options.reset === true ? { reset: true } : {}) },
        toolContext(keycodeHome(), process.cwd()),
      );
      const text = result.content
        .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
        .join("\n");
      emit(options.json === true ? { ok: result.ok, text } : text, options.json);
      if (!result.ok) process.exitCode = 1;
    });

  program
    .command("lsp <file>")
    .description("Start a language server and print diagnostics")
    .option("--command <command>", "language server command")
    .option("--args <json>", "language server arguments as JSON")
    .option("--language <id>", "language id", "typescript")
    .option("--hover <line:character>", "request hover at a position")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [file] = cmd.args;
      if (typeof options.command !== "string") {
        throw new KeycodeError("CONFIG_INVALID", "lsp requires --command");
      }
      if (!file) throw new KeycodeError("CONFIG_INVALID", "lsp requires a file");
      const path = resolve(process.cwd(), file);
      const uri = pathToFileURL(path).toString();
      const client = new LspClient({
        command: options.command,
        args: arrayOption(options.args, "--args") ?? [],
        cwd: process.cwd(),
        rootUri: pathToFileURL(process.cwd()).toString(),
        timeoutMs: 10_000,
      });
      await client.start();
      await client.initialize();
      client.openDocument(uri, typeof options.language === "string" ? options.language : extname(path).replace(".", ""), readFileSync(path, "utf8"));
      const diagnostics = await client.waitForDiagnostics(uri);
      let hover: unknown = null;
      if (typeof options.hover === "string") {
        const [line, character] = options.hover.split(":").map(Number);
        hover = await client.hover(uri, line ?? 0, character ?? 0);
      }
      emit(options.json === true ? { diagnostics, hover } : diagnostics, options.json);
      client.stop();
    });

  program
    .command("memory <action> [text]")
    .description("Manage auto-memory: list, search, add, remove, pause, resume")
    .option("--id <id>", "entry id")
    .option("--query <query>", "search query")
    .option("--json", "emit JSON")
    .action((...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [action, text] = cmd.args;
      const home = keycodeHome();
      const cwd = process.cwd();
      const store = new AutoMemoryStore(join(projectDir(home, cwd), "memory.json"));
      if (action === "list") {
        emit(store.list(), options.json);
        return;
      }
      if (action === "search") {
        emit(store.recall(typeof options.query === "string" ? options.query : ""), options.json);
        return;
      }
      if (action === "add") {
        if (!text) throw new KeycodeError("CONFIG_INVALID", "memory add requires text");
        emit(store.add(text), options.json);
        return;
      }
      if (action === "remove") {
        if (typeof options.id !== "string") throw new KeycodeError("CONFIG_INVALID", "memory remove requires --id");
        emit(store.remove(options.id) ? "Removed." : "Not found.", options.json);
        return;
      }
      if (action === "pause") {
        store.pause();
        emit("Auto-memory paused.", options.json);
        return;
      }
      if (action === "resume") {
        store.resume();
        emit("Auto-memory resumed.", options.json);
        return;
      }
      throw new KeycodeError("CONFIG_INVALID", `Unknown memory action: ${action}`);
    });

  program
    .command("workflow <script>")
    .description("Run a workflow script with checkpoints and resume")
    .option("--context <json>", "workflow context as JSON")
    .option("--checkpoint-dir <dir>", "checkpoint directory")
    .option("--budget <usd>", "budget in USD")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [script] = cmd.args;
      if (!script) throw new KeycodeError("CONFIG_INVALID", "workflow requires a script path");
      const result = await runWorkflow({
        scriptPath: resolve(process.cwd(), script),
        checkpointDir:
          typeof options.checkpointDir === "string"
            ? options.checkpointDir
            : join(keycodeHome(), "workflows"),
        context:
          typeof options.context === "string"
            ? (JSON.parse(options.context) as Record<string, unknown>)
            : {},
        ...(typeof options.budget === "string" ? { budgetUsd: Number(options.budget) } : {}),
      });
      emit(result, options.json);
      if (result.status === "failed") process.exitCode = 1;
    });

  program
    .command("loops <action> [id]")
    .description("Manage cron loops: list, add, remove, run")
    .option("--cron <expression>", "cron expression")
    .option("--command <command>", "command to run")
    .option("--timezone <timezone>", "timezone label")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [action, id] = cmd.args;
      const manager = new LoopManager(join(keycodeHome(), "loops.json"));
      if (action === "list") {
        emit(manager.list(), options.json);
        return;
      }
      if (action === "add") {
        if (typeof options.cron !== "string" || typeof options.command !== "string") {
          throw new KeycodeError("CONFIG_INVALID", "loops add requires --cron and --command");
        }
        emit(
          manager.add({
            cron: options.cron,
            command: options.command,
            ...(typeof options.timezone === "string" ? { timezone: options.timezone } : {}),
          }),
          options.json,
        );
        return;
      }
      if (!id) throw new KeycodeError("CONFIG_INVALID", `loops ${action} requires an id`);
      if (action === "remove") {
        emit(manager.remove(id) ? "Removed." : "Not found.", options.json);
        return;
      }
      if (action === "run") {
        const ran = await manager.runDue(new Date(), async (job) => {
          await runCommand({ command: job.command, cwd: process.cwd(), timeoutMs: 60_000 });
        });
        emit(`Ran ${ran} loop(s).`, options.json);
        return;
      }
      throw new KeycodeError("CONFIG_INVALID", `Unknown loops action: ${action}`);
    });

  program
    .command("notify")
    .description("Send a test notification")
    .option("--event <event>", "idle, permission_required, task_complete, or input_needed", "idle")
    .option("--text <text>", "notification text", "KeyCode notification")
    .option("--webhook <url>", "webhook URL")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const channels: NotificationChannel[] = [
        {
          name: "stdout",
          send: (event, text) => {
            stdout.write(`${event}: ${text}\n`);
          },
        },
      ];
      if (typeof options.webhook === "string") {
        channels.push(webhookChannel(options.webhook));
      }
      const notifier = new Notifier({ channels });
      const sent = await notifier.notify(
        options.event as "idle" | "permission_required" | "task_complete" | "input_needed",
        typeof options.text === "string" ? options.text : "KeyCode notification",
      );
      emit({ sent }, options.json);
    });

  program
    .command("otel")
    .description("Send one OTLP metric to a local collector")
    .option("--endpoint <url>", "OTLP HTTP endpoint")
    .option("--name <name>", "metric name", "keycode.cli")
    .option("--value <value>", "metric value", "1")
    .option("--attributes <json>", "attributes as JSON")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      if (typeof options.endpoint !== "string") {
        throw new KeycodeError("CONFIG_INVALID", "otel requires --endpoint");
      }
      const attributes =
        typeof options.attributes === "string"
          ? (JSON.parse(options.attributes) as Record<string, string | number>)
          : {};
      const exporter = new OtelExporter({ endpoint: options.endpoint, serviceName: "keycode-cli" });
      exporter.record({
        name: typeof options.name === "string" ? options.name : "keycode.cli",
        value: Number(options.value ?? 1),
        attributes,
      });
      const ok = await exporter.flush();
      emit({ ok }, options.json);
      if (!ok) process.exitCode = 1;
    });

  program
    .command("browser <action> [url]")
    .description("Browser automation through a driver module")
    .option("--driver <module>", "driver module exporting createBrowserDriver")
    .option("--allow <domains>", "comma-separated allowed domains", "")
    .option("--selector <selector>", "CSS selector")
    .option("--text <text>", "text to type")
    .option("--json", "emit JSON")
    .action(async (...args: unknown[]) => {
      const cmd = args[args.length - 1] as Command;
      const options = opts(cmd);
      const [action, url] = cmd.args;
      if (typeof options.driver !== "string") {
        throw new KeycodeError(
          "CONFIG_INVALID",
          "Browser automation requires --driver <module> exporting createBrowserDriver.",
        );
      }
      const module = (await import(pathToFileURL(resolve(process.cwd(), options.driver)).href)) as {
        createBrowserDriver?: (options: unknown) => BrowserDriver | Promise<BrowserDriver>;
        default?: BrowserDriver;
      };
      const driver =
        module.createBrowserDriver !== undefined
          ? await module.createBrowserDriver({})
          : module.default;
      if (!driver) {
        throw new KeycodeError("CONFIG_INVALID", "Driver module does not export createBrowserDriver or a default driver");
      }
      const allowedDomains = String(options.allow ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const tool = createBrowserTool({ driver, allowedDomains });
      const result = await tool.execute(
        {
          action: action as "navigate" | "click" | "type" | "read_dom" | "screenshot",
          ...(url === undefined ? {} : { url }),
          ...(typeof options.selector === "string" ? { selector: options.selector } : {}),
          ...(typeof options.text === "string" ? { text: options.text } : {}),
        },
        toolContext(keycodeHome(), process.cwd()),
      );
      const text = result.content
        .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
        .join("\n");
      emit(options.json === true ? { ok: result.ok, text } : text, options.json);
      if (!result.ok) process.exitCode = 1;
    });
}
