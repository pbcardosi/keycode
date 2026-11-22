import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, stringList } from "./frontmatter.js";
import { normalizeSlashes } from "../util/paths.js";

export interface SkillMetadata {
  name: string;
  description: string;
  allowedTools?: string[] | undefined;
  argumentHint?: string | undefined;
  file: string;
  source: "project" | "user";
}

export interface Skill extends SkillMetadata {
  body: string;
}

export interface DiscoverSkillsOptions {
  cwd: string;
  home: string;
  trusted?: boolean | undefined;
  extraDirs?: string[] | undefined;
}

function walkSkillFiles(dir: string, out: string[]): void {
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
      walkSkillFiles(path, out);
    } else if (stat.isFile() && entry === "SKILL.md") {
      out.push(path);
    }
  }
}

function readSkill(file: string, source: "project" | "user"): Skill | null {
  try {
    const parsed = parseFrontmatter(readFileSync(file, "utf8"));
    const fallbackName = normalizeSlashes(file).split("/").slice(-2)[0] ?? "skill";
    const name = typeof parsed.data.name === "string" ? parsed.data.name : fallbackName;
    const description = typeof parsed.data.description === "string" ? parsed.data.description : "";
    const allowedTools = stringList(parsed.data["allowed-tools"]);
    const argumentHint =
      typeof parsed.data["argument-hint"] === "string" ? parsed.data["argument-hint"] : undefined;
    return {
      name,
      description,
      ...(allowedTools.length === 0 ? {} : { allowedTools }),
      ...(argumentHint === undefined ? {} : { argumentHint }),
      file,
      source,
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

export function discoverSkills(options: DiscoverSkillsOptions): SkillMetadata[] {
  const roots: Array<{ dir: string; source: "project" | "user" }> = [];
  if (options.trusted !== false) {
    roots.push({ dir: join(options.cwd, ".keycode", "skills"), source: "project" });
    roots.push({ dir: join(options.cwd, ".claude", "skills"), source: "project" });
  }
  for (const dir of options.extraDirs ?? []) roots.push({ dir, source: "user" });
  roots.push({ dir: join(options.home, "skills"), source: "user" });

  const byName = new Map<string, SkillMetadata>();
  for (const root of roots) {
    const files: string[] = [];
    walkSkillFiles(root.dir, files);
    for (const file of files) {
      const skill = readSkill(file, root.source);
      if (!skill) continue;
      if (byName.has(skill.name)) continue;
      const { body: _body, ...metadata } = skill;
      byName.set(skill.name, metadata);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkill(metadata: SkillMetadata): Skill {
  const skill = readSkill(metadata.file, metadata.source);
  return skill ?? { ...metadata, body: "" };
}

export function findSkill(skills: SkillMetadata[], name: string): SkillMetadata | undefined {
  return skills.find((skill) => skill.name === name);
}

export function renderSkill(skill: Skill, args: string): string {
  return skill.body.replaceAll("$ARGUMENTS", args.trim());
}
