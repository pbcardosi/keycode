import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { createReadTool } from "../../dist/tools/read.js";
import { makeHome, makeToolCtx, makeWorkspace, writeText } from "../helpers.js";

describe("T-M5: add-dir and cd", () => {
  it("extends workspace roots via /add-dir and /cd and allows reads outside the original cwd", async () => {
    const home = makeHome();
    const ws = makeWorkspace("ws");
    const other = makeWorkspace("other");
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const file = join(other, "x.txt");
    writeText(file, "hi\n");

    expect(setup.agent.cwd).toBe(ws);
    setup.agent.setWorkspace(other, [...setup.agent.workspaceRoots, other]);
    expect(setup.agent.cwd).toBe(other);
    const ctx = makeToolCtx({ cwd: other, workspaceRoots: setup.agent.workspaceRoots });
    const read = await createReadTool().execute({ file_path: "x.txt" }, ctx);
    expect(read.ok).toBe(true);

    const out: string[] = [];
    const signal = new AbortController().signal;
    const addDirResult = await executeCommand("/add-dir ../other2", {
      setup,
      agent: setup.agent,
      out: (line) => out.push(line),
      signal,
    });
    expect(addDirResult.handled).toBe(true);
    expect(setup.agent.workspaceRoots.some((root) => root === resolve(other, "../other2"))).toBe(true);

    const cdResult = await executeCommand("/cd ../other3", {
      setup,
      agent: setup.agent,
      out: (line) => out.push(line),
      signal,
    });
    expect(cdResult.handled).toBe(true);
    expect(setup.agent.cwd).toBe(resolve(other, "../other3"));
    expect(setup.agent.workspaceRoots).toContain(resolve(other, "../other3"));
  });
});
