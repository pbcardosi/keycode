import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "../app/agent.js";
import type { Message } from "../contracts/message.js";
import type { AgentSetup } from "../app/factory.js";
import { executeCommand } from "../app/commands.js";
import { renderMarkdown, renderToolRow, spinnerFrame, renderTodos, renderFooter } from "./format.js";
import { saveDraft } from "./input.js";

const MAX_TRANSCRIPT = 200;

function toolDetail(input: unknown): string {
  if (input !== null && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of ["file_path", "path", "command", "pattern", "note"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) return value.slice(0, 60);
    }
  }
  return "";
}

function messageText(message: Message): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

interface ToolRow {
  status: "pending" | "success" | "error" | "denied" | "aborted";
  name: string;
  detail: string;
}

interface TuiAppProps {
  setup: AgentSetup;
  onClear?: (() => void) | undefined;
}

function TuiApp({ setup, onClear }: TuiAppProps): React.ReactElement {
  const { agent } = setup;
  const initial = setup.store.load(setup.sessionId);
  const [messages, setMessages] = useState<Message[]>(initial.messages);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [input, setInput] = useState("");
  const [todos, setTodos] = useState(agent.state.todos);
  const [spinner, setSpinner] = useState(0);
  const [busy, setBusy] = useState(false);
  const app = useApp();
  const controllerRef = useRef(new AbortController());

  useEffect(() => {
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === "text") {
        const message: Message = {
          id: newId("m"),
          role: "assistant",
          content: [{ type: "text", text: event.delta }],
          timestamp: new Date().toISOString(),
        };
        setMessages((previous) => [...previous.slice(-MAX_TRANSCRIPT + 1), message]);
      } else if (event.type === "tool_start") {
        setTools((previous) => [
          ...previous,
          { status: "pending", name: event.name, detail: toolDetail(event.input) },
        ]);
      } else if (event.type === "tool_result") {
        setTools((previous) =>
          previous.map((row) =>
            row.status === "pending" && row.name === event.name
              ? { ...row, status: event.ok ? "success" : "error" }
              : row,
          ),
        );
      } else if (event.type === "done") {
        setTools([]);
        setBusy(false);
      }
      setTodos([...agent.state.todos]);
    });
    return unsubscribe;
  }, [agent]);

  useEffect(() => {
    const timer = setInterval(() => setSpinner((value) => value + 1), 100);
    return () => clearInterval(timer);
  }, []);

  const syncFromStore = (): void => {
    setMessages(setup.store.load(setup.sessionId).messages.slice(-MAX_TRANSCRIPT));
    setTodos([...agent.state.todos]);
  };

  const submit = async (line: string): Promise<void> => {
    const text = line.trim();
    if (text.length === 0) return;
    if (text.startsWith("/")) {
      const result = await executeCommand(text, {
        setup,
        agent,
        out: () => undefined,
        signal: controllerRef.current.signal,
      });
      if (result.exit) app.exit();
      if (result.clear) onClear?.();
      setInput("");
      syncFromStore();
      return;
    }
    setBusy(true);
    saveDraft(setup.home, setup.sessionId, text);
    try {
      await agent.runTurn(text, controllerRef.current.signal);
    } catch (error) {
      const message: Message = {
        id: newId("m"),
        role: "assistant",
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        timestamp: new Date().toISOString(),
      };
      setMessages((previous) => [...previous.slice(-MAX_TRANSCRIPT + 1), message]);
    } finally {
      setBusy(false);
      setInput("");
      syncFromStore();
    }
  };

  useInput((inputKey, key) => {
    if (key.return) {
      if (input.trim().length > 0) void submit(input);
      return;
    }
    if (key.escape) {
      app.exit();
      return;
    }
    if (key.ctrl && inputKey === "c") {
      app.exit();
      return;
    }
    if (key.backspace) {
      setInput((previous) => previous.slice(0, -1));
      return;
    }
    if (inputKey.length === 1 && !key.ctrl && !key.meta) {
      setInput((previous) => previous + inputKey);
    }
  });

  const footer = renderFooter({
    model: agent.model,
    tokensIn: agent.usage.inputTokens,
    tokensOut: agent.usage.outputTokens,
    costUsd: agent.costUsd,
    branch: null,
    tasks: setup.store.load(setup.sessionId).checkpoints.length,
    progress: busy ? `${spinnerFrame(spinner)} generating` : undefined,
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        {messages.length === 0 && <Text dimColor>keycode — type a prompt and press Enter.</Text>}
        {messages.map((message, index) => (
          <Box key={message.id ?? String(index)} flexDirection="column" marginBottom={1}>
            <Text color={message.role === "user" ? "cyan" : "green"}>
              {message.role === "user" ? "You" : "keycode"}:
            </Text>
            <Text>{renderMarkdown(messageText(message))}</Text>
          </Box>
        ))}
        {tools.length > 0 && (
          <Box flexDirection="column">
            {tools.map((row) => (
              <Text
                key={`${row.name}-${row.status}-${Math.random()}`}
                color={
                  row.status === "pending"
                    ? "yellow"
                    : row.status === "error"
                      ? "red"
                      : row.status === "denied" || row.status === "aborted"
                        ? "gray"
                        : "green"
                }
              >
                {renderToolRow(row.status, row.name, row.detail)}
              </Text>
            ))}
          </Box>
        )}
        {todos.length > 0 && <Text dimColor>{renderTodos(todos)}</Text>}
      </Box>
      <Box borderStyle="round" paddingX={1}>
        <Text>{input}</Text>
        <Text color="gray" dimColor>
          {"  Enter to send · Esc to exit"}
        </Text>
      </Box>
      <Text dimColor>{footer}</Text>
    </Box>
  );
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export interface RunTuiOptions {
  setup: AgentSetup;
  onClear?: (() => void) | undefined;
}

export interface RunTuiResult {
  waitUntilExit(): Promise<number>;
  unmount(): void;
  rerender(setup: AgentSetup): void;
}

export function runTui(options: RunTuiOptions): RunTuiResult {
  const app = render(<TuiApp setup={options.setup} onClear={options.onClear} />, {
    exitOnCtrlC: false,
  });
  return {
    waitUntilExit: async () => {
      await app.waitUntilExit();
      return 0;
    },
    unmount: () => app.unmount(),
    rerender(setup: AgentSetup): void {
      app.rerender(<TuiApp setup={setup} onClear={options.onClear} />);
    },
  };
}
