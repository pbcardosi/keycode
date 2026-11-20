import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolOk } from "../contracts/tool.js";
import { matchGlob, toAbsolutePath, walkFiles } from "./walk.js";

export const GlobInput = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  limit: z.number().int().positive().max(10_000).optional(),
  no_ignore: z.boolean().optional(),
});

export type GlobInputType = z.infer<typeof GlobInput>;

export function createGlobTool(): Tool<GlobInputType> {
  return {
    name: "Glob",
    description:
      "Find files by glob pattern. Results are sorted by modification time, newest first. Respects .gitignore and .ignore and skips .git and node_modules by default.",
    input: GlobInput,
    readOnly: true,
    concurrency: "parallel",
    async execute(input: GlobInputType, ctx: ToolContext): Promise<ToolResult> {
      const base = input.path ? toAbsolutePath(ctx.cwd, input.path) : ctx.cwd;
      const files = walkFiles({
        cwd: base,
        noIgnore: input.no_ignore ?? false,
        maxEntries: 50_000,
      });
      const matches = files
        .filter((file) => matchGlob(input.pattern, file.relative))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, input.limit ?? 200);

      const text =
        matches.length === 0 ? "No files found." : matches.map((file) => file.relative).join("\n");
      return toolOk(text, { count: matches.length });
    },
  };
}
