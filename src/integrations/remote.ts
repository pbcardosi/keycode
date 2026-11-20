import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptWebSocket, type WsConnection } from "./ws.js";

export interface RemoteInfo {
  provider?: string | undefined;
  model?: string | undefined;
  sessionId?: string | undefined;
  permissionMode?: string | undefined;
}

export interface RemotePermission {
  id: string;
  tool: string;
  reason: string;
  preview?: string | undefined;
  diff?: string | undefined;
}

export interface RemotePermissionBridge {
  current(): RemotePermission | null;
  subscribe(listener: (permission: RemotePermission | null) => void): () => void;
  resolve(id: string, choice: string): boolean;
}

export interface RemoteHandler {
  onPrompt(prompt: string): Promise<string>;
  onStop?: (() => void) | undefined;
  subscribe?: ((listener: (event: unknown) => void) => () => void) | undefined;
  info?: (() => RemoteInfo) | undefined;
}

export interface RemoteServerOptions {
  handler: RemoteHandler;
  token?: string | undefined;
  staticDir?: string | undefined;
  permissions?: RemotePermissionBridge | undefined;
}

export interface RemoteServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

interface StaticAsset {
  file: string;
  type: string;
}

const ASSETS: Record<string, StaticAsset> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
};

export function defaultWebDir(): string {
  return fileURLToPath(new URL("../web/public/", import.meta.url));
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => resolvePromise(body));
    req.on("error", rejectPromise);
  });
}

function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy": [
      "default-src 'self'",
      "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
      "img-src 'self' data:",
      "style-src 'self'",
      "script-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

function presentedToken(
  req: import("node:http").IncomingMessage,
  url: URL,
): string {
  const authorization = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return authorization.length > 0 ? authorization : (url.searchParams.get("token") ?? "");
}

function originAllowed(req: import("node:http").IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function rejectUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export async function startRemoteControl(options: RemoteServerOptions): Promise<RemoteServer> {
  const token = options.token ?? randomUUID();
  const clients = new Set<WsConnection>();
  let busy = false;
  let unsubscribeEvents: (() => void) | null = null;
  let unsubscribePermissions: (() => void) | null = null;

  const broadcast = (payload: unknown): void => {
    const text = JSON.stringify(payload);
    for (const client of clients) client.send(text);
  };

  const info = (): RemoteInfo => options.handler.info?.() ?? {};
  const currentPermission = (): RemotePermission | null => options.permissions?.current() ?? null;

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const asset = ASSETS[url.pathname];

    if (req.method === "GET" && asset !== undefined && options.staticDir !== undefined) {
      try {
        const body = readFileSync(join(options.staticDir, asset.file));
        res.writeHead(200, { "content-type": asset.type, ...securityHeaders() });
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.end("not found");
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, busy }));
      return;
    }

    if (url.pathname === "/" && req.method === "GET" && options.staticDir === undefined) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<!doctype html><title>keycode remote</title><h1>keycode remote control</h1>");
      return;
    }

    if (presentedToken(req, url) !== token) {
      res.statusCode = 401;
      res.end("unauthorized");
      return;
    }

    if (req.method === "POST" && url.pathname === "/stop") {
      options.handler.onStop?.();
      res.end("stopped");
      return;
    }

    if (req.method === "POST" && url.pathname === "/prompt") {
      if (busy) {
        res.statusCode = 409;
        res.end("busy");
        return;
      }
      let prompt = "";
      try {
        prompt = (JSON.parse(await readBody(req)) as { prompt?: string }).prompt ?? "";
      } catch {
        res.statusCode = 400;
        res.end("invalid json");
        return;
      }
      res.setHeader("content-type", "text/event-stream");
      res.setHeader("cache-control", "no-cache");
      res.write(`data: ${JSON.stringify({ type: "start" })}\n\n`);
      busy = true;
      try {
        const answer = await options.handler.onPrompt(prompt);
        res.write(`data: ${JSON.stringify({ type: "text", text: answer })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      } finally {
        busy = false;
      }
      res.end();
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  if (options.handler.subscribe !== undefined) {
    unsubscribeEvents = options.handler.subscribe((event) => {
      broadcast({ type: "event", event });
    });
  }
  if (options.permissions !== undefined) {
    const bridge = options.permissions;
    unsubscribePermissions = bridge.subscribe((permission) => {
      broadcast({ type: "permission", permission });
    });
  }

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (presentedToken(req, url) !== token || !originAllowed(req)) {
      rejectUpgrade(socket, "401 Unauthorized");
      return;
    }
    const connection = acceptWebSocket(req, socket);
    if (!connection) return;
    clients.add(connection);

    connection.send(
      JSON.stringify({
        type: "hello",
        info: info(),
        permission: currentPermission(),
      }),
    );

    connection.onClose(() => {
      clients.delete(connection);
    });

    connection.onMessage((text) => {
      let message: { type?: string; prompt?: string; id?: string; choice?: string };
      try {
        message = JSON.parse(text) as typeof message;
      } catch {
        connection.send(JSON.stringify({ type: "error", message: "invalid message" }));
        return;
      }

      if (message.type === "stop") {
        options.handler.onStop?.();
        connection.send(JSON.stringify({ type: "stopped" }));
        return;
      }

      if (message.type === "permission" && message.id !== undefined && message.choice !== undefined) {
        const resolved = options.permissions?.resolve(message.id, message.choice) ?? false;
        if (!resolved) {
          connection.send(JSON.stringify({ type: "error", message: "permission request is no longer pending" }));
        }
        return;
      }

      if (message.type === "prompt") {
        if (busy) {
          connection.send(JSON.stringify({ type: "error", message: "A turn is already running" }));
          return;
        }
        const prompt = message.prompt ?? "";
        busy = true;
        connection.send(JSON.stringify({ type: "turn_start" }));
        void (async () => {
          try {
            const answer = await options.handler.onPrompt(prompt);
            connection.send(
              JSON.stringify({
                type: "turn_done",
                ...(options.handler.subscribe === undefined ? { text: answer } : {}),
              }),
            );
          } catch (error) {
            connection.send(
              JSON.stringify({ type: "error", message: (error as Error).message || "turn failed" }),
            );
          } finally {
            busy = false;
          }
        })();
      }
    });
  });

  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    close: () =>
      new Promise<void>((resolvePromise) => {
        unsubscribeEvents?.();
        unsubscribePermissions?.();
        for (const client of clients) client.close();
        clients.clear();
        server.close(() => resolvePromise());
        server.closeAllConnections();
      }),
  };
}
