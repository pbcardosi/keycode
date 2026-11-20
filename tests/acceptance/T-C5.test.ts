import { describe, expect, it } from "vitest";
import type { Message } from "../../dist/contracts/message.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace } from "../helpers.js";

describe("T-C5: Compaction", () => {
  it("summarizes older turns, keeps recent turns, and writes a summary record", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const store = setup.store;
    const id = setup.sessionId;
    for (let index = 0; index < 100; index += 1) {
      const message: Message = {
        id: `seed-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: `message number ${index}` }],
        timestamp: new Date().toISOString(),
      };
      store.appendMessage(id, message);
    }

    const tokensBefore = setup.agent.contextEstimate().tokens;
    const out: string[] = [];
    const result = await executeCommand("/compact", { setup, agent: setup.agent, out: (line) => out.push(line), signal: new AbortController().signal });
    expect(result.handled).toBe(true);
    const view = store.load(id);
    expect(view.summaries.length).toBeGreaterThan(0);
    expect(out.join("\n")).toContain("Compacted");
    expect(view.records.filter((record) => record.type === "message")).toHaveLength(100);
    const tokensAfter = setup.agent.contextEstimate().tokens;
    expect(tokensAfter).toBeLessThan(tokensBefore);
  });

  it("triggers auto-compaction at the configured threshold", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true, autoCompactThreshold: 5 });
    const store = setup.store;
    const id = setup.sessionId;
    for (let index = 0; index < 100; index += 1) {
      const message: Message = {
        id: `seed-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: `message number ${index}` }],
        timestamp: new Date().toISOString(),
      };
      store.appendMessage(id, message);
    }
    await setup.agent.runTurn("summarize me please", new AbortController().signal);
    const view = store.load(id);
    expect(view.summaries.length).toBeGreaterThan(0);
  });
});
