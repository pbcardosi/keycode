import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";
import { guardPath, resolveUserPath } from "./shared.js";
import { isInside } from "../util/paths.js";

export const ReadInput = z.object({
  file_path: z.string().min(1),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(20_000).optional(),
  pages: z.string().optional(),
});

export type ReadInputType = z.infer<typeof ReadInput>;

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8_192);
  return sample.includes(0);
}

function parsePageRange(range: string, total: number): number[] {
  const pages = new Set<number>();
  for (const part of range.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const match = /^(\d+)(?:-(\d+))?$/.exec(trimmed);
    if (!match) continue;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    for (let page = Math.min(start, end); page <= Math.max(start, end); page += 1) {
      if (page >= 1 && page <= total) pages.add(page);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function pdfTextPages(buffer: Buffer): string[] {
  const text = buffer.toString("latin1");
  const chunks = text.split(/\/Type\s*\/Page(?![s])/).slice(1);
  const pages: string[] = [];
  for (const chunk of chunks) {
    const streamMatch = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(chunk);
    let content = "";
    if (streamMatch?.[1] !== undefined) {
      const raw = Buffer.from(streamMatch[1], "latin1");
      if (/FlateDecode/.test(chunk)) {
        try {
          content = inflateSync(raw).toString("latin1");
        } catch {
          content = "";
        }
      } else {
        content = streamMatch[1];
      }
    }
    const strings: string[] = [];
    for (const match of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      if (match[1] !== undefined) strings.push(match[1].replace(/\\([()\\])/g, "$1"));
    }
    for (const match of content.matchAll(/\[(.*?)\]\s*TJ/gs)) {
      const inner = match[1] ?? "";
      const parts = [...inner.matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((item) => item[1] ?? "");
      if (parts.length > 0) strings.push(parts.join(""));
    }
    pages.push(strings.join("\n"));
  }
  return pages;
}

function renderNotebook(content: string): string {
  const notebook = JSON.parse(content) as {
    cells?: Array<{
      cell_type?: string;
      source?: string | string[];
      outputs?: Array<{ text?: string | string[]; data?: Record<string, unknown> }>;
    }>;
  };
  const cells = notebook.cells ?? [];
  return cells
    .map((cell, index) => {
      const source = Array.isArray(cell.source) ? cell.source.join("") : (cell.source ?? "");
      const header = `--- cell ${index + 1} (${cell.cell_type ?? "unknown"}) ---`;
      const outputs = (cell.outputs ?? [])
        .map((output) => {
          if (output.text !== undefined) {
            return Array.isArray(output.text) ? output.text.join("") : output.text;
          }
          const plain = output.data?.["text/plain"];
          return Array.isArray(plain) ? plain.join("") : typeof plain === "string" ? plain : "";
        })
        .filter((value) => value.length > 0)
        .join("\n");
      return outputs.length > 0 ? `${header}\n${source}\n[output]\n${outputs}` : `${header}\n${source}`;
    })
    .join("\n\n");
}

export function createReadTool(): Tool<ReadInputType> {
  return {
    name: "Read",
    description:
      "Read a file from the workspace. Text is returned with line numbers. Supports offsets, images, PDF page ranges, and Jupyter notebooks.",
    input: ReadInput,
    readOnly: true,
    concurrency: "parallel",
    async execute(input: ReadInputType, ctx: ToolContext): Promise<ToolResult> {
      const path = resolveUserPath(ctx, input.file_path);
      if (!isInside(ctx.cwd, path)) {
        return toolError(`Path outside workspace: ${input.file_path}`);
      }

      let stat;
      try {
        stat = statSync(path);
      } catch {
        return toolError(`File not found: ${input.file_path}`);
      }
      if (!stat.isFile()) return toolError(`${input.file_path} is not a regular file.`);

      const extension = extname(path).toLowerCase();
      if (IMAGE_TYPES[extension]) {
        if (stat.size > 8 * 1024 * 1024) return toolError("Image is larger than 8 MB.");
        const data = readFileSync(path).toString("base64");
        ctx.state.readFiles.add(path);
        return {
          ok: true,
          content: [
            { type: "text", text: `Image: ${input.file_path} (${IMAGE_TYPES[extension]}, ${stat.size} bytes)` },
            { type: "image", mime: IMAGE_TYPES[extension], data },
          ],
          display: `Read image ${input.file_path}`,
        };
      }

      let buffer: Buffer;
      try {
        buffer = readFileSync(path);
      } catch (error) {
        return toolError(`Cannot read ${input.file_path}: ${(error as Error).message}`);
      }

      if (extension === ".pdf") {
        const pages = pdfTextPages(buffer);
        const selected = input.pages
          ? parsePageRange(input.pages, pages.length)
          : pages.map((_, index) => index + 1);
        const body = selected
          .map((page) => `--- page ${page} ---\n${pages[page - 1] ?? ""}`)
          .join("\n\n");
        ctx.state.readFiles.add(path);
        return {
          ok: true,
          content: [{ type: "text", text: body.length > 0 ? body : "(no extractable text)" }],
          display: `Read PDF ${input.file_path}`,
        };
      }

      if (extension === ".ipynb") {
        ctx.state.readFiles.add(path);
        return {
          ok: true,
          content: [{ type: "text", text: renderNotebook(buffer.toString("utf8")) }],
          display: `Read notebook ${input.file_path}`,
        };
      }

      if (isBinary(buffer)) {
        return toolError(
          `${input.file_path} appears to be a binary file. Use an image or PDF reader for supported formats.`,
        );
      }

      const text = buffer.toString("utf8");
      const allLines = text.split(/\r?\n/);
      const offset = input.offset ?? 1;
      const limit = input.limit ?? 2_000;
      const selected = allLines.slice(offset - 1, offset - 1 + limit);
      const width = String(offset + selected.length - 1).length;
      const rendered = selected
        .map((line, index) => `${String(offset + index).padStart(width, " ")}\t${line}`)
        .join("\n");
      ctx.state.readFiles.add(path);
      return {
        ok: true,
        content: [{ type: "text", text: rendered }],
        display: `Read ${input.file_path}`,
        metadata: { lines: allLines.length, offset, limit },
      };
    },
  };
}
