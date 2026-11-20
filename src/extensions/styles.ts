import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

export interface OutputStyle {
  name: string;
  description: string;
  body: string;
  source: "builtin" | "project" | "user";
}

export const BUILTIN_STYLES: OutputStyle[] = [
  { name: "default", description: "Balanced responses", body: "", source: "builtin" },
  {
    name: "concise",
    description: "Short answers with minimal prose",
    body: "Be concise. Prefer short paragraphs, bullet lists, and code blocks. Skip preamble.",
    source: "builtin",
  },
  {
    name: "explanatory",
    description: "Explain reasoning and tradeoffs",
    body: "Explain your reasoning and the tradeoffs behind each decision. Include short verification notes.",
    source: "builtin",
  },
];

export interface DiscoverStylesOptions {
  cwd: string;
  home: string;
  trusted?: boolean | undefined;
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

export function discoverStyles(options: DiscoverStylesOptions): OutputStyle[] {
  const roots: Array<{ dir: string; source: "project" | "user" }> = [];
  if (options.trusted !== false) {
    roots.push({ dir: join(options.cwd, ".keycode", "output-styles"), source: "project" });
    roots.push({ dir: join(options.cwd, ".claude", "output-styles"), source: "project" });
  }
  roots.push({ dir: join(options.home, ".keycode", "output-styles"), source: "user" });

  const byName = new Map<string, OutputStyle>();
  for (const style of BUILTIN_STYLES) byName.set(style.name, style);
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
      const fallback = file.replaceAll("\\", "/").split("/").pop()?.replace(/\.md$/, "") ?? "custom";
      const name = typeof parsed.data.name === "string" ? parsed.data.name : fallback;
      if (byName.has(name) && byName.get(name)?.source !== "builtin") continue;
      const description = typeof parsed.data.description === "string" ? parsed.data.description : "";
      byName.set(name, { name, description, body: parsed.body.trim(), source: root.source });
    }
  }
  return [...byName.values()];
}

export function findStyle(styles: OutputStyle[], name: string): OutputStyle | undefined {
  return styles.find((style) => style.name === name);
}
