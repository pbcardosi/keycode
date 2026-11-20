import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { AgentEvent } from "../app/agent.js";
import { createAgentSetup, type AgentSetup, type AgentSetupOptions } from "../app/factory.js";
import type { Usage } from "../contracts/message.js";
import { KeycodeError, toKeycodeError, formatError } from "../util/errors.js";
import type { PermissionPrompter } from "../permissions/pipeline.js";
import { PermissionBroker } from "../tui/permission.js";
import { runTui } from "../tui/app.js";

export type OutputFormat = "text" | "json" | "stream-json";
export type InputFormat = "text" | "stream-json";

export interface HeadlessOptions extends AgentSetupOptions {
  prompt?: string | undefined;
  outputFormat?: OutputFormat | undefined;
  inputFormat?: InputFormat | undefined;
  signal?: AbortSignal | undefined;
}

export interface HeadlessResult {
  setup: AgentSetup;
  text: string;
  usage: Usage;
  turns: number;
  exitCode: number;
}

function writeLine(event: unknown): void {
  stdout.write(`${JSON.stringify(event)}\n`);
}

function extractUserText(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  const message = record.message as { content?: unknown } | undefined;
  const content = message?.content ?? record.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((block) =>
        block !== null && typeof block === "object" && (block as { type?: string }).type === "text"
          ? String((block as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
    return text.length > 0 ? text : null;
  }
  return null;
}

async function readAllStdin(): Promise<string> {
  let text = "";
  for await (const chunk of stdin) text += String(chunk);
  return text;
}

async function readStreamJsonInput(): Promise<string[]> {
  const rl = createInterface({ input: stdin });
  const prompts: string[] = [];
  for await (const line of rl) {
    if (line.trim() === "") continue;
    try {
      const text = extractUserText(JSON.parse(line) as unknown);
      if (text !== null && text.trim().length > 0) prompts.push(text);
    } catch {
      // Ignore malformed lines; the result list remains empty for that entry.
    }
  }
  rl.close();
  return prompts;
}

export async function runHeadless(options: HeadlessOptions): Promise<HeadlessResult> {
  const outputFormat = options.outputFormat ?? "text";
  const inputFormat = options.inputFormat ?? "text";
  const signal = options.signal ?? new AbortController().signal;

  let prompt = options.prompt;
  let prompts: string[] = [];
  if (inputFormat === "stream-json") {
    prompts = await readStreamJsonInput();
  } else if (prompt === undefined || prompt.length === 0) {
    const piped = await readAllStdin();
    if (piped.trim().length > 0) prompt = piped;
  }
  if (prompts.length === 0 && (prompt === undefined || prompt.trim().length === 0)) {
    throw new KeycodeError("CONFIG_INVALID", "No prompt provided. Pass -p \"...\" or pipe input on stdin.");
  }

  let accumulated = "";
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let turns = 0;

  const onEvent = (event: AgentEvent): void => {
    if (event.type === "text") {
      accumulated += event.delta;
      if (outputFormat === "text") stdout.write(event.delta);
      if (outputFormat === "stream-json") {
        writeLine({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: event.delta } },
        });
      }
    } else if (event.type === "thinking" && outputFormat === "stream-json") {
      writeLine({ type: "stream_event", event: { type: "thinking_delta", text: event.delta } });
    } else if (event.type === "tool_start" && outputFormat === "stream-json") {
      writeLine({ type: "tool_use", id: event.id, name: event.name, input: event.input });
    } else if (event.type === "tool_result" && outputFormat === "stream-json") {
      writeLine({ type: "tool_result", tool_use_id: event.id, name: event.name, ok: event.ok, content: event.text });
    } else if (event.type === "usage") {
      usage = {
        inputTokens: usage.inputTokens + event.inputTokens,
        outputTokens: usage.outputTokens + event.outputTokens,
      };
    }
  };

  const setup = await createAgentSetup({ ...options, onEvent });
  for (const warning of setup.warnings) process.stderr.write(`warning: ${warning}\n`);

  if (outputFormat === "stream-json") {
    writeLine({
      type: "system",
      subtype: "init",
      session_id: setup.sessionId,
      provider: setup.providerId,
      model: setup.model,
      cwd: setup.store.cwd,
      tools: setup.toolNames,
    });
  }

  try {
    if (prompts.length > 0) {
      for (const item of prompts) {
        await setup.agent.runTurn(item, signal);
        turns += 1;
      }
    } else if (prompt !== undefined) {
      await setup.agent.runTurn(prompt, signal);
      turns += 1;
    }
  } catch (error) {
    const keycode = toKeycodeError(error);
    if (outputFormat === "text") {
      if (accumulated.length > 0) stdout.write("\n");
      process.stderr.write(`${formatError(keycode, options.debug === true)}\n`);
    } else if (outputFormat === "json") {
      writeLine({
        type: "result",
        subtype: "error",
        is_error: true,
        error: { code: keycode.code, message: keycode.userMessage },
        session_id: setup.sessionId,
        usage,
        total_cost_usd: setup.agent.costUsd,
        num_turns: turns,
      });
    } else {
      writeLine({ type: "error", error: { code: keycode.code, message: keycode.userMessage } });
    }
    setup.lsp?.stop();
    setup.artifacts?.stop();
    await setup.telemetry?.flush();
    await setup.browser?.stop();
    await Promise.all(setup.mcpClients.map((client) => client.close()));
    return { setup, text: accumulated, usage, turns, exitCode: keycode.exitCode };
  }

  if (outputFormat === "text") {
    if (accumulated.length > 0) stdout.write("\n");
  } else if (outputFormat === "json") {
    writeLine({
      type: "result",
      subtype: "success",
      is_error: false,
      result: accumulated,
      session_id: setup.sessionId,
      provider: setup.providerId,
      model: setup.model,
      usage,
      total_cost_usd: setup.agent.costUsd,
      num_turns: turns,
    });
  } else {
    writeLine({
      type: "result",
      subtype: "success",
      is_error: false,
      result: accumulated,
      session_id: setup.sessionId,
      usage,
      total_cost_usd: setup.agent.costUsd,
      num_turns: turns,
    });
  }

  setup.lsp?.stop();
  setup.artifacts?.stop();
  await setup.telemetry?.flush();
  await setup.browser?.stop();
  await Promise.all(setup.mcpClients.map((client) => client.close()));
  return { setup, text: accumulated, usage, turns, exitCode: 0 };
}

export async function runInteractive(
  factory: (prompter: PermissionPrompter) => Promise<AgentSetup>,
): Promise<number> {
  const permissions = new PermissionBroker();
  let current = await factory(permissions);
  for (const warning of current.warnings) process.stderr.write(`warning: ${warning}\n`);
  const closeSetup = async (setup: AgentSetup): Promise<void> => {
    setup.lsp?.stop();
    setup.artifacts?.stop();
    await setup.telemetry?.flush();
    await setup.browser?.stop();
    await Promise.all(setup.mcpClients.map((client) => client.close()));
  };
  const tui = runTui({
    setup: current,
    permissions,
    onClear: () => {
      void closeSetup(current)
        .then(() => factory(permissions))
        .then((next) => {
          current = next;
          tui.rerender(next);
        });
    },
  });
  const code = await tui.waitUntilExit();
  await closeSetup(current);
  return code;
}
