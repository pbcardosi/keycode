import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { connect as netConnect } from "node:net";
import type { ToolContext } from "../dist/contracts/tool.js";
import { PermissionService } from "../dist/permissions/pipeline.js";
import { silentLogger } from "../dist/util/logger.js";
import { systemClock } from "../dist/util/clock.js";
import { SessionStore } from "../dist/storage/session.js";

const CLI = resolve("dist/cli/index.js");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CliOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  input?: string;
}

export function runCli(args: string[], options: CliOptions = {}): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...options.env },
    cwd: options.cwd ?? process.cwd(),
    input: options.input,
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "keycode-test-"));
}

export function makeHome(): string {
  const home = join(makeTempRoot(), "home");
  mkdirSync(home, { recursive: true });
  return home;
}

export function makeWorkspace(name = "ws"): string {
  const ws = join(makeTempRoot(), name);
  mkdirSync(ws, { recursive: true });
  return ws;
}

export function projectKey(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 12);
}

export function readJsonl(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export function parseJsonl(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(path: string, value: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

export function findSessionFile(home: string, cwd: string): string {
  const dir = join(home, "projects", projectKey(cwd), "sessions");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  if (files.length !== 1) {
    throw new Error(`Expected one session file in ${dir}, found ${files.length}`);
  }
  return join(dir, files[0] as string);
}

export function fakeScript(events: unknown[]): string {
  return JSON.stringify(events);
}

export function uuid(): string {
  return randomUUID();
}

export interface WsTestClient {
  send(text: string): void;
  nextMessage(timeoutMs?: number): Promise<string>;
  close(): void;
}

export async function connectWebSocket(port: number): Promise<WsTestClient> {
  const socket = netConnect({ port, host: "127.0.0.1" });
  const key = randomBytes(16).toString("base64");
  const messages: string[] = [];
  let waiter: ((text: string) => void) | null = null;
  let buffer = Buffer.alloc(0);

  const parseFrames = (): void => {
    while (true) {
      if (buffer.length < 2) return;
      const second = buffer[1] ?? 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (buffer.length < offset + length) return;
      const text = buffer.subarray(offset, offset + length).toString("utf8");
      buffer = buffer.subarray(offset + length);
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve(text);
      } else {
        messages.push(text);
      }
    }
  };

  await new Promise<void>((resolvePromise, rejectPromise) => {
    socket.once("error", rejectPromise);
    socket.once("connect", () => {
      socket.write(
        [
          "GET / HTTP/1.1",
          "Host: 127.0.0.1",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });
    let handshake = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      handshake = Buffer.concat([handshake, chunk]);
      const end = handshake.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.off("data", onData);
      if (!handshake.subarray(0, end).toString("utf8").includes("101")) {
        rejectPromise(new Error("WebSocket handshake failed"));
        return;
      }
      const rest = handshake.subarray(end + 4);
      if (rest.length > 0) {
        buffer = Buffer.concat([buffer, rest]);
        parseFrames();
      }
      socket.on("data", (next: Buffer) => {
        buffer = Buffer.concat([buffer, next]);
        parseFrames();
      });
      resolvePromise();
    };
    socket.on("data", onData);
  });

  return {
    send(text: string): void {
      const payload = Buffer.from(text, "utf8");
      const mask = randomBytes(4);
      const header = Buffer.from([0x81, 0x80 | payload.length]);
      const masked = Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] ?? 0)));
      socket.write(Buffer.concat([header, mask, masked]));
    },
    nextMessage(timeoutMs = 2_000): Promise<string> {
      const queued = messages.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise<string>((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          waiter = null;
          rejectPromise(new Error("Timed out waiting for a WebSocket message"));
        }, timeoutMs);
        waiter = (text) => {
          clearTimeout(timer);
          resolvePromise(text);
        };
      });
    },
    close(): void {
      socket.end();
    },
  };
}

