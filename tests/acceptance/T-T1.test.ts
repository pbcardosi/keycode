import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBashTool } from "../../dist/tools/bash.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

describe("T-T1: Bash", () => {
  it("runs commands and captures output, exit codes, and stdin/env", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createBashTool();

    const hello = await tool.execute({ command: "node -e \"process.stdout.write('hello')\"" }, ctx);
    expect(hello.ok).toBe(true);
    expect(textOf(hello)).toContain("hello");

    const fail = await tool.execute({ command: "node -e \"process.exit(3)\"" }, ctx);
    expect(fail.ok).toBe(false);
  });

  it("applies timeout, output caps, and spill files", async () => {
    const home = makeWorkspace();
    const ctx = makeToolCtx({ cwd: home });
    const tool = createBashTool();

    const slow = await tool.execute(
      { command: "node -e \"setTimeout(() => {}, 10000)\"", timeout: 100 },
      ctx,
    );
    expect(slow.ok).toBe(false);
    expect((slow.metadata as { code?: string } | undefined)?.code).toBe("TOOL_TIMEOUT");

    const big = await tool.execute(
      { command: "node -e \"process.stdout.write('x'.repeat(40000))\"" },
      ctx,
    );
    expect(big.ok).toBe(true);
    expect(textOf(big)).toContain("full output at");
    const spilled = (big.metadata as { spilled?: string } | undefined)?.spilled;
    expect(typeof spilled).toBe("string");
    expect(existsSync(spilled as string)).toBe(true);
  });

  it("runs commands in the background and reports a task id", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createBashTool();
    const result = await tool.execute(
      { command: "node -e \"setTimeout(() => {}, 50)\"", run_in_background: true },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(textOf(result)).toContain("task_");
    expect(textOf(result)).toContain("Log:");
  });

  it("passes stdin and environment overrides", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createBashTool();
    const stdinResult = await tool.execute(
      {
        command: "node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(d.toUpperCase()))\"",
        stdin: "abc",
      },
      ctx,
    );
    expect(stdinResult.ok).toBe(true);
    expect(textOf(stdinResult)).toContain("ABC");

    const envResult = await tool.execute(
      { command: "node -e \"console.log(process.env.KEYCODE_TEST)\"", env: { KEYCODE_TEST: "42" } },
      ctx,
    );
    expect(envResult.ok).toBe(true);
    expect(textOf(envResult)).toContain("42");
  });
});
