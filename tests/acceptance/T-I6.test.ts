import { describe, expect, it } from "vitest";
import { createMemoryRunner, teleportSession } from "../../dist/integrations/runner.js";
import { SessionStore } from "../../dist/storage/session.js";
import { messageText } from "../../dist/contracts/message.js";
import { makeHome, makeWorkspace } from "../helpers.js";

describe("T-I6: cloud and self-hosted sessions", () => {
  it("uploads, downloads, and teleports a remote session", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const store = new SessionStore(home, ws);
    const local = store.create({ provider: "fake", model: "fake-model" });
    const runner = createMemoryRunner();
    const remoteId = await runner.upload(local.id, {
      id: "",
      provider: "fake",
      model: "fake-model",
      cwd: ws,
      name: "remote",
      messages: [
        {
          id: "m1",
          role: "user",
          content: [{ type: "text", text: "remote hello" }],
          timestamp: new Date().toISOString(),
        },
      ],
    });
    const remote = await runner.download(remoteId);
    const teleported = teleportSession({ store, remote });
    const view = store.load(teleported.sessionId);
    expect(view.header.name).toBe("remote");
    expect(view.messages).toHaveLength(1);
    expect(messageText(view.messages[0] as NonNullable<(typeof view.messages)[number]>)).toContain("remote hello");
  });
});
