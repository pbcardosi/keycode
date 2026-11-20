import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { KeycodeError } from "../util/errors.js";

function launch(command: string, args: string[]): { command: string; args: string[]; shell: boolean } {
  if (process.platform !== "win32") return { command, args, shell: false };
  if (/\.(exe|com)$/i.test(command)) return { command, args, shell: false };
  const quote = (value: string): string =>
    /[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return {
    command: [command, ...args].map(quote).join(" "),
    args: [],
    shell: true,
  };
}

export interface LspOptions {
  command: string;
  args?: string[] | undefined;
  cwd: string;
  rootUri?: string | undefined;
  timeoutMs?: number | undefined;
  initializationOptions?: Record<string, unknown> | undefined;
  onNotification?: ((method: string, params: unknown) => void) | undefined;
}

export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number | undefined;
  message: string;
  source?: string | undefined;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function uriKey(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri).replace(/\\/g, "/");
    return decoded.startsWith("file:") ? decoded.toLowerCase() : decoded;
  } catch {
    return uri;
  }
}

export class LspClient {
  private readonly options: LspOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly diagnostics = new Map<string, LspDiagnostic[]>();
  private readonly waiters = new Map<string, (diagnostics: LspDiagnostic[]) => void>();
  private stderrText = "";

  constructor(options: LspOptions) {
    this.options = options;
  }

  private timeoutMs(): number {
    return this.options.timeoutMs ?? 10_000;
  }

  async start(): Promise<void> {
    const spec = launch(this.options.command, this.options.args ?? []);
    const child = spawn(spec.command, spec.args, {
      cwd: this.options.cwd,
      windowsHide: true,
      shell: spec.shell,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrText = `${this.stderrText}${chunk.toString("utf8")}`.slice(-4_000);
    });
    child.on("error", (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new KeycodeError("MCP_INIT_FAILED", `LSP: ${error.message}`));
      }
      this.pending.clear();
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      child.once("spawn", () => resolvePromise());
      child.once("error", (error) => rejectPromise(new KeycodeError("MCP_INIT_FAILED", `LSP: ${error.message}`)));
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      const start = headerEnd + 4;
      if (!match) {
        this.buffer = this.buffer.subarray(start);
        continue;
      }
      const length = Number(match[1]);
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      try {
        this.handle(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // Ignore malformed frames.
      }
    }
  }

  private respond(id: number, method: string, params: unknown): void {
    let result: unknown = null;
    if (method === "workspace/configuration") {
      const items = (params as { items?: unknown[] } | undefined)?.items ?? [];
      result = items.map(() => ({}));
    } else if (method === "workspace/workspaceFolders") {
      result =
        this.options.rootUri === undefined
          ? []
          : [{ uri: this.options.rootUri, name: "workspace" }];
    }
    this.options.onNotification?.(`client:${method}`, params);
    this.send({ jsonrpc: "2.0", id, result });
  }

  private handle(message: JsonRpcMessage): void {
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new KeycodeError("MCP_INIT_FAILED", message.error.message));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      if (message.method !== undefined) {
        this.respond(message.id, message.method, message.params);
      }
      return;
    }
    if (message.method !== undefined) {
      this.options.onNotification?.(message.method, message.params);
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri?: string; diagnostics?: LspDiagnostic[] } | undefined;
      if (params?.uri) {
        const key = uriKey(params.uri);
        const list = params.diagnostics ?? [];
        this.diagnostics.set(key, list);
        const waiter = this.waiters.get(key);
        if (waiter) {
          this.waiters.delete(key);
          waiter(list);
        }
      }
    }
  }

  private send(message: JsonRpcMessage): void {
    if (!this.child) throw new KeycodeError("MCP_INIT_FAILED", "LSP client is not started");
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async request(method: string, params: unknown, timeoutMs = this.timeoutMs()): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return await new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const detail = this.stderrText.trim();
        rejectPromise(
          new KeycodeError(
            "TOOL_TIMEOUT",
            `LSP did not answer ${method} in ${timeoutMs} ms${detail.length > 0 ? `: ${detail.slice(-500)}` : ""}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(error);
      }
    });
  }

  async initialize(): Promise<unknown> {
    const result = await this.request("initialize", {
      processId: process.pid,
      rootUri: this.options.rootUri ?? null,
      capabilities: {
        workspace: { workspaceFolders: true, configuration: true },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: true },
          publishDiagnostics: { relatedInformation: true, versionSupport: false },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          references: {},
        },
      },
      workspaceFolders: null,
      initializationOptions: this.options.initializationOptions ?? {},
    });
    this.notify("initialized", {});
    return result;
  }

  openDocument(uri: string, languageId: string, text: string): void {
    this.diagnostics.delete(uriKey(uri));
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  updateDocument(uri: string, text: string, version: number): void {
    this.diagnostics.delete(uriKey(uri));
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  async waitForDiagnostics(uri: string, timeoutMs = 5_000): Promise<LspDiagnostic[]> {
    const key = uriKey(uri);
    const existing = this.diagnostics.get(key);
    if (existing) return existing;
    return await new Promise<LspDiagnostic[]>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        const detail = this.stderrText.trim();
        rejectPromise(
          new KeycodeError(
            "TOOL_TIMEOUT",
            `LSP did not publish diagnostics in ${timeoutMs} ms${detail.length > 0 ? `: ${detail.slice(-500)}` : ""}`,
          ),
        );
      }, timeoutMs);
      this.waiters.set(key, (list) => {
        clearTimeout(timer);
        resolvePromise(list);
      });
    });
  }

  async hover(uri: string, line: number, character: number): Promise<unknown> {
    return await this.request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async definition(uri: string, line: number, character: number): Promise<unknown> {
    return await this.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async references(uri: string, line: number, character: number): Promise<unknown> {
    return await this.request("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  stop(): void {
    if (this.child) {
      if (process.platform === "win32" && this.child.pid) {
        spawnSync("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        this.child.kill();
      }
      this.child = null;
    }
  }
}
