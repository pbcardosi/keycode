import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWriteTool } from "../../dist/tools/write.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

describe("T-T4: Write", () => {
  it("creates and overwrites files, requires a prior Read, and creates parents", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createWriteTool();

    const created = await tool.execute({ file_path: "w1.txt", content: "hello\n" }, ctx);
    expect(created.ok).toBe(true);
    expect(existsSync(join(ctx.cwd, "w1.txt"))).toBe(true);
    expect(readFileSync(join(ctx.cwd, "w1.txt"), "utf8")).toBe("hello\n");

    const overwritten = await tool.execute({ file_path: "w1.txt", content: "again\n" }, ctx);
    expect(overwritten.ok).toBe(true);
    expect(readFileSync(join(ctx.cwd, "w1.txt"), "utf8")).toBe("again\n");

    const fresh = makeWorkspace();
    writeFileSync(join(fresh, "w2.txt"), "original\n");
    const freshCtx = makeToolCtx({ cwd: fresh });
    const noRead = await createWriteTool().execute({ file_path: "w2.txt", content: "x" }, freshCtx);
    expect(noRead.ok).toBe(false);
    expect(textOf(noRead)).toContain("has not been read yet");
    expect(readFileSync(join(fresh, "w2.txt"), "utf8")).toBe("original\n");

    const deep = await tool.execute({ file_path: "sub/deep/f.txt", content: "deep\n" }, ctx);
    expect(deep.ok).toBe(true);
    expect(readFileSync(join(ctx.cwd, "sub", "deep", "f.txt"), "utf8")).toBe("deep\n");
  });

  it("does not leave partial files when a write fails", async () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, "existing.txt"), "original\n");
    const ctx = makeToolCtx({ cwd: ws });
    const result = await createWriteTool().execute({ file_path: "existing.txt", content: "new" }, ctx);
    expect(result.ok).toBe(false);
    expect(readFileSync(join(ws, "existing.txt"), "utf8")).toBe("original\n");
  });
});
