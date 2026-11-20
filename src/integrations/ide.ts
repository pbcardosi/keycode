import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "../util/fsx.js";
import { acceptWebSocket, type WsConnection } from "./ws.js";

export interface IdeSelection {
  file: string;
  text: string;
  startLine?: number | undefined;
  endLine?: number | undefined;
}

export interface IdeBridgeOptions {
  home: string;
  cwd: string;
  token?: string | undefined;
}

export interface IdeBridgeStart {
  port: number;
  token: string;
  discoveryFile: string;
}

export class IdeBridge {
  private readonly options: IdeBridgeOptions;
  private readonly server: Server;
  private connection: WsConnection | null = null;
  private selection: IdeSelection | null = null;
  private port = 0;

  constructor(options: IdeBridgeOptions) {
    this.options = options;
    this.server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end("not found");
    });
    this.server.on("upgrade", (req, socket) => {
      const connection = acceptWebSocket(req, socket);
      if (!connection) return;
      this.connection = connection;
      connection.onMessage((text) => {
        try {
          const message = JSON.parse(text) as { type?: string; selection?: IdeSelection };
          if (message.type === "selection" && message.selection) {
            this.selection = message.selection;
          }
        } catch {
          // Ignore malformed IDE messages.
        }
      });
      connection.onClose(() => {
        this.connection = null;
      });
    });
  }

  async start(): Promise<IdeBridgeStart> {
    await new Promise<void>((resolvePromise) => this.server.listen(0, "127.0.0.1", resolvePromise));
    this.port = (this.server.address() as AddressInfo).port;
    const token = this.options.token ?? randomUUID();
    const discoveryFile = join(this.options.home, "ide-bridge.json");
    ensureDir(this.options.home);
    writeFileSync(
      discoveryFile,
      `${JSON.stringify({ port: this.port, token, cwd: this.options.cwd }, null, 2)}\n`,
    );
    return { port: this.port, token, discoveryFile };
  }

  get connected(): boolean {
    return this.connection !== null;
  }

  selectionContext(): string {
    if (!this.selection) return "";
    return `Selected ${this.selection.file}:\n${this.selection.text}`;
  }

  requestDiff(original: string, modified: string): boolean {
    if (!this.connection) return false;
    this.connection.send(JSON.stringify({ type: "diff", original, modified }));
    return true;
  }

  async stop(): Promise<void> {
    this.connection?.close();
    this.connection = null;
    await new Promise<void>((resolvePromise) => this.server.close(() => resolvePromise()));
  }
}
