import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { AgentEvent } from "../../dist/app/agent.js";
import { makeHome, makeWorkspace } from "../helpers.js";

const FAKE_ENV = (home: string, script: unknown) => ({
  KEYCODE_HOME: home,
  KEYCODE_PROVIDER: "fake",
  KEYCODE_FAKE_SCRIPT: JSON.stringify(script),
});

describe("T-C4: Streaming turn loop", () => {
  it("executes tool calls in order and repeats until end_turn", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const script = {
      turns: [
        [
          { type: "text", delta: "calling" },
          { type: "tool_call", id: "t1", name: "Bash", input: { command: "echo ran" } },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text", delta: "done" },
          { type: "done", stopReason: "end_turn" },
        ],
      ],
    };
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true, env: FAKE_ENV(home, script) });
    const result = await setup.agent.runTurn("run a command", new AbortController().signal);
    expect(result.stopReason).toBe("end_turn");
    const view = setup.store.load(setup.sessionId);
    expect(view.records.some((record) => record.type === "tool_result")).toBe(true);
    const serialized = JSON.stringify(view.messages);
    expect(serialized).toContain("ran");
    expect(serialized).toContain("done");
  });

  it("aborts the in-flight request and preserves partial text", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const script = {
      turns: [
        [
          { type: "text", delta: "first " },
          { type: "delay", ms: 500 },
          { type: "text", delta: "second" },
          { type: "done", stopReason: "end_turn" },
        ],
      ],
    };
    const controller = new AbortController();
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: FAKE_ENV(home, script),
      onEvent: (event) => {
        if (event.type === "text") controller.abort();
      },
    });
    const result = await setup.agent.runTurn("hi", controller.signal);
    expect(result.interrupted).toBe(true);
    expect(result.stopReason).toBe("aborted");
    const view = setup.store.load(setup.sessionId);
    expect(view.messages.some((message) => message.role === "assistant" && message.interrupted === true)).toBe(true);
    expect(JSON.stringify(view.messages)).not.toContain("second");
  });
});
