import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGlobTool } from "../../dist/tools/glob.js";
import { makeWorkspace, textOf, makeToolCtx } from "../helpers.js";

function fixture(): string {
  const ws = makeWorkspace();
  writeFileSync(join(ws, "a.ts"), "a\n");
  writeFileSync(join(ws, "b.ts"), "b\n");
  const older = new Date(Date.now() - 60_000);
  const newer = new Date();
  utimesSync(join(ws, "a.ts"), older, older);
  utimesSync(join(ws, "b.ts"), newer, newer);
  writeFileSync(join(ws, "keep.txt"), "keep\n");
  writeFileSync(join(ws, ".gitignore"), "build\n");
  mkdirSync(join(ws, "build"), { recursive: true });
  writeFileSync(join(ws, "build", "gen.ts"), "gen\n");
  mkdirSync(join(ws, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(ws, "node_modules", "pkg", "x.js"), "x\n");
  try {
    symlinkSync(ws, join(ws, "loop"), "dir");
  } catch {
    // Symlinks to directories may require privileges on Windows.
  }
  return ws;
}

describe("T-T6: Glob", () => {
  it("matches files and excludes node_modules and ignored directories by default", async () => {
    const ws = fixture();
    const result = await createGlobTool().execute({ pattern: "*.ts" }, makeToolCtx({ cwd: ws }));
    expect(result.ok).toBe(true);
    const matches = textOf(result).split("\n").filter((line) => line.length > 0);
    expect(matches).toContain("a.ts");
    expect(matches).toContain("b.ts");
    expect(matches).not.toContain("build/gen.ts");

    const js = await createGlobTool().execute({ pattern: "*.js" }, makeToolCtx({ cwd: ws }));
    expect(textOf(js)).not.toContain("node_modules/pkg/x.js");
  });

  it("sorts by modification time, newest first", async () => {
    const ws = fixture();
    const result = await createGlobTool().execute({ pattern: "*.ts" }, makeToolCtx({ cwd: ws }));
    const matches = textOf(result).split("\n").filter((line) => line.length > 0);
    expect(matches[0]).toBe("b.ts");
  });

  it("respects the limit and marks truncation", async () => {
    const ws = fixture();
    const result = await createGlobTool().execute({ pattern: "*.ts", limit: 1 }, makeToolCtx({ cwd: ws }));
    expect(result.ok).toBe(true);
    expect(textOf(result).split("\n").length).toBe(1);
    expect((result.metadata as { truncated?: boolean } | undefined)?.truncated).toBe(true);
  });

  it("does not follow symlink loops and bounds results", async () => {
    const ws = fixture();
    const result = await createGlobTool().execute({ pattern: "**/*.txt", limit: 50 }, makeToolCtx({ cwd: ws }));
    expect(result.ok).toBe(true);
    const matches = textOf(result).split("\n").filter((line) => line.length > 0 && line !== "No files found.");
    expect(matches.length).toBeLessThanOrEqual(50);
    for (const match of matches) {
      expect(match.startsWith("loop/")).toBe(false);
    }
  });
});
