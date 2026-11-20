import { runCommand } from "../tools/bash.js";
import type { Settings } from "../storage/schema.js";

export interface StatusLineResult {
  text: string;
  failed: boolean;
}

export interface StatusLineOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv | undefined;
  timeoutMs?: number | undefined;
}

export const STATUS_LINE_FALLBACK = "(status unavailable)";

export function resolveStatusLine(settings: Settings): string | null {
  const value = settings.statusLine;
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim().length > 0 ? value : null;
  return value.command.trim().length > 0 ? value.command : null;
}

export async function runStatusLine(
  command: string,
  payload: unknown,
  options: StatusLineOptions,
): Promise<StatusLineResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (typeof value === "string") env[key] = value;
  }
  const result = await runCommand({
    command,
    cwd: options.cwd,
    env,
    stdin: JSON.stringify(payload),
    timeoutMs: options.timeoutMs ?? 5_000,
  });
  if (result.timedOut || result.exitCode !== 0) {
    return { text: STATUS_LINE_FALLBACK, failed: true };
  }
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? "";
  return { text: line.trim().slice(0, 200), failed: false };
}
