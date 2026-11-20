import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite, ensureDir } from "../util/fsx.js";
import { parseHookConfig, type HookConfig } from "./hooks.js";

export interface PluginManifest {
  name: string;
  version: string;
  description?: string | undefined;
}

export interface InstalledPlugin {
  name: string;
  version: string;
  pinnedVersion?: string | undefined;
  source: string;
  enabled: boolean;
  trusted: boolean;
  installedAt: string;
  path: string;
}

interface PluginRegistry {
  version: 1;
  plugins: Record<string, InstalledPlugin>;
}

export interface InstallPluginOptions {
  trusted?: boolean | undefined;
  now?: string | undefined;
}

export function pluginRegistryPath(home: string): string {
  return join(home, "plugins.json");
}

function readRegistry(home: string): PluginRegistry {
  const path = pluginRegistryPath(home);
  if (!existsSync(path)) return { version: 1, plugins: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PluginRegistry>;
    return { version: 1, plugins: parsed.plugins ?? {} };
  } catch {
    return { version: 1, plugins: {} };
  }
}

function writeRegistry(home: string, registry: PluginRegistry): void {
  ensureDir(home);
  atomicWrite(pluginRegistryPath(home), `${JSON.stringify(registry, null, 2)}\n`);
}

export function loadManifest(sourceDir: string): PluginManifest {
  const path = join(sourceDir, "plugin.json");
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PluginManifest>;
      return {
        name: parsed.name ?? sourceDir.replaceAll("\\", "/").split("/").pop() ?? "plugin",
        version: parsed.version ?? "0.0.0",
        ...(parsed.description === undefined ? {} : { description: parsed.description }),
      };
    } catch {
      // Fall through to defaults.
    }
  }
  return {
    name: sourceDir.replaceAll("\\", "/").split("/").pop() ?? "plugin",
    version: "0.0.0",
  };
}

export function installPlugin(
  home: string,
  sourceDir: string,
  options: InstallPluginOptions = {},
): InstalledPlugin {
  const manifest = loadManifest(sourceDir);
  const target = join(home, "plugins", manifest.name);
  ensureDir(join(home, "plugins"));
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  cpSync(sourceDir, target, { recursive: true });
  const record: InstalledPlugin = {
    name: manifest.name,
    version: manifest.version,
    source: sourceDir,
    enabled: true,
    trusted: options.trusted === true,
    installedAt: options.now ?? new Date().toISOString(),
    path: target,
  };
  const registry = readRegistry(home);
  registry.plugins[manifest.name] = record;
  writeRegistry(home, registry);
  return record;
}

export function listPlugins(home: string): InstalledPlugin[] {
  return Object.values(readRegistry(home).plugins);
}

export function setPluginEnabled(home: string, name: string, enabled: boolean): InstalledPlugin | null {
  const registry = readRegistry(home);
  const record = registry.plugins[name];
  if (!record) return null;
  record.enabled = enabled;
  writeRegistry(home, registry);
  return record;
}

export function pinPlugin(home: string, name: string, version: string): InstalledPlugin | null {
  const registry = readRegistry(home);
  const record = registry.plugins[name];
  if (!record) return null;
  record.pinnedVersion = version;
  writeRegistry(home, registry);
  return record;
}

export function removePlugin(home: string, name: string): boolean {
  const registry = readRegistry(home);
  const record = registry.plugins[name];
  if (!record) return false;
  rmSync(record.path, { recursive: true, force: true });
  delete registry.plugins[name];
  writeRegistry(home, registry);
  return true;
}

export function enabledPluginDirs(home: string): string[] {
  return listPlugins(home)
    .filter((plugin) => plugin.enabled)
    .map((plugin) => plugin.path);
}

export function collectPluginHooks(home: string): HookConfig {
  const merged: HookConfig = {};
  for (const dir of enabledPluginDirs(home)) {
    const path = join(dir, "hooks.json");
    if (!existsSync(path)) continue;
    try {
      const config = parseHookConfig(JSON.parse(readFileSync(path, "utf8")) as unknown);
      for (const [event, matchers] of Object.entries(config)) {
        merged[event] = [...(merged[event] ?? []), ...matchers];
      }
    } catch {
      // Ignore malformed plugin hooks.
    }
  }
  return merged;
}
