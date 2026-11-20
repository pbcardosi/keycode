import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

const AGENT = [
  "---",
  "name: restricted",
  "description: Read-only agent",
  "tools: Read",
  "permission-mode: manual",
  "---",
  "You may only read files.",
].join("\n");

describe("T-T14: Subagents", () => {
  it("returns a child report, writes a child session, and enforces restricted tools", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(join(ws, ".keycode", "agents", "restricted.md"), AGENT);

    const script = {
      turns: [
        [
          { type: "tool_call", id: "a1", name: "Agent", input: { prompt: "child task", subagent_type: "restricted" } },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "tool_call", id: "b1", name: "Bash", input: { command: 'node -e "require(\'fs\').writeFileSync(\'child-ran.txt\',\'yes\')"' } },
          { type: "done", stopReason: "tool_use" },
        ],
        [{ type: "text", delta: "child report" }, { type: "done", stopReason: "end_turn" }],
        [{ type: "text", delta: "parent done" }, { type: "done", stopReason: "end_turn" }],
      ],
    };
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      permissionMode: "bypassPermissions",
      env: {
        ...process.env,
        KEYCODE_HOME: home,
        KEYCODE_PROVIDER: "fake",
        KEYCODE_FAKE_SCRIPT: JSON.stringify(script),
      },
    });
    const result = await setup.agent.runTurn("delegate this", new AbortController().signal);
    expect(result.stopReason).toBe("end_turn");

    const parentView = setup.store.load(setup.sessionId);
    const parentSerialized = JSON.stringify(parentView.messages);
    expect(parentSerialized).toContain("child report");
    expect(parentSerialized).toContain("parent done");

    const child = setup.store.list().find((session) => session.parentId === setup.sessionId);
    expect(child).toBeDefined();
    const childView = setup.store.load(child?.id ?? "");
    expect(JSON.stringify(childView.messages)).toContain("Bash");
    expect(existsSync(join(ws, "child-ran.txt"))).toBe(false);
  });
});
