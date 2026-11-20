import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEditTool, unifiedDiff } from "../../dist/tools/edit.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

describe("T-T5: Edit", () => {
  it("performs unique edits and rejects duplicates", async () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, "e.txt"), "alpha\nbeta\nalpha\n");
    const ctx = makeToolCtx({ cwd: ws });
    const tool = createEditTool();

    const duplicate = await tool.execute(
      { file_path: "e.txt", old_string: "alpha", new_string: "gamma" },
      ctx,
    );
    expect(duplicate.ok).toBe(false);
    expect(textOf(duplicate)).toContain("appears 2 times");

    const replaced = await tool.execute(
      { file_path: "e.txt", old_string: "alpha", new_string: "delta", replace_all: true },
      ctx,
    );
    expect(replaced.ok).toBe(true);
    expect(readFileSync(join(ws, "e.txt"), "utf8")).toBe("delta\nbeta\ndelta\n");

    const unique = await tool.execute(
      { file_path: "e.txt", old_string: "beta", new_string: "zeta" },
      ctx,
    );
    expect(unique.ok).toBe(true);
    expect(readFileSync(join(ws, "e.txt"), "utf8")).toBe("delta\nzeta\ndelta\n");

    const alreadyApplied = await tool.execute(
      { file_path: "e.txt", old_string: "alpha", new_string: "delta" },
      ctx,
    );
    expect(alreadyApplied.ok).toBe(true);
    expect((alreadyApplied.metadata as { alreadyApplied?: boolean } | undefined)?.alreadyApplied).toBe(true);
    expect(readFileSync(join(ws, "e.txt"), "utf8")).toBe("delta\nzeta\ndelta\n");

    const missing = await tool.execute(
      { file_path: "e.txt", old_string: "missing", new_string: "not-there" },
      ctx,
    );
    expect(missing.ok).toBe(false);
  });

  it("returns a unified diff", () => {
    const diff = unifiedDiff("a.txt", "one\ntwo\n", "one\nthree\n");
    expect(diff).toContain("--- a/a.txt");
    expect(diff).toContain("+++ b/a.txt");
    expect(diff).toContain("-two");
    expect(diff).toContain("+three");
  });

  it("preserves CRLF line endings", async () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, "crlf.txt"), "a\r\nb\r\n");
    const ctx = makeToolCtx({ cwd: ws });
    const result = await createEditTool().execute(
      { file_path: "crlf.txt", old_string: "a", new_string: "c" },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(join(ws, "crlf.txt"), "utf8")).toBe("c\r\nb\r\n");
  });
});
