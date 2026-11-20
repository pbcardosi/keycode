import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createCodeModeTool } from "../../dist/tools/codemode.js";
import { toolOk, type Tool } from "../../dist/contracts/tool.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

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
});
