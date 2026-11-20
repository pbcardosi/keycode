#!/usr/bin/env node
import { Command } from "commander";
import { stdout } from "node:process";
import { runHeadless, runInteractive, type InputFormat, type OutputFormat } from "./headless.js";
import { createAgentSetup, type AgentSetupOptions } from "../app/factory.js";
import { PERMISSION_MODES, type PermissionMode } from "../contracts/permissions.js";
import { KeycodeError, formatError, toKeycodeError } from "../util/errors.js";
import { keycodeHome } from "../util/paths.js";
import { isTrusted, trustWorkspace } from "../app/trust.js";
import { SessionStore } from "../storage/session.js";
import { AuditLog } from "../permissions/audit.js";
import { runDoctor, formatDoctor } from "./doctor.js";
import { authCommand } from "./auth.js";
import { registerExtraCommands } from "./extra.js";
import { resolve } from "node:path";

export const VERSION = "0.1.0";

type SubCmd = {
  parent?: { opts(): Record<string, unknown> } | null;
  opts(): Record<string, unknown>;
};

function subOpts(cmd: SubCmd): Record<string, unknown> {
  return { ...(cmd.parent?.opts() ?? {}), ...cmd.opts() };
}

interface CliOptions {
  print?: string | boolean;
  outputFormat?: string;
  inputFormat?: string;
  provider?: string;
  model?: string;
  effort?: string;
  fallbackModel?: string;
  permissionMode?: string;
  maxBudgetUsd?: string;
  addDir?: string[];
  sessionId?: string;
  resume?: string | boolean;
  continue?: boolean;
  forkSession?: boolean;
  name?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  memory?: boolean;
  debug?: boolean;
  dangerouslySkipPermissions?: boolean;
  trust?: boolean;
  restricted?: boolean;
  safeMode?: boolean;
  bare?: boolean;
  allowedTool?: string[];
  allow?: string[];
  deny?: string[];
  ask?: string[];
  axScreenReader?: boolean;
}

function collectRule(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseOutputFormat(value: string | undefined): OutputFormat {
  if (value === undefined) return "text";
  if (value === "text" || value === "json" || value === "stream-json") return value;
  throw new KeycodeError("CONFIG_INVALID", `Unknown output format "${value}". Use text, json, or stream-json.`);
}

function parseInputFormat(value: string | undefined): InputFormat {
  if (value === undefined) return "text";
  if (value === "text" || value === "stream-json") return value;
  throw new KeycodeError("CONFIG_INVALID", `Unknown input format "${value}". Use text or stream-json.`);
}

function parsePermissionMode(value: string | undefined): PermissionMode | undefined {
  if (value === undefined) return undefined;
  if (!(PERMISSION_MODES as readonly string[]).includes(value)) {
    throw new KeycodeError(
      "CONFIG_INVALID",
      `Unknown permission mode "${value}". Use ${PERMISSION_MODES.join(", ")}.`,
    );
  }
  return value as PermissionMode;
}

function parseEffort(value: string | undefined): AgentSetupOptions["effort"] {
  if (value === undefined) return undefined;
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max") return value;
  throw new KeycodeError("CONFIG_INVALID", `Unknown effort "${value}". Use low, medium, high, xhigh, or max.`);
}

function setupOptions(options: CliOptions): AgentSetupOptions {
  const permissionMode = options.dangerouslySkipPermissions
    ? "bypassPermissions"
    : parsePermissionMode(options.permissionMode);
  const effort = parseEffort(options.effort);
  return {
    cwd: process.cwd(),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(effort === undefined ? {} : { effort }),
    ...(options.fallbackModel === undefined ? {} : { fallbackModel: options.fallbackModel }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(options.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: Number(options.maxBudgetUsd) }),
    ...(options.addDir === undefined ? {} : { addDirs: options.addDir }),
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options.resume === undefined || options.resume === false
      ? {}
      : { resume: options.resume === true ? true : options.resume }),
    ...(options.continue === true ? { continue: true } : {}),
    ...(options.forkSession === true ? { forkSession: true } : {}),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    ...(options.appendSystemPrompt === undefined ? {} : { appendSystemPrompt: options.appendSystemPrompt }),
    ...(options.memory === false ? { noMemory: true } : {}),
    ...(options.debug === true ? { debug: true } : {}),
    ...(options.trust === undefined ? {} : { trust: options.trust }),
    ...(options.restricted === true ? { restricted: true } : {}),
    ...(options.safeMode === true ? { safeMode: true } : {}),
    ...(options.bare === true ? { bare: true } : {}),
    ...(options.allowedTool === undefined ? {} : { allowedTools: options.allowedTool }),
    ...(options.allow === undefined || options.allow.length === 0
      ? {}
      : { allowRules: options.allow }),
    ...(options.deny === undefined || options.deny.length === 0
      ? {}
      : { denyRules: options.deny }),
    ...(options.ask === undefined || options.ask.length === 0 ? {} : { askRules: options.ask }),
  };
}

