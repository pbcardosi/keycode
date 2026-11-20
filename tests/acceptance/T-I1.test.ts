import { describe, expect, it } from "vitest";
import { createAgent } from "../../dist/sdk/index.js";
import { parseStructuredOutput } from "../../dist/sdk/structured.js";
import { makeHome, makeWorkspace } from "../helpers.js";

function env(home: string, script: unknown): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KEYCODE_HOME: home,
    KEYCODE_PROVIDER: "fake",
    KEYCODE_FAKE_SCRIPT: JSON.stringify(script),
  };
}

const schema = {
  type: "object",
  required: ["name", "count"],
  properties: { name: { type: "string" }, count: { type: "number" } },
};

describe("T-I1: SDK and structured output", () => {
  it("runs through the SDK, streams events, and validates structured output", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const agent = await createAgent({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: env(home, [
        { type: "text", delta: '{"name":"ok","count":2}' },
        { type: "done", stopReason: "end_turn" },
      ]),
    });
    const result = await agent.run("give json");
    expect(result.text).toContain('"name":"ok"');
    expect(parseStructuredOutput(result.text, schema)).toEqual({ name: "ok", count: 2 });

    const streamAgent = await createAgent({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: env(home, [
        { type: "text", delta: "streamed" },
        { type: "done", stopReason: "end_turn" },
      ]),
    });
    const events: string[] = [];
    for await (const event of streamAgent.stream("hi")) events.push(event.type);
    expect(events).toContain("text");
    expect(events).toContain("done");
  });

  it("returns a validation error for a mismatched object", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const agent = await createAgent({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: env(home, [
        { type: "text", delta: '{"name":3,"count":"two"}' },
        { type: "done", stopReason: "end_turn" },
      ]),
    });
    await expect(agent.runStructured("bad json", schema)).rejects.toMatchObject({
      code: "TOOL_INPUT_INVALID",
    });
  });
});
