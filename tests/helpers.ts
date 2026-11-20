import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ToolContext } from "../dist/contracts/tool.js";
import { PermissionService } from "../dist/permissions/pipeline.js";
import { silentLogger } from "../dist/util/logger.js";
import { systemClock } from "../dist/util/clock.js";
import { SessionStore } from "../dist/storage/session.js";

const CLI = resolve("dist/cli/index.js");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CliOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  input?: string;
}

export function runCli(args: string[], options: CliOptions = {}): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...options.env },
    cwd: options.cwd ?? process.cwd(),
    input: options.input,
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "keycode-test-"));
}

export function makeHome(): string {
  const home = join(makeTempRoot(), "home");
  mkdirSync(home, { recursive: true });
  return home;
}

export function makeWorkspace(name = "ws"): string {
  const ws = join(makeTempRoot(), name);
  mkdirSync(ws, { recursive: true });
  return ws;
}

export function projectKey(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 12);
}

export function readJsonl(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export function parseJsonl(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(path: string, value: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

export function findSessionFile(home: string, cwd: string): string {
  const dir = join(home, "projects", projectKey(cwd), "sessions");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  if (files.length !== 1) {
    throw new Error(`Expected one session file in ${dir}, found ${files.length}`);
  }
  return join(dir, files[0] as string);
}

export function fakeScript(events: unknown[]): string {
  return JSON.stringify(events);
}

export function uuid(): string {
  return randomUUID();
}

// Re-exports kept importable from one place.
export { silentLogger } from "../dist/util/logger.js";
export { systemClock } from "../dist/util/clock.js";
export { PermissionService } from "../dist/permissions/pipeline.js";
export { SessionStore } from "../dist/storage/session.js";

export interface ToolCtxOptions {
  cwd: string;
  home?: string | undefined;
  workspaceRoots?: string[] | undefined;
  askQuestions?: ToolContext["askQuestions"] | undefined;
  mode?: "manual" | "bypassPermissions" | "auto" | "dontAsk" | undefined;
}

export function makeToolCtx(options: ToolCtxOptions): ToolContext {
  const cwd = resolve(options.cwd);
  const roots = options.workspaceRoots ?? [cwd];
  return {
    sessionId: "sess-tool-test",
    cwd,
    workspaceRoots: roots,
    signal: new AbortController().signal,
    permissions: new PermissionService({ mode: options.mode ?? "bypassPermissions", cwd, roots }),
    logger: silentLogger,
    clock: systemClock,
    state: { readFiles: new Set(), todos: [], metadata: new Map() },
    home: options.home ?? makeHome(),
    ...(options.askQuestions === undefined ? {} : { askQuestions: options.askQuestions }),
  };
}

export function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .map((block) => (block.type === "text" ? block.text ?? "" : `[${block.type}]`))
    .join("\n");
}

