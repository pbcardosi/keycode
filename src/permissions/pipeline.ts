import type {
  PermissionDecision,
  PermissionGate,
  PermissionRequest,
} from "../contracts/tool.js";
import type {
  PermissionMode,
  PermissionRule,
  PermissionSettings,
  RuleScope,
} from "../contracts/permissions.js";
import { KeycodeError } from "../util/errors.js";
import { assessCommand } from "./dangerous.js";
import { isPathInsideRoots, matchRule, parseRule } from "./rules.js";
import type { AuditLog } from "./audit.js";

export interface PromptChoice {
  behavior: "allow_once" | "allow_always" | "allow_session" | "deny" | "cancel";
  note?: string | undefined;
}

export interface PermissionPrompter {
  ask(request: PermissionRequest, decision: PermissionDecision): Promise<PromptChoice>;
}

export interface PermissionServiceOptions {
  mode: PermissionMode;
  rules?: PermissionRule[] | undefined;
  cwd: string;
  roots?: string[] | undefined;
  prompter?: PermissionPrompter | undefined;
  audit?: AuditLog | undefined;
  sessionId?: string | undefined;
  managedDenyTools?: string[] | undefined;
  persistRule?: ((raw: string) => void) | undefined;
  trusted?: boolean | undefined;
}

const EDIT_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "MultiEdit"]);
const COMMAND_TOOLS = new Set(["Bash", "PowerShell"]);
const NETWORK_TOOLS = new Set(["WebFetch", "WebSearch"]);

export function rulesFromPermissionSettings(
  permissions: PermissionSettings,
  scope: RuleScope = "user",
): PermissionRule[] {
  return [
    ...permissions.deny.map((raw) => parseRule(raw, scope, "deny")),
    ...permissions.ask.map((raw) => parseRule(raw, scope, "ask")),
    ...permissions.allow.map((raw) => parseRule(raw, scope, "allow")),
  ];
}

function defaultDecision(
  mode: PermissionMode,
  request: PermissionRequest,
  inside: boolean,
): PermissionDecision {
  if (mode === "plan") {
    return request.readOnly
      ? { behavior: "allow", reason: "Plan mode allows read-only tools", source: "mode" }
      : { behavior: "deny", reason: "Plan mode blocks mutations", source: "mode" };
  }
  if (mode === "bypassPermissions") {
    return { behavior: "allow", reason: "bypassPermissions allows all tools", source: "mode" };
  }
  if (mode === "manual") {
    return request.readOnly && inside
      ? { behavior: "allow", reason: "Read-only inside the workspace", source: "mode" }
      : { behavior: "ask", reason: "Manual mode requires approval", source: "mode" };
  }
  if (mode === "acceptEdits") {
    if (request.readOnly && inside) {
      return { behavior: "allow", reason: "Read-only inside the workspace", source: "mode" };
    }
    if (EDIT_TOOLS.has(request.tool) && inside) {
      return { behavior: "allow", reason: "acceptEdits allows edits inside the workspace", source: "mode" };
    }
    return { behavior: "ask", reason: "acceptEdits prompts for commands and network access", source: "mode" };
  }
  if (mode === "auto") {
    if (request.readOnly && inside) {
      return { behavior: "allow", reason: "auto allows read-only tools", source: "mode" };
    }
    if (EDIT_TOOLS.has(request.tool) && inside) {
      return { behavior: "allow", reason: "auto allows edits inside the workspace", source: "mode" };
    }
    return { behavior: "ask", reason: "auto requires approval for risky operations", source: "mode" };
  }
  return {
    behavior: "deny",
    reason: "dontAsk denies anything that would prompt",
    source: "mode",
  };
}

export class PermissionService implements PermissionGate {
  private readonly options: PermissionServiceOptions;
  private readonly sessionRules: PermissionRule[] = [];
  private readonly roots: string[];

  constructor(options: PermissionServiceOptions) {
    this.options = options;
    this.roots = options.roots ?? [options.cwd];
  }

  recordSessionAllow(tool: string, pattern?: string | undefined): void {
    const raw = pattern === undefined ? tool : `${tool}(${pattern})`;
    this.sessionRules.unshift(parseRule(raw, "session", "allow"));
  }