function installSigint(controller: AbortController): void {
  let count = 0;
  process.on("SIGINT", () => {
    count += 1;
    if (count === 1) {
      controller.abort();
      process.stderr.write("\nAborting current turn. Press Ctrl+C again to exit.\n");
    } else {
      process.exit(130);
    }
  });
}

const program = new Command();
program
  .name("keycode")
  .description("A free, local-first, bring-your-own-key coding agent.")
  .version(VERSION, "-v, --version")
  .argument("[prompt]", "prompt to run headlessly")
  .option("-p, --print [prompt]", "print mode; no interactive UI")
  .option("--output-format <format>", "text, json, or stream-json", "text")
  .option("--input-format <format>", "text or stream-json", "text")
  .option("--provider <id>", "provider id")
  .option("--model <id>", "model id")
  .option("--effort <level>", "low, medium, high, xhigh, or max")
  .option("--fallback-model <id>", "model to use when the primary fails")
  .option("--permission-mode <mode>", "manual, acceptEdits, plan, auto, dontAsk, or bypassPermissions")
  .option("--allow <rule>", "allow rule, for example Bash(npm test) (repeatable)", collectRule, [] as string[])
  .option("--deny <rule>", "deny rule (repeatable)", collectRule, [] as string[])
  .option("--ask <rule>", "ask rule (repeatable)", collectRule, [] as string[])
  .option("--dangerously-skip-permissions", "alias for --permission-mode bypassPermissions")
  .option("--max-budget-usd <amount>", "stop before exceeding this spend")
  .option("--add-dir <dirs...>", "additional workspace directories")
  .option("--session-id <uuid>", "use a specific session id")
  .option("--resume [id]", "resume a session by id, name, or prefix")
  .option("--continue", "continue the latest session in this directory")
  .option("--fork-session", "fork when resuming")
  .option("--name <name>", "session name")
  .option("--system-prompt <text>", "replace the base system prompt")
  .option("--append-system-prompt <text>", "append to the system prompt")
  .option("--no-memory", "do not load CLAUDE.md files")
  .option("--trust", "trust this workspace")
  .option("--restricted", "remove code-running tools and WebFetch unless named")
  .option("--allowed-tool <names...>", "keep these tools in restricted mode")
  .option("--safe-mode", "disable customizations")
  .option("--bare", "skip hooks, LSP, plugin sync, and memory")
  .option("--ax-screen-reader", "flat-text accessibility mode")
  .option("--debug", "print debug details")
  .action(async (promptArg: string | undefined, options: CliOptions) => {
    if (options.axScreenReader === true) process.env.KEYCODE_AX = "1";
    const outputFormat = parseOutputFormat(options.outputFormat);
    const inputFormat = parseInputFormat(options.inputFormat);
    const printPrompt =
      typeof options.print === "string" ? options.print : options.print === true ? promptArg : undefined;
    const prompt = printPrompt ?? promptArg;
    const headless =
      options.print !== undefined || prompt !== undefined || inputFormat === "stream-json" || !process.stdin.isTTY;

    if (headless) {
      const controller = new AbortController();
      installSigint(controller);
      const result = await runHeadless({
        ...setupOptions(options),
        ...(prompt === undefined ? {} : { prompt }),
        outputFormat,
        inputFormat,
        signal: controller.signal,
      });
      process.exitCode = result.exitCode;
      return;
    }

    const code = await runInteractive(async (prompter) => {
      const setup = await createAgentSetup({ ...setupOptions(options), prompter });
      if (setup.warnings.length > 0) {
        for (const warning of setup.warnings) process.stderr.write(`warning: ${warning}\n`);
      }
      if (!isTrusted(setup.home, setup.store.cwd)) {
        trustWorkspace(setup.home, setup.store.cwd);
      }
      return setup;
    });
    process.exitCode = code;
  });

