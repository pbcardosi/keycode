import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNotebookEditTool } from "../../dist/tools/notebook.js";
import { makeToolCtx, makeWorkspace } from "../helpers.js";

function fixture(path: string): void {
  writeFileSync(
    path,
    JSON.stringify({
      cells: [
        { cell_type: "code", source: ["print(1)"], outputs: [{ text: "1" }], metadata: {} },
        { cell_type: "markdown", source: ["# Title"], metadata: {} },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }),
  );
}

describe("T-T11: NotebookEdit", () => {
  it("replaces, inserts, and deletes cells while preserving outputs and valid JSON", async () => {
    const ws = makeWorkspace();
    const path = join(ws, "nb.ipynb");
    fixture(path);
    const ctx = makeToolCtx({ cwd: ws });
    const tool = createNotebookEditTool();

    const replaced = await tool.execute({ notebook_path: "nb.ipynb", cell_id: "0", new_source: "print(2)", edit_mode: "replace" }, ctx);
    expect(replaced.ok).toBe(true);
    let notebook = JSON.parse(readFileSync(path, "utf8")) as { cells: Array<{ source: unknown; cell_type: string; outputs?: unknown[] }> };
    expect(notebook.cells[0]?.source).toBe("print(2)");
    expect(notebook.cells[0]?.outputs).toEqual([{ text: "1" }]);

    const inserted = await tool.execute({ notebook_path: "nb.ipynb", cell_id: "0", new_source: "## More", cell_type: "markdown", edit_mode: "insert" }, ctx);
    expect(inserted.ok).toBe(true);
    notebook = JSON.parse(readFileSync(path, "utf8")) as typeof notebook;
    expect(notebook.cells).toHaveLength(3);
    expect(notebook.cells[1]?.cell_type).toBe("markdown");

    const deleted = await tool.execute({ notebook_path: "nb.ipynb", cell_id: "1", edit_mode: "delete" }, ctx);
    expect(deleted.ok).toBe(true);
    notebook = JSON.parse(readFileSync(path, "utf8")) as typeof notebook;
    expect(notebook.cells).toHaveLength(2);
  });
});
