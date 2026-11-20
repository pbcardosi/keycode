import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { createGlobTool } from "../../dist/tools/glob.js";
import { createGrepTool } from "../../dist/tools/grep.js";
import { makeToolCtx, makeWorkspace, textOf, writeText } from "../helpers.js";

describe("T-M6: ignore-aware discovery", () => {
  it("excludes ignored files from Glob and Grep; hidden files are included", async () => {
    const ws = makeWorkspace();
    writeText(join(ws, ".gitignore"), "a.txt\n");
    writeText(join(ws, "a.txt"), "hello\n");
    writeText(join(ws, "b.txt"), "hello\n");
    writeText(join(ws, ".hidden.txt"), "hello\n");

    const glob = await createGlobTool().execute({ pattern: "*.txt" }, makeToolCtx({ cwd: ws }));
    const matches = textOf(glob).split("\n").filter((line) => line.length > 0 && line !== "No files found.");
    expect(matches).not.toContain("a.txt");
    expect(matches).toContain("b.txt");
    expect(matches).toContain(".hidden.txt");

    const globAll = await createGlobTool().execute({ pattern: "*.txt", no_ignore: true }, makeToolCtx({ cwd: ws }));
    expect(textOf(globAll)).toContain("a.txt");

    const grep = await createGrepTool().execute({ pattern: "hello" }, makeToolCtx({ cwd: ws }));
    expect(textOf(grep)).not.toContain("a.txt");
    expect(textOf(grep)).toContain("b.txt");

    const grepAll = await createGrepTool().execute(
      { pattern: "hello", no_ignore: true },
      makeToolCtx({ cwd: ws }),
    );
    expect(textOf(grepAll)).toContain("a.txt");
  });

  it("uses .ignore over .gitignore when both exist", async () => {
    const ws = makeWorkspace();
    writeText(join(ws, ".gitignore"), "a.txt\n");
    writeText(join(ws, ".ignore"), "b.txt\n");
    writeText(join(ws, "a.txt"), "a\n");
    writeText(join(ws, "b.txt"), "b\n");
    const glob = await createGlobTool().execute({ pattern: "*.txt" }, makeToolCtx({ cwd: ws }));
    const matches = textOf(glob).split("\n").filter((line) => line.length > 0);
    expect(matches).toContain("a.txt");
    expect(matches).not.toContain("b.txt");
  });

  it("skips files larger than 4 MB in Grep", async () => {
    const ws = makeWorkspace();
    writeText(join(ws, "big.txt"), "hello" + "x".repeat(4 * 1024 * 1024));
    writeText(join(ws, "small.txt"), "hello\n");
    const grep = await createGrepTool().execute({ pattern: "hello" }, makeToolCtx({ cwd: ws }));
    expect(textOf(grep)).toContain("small.txt");
    expect(textOf(grep)).not.toContain("big.txt");
  });
});