program
  .command("doctor")
  .description("Check the installation, configuration, providers, and tools")
  .option("--fix", "repair safe issues such as a missing home directory")
  .option("--json", "emit JSON")
  .option("--provider <id>", "provider to test")
  .action(async (...args: unknown[]) => {
    const cmd = args[args.length - 1] as SubCmd;
    const options = subOpts(cmd) as { fix?: boolean; json?: boolean; provider?: string };
    const report = await runDoctor({
      cwd: process.cwd(),
      fix: options.fix === true,
      ...(options.provider === undefined ? {} : { provider: options.provider }),
    });
    if (options.json === true) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      stdout.write(`${formatDoctor(report)}\n`);
    }
    process.exitCode = report.ok ? 0 : 1;
  });

program
  .command("auth <action> [provider]")
  .description("Manage provider credentials: set, status, logout")
  .option("--key <key>", "API key (otherwise read from stdin)")
  .action(async (action: string, provider: string | undefined, options: { key?: string }) => {
    const code = await authCommand(action, {
      home: keycodeHome(),
      ...(provider === undefined ? {} : { provider }),
      ...(options.key === undefined ? {} : { key: options.key }),
    });
    process.exitCode = code;
  });

program
  .command("sessions")
  .description("List sessions in the current directory")
  .option("--json", "emit JSON")
  .action((options: { json?: boolean }) => {
    const store = new SessionStore(keycodeHome(), process.cwd());
    const sessions = store.list();
    if (options.json === true) {
      stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    } else if (sessions.length === 0) {
      stdout.write("No sessions.\n");
    } else {
      stdout.write(
        `${sessions
          .map((session) => `${session.id}  ${session.name}  ${session.messageCount} msgs  ${session.provider}/${session.model}`)
          .join("\n")}\n`,
      );
    }
  });

program
  .command("audit")
  .description("Show recent audit log entries")
  .option("--limit <n>", "number of entries", "50")
  .option("--json", "emit JSON")
  .action((options: { limit?: string; json?: boolean }) => {
    const entries = new AuditLog(keycodeHome()).read(Number(options.limit ?? 50));
    if (options.json === true) {
      stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
    } else {
      stdout.write(
        `${entries
          .map((entry) => `${entry.timestamp} ${entry.decision.padEnd(5)} ${entry.tool} ${entry.rule ?? ""} ${entry.reason}`)
          .join("\n")}${entries.length > 0 ? "\n" : "No audit entries.\n"}`,
      );
    }
  });

program
  .command("config")
  .description("Print the effective settings")
  .action(async () => {
    const { loadSettings } = await import("../storage/settings.js");
    const loaded = loadSettings({ cwd: process.cwd(), home: keycodeHome() });
    stdout.write(
      `${JSON.stringify({ settings: loaded.settings, sources: loaded.sources, warnings: loaded.warnings }, null, 2)}\n`,
    );
  });

registerExtraCommands(program);

export async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

try {
  await main();
} catch (error) {
  const keycode = toKeycodeError(error);
  process.stderr.write(`${formatError(keycode, process.argv.includes("--debug"))}\n`);
  process.exitCode = keycode.exitCode;
}
