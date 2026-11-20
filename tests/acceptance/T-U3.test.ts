import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { Notifier, oscNotification } from "../../dist/notifications/index.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeWorkspace, writeJson } from "../helpers.js";

describe("T-U3: notifications", () => {
  it("deduplicates events, respects the idle threshold, and emits OSC", async () => {
    let now = 0;
    const sent: string[] = [];
    const notifier = new Notifier({
      dedupeMs: 1_000,
      idleThresholdMs: 100,
      now: () => now,
      channels: [{ name: "test", send: (event, text) => sent.push(`${event}:${text}`) }],
    });

    expect(await notifier.notify("permission_required", "approve Bash")).toBe(true);
    expect(await notifier.notify("permission_required", "approve Bash")).toBe(false);
    now = 1_500;
    expect(await notifier.notify("permission_required", "approve Bash")).toBe(true);

    now = 1_600;
    notifier.activity();
    expect(await notifier.checkIdle()).toBe(false);
    now = 1_701;
    expect(await notifier.checkIdle()).toBe(true);
    expect(sent.length).toBe(3);
    expect(oscNotification("hi")).toContain("\x1b]9;hi\x07");
  });

  it("sends a task-complete webhook from a real agent turn", async () => {
    const received: Array<{ event: string; text: string }> = [];
    const server: Server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        received.push(JSON.parse(raw) as { event: string; text: string });
        res.end("ok");
      });
    });
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/notify`;
    try {
      const home = makeHome();
      const ws = makeWorkspace();
      writeJson(join(home, "settings.json"), {
        notifications: { webhook: endpoint },
      });
      const setup = await createAgentSetup({
        cwd: ws,
        home,
        provider: "fake",
        trust: true,
        env: {
          ...process.env,
          KEYCODE_HOME: home,
          KEYCODE_PROVIDER: "fake",
          KEYCODE_FAKE_SCRIPT: JSON.stringify([
            { type: "text", delta: "all done" },
            { type: "done", stopReason: "end_turn" },
          ]),
        },
      });
      await setup.agent.runTurn("finish", new AbortController().signal);

      const deadline = Date.now() + 5_000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 50));
      }
      expect(received[0]?.event).toBe("task_complete");
      expect(received[0]?.text).toContain("all done");
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });
});
