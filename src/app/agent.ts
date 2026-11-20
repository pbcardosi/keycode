import type { ContentBlock, Message, Usage } from "../contracts/message.js";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
  Provider,
  StopReason,
} from "../contracts/provider.js";
import type {
  Question,
  QuestionResult,
  Tool,
  ToolContext,
  ToolResult,
  ToolState,
} from "../contracts/tool.js";
import type { SessionStore } from "../storage/session.js";
import type { CheckpointStore, RewindMode } from "../storage/checkpoints.js";
import type { PermissionService } from "../permissions/pipeline.js";
import type { SandboxPolicy } from "../sandbox/index.js";
import type { BudgetGuard, Pricing } from "../providers/budget.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KeycodeError, isKeycodeError } from "../util/errors.js";
import { newId } from "../util/ids.js";
import { isInside } from "../util/paths.js";
import { unifiedDiff } from "../tools/edit.js";
import { systemClock, type Clock } from "../util/clock.js";
import { silentLogger, type Logger } from "../util/logger.js";
import { toolSpecs } from "../tools/index.js";
import { parseTextToolCalls, TEXT_TOOL_PROTOCOL } from "../providers/textProtocol.js";
import { negotiateMessages, negotiateTools, ALL_CAPABILITIES } from "../providers/capabilities.js";
import { effectiveMessages, compactSession, type CompactResult } from "./compact.js";
import { promptHash } from "../core/context.js";
import type { HookDispatcher } from "../extensions/hooks.js";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedTokens?: number | undefined }
  | { type: "done"; stopReason: StopReason }
  | { type: "error"; error: unknown };

export interface AgentOptions {
  sessionId: string;
  store: SessionStore;
  provider: Provider;
  providerId: string;
  model: string;
  tools: Tool[];
  permissions: PermissionService;
  home: string;
  cwd: string;
  workspaceRoots: string[];
  sandbox?: SandboxPolicy | undefined;
  systemPrompt: string;
  buildPrompt?: (() => string) | undefined;
  clock?: Clock | undefined;
  logger?: Logger | undefined;
  budget?: BudgetGuard | undefined;
  pricing?: Pricing | undefined;
  capabilities?: ModelCapabilities | undefined;
  autoCompactThreshold?: number | undefined;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  maxToolCalls?: number | undefined;
  fallback?: { provider: Provider; model: string } | undefined;
  checkpointStore?: CheckpointStore | undefined;
  askQuestions?: ((questions: Question[]) => Promise<QuestionResult>) | undefined;
  onEvent?: ((event: AgentEvent) => void) | undefined;
  hooks?: HookDispatcher | undefined;
  onTurnComplete?: ((result: TurnResult, signal: AbortSignal) => Promise<void> | void) | undefined;
}

export interface TurnResult {
  text: string;
  usage: Usage;
  costUsd: number;
  toolCalls: number;
  stopReason: StopReason;
  interrupted: boolean;
}

interface StreamedTurn {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: unknown }>;
  usage: Usage;
  stopReason: StopReason;
  interrupted: boolean;
}

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0 };
}

function addUsage(target: Usage, event: Usage): void {
  target.inputTokens += event.inputTokens;
  target.outputTokens += event.outputTokens;
  if (event.cachedTokens !== undefined) {
    target.cachedTokens = (target.cachedTokens ?? 0) + event.cachedTokens;
  }
}

function resultText(result: ToolResult): string {
  return result.content
    .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
    .join("\n");
}

function stableInput(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableInput).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableInput(record[key])}`)
    .join(",")}}`;
}

function callSignature(call: { name: string; input: unknown }): string {
  return `${call.name}:${stableInput(call.input)}`;
}

