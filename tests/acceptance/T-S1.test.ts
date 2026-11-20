import { describe, expect, it } from "vitest";
import { PermissionService } from "../../dist/permissions/pipeline.js";
import { makeWorkspace } from "../helpers.js";
import type { PermissionMode } from "../../dist/contracts/permissions.js";

type Decision = ReturnType<PermissionService["evaluate"]>["behavior"];

describe("T-S1: permission modes", () => {
  const MODES: PermissionMode[] = ["manual", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];

  function evaluate(mode: PermissionMode, tool: string, input: unknown, cwd: string, readOnly: boolean): Decision {
    const service = new PermissionService({ mode, cwd, roots: [cwd] });
    return service.evaluate({ tool, input, cwd, readOnly }).behavior;
  }

  it("manual prompts writes and commands, allows reads inside the workspace", () => {
    const cwd = makeWorkspace();
    expect(evaluate("manual", "Write", { file_path: "out.txt" }, cwd, false)).toBe("ask");
    expect(evaluate("manual", "Bash", { command: "echo hi" }, cwd, false)).toBe("ask");
    expect(evaluate("manual", "Read", { file_path: "out.txt" }, cwd, true)).toBe("allow");
  });

  it("acceptEdits allows edits and reads, prompts commands", () => {
    const cwd = makeWorkspace();
    expect(evaluate("acceptEdits", "Write", { file_path: "out.txt" }, cwd, false)).toBe("allow");
    expect(evaluate("acceptEdits", "Bash", { command: "echo hi" }, cwd, false)).toBe("ask");
    expect(evaluate("acceptEdits", "Read", { file_path: "out.txt" }, cwd, true)).toBe("allow");
  });

  it("plan blocks mutations and allows reads", () => {
    const cwd = makeWorkspace();
    expect(evaluate("plan", "Write", { file_path: "out.txt" }, cwd, false)).toBe("deny");
    expect(evaluate("plan", "Bash", { command: "echo hi" }, cwd, false)).toBe("deny");
    expect(evaluate("plan", "Read", { file_path: "out.txt" }, cwd, true)).toBe("allow");
  });

  it("auto allows edits, prompts risky commands", () => {
    const cwd = makeWorkspace();
    expect(evaluate("auto", "Write", { file_path: "out.txt" }, cwd, false)).toBe("allow");
    expect(evaluate("auto", "Bash", { command: "echo hi" }, cwd, false)).toBe("ask");
    expect(evaluate("auto", "Read", { file_path: "out.txt" }, cwd, true)).toBe("allow");
  });

  it("dontAsk denies anything that would prompt", () => {
    const cwd = makeWorkspace();
    expect(evaluate("dontAsk", "Write", { file_path: "out.txt" }, cwd, false)).toBe("deny");
    expect(evaluate("dontAsk", "Bash", { command: "echo hi" }, cwd, false)).toBe("deny");
  });

  it("bypassPermissions allows everything except managed denies", () => {
    const cwd = makeWorkspace();
    expect(evaluate("bypassPermissions", "Write", { file_path: "out.txt" }, cwd, false)).toBe("allow");
    expect(evaluate("bypassPermissions", "Bash", { command: "echo hi" }, cwd, false)).toBe("allow");
  });
});
