import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGrepTool } from "../../dist/tools/grep.js";
import { makeWorkspace, textOf, makeToolCtx } from "../helpers.js";

describe("T-T7: Grep", () => {
  function fixture(): string {
    const ws = makeWorkspace();
    writeFileSync(join(ws, "a.ts"), "hello world\nfoo hello\n");
    writeFileSync(join(ws, "b.md"), "hello in md\n");
    writeFileSync(join(ws, "ignored.txt"), "hello ignored\n");
    writeFileSync(join(ws, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(ws, "binary.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    return ws;
  }

  it("returns matching lines in content mode, honoring ignore rules", async () => {
    const ws = fixture();
    const result = await createGrepTool().execute({ pattern: "hello" }, makeToolCtx({ cwd: ws }));
    expect(result.ok).toBe(true);
    const text = textOf(result);
    expect(text).toContain("a.ts:1:hello world");
    expect(text).toContain("a.ts:2:foo hello");
    expect(text).toContain("b.md:1:hello in md");
    expect(text).not.toContain("ignored.txt");
  });

  it("lists files with matches and counts", async () => {
    const ws = fixture();
    const files = await createGrepTool().execute(
      { pattern: "hello", output_mode: "files_with_matches" },
      makeToolCtx({ cwd: ws }),
    );
    expect(textOf(files)).toContain("a.ts");
    expect(textOf(files)).toContain("b.md");
    expect(textOf(files)).not.toContain("ignored.txt");

    const count = await createGrepTool().execute(
      { pattern: "hello", output_mode: "count" },
      makeToolCtx({ cwd: ws }),
    );
    expect(textOf(count)).toContain("a.ts:2");
  });

  it("supports literal mode, glob filters, context, and head_limit", async () => {
    const ws = fixture();
    const literal = await createGrepTool().execute(
      { pattern: "foo hello", literal: true },
      makeToolCtx({ cwd: ws }),
    );
    expect(textOf(literal)).toContain("a.ts:2:foo hello");

    const globbed = await createGrepTool().execute({ pattern: "hello", glob: "*.md" }, makeToolCtx({ cwd: ws }));
    expect(textOf(globbed)).toContain("b.md:1:hello in md");
    expect(textOf(globbed)).not.toContain("a.ts");

    const context = await createGrepTool().execute({ pattern: "hello", context: 1 }, makeToolCtx({ cwd: ws }));
    expect(textOf(context)).toContain("a.ts:2:foo hello");

    const limited = await createGrepTool().execute({ pattern: "hello", head_limit: 1 }, makeToolCtx({ cwd: ws }));
    expect((limited.metadata as { matches?: number } | undefined)?.matches).toBe(1);
    expect((limited.metadata as { truncated?: boolean } | undefined)?.truncated).toBe(true);
  });

  it("skips binary files", async () => {
    const ws = fixture();
    const result = await createGrepTool().execute({ pattern: "hello" }, makeToolCtx({ cwd: ws }));
    expect(result.ok).toBe(true);
    expect(textOf(result)).not.toContain("binary.bin");
  });
});