function schemaMessage(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.map(String).join(".") : "input"}: ${issue.message}`)
    .join("; ");
}

function permissionPreview(
  tool: Tool,
  input: unknown,
  cwd: string,
): { preview?: string | undefined; diff?: string | undefined } {
  if (input === null || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  if (typeof record.command === "string") return { preview: `$ ${record.command}` };

  const pathValue = typeof record.file_path === "string" ? record.file_path : undefined;
  if (!pathValue) return {};
  const absolute = resolve(cwd, pathValue);

  if (tool.name === "Write" && typeof record.content === "string") {
    const lines = record.content.split(/\r?\n/);
    return {
      preview: `Write ${pathValue} (${lines.length} lines)\n${lines.slice(0, 12).join("\n")}${
        lines.length > 12 ? "\n..." : ""
      }`,
    };
  }

  const oldString = record.old_string;
  const newString = record.new_string;
  if (
    tool.name === "Edit" &&
    typeof oldString === "string" &&
    typeof newString === "string" &&
    isInside(cwd, absolute)
  ) {
    try {
      const before = readFileSync(absolute, "utf8");
      const after =
        record.replace_all === true
          ? before.split(oldString).join(newString)
          : before.replace(oldString, newString);
      if (after !== before) {
        const diff = unifiedDiff(pathValue, before, after);
        return { diff: diff.length > 4_000 ? `${diff.slice(0, 4_000)}\n...` : diff };
      }
    } catch {
      // Fall back to a simple preview if the file cannot be read.
    }
  }

  return { preview: `${tool.name} ${pathValue}` };
}

export class Agent {
  private readonly options: AgentOptions;
  private readonly toolState: ToolState = { readFiles: new Set(), todos: [], metadata: new Map() };
  private readonly subscribers = new Set<(event: AgentEvent) => void>();
  private systemPrompt: string;
  private turn = 0;
  private sessionUsage: Usage = emptyUsage();
  private sessionCost = 0;

  constructor(options: AgentOptions) {
    this.options = options;
    this.systemPrompt = options.systemPrompt;
    const view = options.store.load(options.sessionId);
    this.toolState.todos = view.todos;
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  get providerId(): string {
    return this.options.providerId;
  }

  get model(): string {
    return this.options.model;
  }

  get effort(): AgentOptions["effort"] {
    return this.options.effort;
  }

  get cwd(): string {
    return this.options.cwd;
  }

  get usage(): Usage {
    return { ...this.sessionUsage };
  }

  get costUsd(): number {
    return this.sessionCost;
  }

  get state(): ToolState {
    return this.toolState;
  }

  get workspaceRoots(): string[] {
    return this.options.workspaceRoots;
  }

  get prompt(): string {
    return this.systemPrompt;
  }

  setModel(model: string): void {
    this.options.model = model;
  }

  setEffort(effort: NonNullable<AgentOptions["effort"]>): void {
    this.options.effort = effort;
  }

  setWorkspace(cwd: string, workspaceRoots?: string[] | undefined): void {
    this.options.cwd = cwd;
    if (workspaceRoots !== undefined) this.options.workspaceRoots = workspaceRoots;
  }

  private capabilities(): ModelCapabilities {
    return this.options.capabilities ?? ALL_CAPABILITIES;
  }

  subscribe(handler: (event: AgentEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  private emit(event: AgentEvent): void {
    this.options.onEvent?.(event);
    for (const handler of [...this.subscribers]) handler(event);
  }

  private async *streamWithFallback(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    let emittedText = false;
    try {
      for await (const event of this.options.provider.stream(request, signal)) {
        if (event.type === "text") emittedText = true;
        yield event;
      }
      return;
    } catch (error) {
      const fallback = this.options.fallback;
      const keycode = isKeycodeError(error) ? error : null;
      if (
        signal.aborted ||
        emittedText ||
        !fallback ||
        (keycode && !keycode.retryable && keycode.code !== "PROVIDER_AUTH")
      ) {
        throw error;
      }
      const fallbackRequest: ModelRequest = { ...request, model: fallback.model };
      for await (const event of fallback.provider.stream(fallbackRequest, signal)) {
        yield event;
      }
    }
  }

  private async streamTurn(signal: AbortSignal): Promise<StreamedTurn> {
    const view = this.options.store.load(this.options.sessionId);
    const capabilities = this.capabilities();
    const messages = negotiateMessages(
      capabilities,
      effectiveMessages(view),
    );
    const tools = capabilities.tools ? negotiateTools(capabilities, toolSpecs(this.options.tools)) : [];
    const request: ModelRequest = {
      model: this.options.model,
      system: capabilities.tools
        ? this.systemPrompt
        : `${this.systemPrompt}\n\n${TEXT_TOOL_PROTOCOL}`,
      messages,
      tools,
      ...(this.options.effort === undefined ? {} : { effort: this.options.effort }),
    };

    this.options.budget?.assertCanStart();

    let text = "";
    const toolCalls: StreamedTurn["toolCalls"] = [];
    const usage = emptyUsage();
    let stopReason: StopReason = "end_turn";
    let interrupted = false;

    for await (const event of this.streamWithFallback(request, signal)) {
      if (event.type === "text") {
        text += event.delta;
        this.emit({ type: "text", delta: event.delta });
      } else if (event.type === "thinking") {
        this.emit({ type: "thinking", delta: event.delta });
      } else if (event.type === "tool_call") {
        toolCalls.push({ id: event.id, name: event.name, input: event.input });
      } else if (event.type === "usage") {
        addUsage(usage, event);
        this.emit({ type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens });
        const cost = this.options.budget?.addUsage(event.inputTokens, event.outputTokens) ?? this.costFor(event);
        this.sessionCost += cost;
      } else if (event.type === "error") {
        throw event.error;
      } else if (event.type === "done") {
        stopReason = event.stopReason;
        interrupted = event.stopReason === "aborted";
      }
    }

    if (signal.aborted) {
      interrupted = true;
      if (stopReason !== "aborted") stopReason = "aborted";
    }

    if (this.capabilities().tools === false && toolCalls.length === 0) {
      const parsed = parseTextToolCalls(text);
      if (parsed.calls.length > 0) {
        text = parsed.text;
        toolCalls.push(...parsed.calls);
        stopReason = "tool_use";
      }
    }

    return { text, toolCalls, usage, stopReason, interrupted };
  }

  private costFor(event: { inputTokens: number; outputTokens: number }): number {
    const pricing = this.options.pricing;
    if (!pricing) return 0;
    return (
      (event.inputTokens / 1_000_000) * pricing.inputPerMTok +
      (event.outputTokens / 1_000_000) * pricing.outputPerMTok
    );
  }

  private toolContext(signal: AbortSignal): ToolContext {
    return {
      sessionId: this.options.sessionId,
      cwd: this.options.cwd,
      workspaceRoots: this.options.workspaceRoots,
      signal,
      permissions: this.options.permissions,
      logger: this.options.logger ?? silentLogger,
      clock: this.options.clock ?? systemClock,
      state: this.toolState,
      home: this.options.home,
      ...(this.options.sandbox === undefined ? {} : { sandbox: this.options.sandbox }),
      ...(this.options.askQuestions === undefined ? {} : { askQuestions: this.options.askQuestions }),
      onMutation: (paths) => {
        const view = this.options.store.load(this.options.sessionId);
        this.options.checkpointStore?.create(
          this.options.sessionId,
          this.turn,
          paths,
          view.messages.length,
        );
      },
    };
  }

  private repeatedCallResult(call: { id: string; name: string }): {
    result: ToolResult;
    message: ContentBlock;
  } {
    const text = `REPEATED_TOOL_CALL: ${call.name} with identical input already ran three times. Do not repeat it. Verify the current state with a different command or finish with a summary.`;
    return {
      result: {
        ok: false,
        content: [{ type: "text", text }],
        metadata: { code: "REPEATED_TOOL_CALL" },
      },
      message: { type: "tool_result", toolCallId: call.id, ok: false, content: [{ type: "text", text }] },
    };
  }

  private async executeToolCall(
    call: { id: string; name: string; input: unknown },
    signal: AbortSignal,
  ): Promise<{ result: ToolResult; message: ContentBlock }> {    const tool = this.options.tools.find((candidate) => candidate.name === call.name);
    if (!tool) {
      const message = `Unknown tool "${call.name}". Available tools: ${this.options.tools.map((item) => item.name).join(", ")}.`;
      return {
        result: { ok: false, content: [{ type: "text", text: message }] },
        message: {
          type: "tool_result",
          toolCallId: call.id,
          ok: false,
          content: [{ type: "text", text: message }],
        },
      };
    }

    const allowedBySkill = this.toolState.metadata.get("skill.allowedTools");
    if (
      Array.isArray(allowedBySkill) &&
      call.name !== "Skill" &&
      !allowedBySkill.includes(call.name)
    ) {
      const message = `PERMISSION_DENIED: ${call.name} is not allowed by the active skill (allowed: ${allowedBySkill.join(", ")})`;
      return {
        result: { ok: false, content: [{ type: "text", text: message }], metadata: { code: "PERMISSION_DENIED" } },
        message: { type: "tool_result", toolCallId: call.id, ok: false, content: [{ type: "text", text: message }] },
      };
    }

    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) {
      const message = `TOOL_INPUT_INVALID: ${schemaMessage(parsed.error)}`;
      return {
        result: { ok: false, content: [{ type: "text", text: message }] },
        message: {
          type: "tool_result",
          toolCallId: call.id,
          ok: false,
          content: [{ type: "text", text: message }],
        },
      };
    }

    let effectiveInput: unknown = parsed.data;
    const preHook = await this.options.hooks?.run("PreToolUse", {
      session_id: this.options.sessionId,
      hook_event_name: "PreToolUse",
      cwd: this.options.cwd,
      tool_name: call.name,
      tool_input: parsed.data,
    });
    if (preHook?.decision === "deny") {
      const message = `PERMISSION_DENIED: ${preHook.reason ?? "Denied by hook"}`;
      return {
        result: { ok: false, content: [{ type: "text", text: message }], metadata: { code: "PERMISSION_DENIED" } },
        message: { type: "tool_result", toolCallId: call.id, ok: false, content: [{ type: "text", text: message }] },
      };
    }
    if (preHook?.updatedInput !== undefined) {
      const reparsed = tool.input.safeParse(preHook.updatedInput);
      if (!reparsed.success) {
        const message = `TOOL_INPUT_INVALID: ${schemaMessage(reparsed.error)}`;
        return {
          result: { ok: false, content: [{ type: "text", text: message }] },
          message: { type: "tool_result", toolCallId: call.id, ok: false, content: [{ type: "text", text: message }] },
        };
      }
      effectiveInput = reparsed.data;
    }

    let result: ToolResult;
    try {
      const preview = permissionPreview(tool, effectiveInput, this.options.cwd);
      const decision = await this.options.permissions.check({
        tool: call.name,
        input: effectiveInput,
        cwd: this.options.cwd,
        readOnly: tool.readOnly,
        ...(preview.preview === undefined ? {} : { preview: preview.preview }),
        ...(preview.diff === undefined ? {} : { diff: preview.diff }),
      });
      if (decision.behavior === "deny") {
        result = {
          ok: false,
          content: [{ type: "text", text: `PERMISSION_DENIED: ${decision.reason}` }],
          metadata: { code: "PERMISSION_DENIED", rule: decision.rule ?? null },
        };
      } else {
        result = await tool.execute(effectiveInput, this.toolContext(signal));
      }
    } catch (error) {
      const keycode = isKeycodeError(error)
        ? error
        : new KeycodeError("PROVIDER_UNAVAILABLE", (error as Error).message, { cause: error });
      result = {
        ok: false,
        content: [{ type: "text", text: `${keycode.code}: ${keycode.userMessage}` }],
        metadata: { code: keycode.code },
      };
    }

    await this.options.hooks?.run(result.ok ? "PostToolUse" : "PostToolUseFailure", {
      session_id: this.options.sessionId,
      hook_event_name: result.ok ? "PostToolUse" : "PostToolUseFailure",
      cwd: this.options.cwd,
      tool_name: call.name,
      tool_input: effectiveInput,
      tool_result: { ok: result.ok, content: result.content },
    });

    return {
      result,
      message: {
        type: "tool_result",
        toolCallId: call.id,
        ok: result.ok,
        content: result.content,
      },
    };
  }

  async runTurn(input: string, signal: AbortSignal): Promise<TurnResult> {
    this.turn += 1;
    this.toolState.metadata.delete("skill.allowedTools");
    const promptHook = await this.options.hooks?.run("UserPromptSubmit", {
      session_id: this.options.sessionId,
      hook_event_name: "UserPromptSubmit",
      cwd: this.options.cwd,
      prompt: input,
    });
    if (promptHook?.decision === "deny") {
      throw new KeycodeError("PERMISSION_DENIED", promptHook.reason ?? "Prompt blocked by hook");
    }
    const viewBefore = this.options.store.load(this.options.sessionId);
    this.options.checkpointStore?.create(
      this.options.sessionId,
      this.turn,
      [],
      viewBefore.messages.length,
    );

    const userMessage: Message = {
      id: newId("m"),
      role: "user",
      content: [{ type: "text", text: input }],
      timestamp: new Date().toISOString(),
    };
    this.options.store.appendMessage(this.options.sessionId, userMessage);

    const turnUsage = emptyUsage();
    const turnCostStart = this.sessionCost;
    let allText = "";
    let totalToolCalls = 0;
    let stopReason: StopReason = "end_turn";
    let interrupted = false;
    const maxToolCalls = this.options.maxToolCalls ?? 20;
    let lastCallSignature: string | null = null;
    let consecutiveRepeats = 0;

    try {
      for (let iteration = 0; iteration < maxToolCalls + 1; iteration += 1) {
        const streamed = await this.streamTurn(signal);
        allText += streamed.text;
        addUsage(turnUsage, streamed.usage);
        addUsage(this.sessionUsage, streamed.usage);
        stopReason = streamed.stopReason;
        interrupted = streamed.interrupted;

        const assistantContent: ContentBlock[] = [];
        if (streamed.text.length > 0) assistantContent.push({ type: "text", text: streamed.text });
        for (const call of streamed.toolCalls) {
          assistantContent.push({ type: "tool_call", id: call.id, name: call.name, input: call.input });
        }

        if (assistantContent.length > 0) {
          this.options.store.appendMessage(this.options.sessionId, {
            id: newId("m"),
            role: "assistant",
            content: assistantContent,
            timestamp: new Date().toISOString(),
            usage: streamed.usage,
            ...(streamed.interrupted ? { interrupted: true } : {}),
          });
        }

        if (streamed.interrupted || signal.aborted) {
          interrupted = true;
          stopReason = "aborted";
          break;
        }
        if (streamed.toolCalls.length === 0) break;
        if (totalToolCalls + streamed.toolCalls.length > maxToolCalls) {
          throw new KeycodeError(
            "TOOL_INPUT_INVALID",
            `Turn exceeded the maximum of ${maxToolCalls} tool calls`,
          );
        }

        const toolResults: ContentBlock[] = [];
        for (const call of streamed.toolCalls) {
          totalToolCalls += 1;
          this.emit({ type: "tool_start", id: call.id, name: call.name, input: call.input });
          const signature = callSignature(call);
          if (signature === lastCallSignature) {
            consecutiveRepeats += 1;
          } else {
            lastCallSignature = signature;
            consecutiveRepeats = 1;
          }
          const executed =
            consecutiveRepeats >= 3
              ? this.repeatedCallResult(call)
              : await this.executeToolCall(call, signal);
          toolResults.push(executed.message);
          this.options.store.appendToolResult(
            this.options.sessionId,
            call.id,
            executed.result.ok,
            executed.result.content,
          );
          this.emit({
            type: "tool_result",
            id: call.id,
            name: call.name,
            ok: executed.result.ok,
            text: resultText(executed.result),
          });

          if (call.name === "TodoWrite" && this.toolState.todos.length > 0) {
            this.options.store.appendTodos(this.options.sessionId, this.toolState.todos);
          }
        }

        if (toolResults.length > 0) {
          this.options.store.appendMessage(this.options.sessionId, {
            id: newId("m"),
            role: "user",
            content: toolResults,
            timestamp: new Date().toISOString(),
          });
        }
        if (signal.aborted) {
          interrupted = true;
          stopReason = "aborted";
          break;
        }
      }

      if (!interrupted) {
        await this.maybeAutoCompact(signal);
      }
    } catch (error) {
      if (signal.aborted) {
        return {
          text: allText,
          usage: turnUsage,
          costUsd: this.sessionCost - turnCostStart,
          toolCalls: totalToolCalls,
          stopReason: "aborted",
          interrupted: true,
        };
      }
      throw error;
    }

    await this.options.hooks?.run("Stop", {
      session_id: this.options.sessionId,
      hook_event_name: "Stop",
      cwd: this.options.cwd,
      stop_reason: stopReason,
    });
    const turnResult: TurnResult = {
      text: allText,
      usage: turnUsage,
      costUsd: this.sessionCost - turnCostStart,
      toolCalls: totalToolCalls,
      stopReason,
      interrupted,
    };
    try {
      await this.options.onTurnComplete?.(turnResult, signal);
    } catch (error) {
      this.options.logger?.warn("onTurnComplete failed", { error: (error as Error).message });
    }
    this.emit({ type: "done", stopReason });
    return turnResult;
  }

  async sideQuestion(question: string, signal: AbortSignal): Promise<string> {
    const view = this.options.store.load(this.options.sessionId);
    const messages: Message[] = [
      ...effectiveMessages(view),
      {
        id: newId("m"),
        role: "user",
        content: [{ type: "text", text: question }],
        timestamp: new Date().toISOString(),
      },
    ];
    let text = "";
    for await (const event of this.options.provider.stream(
      { model: this.options.model, system: this.systemPrompt, messages, tools: [] },
      signal,
    )) {
      if (event.type === "text") text += event.delta;
      if (event.type === "error") throw event.error;
    }
    return text;
  }

  branch(name?: string): string {
    return this.options.store.fork(this.options.sessionId, name).id;
  }

  rewind(checkpointId: string, mode: RewindMode): { files: number; messages: number } {
    if (!this.options.checkpointStore) {
      throw new KeycodeError("CONFIG_INVALID", "Checkpoints are not enabled");
    }
    return this.options.checkpointStore.restore(this.options.sessionId, checkpointId, mode);
  }

  async compact(instructions?: string, signal?: AbortSignal): Promise<CompactResult> {
    await this.options.hooks?.run("PreCompact", {
      session_id: this.options.sessionId,
      hook_event_name: "PreCompact",
      cwd: this.options.cwd,
      instructions: instructions ?? null,
    });
    const controller = new AbortController();
    const result = await compactSession({
      store: this.options.store,
      sessionId: this.options.sessionId,
      provider: this.options.provider,
      model: this.options.model,
      ...(instructions === undefined ? {} : { instructions }),
      signal: signal ?? controller.signal,
    });
    if (result.compacted && this.options.buildPrompt) {
      this.systemPrompt = this.options.buildPrompt();
      this.options.store.appendContext(
        this.options.sessionId,
        this.systemPrompt,
        promptHash(this.systemPrompt),
      );
    }
    await this.options.hooks?.run("PostCompact", {
      session_id: this.options.sessionId,
      hook_event_name: "PostCompact",
      cwd: this.options.cwd,
      compacted: result.compacted,
      tokens_before: result.tokensBefore,
      tokens_after: result.tokensAfter,
    });
    return result;
  }

  private async maybeAutoCompact(signal: AbortSignal): Promise<void> {
    const threshold = this.options.autoCompactThreshold;
    if (threshold === undefined || signal.aborted) return;
    const estimate = this.contextEstimate();
    if (estimate.tokens >= threshold) {
      await this.compact(undefined, signal);
    }
  }

  contextEstimate(): { tokens: number; messages: number } {
    const view = this.options.store.load(this.options.sessionId);
    const messages = effectiveMessages(view);
    return {
      tokens: messages.reduce((total, message) => total + Math.ceil(JSON.stringify(message.content).length / 4), 0),
      messages: messages.length,
    };
  }
}
