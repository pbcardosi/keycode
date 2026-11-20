import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { acceptWebSocket } from "./ws.js";

export interface RemoteHandler {
  onPrompt(prompt: string): Promise<string>;
  onStop?: (() => void) | undefined;
}

export interface RemoteServerOptions {
  handler: RemoteHandler;
  token?: string | undefined;
}

export interface RemoteServer {
  url: string;
  token: string;
  close(): Promise<void>;
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

export async function startRemoteControl(options: RemoteServerOptions): Promise<RemoteServer> {
  const token = options.token ?? randomUUID();
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/" && req.method === "GET") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<!doctype html><title>keycode remote</title><h1>keycode remote control</h1>");
      return;
    }
    const authorization = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const presented = authorization.length > 0 ? authorization : (url.searchParams.get("token") ?? "");
    if (presented !== token) {
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
      const answer = await options.handler.onPrompt(prompt);
      res.write(`data: ${JSON.stringify({ type: "text", text: answer })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  server.on("upgrade", (req, socket) => {
    const connection = acceptWebSocket(req, socket);
    if (!connection) return;
    connection.onMessage((text) => {
      void (async () => {
        try {
          const message = JSON.parse(text) as { type?: string; prompt?: string };
          if (message.type === "stop") {
            options.handler.onStop?.();
            connection.send(JSON.stringify({ type: "stopped" }));
            return;
          }
          if (message.type === "prompt") {
            const answer = await options.handler.onPrompt(message.prompt ?? "");
            connection.send(JSON.stringify({ type: "text", text: answer }));
            connection.send(JSON.stringify({ type: "done" }));
          }
        } catch {
          connection.send(JSON.stringify({ type: "error", message: "invalid message" }));
        }
      })();
    });
  });

  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    close: () =>
      new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      }),
  };
}
