import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace } from "../helpers.js";

const FAKE_ENV = (home: string, script: unknown) => ({
  KEYCODE_HOME: home,
  KEYCODE_PROVIDER: "fake",
  KEYCODE_FAKE_SCRIPT: JSON.stringify(script),
});

function usageScript(): unknown {
  return [
    { type: "usage", inputTokens: 10, outputTokens: 5 },
    { type: "text", delta: "hi" },
    { type: "done", stopReason: "end_turn" },
  ];
}

describe("T-C6: Usage and context views", () => {
  it("reports per-turn tokens, cost, session stats, and context grid", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true, env: FAKE_ENV(home, usageScript()) });
    await setup.agent.runTurn("hello", new AbortController().signal);

    const usageOut: string[] = [];
    await executeCommand("/usage", { setup, agent: setup.agent, out: (line) => usageOut.push(line), signal: new AbortController().signal });
    expect(usageOut.join("\n")).toContain("10 in / 5 out");

    const costOut: string[] = [];
    await executeCommand("/cost", { setup, agent: setup.agent, out: (line) => costOut.push(line), signal: new AbortController().signal });
    expect(costOut.join("\n")).toContain("cost:");

    const statsOut: string[] = [];
    await executeCommand("/stats", { setup, agent: setup.agent, out: (line) => statsOut.push(line), signal: new AbortController().signal });
    expect(statsOut.join("\n")).toContain(`session: ${setup.sessionId}`);

    const contextOut: string[] = [];
    await executeCommand("/context", { setup, agent: setup.agent, out: (line) => contextOut.push(line), signal: new AbortController().signal });
    expect(contextOut.join("\n")).toContain("Context:");
  });
});
