import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveImports } from "../../dist/storage/memory.js";
import { makeWorkspace, writeText } from "../helpers.js";

describe("T-M2: CLAUDE.md imports", () => {
  it("resolves imports recursively and detects cycles", () => {
    const ws = makeWorkspace();
    writeText(join(ws, "a.md"), "@b.md\nfirst\n");
    writeText(join(ws, "b.md"), "@a.md\nsecond\n");
    const warnings: string[] = [];
    const files: string[] = [];
    const out = resolveImports(readFileSync(join(ws, "a.md"), "utf8"), ws, {
      maxFileBytes: 1000,
      stack: [join(ws, "a.md")],
      files,
      warnings,
    });
    expect(out).toContain("first");
    expect(out).toContain("second");
    expect(warnings.some((warning) => warning.includes("Import cycle detected"))).toBe(true);
  });

  it("ignores imports inside code fences", () => {
    const ws = makeWorkspace();
    writeText(join(ws, "a.md"), "```\n@c.md\n```\nreal\n");
    const warnings: string[] = [];
    const out = resolveImports(readFileSync(join(ws, "a.md"), "utf8"), ws, {
      maxFileBytes: 1000,
      stack: [join(ws, "a.md")],
      warnings,
    });
    expect(out).toContain("real");
    expect(warnings).toEqual([]);
  });

  it("warns about missing import files", () => {
    const ws = makeWorkspace();
    writeText(join(ws, "a.md"), "@missing.md\nreal\n");
    const warnings: string[] = [];
    const out = resolveImports(readFileSync(join(ws, "a.md"), "utf8"), ws, {
      maxFileBytes: 1000,
      stack: [join(ws, "a.md")],
      warnings,
    });
    expect(out).toContain("real");
    expect(warnings.some((warning) => warning.includes("Import not found: missing.md"))).toBe(true);
  });
});
