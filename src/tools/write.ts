import { existsSync, statSync } from "node:fs";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";
import { atomicWrite } from "../util/fsx.js";
import { guardPath, resolveUserPath } from "./shared.js";

export const WriteInput = z.object({
  file_path: z.string().min(1),
  content: z.string(),
});

export type WriteInputType = z.infer<typeof WriteInput>;

export function createWriteTool(): Tool<WriteInputType> {
  return {
    name: "Write",
    description:
      "Create or overwrite a file. Parent directories are created. An existing file must be read first in this session.",
    input: WriteInput,
    readOnly: false,
    concurrency: "exclusive",
    async execute(input: WriteInputType, ctx: ToolContext): Promise<ToolResult> {
      const path = resolveUserPath(ctx, input.file_path);
      const guard = guardPath(ctx, path);
      if (guard) return guard;

      const exists = existsSync(path);
      if (exists) {
        const stat = statSync(path);
        if (!stat.isFile()) return toolError(`${input.file_path} is not a regular file.`);
        if (!ctx.state.readFiles.has(path)) {
          return toolError(
            `File has not been read yet: ${input.file_path}. Read it before overwriting.`,
          );
        }
      }

      ctx.onMutation?.([path]);
      try {
        atomicWrite(path, input.content);
      } catch (error) {
        return toolError(`Failed to write ${input.file_path}: ${(error as Error).message}`);
      }
      ctx.state.readFiles.add(path);
      const lines = input.content.split(/\r?\n/).length;
      return toolOk(
        `${exists ? "Updated" : "Created"} ${input.file_path} (${lines} lines, ${Buffer.byteLength(input.content)} bytes).`,
        { path, created: !exists, lines },
      );
    },
  };
}
