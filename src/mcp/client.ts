import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { KeycodeError } from "../util/errors.js";

export interface McpServerConfig {
  type?: "stdio" | "sse" | "http" | undefined;
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
  env?: Record<string, string> | undefined;
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface McpToolDefinition {
  name: string;
  description?: string | undefined;
  inputSchema?: unknown;
}

export interface McpResourceDefinition {
  uri: string;
  name?: string | undefined;
  mimeType?: string | undefined;
}

export interface McpPromptDefinition {
  name: string;
  description?: string | undefined;
}

export interface McpToolCallResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }> | undefined;
  isError?: boolean | undefined;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpClient {
  readonly name: string;
  private readonly config: McpServerConfig;
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.config = config;
  }

  private timeoutMs(): number {
    return this.config.timeoutMs ?? 30_000;
  }

  async connect(): Promise<void> {
    const type = this.config.type ?? (this.config.url ? "http" : "stdio");
    if (type === "stdio") {
      if (!this.config.command) {
        throw new KeycodeError("MCP_INIT_FAILED", `MCP server ${this.name} has no command`);
      }
      const child = spawn(this.config.command, this.config.args ?? [], {
        cwd: this.config.cwd ?? process.cwd(),
        env: { ...process.env, ...this.config.env },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      this.reader = createInterface({ input: child.stdout });
      this.reader.on("line", (line) => this.handleLine(line));
      child.on("error", (error) => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new KeycodeError("MCP_INIT_FAILED", error.message));
        }
        this.pending.clear();
      });
    } else if (!this.config.url) {
      throw new KeycodeError("MCP_INIT_FAILED", `MCP server ${this.name} has no url`);
    }

    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "keycode", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new KeycodeError("MCP_INIT_FAILED", `${this.name}: ${message.error.message}`));
    } else {
      pending.resolve(message.result);
    }
  }

  private write(message: JsonRpcMessage): void {
    if (!this.child) throw new KeycodeError("MCP_INIT_FAILED", `MCP server ${this.name} is not connected`);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method: string, params: unknown): void {
    if ((this.config.type ?? "stdio") !== "stdio") return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  async request(method: string, params: unknown, timeoutMs = this.timeoutMs()): Promise<unknown> {
    const type = this.config.type ?? (this.config.url ? "http" : "stdio");
    if (type !== "stdio") {
      if (!this.config.url) throw new KeycodeError("MCP_INIT_FAILED", `MCP server ${this.name} has no url`);
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new KeycodeError("MCP_INIT_FAILED", `${this.name} returned HTTP ${response.status}`);
      const message = (await response.json()) as JsonRpcMessage;
      if (message.error) throw new KeycodeError("MCP_INIT_FAILED", `${this.name}: ${message.error.message}`);
      return message.result;
    }

    const id = this.nextId;
    this.nextId += 1;
    return await new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new KeycodeError("TOOL_TIMEOUT", `${this.name} did not answer ${method} in ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(error);
      }
    });
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = (await this.request("tools/list", {})) as { tools?: McpToolDefinition[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    return (await this.request("tools/call", { name, arguments: args }, this.config.timeoutMs ?? 60_000)) as McpToolCallResult;
  }

  async listResources(): Promise<McpResourceDefinition[]> {
    const result = (await this.request("resources/list", {})) as { resources?: McpResourceDefinition[] } | undefined;
    return result?.resources ?? [];
  }

  async readResource(uri: string): Promise<Array<{ uri: string; text?: string }>> {
    const result = (await this.request("resources/read", { uri })) as
      | { contents?: Array<{ uri: string; text?: string }> }
      | undefined;
    return result?.contents ?? [];
  }

  async listPrompts(): Promise<McpPromptDefinition[]> {
    const result = (await this.request("prompts/list", {})) as { prompts?: McpPromptDefinition[] } | undefined;
    return result?.prompts ?? [];
  }

  async getPrompt(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return await this.request("prompts/get", { name, arguments: args });
  }

  async close(): Promise<void> {
    this.reader?.close();
    this.reader = null;
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}
