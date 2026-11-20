import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useStdin } from "ink";
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

export function TuiApp({ setup, onClear }: TuiAppProps): React.ReactElement {
  const { agent } = setup;
  const initial = setup.store.load(setup.sessionId);
  const [messages, setMessages] = useState<Message[]>(initial.messages);
  const [streamText, setStreamText] = useState("");
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [input, setInput] = useState("");
  const [todos, setTodos] = useState(agent.state.todos);
  const [spinner, setSpinner] = useState(0);
  const [busy, setBusy] = useState(false);
  const app = useApp();
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const controllerRef = useRef(new AbortController());
  const inputRef = useRef("");
  const busyRef = useRef(false);
  const submitRef = useRef<(line: string) => void>(() => undefined);
  inputRef.current = input;
  busyRef.current = busy;

  useEffect(() => {
    if (typeof setRawMode === "function" && isRawModeSupported) setRawMode(true);
    return () => {
      if (typeof setRawMode === "function" && isRawModeSupported) setRawMode(false);
    };
  }, [isRawModeSupported, setRawMode]);

  useEffect(() => {
    const handleData = (data: string): void => {
      const text = data.toString();
      let index = 0;
      while (index < text.length) {
        const char = text[index] ?? "";
        if (char === "\x1b") {
          const next = text[index + 1];
          if (next === "[" || next === "O") {
            index += 2;
            while (index < text.length && !/[A-Za-z~]/.test(text[index] ?? "")) index += 1;
            index += 1;
            continue;
          }
          if (busyRef.current) {
            controllerRef.current.abort();
            controllerRef.current = new AbortController();
          } else {
            app.exit();
          }
          index += 1;
          continue;
        }
        if (char === "\x03") {
          if (busyRef.current) {
            controllerRef.current.abort();
            controllerRef.current = new AbortController();
          } else {
            app.exit();
          }
          index += 1;
          continue;
        }
        if (char === "\n" || char === "\r") {
          const pending = inputRef.current.trim();
          if (pending.length > 0) void submitRef.current(pending);
          index += 1;
          continue;
        }
        if (char === "\x7f" || char === "\b") {
          setInput((previous) => previous.slice(0, -1));
          index += 1;
          continue;
        }
        if (char >= " ") setInput((previous) => previous + char);
        index += 1;
      }
    };
    stdin.on("data", handleData);
    const onEnd = (): void => {
      app.exit();
    };
    stdin.on("end", onEnd);
    return () => {
      stdin.off("data", handleData);
      stdin.off("end", onEnd);
    };
  }, [stdin, app]);

  useEffect(() => {
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === "text") {
        setStreamText((previous) => previous + event.delta);
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
        setStreamText("");
        setTools([]);
        setBusy(false);
        setMessages(setup.store.load(setup.sessionId).messages.slice(-MAX_TRANSCRIPT));
      }
      setTodos([...agent.state.todos]);
    });
    return unsubscribe;
  }, [agent, setup]);

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
      setStreamText("");
      syncFromStore();
      return;
    }
    if (controllerRef.current.signal.aborted) controllerRef.current = new AbortController();
    setBusy(true);
    setStreamText("");
    setTools([]);
    saveDraft(setup.home, setup.sessionId, text);
    try {
      await agent.runTurn(text, controllerRef.current.signal);
    } catch (error) {
      setStreamText(`Error: ${(error as Error).message}`);
    } finally {
      setBusy(false);
      setInput("");
      syncFromStore();
    }
  };

  submitRef.current = submit;

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
        {messages.length === 0 && streamText.length === 0 && (
          <Text dimColor>keycode — type a prompt and press Enter.</Text>
        )}
        {messages.map((message, index) => (
          <Box key={message.id ?? String(index)} flexDirection="column" marginBottom={1}>
            <Text color={message.role === "user" ? "cyan" : "green"}>
              {message.role === "user" ? "You" : "keycode"}:
            </Text>
            <Text>{renderMarkdown(messageText(message))}</Text>
          </Box>
        ))}
        {streamText.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="green">keycode:</Text>
            <Text>{renderMarkdown(streamText)}</Text>
          </Box>
        )}
        {tools.length > 0 && (
          <Box flexDirection="column">
            {tools.map((row, index) => (
              <Text
                key={`${row.name}-${index}-${row.status}`}
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
      <Box>
        <Text color="cyan">{"› "}</Text>
        <Text>{input}</Text>
        <Text dimColor>{busy ? "  Esc aborts" : "  Enter to send · Esc to exit"}</Text>
      </Box>
      <Text dimColor>{footer}</Text>
    </Box>
  );
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
