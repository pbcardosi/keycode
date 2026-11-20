import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadMemory } from "../../dist/storage/memory.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

describe("T-M1: CLAUDE.md hierarchy", () => {
  it("assembles user, project, local, and parent memory in order with dedup", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(join(home, "CLAUDE.md"), "mem-user\n");
    writeText(join(ws, "CLAUDE.md"), "mem-project\n");
    writeText(join(ws, "CLAUDE.local.md"), "mem-local\n");

    const result = loadMemory({ cwd: ws, home });
    const text = result.text;
    expect(text).toContain("mem-user");
    expect(text).toContain("mem-project");
    expect(text).toContain("mem-local");
    expect(text.indexOf("mem-user")).toBeLessThan(text.indexOf("mem-project"));
    expect(text.indexOf("mem-project")).toBeLessThan(text.indexOf("mem-local"));
    expect(result.files).toContain(join(home, "CLAUDE.md"));
  });

  it("loads parent directory memory root-first", () => {
    const home = makeHome();
    const root = join(makeWorkspace(), "a", "b", "c");
    writeText(join(root, "..", "..", "CLAUDE.md"), "mem-root\n");
    writeText(join(root, "..", "CLAUDE.md"), "mem-mid\n");
    writeText(join(root, "CLAUDE.md"), "mem-leaf\n");
    const result = loadMemory({ cwd: root, home });
    expect(result.text.indexOf("mem-root")).toBeLessThan(result.text.indexOf("mem-mid"));
    expect(result.text.indexOf("mem-mid")).toBeLessThan(result.text.indexOf("mem-leaf"));
  });

  it("truncates memory that exceeds the size limit", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(join(ws, "CLAUDE.md"), "x".repeat(100));
    const result = loadMemory({ cwd: ws, home, maxFileBytes: 10 });
    expect(result.text.length).toBeLessThanOrEqual(10);
    expect(result.warnings.some((warning) => warning.includes("truncated"))).toBe(true);
  });

  it("returns empty memory when disabled", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(join(ws, "CLAUDE.md"), "secret memory\n");
    const result = loadMemory({ cwd: ws, home, noMemory: true });
    expect(result.text).toBe("");
  });
});
