import React, { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useStdin } from "ink";
import type { AgentEvent } from "../app/agent.js";
import type { ContentBlock, Message } from "../contracts/message.js";
import type { AgentSetup } from "../app/factory.js";
import { executeCommand } from "../app/commands.js";
import { renderMarkdown, renderToolRow, spinnerFrame, renderTodos, renderFooter } from "./format.js";
import { saveDraft } from "./input.js";
import type { PermissionBroker, PendingPermission } from "./permission.js";
import type { PromptChoice } from "../permissions/pipeline.js";

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
  permissions?: PermissionBroker | undefined;
  onClear?: (() => void) | undefined;
}

const PERMISSION_CHOICES: Record<string, PromptChoice> = {
  "1": { behavior: "allow_once" },
  y: { behavior: "allow_once" },
  "2": { behavior: "allow_always" },
  a: { behavior: "allow_always" },
  "3": { behavior: "allow_session" },
  s: { behavior: "allow_session" },
  "4": { behavior: "deny" },
  n: { behavior: "deny" },
  "5": { behavior: "cancel" },
  c: { behavior: "cancel" },
  q: { behavior: "cancel" },
};

export function TuiApp({ setup, permissions, onClear }: TuiAppProps): React.ReactElement {
  const { agent } = setup;
  const initial = setup.store.load(setup.sessionId);
  const [messages, setMessages] = useState<Message[]>(initial.messages);
  const [streamText, setStreamText] = useState("");
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [input, setInput] = useState("");
  const [todos, setTodos] = useState(agent.state.todos);
  const [spinner, setSpinner] = useState(0);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const app = useApp();
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const controllerRef = useRef(new AbortController());
  const inputRef = useRef("");
  const busyRef = useRef(false);
  const permissionRef = useRef<PendingPermission | null>(null);
  const submitRef = useRef<(line: string) => void>(() => undefined);
  inputRef.current = input;
  busyRef.current = busy;
  permissionRef.current = permission;

  useEffect(() => {
    if (!permissions) return;
    const update = (): void => setPermission(permissions.current);
    update();
    const unsubscribe = permissions.subscribe(update);
    return () => {
      unsubscribe();
      permissions.cancelAll();
    };
  }, [permissions]);

  useEffect(() => {
    if (typeof setRawMode === "function" && isRawModeSupported) setRawMode(true);
    return () => {
      if (typeof setRawMode === "function" && isRawModeSupported) setRawMode(false);
    };
  }, [isRawModeSupported, setRawMode]);

  useEffect(() => {
    const handleData = (data: string): void => {
      const text = data.toString();
      let line = inputRef.current;
      let index = 0;
      while (index < text.length) {
        const char = text[index] ?? "";
        if (permissionRef.current) {
          if (char === "\x1b" || char === "\x03") {
            permissions?.resolveCurrent({ behavior: "cancel" });
            index += 1;
            continue;
          }
          const choice = PERMISSION_CHOICES[char];
          if (choice) permissions?.resolveCurrent(choice);
          index += 1;
          continue;
        }
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
          // A Windows Enter key can arrive as CRLF. Treat it as one submit.
          if (char === "\r" && text[index + 1] === "\n") index += 1;
          const pending = line.trim();
          line = "";
          inputRef.current = "";
          setInput("");
          if (pending.length > 0) void submitRef.current(pending);
          index += 1;
          continue;
        }
        if (char === "\x7f" || char === "\b") {
          line = line.slice(0, -1);
          index += 1;
          continue;
        }
        if (char >= " ") line += char;
        index += 1;
      }
      inputRef.current = line;
      setInput(line);
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
  }, [stdin, app, permissions]);

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
    if (text.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setInput("");
    inputRef.current = "";
    setStreamText("");
    setTools([]);
    try {
      if (text.startsWith("/")) {
        const result = await executeCommand(text, {
          setup,
          agent,
          out: () => undefined,
          signal: controllerRef.current.signal,
        });
        if (result.exit) app.exit();
        if (result.clear) onClear?.();
        return;
      }
      if (controllerRef.current.signal.aborted) controllerRef.current = new AbortController();
      saveDraft(setup.home, setup.sessionId, text);
      await agent.runTurn(text, controllerRef.current.signal);
    } catch (error) {
      setStreamText(`Error: ${(error as Error).message}`);
    } finally {
      busyRef.current = false;
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
    checkpoints: setup.store.load(setup.sessionId).checkpoints.length,
    progress: permission
      ? "waiting for approval"
      : busy
        ? `${spinnerFrame(spinner)} generating`
        : undefined,
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        {messages.length === 0 && streamText.length === 0 && (
          <Text dimColor>keycode — type a prompt and press Enter.</Text>
        )}
        {messages.map((message, index) => {
          const text = messageText(message);
          const toolCalls = message.content.filter(
            (block): block is Extract<ContentBlock, { type: "tool_call" }> => block.type === "tool_call",
          );
          const toolResults = message.content.filter(
            (block): block is Extract<ContentBlock, { type: "tool_result" }> => block.type === "tool_result",
          );
          if (text.length === 0 && toolCalls.length === 0 && toolResults.length === 0) return null;
          return (
            <Box key={message.id ?? String(index)} flexDirection="column" marginBottom={1}>
              {text.length > 0 && (
                <>
                  <Text color={message.role === "user" ? "cyan" : "green"}>
                    {message.role === "user" ? "You" : "keycode"}:
                  </Text>
                  <Text>{renderMarkdown(text)}</Text>
                </>
              )}
              {toolCalls.map((call, callIndex) => {
                const detail = toolDetail(call.input);
                return (
                  <Text key={`${call.id}-${callIndex}`} dimColor>
                    {"  ⚙ "}
                    {call.name}
                    {detail.length > 0 ? ` · ${detail}` : ""}
                  </Text>
                );
              })}
              {toolResults.map((result, resultIndex) => (
                <Text key={`${result.toolCallId}-${resultIndex}`} dimColor>
                  {"  ↳ "}
                  {result.ok ? "ok" : "error"}
                </Text>
              ))}
            </Box>
          );
        })}
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
      {permission && (
        <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1} marginBottom={1}>
          <Text color="yellow">Permission required: {permission.request.tool}</Text>
          <Text>{permission.decision.reason}</Text>
          {permission.request.preview && <Text dimColor>{permission.request.preview}</Text>}
          {permission.request.diff && <Text>{permission.request.diff}</Text>}
          <Text color="cyan">
            [1] allow once  [2] allow always  [3] allow for session  [4] deny  [5] cancel
          </Text>
        </Box>
      )}
      {permission ? (
        <Text dimColor>Choose 1-5 · Esc cancels</Text>
      ) : (
        <Box>
          <Text color="cyan">{"› "}</Text>
          <Text>{input}</Text>
          <Text dimColor>{busy ? "  Esc aborts" : "  Enter to send · Esc to exit"}</Text>
        </Box>
      )}
      <Text dimColor>{footer}</Text>
    </Box>
  );
}

export interface RunTuiOptions {
  setup: AgentSetup;
  permissions?: PermissionBroker | undefined;
  onClear?: (() => void) | undefined;
}

export interface RunTuiResult {
  waitUntilExit(): Promise<number>;
  unmount(): void;
  rerender(setup: AgentSetup): void;
}

export function runTui(options: RunTuiOptions): RunTuiResult {
  const app = render(
    <TuiApp
      setup={options.setup}
      permissions={options.permissions}
      onClear={options.onClear}
    />,
    { exitOnCtrlC: false },
  );
  return {
    waitUntilExit: async () => {
      await app.waitUntilExit();
      return 0;
    },
    unmount: () => app.unmount(),
    rerender(setup: AgentSetup): void {
      app.rerender(
        <TuiApp
          setup={setup}
          permissions={options.permissions}
          onClear={options.onClear}
        />,
      );
    },
  };
}
