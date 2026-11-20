// Convert a KeyCode session JSONL file into the prototype dashboard trace model.
// Usage:
//   node scripts/extract-trace.mjs [session.jsonl] [--out <path>] [--context-window <tokens>]
//
// Only tool metadata and truncated chat excerpts are emitted. Tool output is
// read for status and diff counts but is never written to the trace.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(HERE, "..", "prototype", "neon-dashboard", "trace.json");
const DEFAULT_CONTEXT_WINDOW = 128_000;

const TOOL_LANES = {
  Read: { lane: 1, laneKey: "read", icon: "i-read", file: true },
  Glob: { lane: 2, laneKey: "search", icon: "i-search" },
  Grep: { lane: 2, laneKey: "search", icon: "i-search" },
  Edit: { lane: 3, laneKey: "edit", icon: "i-edit", file: true },
  Write: { lane: 3, laneKey: "edit", icon: "i-edit", file: true },
  NotebookEdit: { lane: 3, laneKey: "edit", icon: "i-edit", file: true },
  Bash: { lane: 4, laneKey: "shell", icon: "i-shell" },
  PowerShell: { lane: 4, laneKey: "shell", icon: "i-shell" },
  Task: { lane: 4, laneKey: "shell", icon: "i-shell" },
  WebSearch: { lane: 2, laneKey: "search", icon: "i-search" },
  WebFetch: { lane: 2, laneKey: "search", icon: "i-search" },
};

const TEST_COMMAND =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|verify)\b|\b(?:vitest|jest|mocha|pytest|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle\s+test)\b/i;

function parseArgs(argv) {
  const options = { session: null, out: null, contextWindow: DEFAULT_CONTEXT_WINDOW, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--out") {
      options.out = argv[++index] ?? null;
    } else if (arg === "--context-window") {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) options.contextWindow = value;
    } else if (!arg.startsWith("--")) {
      options.session = arg;
    }
  }
  return options;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/extract-trace.mjs [session.jsonl] [--out <path>] [--context-window <tokens>]",
      "Without a session path, the newest file under ~/.keycode/projects is used.",
      "The default output is prototype/neon-dashboard/trace.json.",
    ].join("\n") + "\n",
  );
}

function findNewestSession() {
  const root = join(homedir(), ".keycode", "projects");
  const sessions = [];
  for (const project of readdirSync(root)) {
    const dir = join(root, project, "sessions");
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const path = join(dir, entry);
      sessions.push({ path, mtimeMs: statSync(path).mtimeMs });
    }
  }
  sessions.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return sessions[0]?.path ?? null;
}

function readSession(path) {
  const text = readFileSync(path, "utf8");
  const records = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const session = records.find((record) => record.type === "session");
  if (!session) throw new Error(`${path} is not a KeyCode session transcript`);
  return { path, session, records };
}

function blockText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function rawText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("\n");
}

