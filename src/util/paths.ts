import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function keycodeHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.KEYCODE_HOME;
  return configured && configured.length > 0 ? resolve(configured) : resolve(homedir(), ".keycode");
}

function canonicalCwd(cwd: string): string {
  try {
    return realpathSync(resolve(cwd));
  } catch {
    return resolve(cwd);
  }
}

export function projectKey(cwd: string): string {
  return createHash("sha256").update(canonicalCwd(cwd)).digest("hex").slice(0, 12);
}

export function projectDir(home: string, cwd: string): string {
  return resolve(home, "projects", projectKey(cwd));
}

export function sessionsDir(home: string, cwd: string): string {
  return resolve(projectDir(home, cwd), "sessions");
}

export function checkpointsDir(home: string, cwd: string): string {
  return resolve(projectDir(home, cwd), "checkpoints");
}

export function toolOutputDir(home: string): string {
  return resolve(home, "tool-output");
}

export function logsDir(home: string): string {
  return resolve(home, "logs");
}

export function tasksDir(home: string): string {
  return resolve(home, "tasks");
}

export function defaultHome(): string {
  return resolve(homedir(), ".keycode");
}

export function managedSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.KEYCODE_MANAGED_SETTINGS;
  if (override) return resolve(override);
  if (platform === "win32") {
    const programData = env.ProgramData ?? "C:\\ProgramData";
    return resolve(programData, "keycode", "managed-settings.json");
  }
  if (platform === "darwin") {
    return "/Library/Application Support/keycode/managed-settings.json";
  }
  return "/etc/keycode/managed-settings.json";
}

export function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function normalizeSlashes(path: string): string {
  return path.split(sep).join("/");
}

export function displayPath(cwd: string, path: string): string {
  const rel = relative(resolve(cwd), resolve(path));
  if (rel === "") return ".";
  if (!rel.startsWith("..") && !isAbsolute(rel)) return `./${normalizeSlashes(rel)}`;
  return normalizeSlashes(path);
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}
