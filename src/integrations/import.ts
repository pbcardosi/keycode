import { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite, ensureDir } from "../util/fsx.js";
import type { Settings } from "../storage/schema.js";

export interface ImportOptions {
  home: string;
  cwd: string;
  dryRun?: boolean | undefined;
  codexPath?: string | undefined;
  geminiPath?: string | undefined;
  cursorPath?: string | undefined;
}

export interface ImportResult {
  changed: string[];
  written: string[];
  backup: string | null;
}

interface SourceConfig {
  provider?: string | undefined;
  model?: string | undefined;
  mcpServers?: Record<string, unknown> | undefined;
}

function readJson(path: string): SourceConfig | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SourceConfig;
  } catch {
    return null;
  }
}

function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export async function importConfigs(options: ImportOptions): Promise<ImportResult> {
  const settingsPath = join(options.home, "settings.json");
  const existing = readSettings(settingsPath);
  const next: Settings = { ...existing };
  const codex = readJson(options.codexPath ?? join(options.home, "codex.json"));
  const gemini = readJson(options.geminiPath ?? join(options.home, "gemini.json"));

  if (codex?.provider !== undefined) next.provider = codex.provider;
  if (codex?.model !== undefined) next.model = codex.model;
  if (gemini?.model !== undefined && next.model === undefined) next.model = gemini.model;
  const mcpServers = {
    ...(existing.mcpServers ?? {}),
    ...(codex?.mcpServers ?? {}),
    ...(gemini?.mcpServers ?? {}),
  };
  if (Object.keys(mcpServers).length > 0) next.mcpServers = mcpServers;

  const changes: Array<{ path: string; content: string }> = [];
  const nextSettings = `${JSON.stringify(next, null, 2)}\n`;
  const previousSettings = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : "";
  if (nextSettings !== previousSettings) changes.push({ path: settingsPath, content: nextSettings });

  const cursorDir = options.cursorPath ?? join(options.cwd, ".cursor", "rules");
  if (existsSync(cursorDir)) {
    for (const file of readdirSync(cursorDir)) {
      if (!file.endsWith(".mdc")) continue;
      const name = file.replace(/\.mdc$/, "");
      const body = readFileSync(join(cursorDir, file), "utf8").trim();
      const target = join(options.home, "commands", `${name}.md`);
      const content = `---\ndescription: Imported from Cursor (${name})\n---\n${body}\n`;
      if (!existsSync(target) || readFileSync(target, "utf8") !== content) {
        changes.push({ path: target, content });
      }
    }
  }

  const changed = changes.map((change) => change.path);
  if (options.dryRun === true) return { changed, written: [], backup: null };

  let backup: string | null = null;
  for (const change of changes) {
    if (change.path === settingsPath && existsSync(settingsPath) && backup === null) {
      backup = `${settingsPath}.bak`;
      copyFileSync(settingsPath, backup);
    }
    ensureDir(join(change.path, ".."));
    atomicWrite(change.path, change.content);
  }
  return { changed, written: changed, backup };
}
