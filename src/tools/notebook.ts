import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";
import { atomicWrite } from "../util/fsx.js";
import { guardPath, resolveUserPath } from "./shared.js";

export const NotebookEditInput = z.object({
  notebook_path: z.string().min(1),
  cell_id: z.string().optional(),
  new_source: z.string().optional(),
  cell_type: z.enum(["code", "markdown", "raw"]).optional(),
  edit_mode: z.enum(["replace", "insert", "delete"]).default("replace"),
});

export type NotebookEditInputType = z.infer<typeof NotebookEditInput>;

interface NotebookCell {
  cell_type: string;
  source: string | string[];
  outputs?: unknown[] | undefined;
  id?: string | undefined;
  [key: string]: unknown;
}

interface Notebook {
  cells: NotebookCell[];
  [key: string]: unknown;
}

function findIndex(notebook: Notebook, cellId: string | undefined): number {
  if (cellId === undefined || cellId === "") return notebook.cells.length - 1;
  const numeric = Number(cellId);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < notebook.cells.length) return numeric;
  return notebook.cells.findIndex((cell) => cell.id === cellId);
}

export function createNotebookEditTool(): Tool<NotebookEditInputType> {
  return {
    name: "NotebookEdit",
    description:
      "Replace, insert, or delete Jupyter notebook cells while preserving outputs and valid ipynb JSON.",
    input: NotebookEditInput,
    readOnly: false,
    concurrency: "exclusive",
    async execute(input: NotebookEditInputType, ctx: ToolContext): Promise<ToolResult> {
      const path = resolveUserPath(ctx, input.notebook_path);
      const guard = guardPath(ctx, path);
      if (guard) return guard;

      let notebook: Notebook;
      try {
        notebook = JSON.parse(readFileSync(path, "utf8")) as Notebook;
      } catch (error) {
        return toolError(`Cannot read notebook ${input.notebook_path}: ${(error as Error).message}`);
      }
      if (!Array.isArray(notebook.cells)) {
        return toolError(`${input.notebook_path} is not a valid notebook (missing cells array).`);
      }

      const index = findIndex(notebook, input.cell_id);
      if (input.edit_mode !== "insert" && index === -1) {
        return toolError(`Cell not found: ${input.cell_id ?? "(none)"}`);
      }
      if (input.edit_mode !== "delete" && (input.new_source === undefined || input.new_source.length === 0)) {
        return toolError("new_source is required for replace and insert.");
      }

      if (input.edit_mode === "replace") {
        const cell = notebook.cells[index];
        if (!cell) return toolError(`Cell not found: ${input.cell_id ?? ""}`);
        cell.source = input.new_source ?? "";
        if (input.cell_type !== undefined) cell.cell_type = input.cell_type;
      } else if (input.edit_mode === "insert") {
        const at = index === -1 ? 0 : index + 1;
        const cellType = input.cell_type ?? "code";
        notebook.cells.splice(at, 0, {
          cell_type: cellType,
          source: input.new_source ?? "",
          outputs: cellType === "code" ? [] : undefined,
          metadata: {},
          execution_count: null,
        } as NotebookCell);
      } else {
        notebook.cells.splice(index, 1);
      }

      ctx.onMutation?.([path]);
      try {
        atomicWrite(path, `${JSON.stringify(notebook, null, 2)}\n`);
      } catch (error) {
        return toolError(`Failed to write notebook: ${(error as Error).message}`);
      }

      return toolOk(
        `${input.edit_mode} applied to ${input.notebook_path} (${notebook.cells.length} cells).`,
        { cells: notebook.cells.length, editMode: input.edit_mode },
      );
    },
  };
}
