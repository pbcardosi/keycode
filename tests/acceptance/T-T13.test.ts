import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

const SKILL = [
  "---",
  "name: hello",
  "description: Hello skill",
  "allowed-tools: Read",
  "---",
  "Use only Read. Args: $ARGUMENTS",
].join("\n");

describe("T-T13: Skill tool", () => {
  it("injects the body on invocation and denies a disallowed tool", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(join(ws, ".keycode", "skills", "hello", "SKILL.md"), SKILL);

    const script = {
      turns: [
        [
          { type: "tool_call", id: "s1", name: "Skill", input: { skill: "hello", args: "world" } },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "tool_call", id: "b1", name: "Bash", input: { command: "echo nope" } },
          { type: "done", stopReason: "tool_use" },
        ],
        [{ type: "text", delta: "done" }, { type: "done", stopReason: "end_turn" }],
      ],
    };
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: {
        ...process.env,
        KEYCODE_HOME: home,
        KEYCODE_PROVIDER: "fake",
        KEYCODE_FAKE_SCRIPT: JSON.stringify(script),
      },
    });
    const result = await setup.agent.runTurn("use the skill", new AbortController().signal);
    expect(result.stopReason).toBe("end_turn");
    const serialized = JSON.stringify(setup.store.load(setup.sessionId).messages);
    expect(serialized).toContain("Use only Read");
    expect(serialized).toContain("world");
    expect(serialized).toContain("not allowed by the active skill");
  });
});
