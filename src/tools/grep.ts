import { readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError } from "../contracts/tool.js";
import { matchGlob, toAbsolutePath, walkFiles } from "./walk.js";
import { normalizeSlashes } from "../util/paths.js";
import { capOutput } from "./shared.js";
import { guardPath } from "./shared.js";

export const GrepInput = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  glob: z.string().optional(),
  type: z.string().optional(),
  output_mode: z.enum(["content", "files_with_matches", "count"]).optional(),
  case_sensitive: z.boolean().optional(),
  literal: z.boolean().optional(),
  context: z.number().int().min(0).max(20).optional(),
  head_limit: z.number().int().positive().max(10_000).optional(),
  no_ignore: z.boolean().optional(),
});

export type GrepInputType = z.infer<typeof GrepInput>;

const TYPE_EXTENSIONS: Record<string, string[]> = {
  js: [".js", ".mjs", ".cjs", ".jsx"],
  ts: [".ts", ".mts", ".cts", ".tsx"],
  py: [".py"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
  rb: [".rb"],
  php: [".php"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".hpp", ".h"],
  json: [".json"],
  md: [".md", ".mdx"],
  yaml: [".yml", ".yaml"],
  html: [".html", ".htm"],
  css: [".css", ".scss"],
  sh: [".sh", ".bash", ".zsh"],
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8_192).includes(0);
}

export function createGrepTool(): Tool<GrepInputType> {
  return {
    name: "Grep",
    description:
      "Search file contents with a regular expression. Supports glob and type filters, context lines, and content, file, or count output.",
    input: GrepInput,
    readOnly: true,
    concurrency: "parallel",
    async execute(input: GrepInputType, ctx: ToolContext): Promise<ToolResult> {
      let regex: RegExp;
      try {
        regex = new RegExp(
          input.literal === true ? escapeRegex(input.pattern) : input.pattern,
          input.case_sensitive === true ? "" : "i",
        );
      } catch (error) {
        return toolError(`Invalid regular expression: ${(error as Error).message}`);
      }

      const base = input.path ? toAbsolutePath(ctx.cwd, input.path) : ctx.cwd;
      if (guardPath(ctx, base) !== null) {
        return toolError(`PATH_OUTSIDE_WORKSPACE: ${base} is outside the workspace.`);
      }
      const files = walkFiles({ cwd: base, noIgnore: input.no_ignore ?? false, maxEntries: 50_000 });
      const extensions = input.type ? TYPE_EXTENSIONS[input.type.toLowerCase()] : undefined;
      if (input.type && !extensions) {
        return toolError(
          `Unknown file type "${input.type}". Known types: ${Object.keys(TYPE_EXTENSIONS).join(", ")}.`,
        );
      }

      const outputMode = input.output_mode ?? "content";
      const limit = input.head_limit ?? 250;
      const contextLines = input.context ?? 0;
      const results: string[] = [];
      let matchCount = 0;
      let truncated = false;

      for (const file of files) {
        if (results.length >= limit) {
          truncated = true;
          break;
        }
        if (input.glob && !matchGlob(input.glob, file.relative)) continue;
        if (extensions && !extensions.includes(extname(file.path).toLowerCase())) continue;
        if (file.size > 4 * 1024 * 1024) continue;

        let buffer: Buffer;
        try {
          buffer = readFileSync(file.path);
        } catch {
          continue;
        }
        if (isBinary(buffer)) continue;
        const lines = buffer.toString("utf8").split(/\r?\n/);
        const fileMatches: number[] = [];
        for (let index = 0; index < lines.length; index += 1) {
          if (regex.test(lines[index] ?? "")) fileMatches.push(index);
        }
        if (fileMatches.length === 0) continue;

        const displayPath = normalizeSlashes(relative(ctx.cwd, file.path));
        if (outputMode === "files_with_matches") {
          results.push(displayPath);
          matchCount += fileMatches.length;
          continue;
        }
        if (outputMode === "count") {
          results.push(`${displayPath}:${fileMatches.length}`);
          matchCount += fileMatches.length;
          continue;
        }

        const included = new Set<number>();
        for (const matchIndex of fileMatches) {
          for (
            let lineIndex = Math.max(0, matchIndex - contextLines);
            lineIndex <= Math.min(lines.length - 1, matchIndex + contextLines);
            lineIndex += 1
          ) {
            if (included.has(lineIndex)) continue;
            included.add(lineIndex);
            results.push(`${displayPath}:${lineIndex + 1}:${lines[lineIndex] ?? ""}`);
            if (results.length >= limit) {
              truncated = true;
              break;
            }
          }
          matchCount += 1;
          if (results.length >= limit) break;
        }
      }

      if (results.length === 0) {
        return { ok: true, content: [{ type: "text", text: "No matches found." }], metadata: { matches: 0 } };
      }
      const capped = capOutput(results.join("\n"), ctx, "grep");
      return {
        ok: true,
        content: [{ type: "text", text: capped.text }],
        metadata: { matches: matchCount, truncated, ...(capped.spilled === null ? {} : { spilled: capped.spilled }) },
      };
    },
  };
}