  evaluate(request: PermissionRequest): PermissionDecision {
    if (this.options.managedDenyTools?.includes(request.tool)) {
      return {
        behavior: "deny",
        reason: `${request.tool} is disabled by managed policy`,
        rule: request.tool,
        source: "managed",
      };
    }

    const pathInput = request.input;
    const candidate =
      pathInput !== null && typeof pathInput === "object"
        ? ((pathInput as Record<string, unknown>).file_path ??
          (pathInput as Record<string, unknown>).path ??
          (pathInput as Record<string, unknown>).notebook_path)
        : undefined;

    let inside = true;
    if (typeof candidate === "string") {
      const absolute = candidate;
      inside =
        isPathInsideRoots(absolute, this.roots) ||
        isPathInsideRoots(`${this.options.cwd}/${candidate}`, this.roots);
      if (!inside) {
        return {
          behavior: "deny",
          reason: `Path ${candidate} is outside the workspace`,
          source: "path",
        };
      }
    }

    const configured = this.options.rules ?? [];
    const visible = this.options.trusted === false
      ? configured.filter((rule) => rule.scope !== "project" && rule.scope !== "local")
      : configured;
    const rules = [...visible, ...this.sessionRules];

    const deny = rules.find((rule) => rule.behavior === "deny" && matchRule(rule, request));
    if (deny) {
      return { behavior: "deny", reason: `Denied by rule ${deny.raw}`, rule: deny.raw, source: deny.scope };
    }
    const ask = rules.find((rule) => rule.behavior === "ask" && matchRule(rule, request));
    if (ask) {
      return { behavior: "ask", reason: `Approval required by rule ${ask.raw}`, rule: ask.raw, source: ask.scope };
    }
    const allow = rules.find((rule) => rule.behavior === "allow" && matchRule(rule, request));
    if (allow) {
      return { behavior: "allow", reason: `Allowed by rule ${allow.raw}`, rule: allow.raw, source: allow.scope };
    }

    if (
      COMMAND_TOOLS.has(request.tool) &&
      typeof (request.input as { command?: unknown })?.command === "string"
    ) {
      const command = (request.input as { command: string }).command;
      const danger = assessCommand(command);
      if (danger.level === "danger") {
        if (this.options.mode === "bypassPermissions") {
          return {
            behavior: "allow",
            reason: `Dangerous command allowed by bypassPermissions: ${danger.reason}`,
            source: "danger",
          };
        }
        if (this.options.mode === "plan" || this.options.mode === "dontAsk") {
          return { behavior: "deny", reason: `Blocked dangerous command: ${danger.reason}`, source: "danger" };
        }
        return { behavior: "ask", reason: `Dangerous command: ${danger.reason}`, source: "danger" };
      }
      if (danger.level === "warn" && !request.readOnly) {
        if (this.options.mode === "bypassPermissions") {
          return {
            behavior: "allow",
            reason: `Warning allowed by bypassPermissions: ${danger.reason}`,
            source: "danger",
          };
        }
        return { behavior: "ask", reason: `Review command: ${danger.reason}`, source: "danger" };
      }
    }

    if (NETWORK_TOOLS.has(request.tool) && this.options.mode === "auto") {
      return { behavior: "ask", reason: "Network access requires approval in auto mode", source: "mode" };
    }

    return defaultDecision(this.options.mode, request, inside);
  }

  async check(request: PermissionRequest): Promise<PermissionDecision> {
    const started = Date.now();
    let decision = this.evaluate(request);
    if (decision.behavior === "ask") {
      const prompter = this.options.prompter;
      if (!prompter) {
        throw new KeycodeError(
          "PERMISSION_PROMPT_UNAVAILABLE",
          `${request.tool} needs approval, but no interactive channel is available. Add an allow rule or run interactively.`,
        );
      }
      const choice = await prompter.ask(request, decision);
      if (choice.behavior === "cancel") {
        throw new KeycodeError("ABORTED", "Permission prompt cancelled");
      }
      if (choice.behavior === "deny") {
        decision = {
          behavior: "deny",
          reason: choice.note && choice.note.length > 0 ? choice.note : "Denied by user",
          ...(decision.rule === undefined ? {} : { rule: decision.rule }),
          source: "user",
        };
      } else {
        decision = {
          behavior: "allow",
          reason: choice.behavior === "allow_once" ? "Allowed once by user" : "Allowed by user",
          ...(decision.rule === undefined ? {} : { rule: decision.rule }),
          source: "user",
        };
        if (choice.behavior === "allow_session") {
          this.recordSessionAllow(request.tool, undefined);
        } else if (choice.behavior === "allow_always") {
          this.recordSessionAllow(request.tool, undefined);
          this.options.persistRule?.(request.tool);
        }
      }
    }

    this.options.audit?.record(
      this.options.sessionId ?? "unknown",
      request,
      decision,
      Date.now() - started,
    );
    return decision;
  }
}
