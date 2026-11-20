import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import { join } from "node:path";
import type { PermissionSettings } from "../contracts/permissions.js";
import { keycodeHome, managedSettingsPath } from "../util/paths.js";
import { SettingsSchema, type Settings } from "./schema.js";

export interface LoadedSettings {
  settings: Settings;
  warnings: string[];
  sources: string[];
}

export interface LoadSettingsOptions {
  cwd: string;
  home?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  projectLayers?: boolean | undefined;
}

const DEFAULT_PERMISSIONS: PermissionSettings = {
  defaultMode: "manual",
  allow: [],
  deny: [],
  ask: [],
};

function interpolateEnv(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name: string) => env[name] ?? match);
  }
  if (Array.isArray(value)) return value.map((item) => interpolateEnv(item, env));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = interpolateEnv(item, env);
    }
    return result;
  }
  return value;
}

function deepMerge(base: Settings, next: Settings): Settings {
  const output: Settings = { ...base };
  for (const [key, value] of Object.entries(next) as Array<[keyof Settings, unknown]>) {
    if (value === undefined) continue;
    const current = output[key];
    if (
      key === "permissions" &&
      current !== null &&
      typeof current === "object" &&
      value !== null &&
      typeof value === "object"
    ) {
      const currentPermissions = current as Record<string, unknown>;
      const nextPermissions = value as Record<string, unknown>;
      output.permissions = {
        ...currentPermissions,
        ...nextPermissions,
        allow: [
          ...(Array.isArray(currentPermissions.allow) ? currentPermissions.allow : []),
          ...(Array.isArray(nextPermissions.allow) ? nextPermissions.allow : []),
        ],
        deny: [
          ...(Array.isArray(currentPermissions.deny) ? currentPermissions.deny : []),
          ...(Array.isArray(nextPermissions.deny) ? nextPermissions.deny : []),
        ],
        ask: [
          ...(Array.isArray(currentPermissions.ask) ? currentPermissions.ask : []),
          ...(Array.isArray(nextPermissions.ask) ? nextPermissions.ask : []),
        ],
      } as Settings["permissions"];
    } else if (
      (key === "providers" || key === "hooks" || key === "mcpServers" || key === "env") &&
      current !== null &&
      typeof current === "object" &&
      value !== null &&
      typeof value === "object"
    ) {
      (output as Record<string, unknown>)[key] = {
        ...(current as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      (output as Record<string, unknown>)[key] = value;
    }
  }
  return output;
}

function readLayer(path: string, warnings: string[]): Settings | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(
      readFileSync(path, "utf8").replace(/^\uFEFF/, ""),
    ) as unknown;
    const parsed = SettingsSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push(
        `Ignoring invalid settings file ${path}: ${parsed.error.issues[0]?.message ?? "schema error"}`,
      );
      return null;
    }
    return parsed.data;
  } catch (error) {
    warnings.push(`Ignoring unreadable settings file ${path}: ${(error as Error).message}`);
    return null;
  }
}

export function settingsCandidatePaths(options: LoadSettingsOptions): string[] {
  const env = options.env ?? process.env;
  const home = options.home ?? keycodeHome(env);
  const paths = [join(home, "settings.json")];
  if (options.projectLayers !== false) {
    paths.push(
      join(options.cwd, ".keycode", "settings.json"),
      join(options.cwd, ".claude", "settings.json"),
      join(options.cwd, ".keycode", "settings.local.json"),
      join(options.cwd, ".claude", "settings.local.json"),
    );
  }
  paths.push(managedSettingsPath(env));
  return paths;
}

export function loadSettings(options: LoadSettingsOptions): LoadedSettings {
  const env = options.env ?? process.env;
  const home = options.home ?? keycodeHome(env);
  const warnings: string[] = [];
  const sources: string[] = [];
  let settings: Settings = {
    permissions: { ...DEFAULT_PERMISSIONS, allow: [], deny: [], ask: [] },
    telemetry: "off",
  };

  for (const path of settingsCandidatePaths(options)) {
    const layer = readLayer(path, warnings);
    if (layer === null) continue;
    settings = deepMerge(settings, interpolateEnv(layer, env) as Settings);
    sources.push(path);
  }

  if (settings.permissions === undefined) {
    settings.permissions = { ...DEFAULT_PERMISSIONS, allow: [], deny: [], ask: [] };
  }

  return { settings, warnings, sources };
}

export function watchSettings(
  options: LoadSettingsOptions,
  onChange: (loaded: LoadedSettings) => void,
  intervalMs = 250,
): () => void {
  const paths = settingsCandidatePaths(options).filter((path) => existsSync(path));
  let timer: NodeJS.Timeout | null = null;
  const trigger = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange(loadSettings(options));
    }, intervalMs);
  };
  for (const path of paths) {
    watchFile(path, { interval: intervalMs }, trigger);
  }
  return () => {
    if (timer !== null) clearTimeout(timer);
    for (const path of paths) unwatchFile(path);
  };
}

export function permissionSettings(settings: Settings): PermissionSettings {
  const permissions = settings.permissions;
  return {
    defaultMode: (permissions?.defaultMode as PermissionSettings["defaultMode"] | undefined) ?? "manual",
    allow: permissions?.allow ?? [],
    deny: permissions?.deny ?? [],
    ask: permissions?.ask ?? [],
  };
}
