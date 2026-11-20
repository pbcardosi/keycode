import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError } from "../contracts/tool.js";
import { toolOutputDir, isInside } from "../util/paths.js";
import { newId } from "../util/ids.js";

export const MAX_TOOL_OUTPUT = 30_000;

export function capOutput(
  text: string,
  ctx: ToolContext,
  label: string,
): { text: string; spilled: string | null } {
  if (text.length <= MAX_TOOL_OUTPUT) return { text, spilled: null };
  const dir = toolOutputDir(ctx.home);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${newId(label)}.txt`);
  writeFileSync(path, text);
  const head = text.slice(0, 6_000);
  const tail = text.slice(-3_000);
  return {
    text: `${head}\n\n...[${text.length - 9_000} characters omitted; full output at ${path}]...\n\n${tail}`,
    spilled: path,
  };
}

export function guardPath(ctx: ToolContext, path: string): ToolResult | null {
  if (ctx.workspaceRoots.some((root) => isInside(root, path))) return null;
  return toolError(
    `PATH_OUTSIDE_WORKSPACE: ${path} is outside the workspace. Use --add-dir to allow it.`,
    { code: "PATH_OUTSIDE_WORKSPACE" },
  );
}

export function resolveUserPath(ctx: ToolContext, path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }
  return isAbsolute(path) ? path : resolve(ctx.cwd, path);
}
