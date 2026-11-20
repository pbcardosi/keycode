import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError } from "../contracts/tool.js";
import { atomicWrite } from "../util/fsx.js";
import { scanSecrets } from "../util/redact.js";
import { guardPath, resolveUserPath } from "./shared.js";

export const EditInput = z.object({
  file_path: z.string().min(1),
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

export type EditInputType = z.infer<typeof EditInput>;

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function unifiedDiff(path: string, before: string, after: string): string {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const context = 2;
  const start = Math.max(0, prefix - context);
  const endA = Math.min(a.length, a.length - suffix + context);
  const endB = Math.min(b.length, b.length - suffix + context);
  const lines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${start + 1},${endA - start} +${start + 1},${endB - start} @@`,
  ];
  for (let index = start; index < prefix; index += 1) lines.push(` ${a[index] ?? ""}`);
  for (let index = prefix; index < a.length - suffix; index += 1) lines.push(`-${a[index] ?? ""}`);
  for (let index = prefix; index < b.length - suffix; index += 1) lines.push(`+${b[index] ?? ""}`);
  for (let index = a.length - suffix; index < endA; index += 1) lines.push(` ${a[index] ?? ""}`);
  return lines.join("\n");
}

export function createEditTool(): Tool<EditInputType> {
  return {
    name: "Edit",
    description:
      "Replace an exact string in a file. The old string must be unique unless replace_all is true. Preserves line endings.",
    input: EditInput,
    readOnly: false,
    concurrency: "exclusive",
    async execute(input: EditInputType, ctx: ToolContext): Promise<ToolResult> {
      const path = resolveUserPath(ctx, input.file_path);
      const guard = guardPath(ctx, path);
      if (guard) return guard;
      if (!existsSync(path)) return toolError(`File not found: ${input.file_path}`);

      let before: string;
      try {
        before = readFileSync(path, "utf8");
      } catch (error) {
        return toolError(`Cannot read ${input.file_path}: ${(error as Error).message}`);
      }

      const crlf = before.includes("\r\n");
      const oldString =
        crlf && !input.old_string.includes("\r\n")
          ? input.old_string.replaceAll("\n", "\r\n")
          : input.old_string;
      const newString =
        crlf && !input.new_string.includes("\r\n")
          ? input.new_string.replaceAll("\n", "\r\n")
          : input.new_string;

      const occurrences = countOccurrences(before, oldString);
      if (occurrences === 0) {
        if (newString.length > 0 && before.includes(newString)) {
          return {
            ok: true,
            content: [
              {
                type: "text",
                text: `No change needed: ${input.file_path} already contains the requested text. Verify with Read, then stop.`,
              },
            ],
            display: `No change needed: ${input.file_path}`,
            metadata: { path, alreadyApplied: true },
          };
        }
        return toolError(
          `old_string was not found in ${input.file_path}. Re-read the file and match the exact text, including whitespace. If you already applied this change, verify with Read and stop; do not retry the same edit.`,
        );
      }
      if (occurrences > 1 && input.replace_all !== true) {
        return toolError(
          `old_string appears ${occurrences} times in ${input.file_path}. Include more context to make it unique, or set replace_all.`,
        );
      }

      const after =
        input.replace_all === true
          ? before.split(oldString).join(newString)
          : before.replace(oldString, newString);

      const beforeCounts = new Map(scanSecrets(before).map((finding) => [finding.kind, finding.count]));
      const introduced = scanSecrets(after).filter(
        (finding) => finding.count > (beforeCounts.get(finding.kind) ?? 0),
      );
      if (introduced.length > 0) {
        return toolError(
          `SECRET_DETECTED: refusing to write ${input.file_path}; the edit would add ${introduced
            .map((finding) => finding.kind)
            .join(", ")}. Remove the credential or load it from an environment variable.`,
          { code: "SECRET_DETECTED" },
        );
      }

      ctx.onMutation?.([path]);
      try {
        atomicWrite(path, after);
      } catch (error) {
        return toolError(`Failed to write ${input.file_path}: ${(error as Error).message}`);
      }
      ctx.state.readFiles.add(path);

      return {
        ok: true,
        content: [{ type: "text", text: unifiedDiff(input.file_path, before, after) }],
        display: `Edited ${input.file_path} (${occurrences} replacement${occurrences === 1 ? "" : "s"})`,
        metadata: { path, replacements: occurrences },
      };
    },
  };
}
