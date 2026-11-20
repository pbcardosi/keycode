import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseFrontmatter, stringList } from "./frontmatter.js";
import { normalizeSlashes } from "../util/paths.js";
import { PERMISSION_MODES, type PermissionMode } from "../contracts/permissions.js";

export interface AgentDefinition {
  name: string;
  description: string;
  tools?: string[] | undefined;
  model?: string | undefined;
  permissionMode?: PermissionMode | undefined;
  body: string;
  file: string;
  source: "project" | "user";
}

export interface DiscoverAgentsOptions {
  cwd: string;
  home: string;
  trusted?: boolean | undefined;
  extraDirs?: string[] | undefined;
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(path, out);
    else if (stat.isFile() && entry.endsWith(".md")) out.push(path);
  }
}

export function discoverAgents(options: DiscoverAgentsOptions): AgentDefinition[] {
  const roots: Array<{ dir: string; source: "project" | "user" }> = [];
  if (options.trusted !== false) {
    roots.push({ dir: join(options.cwd, ".keycode", "agents"), source: "project" });
    roots.push({ dir: join(options.cwd, ".claude", "agents"), source: "project" });
  }
  for (const dir of options.extraDirs ?? []) roots.push({ dir, source: "user" });
  roots.push({ dir: join(options.home, ".keycode", "agents"), source: "user" });

  const byName = new Map<string, AgentDefinition>();
  for (const root of roots) {
    const files: string[] = [];
    walk(root.dir, files);
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const parsed = parseFrontmatter(text);
      const fallbackName = normalizeSlashes(relative(root.dir, file)).replace(/\.md$/, "");
      const name = typeof parsed.data.name === "string" ? parsed.data.name : fallbackName;
      if (byName.has(name)) continue;
      const description = typeof parsed.data.description === "string" ? parsed.data.description : "";
      const tools = stringList(parsed.data.tools);
      const model = typeof parsed.data.model === "string" ? parsed.data.model : undefined;
      const rawMode =
        typeof parsed.data["permission-mode"] === "string"
          ? parsed.data["permission-mode"]
          : typeof parsed.data.permissionMode === "string"
            ? parsed.data.permissionMode
            : undefined;
      const permissionMode =
        rawMode !== undefined && (PERMISSION_MODES as readonly string[]).includes(rawMode)
          ? (rawMode as PermissionMode)
          : undefined;
      byName.set(name, {
        name,
        description,
        ...(tools.length === 0 ? {} : { tools }),
        ...(model === undefined ? {} : { model }),
        ...(permissionMode === undefined ? {} : { permissionMode }),
        body: parsed.body,
        file,
        source: root.source,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findAgentDefinition(
  agents: AgentDefinition[],
  name: string,
): AgentDefinition | undefined {
  return agents.find((agent) => agent.name === name);
}
