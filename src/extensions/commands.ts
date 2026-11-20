import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseFrontmatter, stringList } from "./frontmatter.js";
import { normalizeSlashes } from "../util/paths.js";

export interface CommandDefinition {
  name: string;
  description: string;
  argumentHint?: string | undefined;
  allowedTools?: string[] | undefined;
  model?: string | undefined;
  body: string;
  file: string;
  source: "project" | "user";
}

export interface DiscoverCommandsOptions {
  cwd: string;
  home: string;
  trusted?: boolean | undefined;
  extraDirs?: string[] | undefined;
}

function walk(dir: string, base: string, source: "project" | "user", out: string[]): void {
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
    if (stat.isDirectory()) {
      walk(path, base, source, out);
      continue;
    }
    if (stat.isFile() && entry.endsWith(".md")) out.push(path);
  }
}

export function discoverCommands(options: DiscoverCommandsOptions): CommandDefinition[] {
  const roots: Array<{ dir: string; source: "project" | "user" }> = [];
  if (options.trusted !== false) {
    roots.push({ dir: join(options.cwd, ".keycode", "commands"), source: "project" });
    roots.push({ dir: join(options.cwd, ".claude", "commands"), source: "project" });
  }
  for (const dir of options.extraDirs ?? []) roots.push({ dir, source: "user" });
  roots.push({ dir: join(options.home, ".keycode", "commands"), source: "user" });

  const byName = new Map<string, CommandDefinition>();
  for (const root of roots) {
    const files: string[] = [];
    walk(root.dir, root.dir, root.source, files);
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const parsed = parseFrontmatter(text);
      const name = normalizeSlashes(relative(root.dir, file)).replace(/\.md$/, "");
      if (byName.has(name)) continue;
      const description = typeof parsed.data.description === "string" ? parsed.data.description : "";
      const argumentHint =
        typeof parsed.data["argument-hint"] === "string" ? parsed.data["argument-hint"] : undefined;
      const allowedTools = stringList(parsed.data["allowed-tools"]);
      const model = typeof parsed.data.model === "string" ? parsed.data.model : undefined;
      byName.set(name, {
        name,
        description,
        ...(argumentHint === undefined ? {} : { argumentHint }),
        ...(allowedTools.length === 0 ? {} : { allowedTools }),
        ...(model === undefined ? {} : { model }),
        body: parsed.body,
        file,
        source: root.source,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findCommand(
  commands: CommandDefinition[],
  name: string,
): CommandDefinition | undefined {
  return commands.find((command) => command.name === name);
}

export interface RenderCommandOptions {
  runInjection?: ((command: string) => string | null) | undefined;
  deniedText?: string | undefined;
}

export function renderCommand(
  definition: CommandDefinition,
  args: string,
  options: RenderCommandOptions = {},
): string {
  const positional = args.trim() === "" ? [] : args.trim().split(/\s+/);
  const denied = options.deniedText ?? "[injection denied]";
  const lines = definition.body.split(/\r?\n/);
  const output = lines.map((line) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("!")) return line;
    const command = trimmed.slice(1).trim();
    if (command.length === 0) return line;
    if (!options.runInjection) return denied;
    const result = options.runInjection(command);
    return result === null ? denied : result;
  });

  let text = output.join("\n");
  text = text.replaceAll("$ARGUMENTS", args.trim());
  text = text.replace(/\$(\d)/g, (_match, index: string) => positional[Number(index) - 1] ?? "");

  const hasPlaceholder =
    definition.body.includes("$ARGUMENTS") || /\$\d/.test(definition.body);
  if (!hasPlaceholder && args.trim().length > 0) {
    text += `\n\n${args.trim()}`;
  }
  return text.trim();
}