export function writeFakeLspServer(path: string): void {
  const script = [
    'let buffer = Buffer.alloc(0);',
    'function send(msg) { const body = JSON.stringify(msg); process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`); }',
    'function handle(msg) {',
    '  if (msg.method === "textDocument/didOpen") { send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: msg.params.textDocument.uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, message: "fake diagnostic" }] } }); return; }',
    '  if (msg.id === undefined) return;',
    '  const respond = (result) => send({ jsonrpc: "2.0", id: msg.id, result });',
    '  if (msg.method === "initialize") respond({ capabilities: { hoverProvider: true, definitionProvider: true, referencesProvider: true, textDocumentSync: 1 } });',
    '  else if (msg.method === "textDocument/hover") respond({ contents: { kind: "plaintext", value: "hover text" } });',
    '  else if (msg.method === "textDocument/definition") respond({ uri: "file:///def.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } });',
    '  else if (msg.method === "textDocument/references") respond([{ uri: "file:///ref.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }]);',
    '}',
    'process.stdin.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); while (true) { const headerEnd = buffer.indexOf("\\r\\n\\r\\n"); if (headerEnd === -1) return; const header = buffer.subarray(0, headerEnd).toString(); const m = /Content-Length:\\s*(\\d+)/i.exec(header); const start = headerEnd + 4; if (!m) { buffer = buffer.subarray(start); continue; } const length = Number(m[1]); if (buffer.length < start + length) return; const body = buffer.subarray(start, start + length).toString(); buffer = buffer.subarray(start + length); try { handle(JSON.parse(body)); } catch {} } });',
  ].join("\n");
  writeFileSync(path, script);
}

export function writeFakeMcpServer(path: string): void {
  const script = [
    'let buffer = "";',
    'process.stdin.on("data", (chunk) => {',
    '  buffer += chunk.toString();',
    '  let index;',
    '  while ((index = buffer.indexOf("\\n")) !== -1) {',
    '    const line = buffer.slice(0, index).trim();',
    '    buffer = buffer.slice(index + 1);',
    '    if (!line) continue;',
    '    let msg;',
    '    try { msg = JSON.parse(line); } catch { continue; }',
    '    if (msg.id === undefined) continue;',
    '    const respond = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");',
    '    if (msg.method === "initialize") respond({ protocolVersion: "2024-11-05", capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "fake", version: "1" } });',
    '    else if (msg.method === "tools/list") respond({ tools: [{ name: "echo", description: "Echo a value", inputSchema: { type: "object" } }] });',
    '    else if (msg.method === "tools/call") respond({ content: [{ type: "text", text: JSON.stringify(msg.params.arguments) }] });',
    '    else if (msg.method === "resources/list") respond({ resources: [{ uri: "file:///a.txt", name: "a" }] });',
    '    else if (msg.method === "resources/read") respond({ contents: [{ uri: msg.params.uri, text: "hello resource" }] });',
    '    else if (msg.method === "prompts/list") respond({ prompts: [{ name: "greet", description: "Greeting" }] });',
    '    else if (msg.method === "prompts/get") respond({ messages: [{ role: "user", content: { type: "text", text: "hi prompt" } }] });',
    '  }',
    '});',
  ].join("\n");
  writeFileSync(path, script);
}

// Re-exports kept importable from one place.
export { silentLogger } from "../dist/util/logger.js";
export { systemClock } from "../dist/util/clock.js";
export { PermissionService } from "../dist/permissions/pipeline.js";
export { SessionStore } from "../dist/storage/session.js";

export interface ToolCtxOptions {
  cwd: string;
  home?: string | undefined;
  workspaceRoots?: string[] | undefined;
  askQuestions?: ToolContext["askQuestions"] | undefined;
  mode?: "manual" | "bypassPermissions" | "auto" | "dontAsk" | undefined;
  sandbox?: ToolContext["sandbox"] | undefined;
}

export function makeToolCtx(options: ToolCtxOptions): ToolContext {
  const cwd = resolve(options.cwd);
  const roots = options.workspaceRoots ?? [cwd];
  return {
    sessionId: "sess-tool-test",
    cwd,
    workspaceRoots: roots,
    signal: new AbortController().signal,
    permissions: new PermissionService({ mode: options.mode ?? "bypassPermissions", cwd, roots }),
    logger: silentLogger,
    clock: systemClock,
    state: { readFiles: new Set(), todos: [], metadata: new Map() },
    home: options.home ?? makeHome(),
    ...(options.askQuestions === undefined ? {} : { askQuestions: options.askQuestions }),
    ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
  };
}

export function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .map((block) => (block.type === "text" ? block.text ?? "" : `[${block.type}]`))
    .join("\n");
}

