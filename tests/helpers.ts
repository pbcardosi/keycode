import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

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
