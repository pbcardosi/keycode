import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace } from "../helpers.js";

describe("T-C8: Branch and side questions", () => {
  it("creates a branched session with a parent link", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    await setup.agent.runTurn("hello", new AbortController().signal);

    const out: string[] = [];
    const result = await executeCommand("/branch sidebranch", {
      setup,
      agent: setup.agent,
      out: (line) => out.push(line),
      signal: new AbortController().signal,
    });
    expect(result.handled).toBe(true);
    const forks = setup.store.list().filter((session) => session.parentId === setup.sessionId);
    expect(forks.length).toBeGreaterThanOrEqual(1);
    const branched = forks.find((session) => session.name === "sidebranch");
    expect(branched).toBeDefined();
    expect(branched?.parentId).toBe(setup.sessionId);
    expect(branched?.id).not.toBe(setup.sessionId);
  });

  it("answers /btw without adding the exchange to the main transcript", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    await setup.agent.runTurn("hello", new AbortController().signal);
    const before = setup.store.load(setup.sessionId).messages.length;

    const out: string[] = [];
    await executeCommand("/btw what is 2+2?", { setup, agent: setup.agent, out: (line) => out.push(line), signal: new AbortController().signal });
    expect(out.join("\n")).toContain("fake response");
    expect(setup.store.load(setup.sessionId).messages.length).toBe(before);
  });
});
