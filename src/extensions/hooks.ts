import { z } from "zod";
import { runCommand } from "../tools/bash.js";
import { silentLogger, type Logger } from "../util/logger.js";

export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "UserPromptSubmit",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "SessionEnd",
  "Notification",
  "Setup",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "TeammateIdle",
  "TaskCompleted",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export const HookCommandSchema = z.object({
  type: z.literal("command"),
  command: z.string().min(1),
  timeout: z.number().positive().max(600).optional(),
});

export const HookMatcherSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(HookCommandSchema),
});

export const HookConfigSchema = z.record(z.string(), z.array(HookMatcherSchema));

export type HookCommandConfig = z.infer<typeof HookCommandSchema>;
export type HookMatcherConfig = z.infer<typeof HookMatcherSchema>;
export type HookConfig = z.infer<typeof HookConfigSchema>;

export interface HookPayload {
  session_id: string;
  hook_event_name: string;
  cwd: string;
  tool_name?: string | undefined;
  tool_input?: unknown;
  tool_result?: unknown;
  [key: string]: unknown;
}

export interface HookOutcome {
  decision?: "allow" | "deny" | "ask" | undefined;
  reason?: string | undefined;
  updatedInput?: unknown;
  additionalContext?: string | undefined;
}

export interface HookDispatcher {
  run(event: string, payload: HookPayload): Promise<HookOutcome>;
}

export function parseHookConfig(raw: unknown): HookConfig {
  const parsed = HookConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function mergeHookConfigs(first: HookConfig, second: HookConfig): HookConfig {
  const merged: HookConfig = { ...first };
  for (const [event, matchers] of Object.entries(second)) {
    merged[event] = [...(merged[event] ?? []), ...matchers];
  }
  return merged;
}

export function matchesMatcher(matcher: string | undefined, toolName: string): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (matcher.startsWith("/") && matcher.endsWith("/") && matcher.length > 2) {
    try {
      return new RegExp(matcher.slice(1, -1)).test(toolName);
    } catch {
      return false;
    }
  }
  return matcher.split("|").map((entry) => entry.trim()).includes(toolName);
}

export interface HookDispatcherOptions {
  cwd: string;
  home: string;
  env?: NodeJS.ProcessEnv | undefined;
  logger?: Logger | undefined;
  outputCap?: number | undefined;
}

const MAX_OUTPUT = 10_000;

export class CommandHookDispatcher implements HookDispatcher {
  private readonly config: HookConfig;
  private readonly options: HookDispatcherOptions;

  constructor(config: HookConfig, options: HookDispatcherOptions) {
    this.config = config;
    this.options = options;
  }

  async run(event: string, payload: HookPayload): Promise<HookOutcome> {
    const matchers = this.config[event] ?? [];
    if (matchers.length === 0) return {};
    const logger = this.options.logger ?? silentLogger;
    let combined: HookOutcome = {};

    for (const matcher of matchers) {
      if (payload.tool_name !== undefined && !matchesMatcher(matcher.matcher, payload.tool_name)) {
        continue;
      }
      for (const hook of matcher.hooks) {
        if (hook.type !== "command") continue;
        const outcome = await this.runOne(event, hook, payload, logger);
        if (outcome.decision === "deny") return { ...combined, ...outcome };
        if (outcome.decision === "ask") {
          combined = { ...combined, decision: "ask", reason: outcome.reason ?? combined.reason };
        }
        if (outcome.updatedInput !== undefined) combined.updatedInput = outcome.updatedInput;
        if (outcome.additionalContext !== undefined) {
          combined.additionalContext = [combined.additionalContext, outcome.additionalContext]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join("\n");
        }
      }
    }
    return combined;
  }

  private async runOne(
    event: string,
    hook: HookCommandConfig,
    payload: HookPayload,
    logger: Logger,
  ): Promise<HookOutcome> {
    const result = await runCommand({
      command: hook.command,
      cwd: this.options.cwd,
      env: {
        ...(this.options.env ?? {}),
        KEYCODE_PROJECT_DIR: this.options.cwd,
        KEYCODE_SESSION_ID: payload.session_id,
        KEYCODE_HOOK_EVENT: event,
      },
      stdin: JSON.stringify(payload),
      timeoutMs: Math.round((hook.timeout ?? 60) * 1000),
    });

    if (result.timedOut) {
      logger.warn(`Hook ${event} timed out`);
      return {};
    }
    if (result.exitCode === 2) {
      return {
        decision: "deny",
        reason: result.stderr.trim().length > 0 ? result.stderr.trim() : "Blocked by hook",
      };
    }
    if (result.exitCode !== 0) {
      logger.warn(`Hook ${event} failed with exit code ${result.exitCode ?? "null"}`);
      return {};
    }
    const raw = result.stdout.slice(0, this.options.outputCap ?? MAX_OUTPUT).trim();
    if (raw.length === 0) return {};
    try {
      const parsed = JSON.parse(raw) as {
        decision?: unknown;
        reason?: unknown;
        updatedInput?: unknown;
        additionalContext?: unknown;
      };
      const decision =
        parsed.decision === "allow" || parsed.decision === "deny" || parsed.decision === "ask"
          ? parsed.decision
          : undefined;
      return {
        ...(decision === undefined ? {} : { decision }),
        ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
        ...(parsed.updatedInput === undefined ? {} : { updatedInput: parsed.updatedInput }),
        ...(typeof parsed.additionalContext === "string" ? { additionalContext: parsed.additionalContext } : {}),
      };
    } catch {
      logger.warn(`Hook ${event} returned invalid JSON`);
      return {};
    }
  }
}
