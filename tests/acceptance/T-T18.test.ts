import { z } from "zod";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodeModeTool } from "../../dist/tools/codemode.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { toolOk, type Tool } from "../../dist/contracts/tool.js";
import { makeHome, makeToolCtx, makeWorkspace, textOf, writeJson } from "../helpers.js";

const echo: Tool<{ text: string }> = {
  name: "echo",
  description: "Echo text",
  input: z.object({ text: z.string() }),
  readOnly: true,
  concurrency: "parallel",
  async execute(input) {
    return toolOk(`echo:${input.text}`);
  },
};

describe("T-T18: Code Mode", () => {
  it("evaluates expressions, calls tools, persists state, and resets", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createCodeModeTool({ enabled: true, tools: [echo] });

    const first = await tool.execute({ code: 'state.value = 41; console.log("set"); state.value + 1' }, ctx);
    expect(first.ok).toBe(true);
    expect(textOf(first)).toContain("set");
    expect(textOf(first)).toContain("=> 42");

    const bridged = await tool.execute({ code: 'await tools.call("echo", { text: "hi" })' }, ctx);
    expect(textOf(bridged)).toContain("echo:hi");

    const persisted = await tool.execute({ code: "state.value" }, ctx);
    expect(textOf(persisted)).toContain("=> 41");

    const reset = await tool.execute({ code: "state.value", reset: true }, ctx);
    expect(textOf(reset)).not.toContain("41");

    const disabled = createCodeModeTool({ enabled: false });
    const denied = await disabled.execute({ code: "1 + 1" }, ctx);
    expect(denied.ok).toBe(false);
    expect((denied.metadata as { code?: string } | undefined)?.code).toBe("TOOL_UNSUPPORTED");
  });

  it("enables Code Mode for the agent from settings", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeJson(join(home, "settings.json"), { codeMode: true });
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
        KEYCODE_FAKE_SCRIPT: JSON.stringify({
          turns: [
            [
              { type: "tool_call", id: "c1", name: "CodeMode", input: { code: "1 + 1" } },
              { type: "done", stopReason: "tool_use" },
            ],
            [{ type: "text", delta: "computed" }, { type: "done", stopReason: "end_turn" }],
          ],
        }),
      },
    });
    try {
      const result = await setup.agent.runTurn("compute", new AbortController().signal);
      expect(result.stopReason).toBe("end_turn");
      expect(JSON.stringify(setup.store.load(setup.sessionId).messages)).toContain("=> 2");
    } finally {
      await Promise.all(setup.mcpClients.map((client) => client.close()));
    }
  });
});
