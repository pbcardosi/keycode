import { describe, expect, it } from "vitest";
import { startRemoteControl } from "../../dist/integrations/remote.js";

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
});
