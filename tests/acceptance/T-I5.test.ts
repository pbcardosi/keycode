import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  startRemoteControl,
  type RemotePermission,
} from "../../dist/integrations/remote.js";
import { connectWebSocket } from "../helpers.js";

describe("T-I5: Remote Control", () => {
  it("binds loopback, streams a reply with the pairing token, and rejects a wrong token", async () => {
    let stopped = false;
    const server = await startRemoteControl({
      token: "pair-token",
      handler: {
        onPrompt: async (prompt) => `reply: ${prompt}`,
        onStop: () => {
          stopped = true;
        },
      },
    });
    expect(server.url.startsWith("http://127.0.0.1")).toBe(true);

    const response = await fetch(`${server.url}/prompt?token=pair-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"reply: hi"');
    expect(text).toContain('"type":"done"');

    const wrong = await fetch(`${server.url}/prompt?token=wrong`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(wrong.status).toBe(401);

    const stop = await fetch(`${server.url}/stop?token=pair-token`, { method: "POST" });
    expect(stop.status).toBe(200);
    expect(stopped).toBe(true);

    await server.close();
  });

  it("serves the web UI and streams agent events and approvals over WebSocket", async () => {
    let emit: (event: unknown) => void = () => undefined;
    let notifyPermission: (permission: RemotePermission | null) => void = () => undefined;
    let pending: RemotePermission | null = {
      id: "perm-1",
      tool: "Bash",
      reason: "Manual mode requires approval",
      preview: "$ echo hi",
    };
    const resolved: Array<[string, string]> = [];

    const server = await startRemoteControl({
      token: "pair-token",
      staticDir: resolve(process.cwd(), "dist/web/public"),
      handler: {
        info: () => ({
          provider: "fake",
          model: "fake-model",
          sessionId: "12345678-0000-0000-0000-000000000000",
          permissionMode: "manual",
        }),
        subscribe: (listener) => {
          emit = listener;
          return () => {
            emit = () => undefined;
          };
        },
        onPrompt: async (prompt) => {
          emit({ type: "text", delta: `reply ${prompt}` });
          emit({ type: "done", stopReason: "end_turn" });
          return `reply ${prompt}`;
        },
      },
      permissions: {
        current: () => pending,
        subscribe: (listener) => {
          notifyPermission = listener;
          return () => {
            notifyPermission = () => undefined;
          };
        },
        resolve: (id, choice) => {
          resolved.push([id, choice]);
          pending = null;
          notifyPermission(null);
          return true;
        },
      },
    });

    const page = await fetch(`${server.url}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await page.text()).toContain("keycode");
    const script = await fetch(`${server.url}/app.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("WebSocket");
    expect((await fetch(`${server.url}/health`)).status).toBe(200);

    const port = Number(new URL(server.url).port);
    const client = await connectWebSocket(port, "/?token=pair-token");

    const hello = JSON.parse(await client.nextMessage()) as {
      type: string;
      info: { provider: string };
      permission: { id: string } | null;
    };
    expect(hello.type).toBe("hello");
    expect(hello.info.provider).toBe("fake");
    expect(hello.permission?.id).toBe("perm-1");

    client.send(JSON.stringify({ type: "permission", id: "perm-1", choice: "allow_once" }));
    const cleared = JSON.parse(await client.nextMessage()) as { type: string; permission: unknown };
    expect(cleared).toEqual({ type: "permission", permission: null });
    expect(resolved).toEqual([["perm-1", "allow_once"]]);

    client.send(JSON.stringify({ type: "prompt", prompt: "hi" }));
    const start = JSON.parse(await client.nextMessage()) as { type: string };
    expect(start.type).toBe("turn_start");
    const textEvent = JSON.parse(await client.nextMessage()) as {
      type: string;
      event: { type: string; delta: string };
    };
    expect(textEvent.type).toBe("event");
    expect(textEvent.event).toMatchObject({ type: "text", delta: "reply hi" });
    const done = JSON.parse(await client.nextMessage()) as { type: string; event: { type: string } };
    expect(done.event.type).toBe("done");
    const turnDone = JSON.parse(await client.nextMessage()) as { type: string };
    expect(turnDone.type).toBe("turn_done");

    await expect(connectWebSocket(port, "/?token=wrong")).rejects.toThrow();
    client.close();
    await server.close();
  });
});