function cleanChat(text) {
  return text
    .replace(/```/g, " ")
    .replace(/\*\*/g, "")
    .replace(/`/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function formatDuration(ms) {
  const value = Math.max(0, Math.round(ms));
  if (value < 1_000) return `${value} ms`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1)} s`;
  if (value < 60_000) return `${Math.round(value / 1_000)} s`;
  const minutes = Math.floor(value / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function toolTitle(name, input) {
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return String(input.file_path ?? input.path ?? name);
    case "Grep":
    case "Glob":
      return String(input.pattern ?? input.path ?? input.query ?? name);
    case "Bash":
    case "PowerShell":
      return String(input.command ?? name);
    case "WebSearch":
    case "WebFetch":
      return String(input.query ?? input.url ?? name);
    case "Task":
      return String(input.description ?? input.prompt ?? name);
    default:
      return String(input.file_path ?? input.command ?? input.query ?? name);
  }
}

function diffCounts(text) {
  let added = 0;
  let removed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

function classify(name, input) {
  const base = TOOL_LANES[name] ?? TOOL_LANES.Bash;
  if (
    (name === "Bash" || name === "PowerShell") &&
    TEST_COMMAND.test(String(input.command ?? ""))
  ) {
    return { ...base, lane: 5, laneKey: "test", icon: "i-test", kind: "Test" };
  }
  return { ...base, kind: name };
}

function eventMeta(event) {
  if (event.status === "error") return "failed";
  if (event.kind === "Test") return "passed";
  if (event.lane === 3) {
    const { added, removed } = diffCounts(event.output);
    if (added + removed > 0) return `+${added} −${removed}`;
  }
  return formatDuration(event.durationMs);
}

function buildEvents(records) {
  const calls = new Map();
  for (const record of records) {
    if (record.type !== "message" || record.role !== "assistant") continue;
    if (!Array.isArray(record.content)) continue;
    for (const block of record.content) {
      if (block.type !== "tool_call" || typeof block.id !== "string") continue;
      calls.set(block.id, {
        id: block.id,
        name: String(block.name ?? "Tool"),
        input:
          block.input !== null && typeof block.input === "object" ? block.input : Object.create(null),
        startedAt: String(record.timestamp ?? new Date().toISOString()),
        endedAt: String(record.timestamp ?? new Date().toISOString()),
        usage: record.usage ?? null,
        ok: false,
        output: "",
      });
    }
  }
  for (const record of records) {
    if (record.type !== "tool_result") continue;
    const call = calls.get(record.toolCallId);
    if (!call) continue;
    call.endedAt = String(record.timestamp ?? call.startedAt);
    call.ok = record.ok === true;
    call.output = rawText(record.content);
  }

  const events = [];
  const context = records.find((record) => record.type === "context");
  if (context?.timestamp) {
    events.push({
      id: "evt_context",
      kind: "Context",
      lane: 0,
      laneKey: "context",
      icon: "i-memory",
      category: "context",
      file: false,
      title: "Session context",
      meta: "system prompt",
      status: "ok",
      startedAt: String(context.timestamp),
      endedAt: String(context.timestamp),
      durationMs: 0,
    });
  }

  for (const call of calls.values()) {
    const lane = classify(call.name, call.input);
    const started = Date.parse(call.startedAt);
    const ended = Date.parse(call.endedAt);
    const durationMs = Math.max(0, ended - started);
    const event = {
      id: call.id,
      kind: lane.kind,
      lane: lane.lane,
      laneKey: lane.laneKey,
      icon: lane.icon,
      category: "tool",
      file: lane.file === true,
      title: truncate(toolTitle(call.name, call.input), 160),
      meta: "",
      status: call.ok ? "ok" : "error",
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      durationMs,
      output: call.output,
    };
    event.meta = eventMeta(event);
    delete event.output;
    if (call.usage) {
      event.tokens = {
        inputTokens: Number(call.usage.inputTokens) || 0,
        outputTokens: Number(call.usage.outputTokens) || 0,
        cachedTokens: Number(call.usage.cachedTokens) || 0,
      };
    }
    events.push(event);
  }

  return events.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
}

function usageTotals(records) {
  const usages = records
    .filter((record) => record.type === "message" && record.usage)
    .map((record) => record.usage);
  const last = usages.at(-1) ?? {};
  return {
    inputTokens: Number(last.inputTokens) || 0,
    outputTokens: usages.reduce((sum, usage) => sum + (Number(usage.outputTokens) || 0), 0),
    cachedTokens: Number(last.cachedTokens) || 0,
  };
}

function chatMessages(records) {
  const messages = records.filter((record) => record.type === "message");
  const user = messages.find((record) => record.role === "user" && blockText(record.content).length > 0);
  const assistant = [...messages]
    .reverse()
    .find((record) => record.role === "assistant" && blockText(record.content).length > 0);
  const chat = [];
  if (user) {
    chat.push({
      role: "user",
      text: truncate(cleanChat(blockText(user.content)), 200),
      at: String(user.timestamp ?? ""),
    });
  }
  if (assistant) {
    chat.push({
      role: "assistant",
      text: truncate(cleanChat(blockText(assistant.content)), 220),
      at: String(assistant.timestamp ?? ""),
    });
  }
  return chat;
}

function buildTrace(path, contextWindow) {
  const { session, records } = readSession(path);
  const events = buildEvents(records);
  const usage = usageTotals(records);
  const chat = chatMessages(records);
  const start = Date.parse(session.createdAt);
  const end = Math.max(start, ...events.map((event) => Date.parse(event.endedAt)));
  const durationMs = Math.max(0, end - start);
  const toolEvents = events.filter((event) => event.category === "tool");
  const files = new Set(toolEvents.filter((event) => event.file).map((event) => event.title));
  const tests = toolEvents.filter((event) => event.kind === "Test");
  const title = String(session.name ?? chat[0]?.text ?? "Recorded session");

  return {
    version: 1,
    source: "session-jsonl",
    session: {
      id: String(session.id ?? ""),
      provider: String(session.provider ?? "unknown"),
      model: String(session.model ?? "unknown"),
      title: truncate(title, 120),
      createdAt: new Date(start).toISOString(),
      endedAt: new Date(end).toISOString(),
      durationMs,
      contextWindow,
    },
    usage,
    stats: {
      toolCalls: toolEvents.length,
      files: files.size,
      tests: tests.length,
      testsPassed: tests.filter((event) => event.status === "ok").length,
      testsFailed: tests.filter((event) => event.status === "error").length,
      approvals: 0,
    },
    events,
    chat,
  };
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

try {
  const sessionPath = options.session ? resolve(options.session) : findNewestSession();
  if (!sessionPath) throw new Error("no session transcript found under ~/.keycode/projects");
  const trace = buildTrace(sessionPath, options.contextWindow);
  const outPath = options.out ? resolve(options.out) : DEFAULT_OUT;
  writeFileSync(outPath, `${JSON.stringify(trace, null, 2)}\n`);
  process.stdout.write(
    [
      `session: ${trace.session.id || "(unknown)"} ${trace.session.provider}/${trace.session.model}`,
      `events: ${trace.events.length} (${trace.stats.toolCalls} tool calls, ${trace.stats.files} files)`,
      `wrote: ${outPath}`,
    ].join("\n") + "\n",
  );
} catch (error) {
  process.stderr.write(`extract-trace: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
