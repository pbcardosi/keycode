import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type TrustItemKind =
  | "hooks"
  | "mcp"
  | "lsp"
  | "browser"
  | "permissions"
  | "env"
  | "customizations";

export interface TrustItem {
  kind: TrustItemKind;
  name: string;
  detail: string;
}

export interface TrustManifest {
  items: TrustItem[];
  fingerprint: string;
}

export interface TrustState {
  trusted: boolean;
  changed: boolean;
  items: TrustItem[];
  fingerprint: string;
}

interface ProjectSettingsFile {
  path: string;
  settings: Record<string, unknown>;
}

function projectSettingsFiles(cwd: string): string[] {
  return [
    join(cwd, ".keycode", "settings.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".keycode", "settings.local.json"),
    join(cwd, ".claude", "settings.local.json"),
  ];
}

function readProjectSettings(cwd: string): ProjectSettingsFile[] {
  const result: ProjectSettingsFile[] = [];
  for (const path of projectSettingsFiles(cwd)) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as unknown;
      if (raw !== null && typeof raw === "object") {
        result.push({ path, settings: raw as Record<string, unknown> });
      }
    } catch {
      result.push({ path, settings: {} });
    }
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function hookCommands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const commands: string[] = [];
  for (const entry of value) {
    const hook = record(entry);
    const nested = Array.isArray(hook.hooks) ? hook.hooks : [];
    for (const item of nested) {
      const command = record(item).command;
      if (typeof command === "string") commands.push(command);
    }
    if (typeof hook.command === "string") commands.push(hook.command);
  }
  return commands;
}

function label(cwd: string, path: string): string {
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}

export function buildTrustManifest(cwdInput: string): TrustManifest {
  const cwd = resolve(cwdInput);
  const items: TrustItem[] = [];
  for (const file of readProjectSettings(cwd)) {
    const source = label(cwd, file.path);
    const settings = file.settings;

    const permissions = record(settings.permissions);
    for (const behavior of ["allow", "ask"] as const) {
      for (const rule of stringArray(permissions[behavior])) {
        items.push({
          kind: "permissions",
          name: `${source}: ${behavior}`,
          detail: rule,
        });
      }
    }

    const hooks = record(settings.hooks);
    for (const [event, value] of Object.entries(hooks)) {
      for (const command of hookCommands(value)) {
        items.push({ kind: "hooks", name: `${source}: ${event}`, detail: command });
      }
    }

    const mcpServers = record(settings.mcpServers);
    for (const [name, value] of Object.entries(mcpServers)) {
      const server = record(value);
      const detail =
        typeof server.command === "string"
          ? [server.command, ...stringArray(server.args)].join(" ")
          : typeof server.url === "string"
            ? server.url
            : "MCP server";
      items.push({ kind: "mcp", name: `${source}: ${name}`, detail });
    }

    const lsp = record(settings.lsp);
    for (const [language, value] of Object.entries(lsp)) {
      const server = record(value);
      const command = typeof server.command === "string" ? server.command : "language server";
      items.push({
        kind: "lsp",
        name: `${source}: ${language}`,
        detail: [command, ...stringArray(server.args)].join(" "),
      });
    }

    const browser = record(settings.browser);
    if (typeof browser.driver === "string") {
      items.push({ kind: "browser", name: `${source}: browser`, detail: browser.driver });
    }

    const env = record(settings.env);
    for (const key of Object.keys(env)) {
      items.push({ kind: "env", name: `${source}: env`, detail: key });
    }
  }

  const customizationDirs: Array<[string, string]> = [
    [".keycode/commands", "command"],
    [".keycode/skills", "skill"],
    [".keycode/agents", "agent"],
    [".keycode/output-styles", "style"],
    [".claude/commands", "command"],
    [".claude/skills", "skill"],
    [".claude/agents", "agent"],
    [".claude/output-styles", "style"],
  ];
  let customizationCount = 0;
  for (const [dir, kind] of customizationDirs) {
    const absolute = join(cwd, dir);
    if (!existsSync(absolute)) continue;
    let files: string[] = [];
    try {
      files = readdirSync(absolute, { recursive: true })
        .map((entry) => String(entry))
        .filter((entry) => !entry.endsWith("/"))
        .sort();
    } catch {
      continue;
    }
    for (const file of files) {
      if (customizationCount >= 200) break;
      const path = join(absolute, file);
      let detail = `${kind} file`;
      try {
        if (!statSync(path).isFile()) continue;
        const text = readFileSync(path);
        detail = `${text.length} bytes · ${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
      } catch {
        continue;
      }
      items.push({
        kind: "customizations",
        name: `${dir}/${relative(absolute, path).replace(/\\/g, "/")}`,
        detail,
      });
      customizationCount += 1;
    }
  }
  if (customizationCount >= 200) {
    items.push({
      kind: "customizations",
      name: "additional project customizations",
      detail: "More than 200 files; review the directories manually.",
    });
  }

  items.sort((a, b) => `${a.kind}\0${a.name}\0${a.detail}`.localeCompare(`${b.kind}\0${b.name}\0${b.detail}`));
  const fingerprint = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  return { items, fingerprint };
}

export function manifestSummary(manifest: TrustManifest): string {
  if (manifest.items.length === 0) return "No project-controlled commands or permissions.";
  return manifest.items
    .map((item) => `- ${item.kind}: ${item.name} — ${item.detail}`)
    .join("\n");
}
