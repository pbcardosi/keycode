import { lstatSync, readdirSync, readFileSync, realpathSync, type Dirent } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { normalizeSlashes } from "../util/paths.js";
import { globToRegex } from "../permissions/rules.js";

export interface WalkOptions {
  cwd: string;
  noIgnore?: boolean | undefined;
  maxEntries?: number | undefined;
  includeDirectories?: boolean | undefined;
}

export interface WalkedFile {
  path: string;
  relative: string;
  mtimeMs: number;
  size: number;
}

interface IgnorePattern {
  regex: RegExp;
  negate: boolean;
  directoryOnly: boolean;
  base: string;
}

function loadIgnoreFile(dir: string, cwd: string): IgnorePattern[] {
  const ignorePath = join(dir, ".ignore");
  const gitPath = join(dir, ".gitignore");
  const path = exists(ignorePath) ? ignorePath : exists(gitPath) ? gitPath : null;
  if (!path) return [];
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const patterns: IgnorePattern[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    }
    let directoryOnly = false;
    if (line.endsWith("/")) {
      directoryOnly = true;
      line = line.slice(0, -1);
    }
    if (line.startsWith("/")) line = line.slice(1);
    if (line === "") continue;
    const base = normalizeSlashes(relative(cwd, dir));
    patterns.push({
      regex: globToRegex(line, true),
      negate,
      directoryOnly,
      base: base === "." ? "" : base,
    });
  }
  return patterns;
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isIgnored(relativePath: string, isDirectory: boolean, patterns: IgnorePattern[]): boolean {
  let ignored = false;
  const normalized = normalizeSlashes(relativePath).toLowerCase();
  for (const pattern of patterns) {
    if (pattern.directoryOnly && !isDirectory) continue;
    const candidate =
      pattern.base.length > 0 ? normalized.slice(pattern.base.length + 1) : normalized;
    if (pattern.regex.test(candidate)) {
      ignored = !pattern.negate;
    }
  }
  return ignored;
}

export function walkFiles(options: WalkOptions): WalkedFile[] {
  const cwd = resolve(options.cwd);
  const maxEntries = options.maxEntries ?? 20_000;
  const results: WalkedFile[] = [];
  const seenReal = new Set<string>();
  const rootIgnore = options.noIgnore === true ? [] : loadIgnoreFile(cwd, cwd);
  const patternsByDir = new Map<string, IgnorePattern[]>([[cwd, rootIgnore]]);

  const visit = (dir: string, depth: number): void => {
    if (results.length >= maxEntries || depth > 40) return;
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }
    if (seenReal.has(real)) return;
    seenReal.add(real);

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const patterns = patternsByDir.get(dir) ?? rootIgnore;
    for (const entry of entries) {
      if (results.length >= maxEntries) return;
      const entryPath = join(dir, entry.name);
      const rel = normalizeSlashes(relative(cwd, entryPath));
      const isDirectory = entry.isDirectory();
      if (entry.name === ".git") continue;
      if (!options.noIgnore && isIgnored(rel, isDirectory, patterns)) continue;
      if (!options.noIgnore && entry.name === "node_modules") continue;
      if (entry.isSymbolicLink()) continue;

      if (isDirectory) {
        if (options.includeDirectories) {
          results.push({ path: entryPath, relative: rel, mtimeMs: 0, size: 0 });
        }
        if (!options.noIgnore) {
          const nested = [...patterns, ...loadIgnoreFile(entryPath, cwd)];
          patternsByDir.set(entryPath, nested);
        }
        visit(entryPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      try {
        const stat = lstatSync(entryPath);
        results.push({ path: entryPath, relative: rel, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        continue;
      }
    }
  };

  visit(cwd, 0);
  return results;
}

export function matchGlob(pattern: string, relativePath: string): boolean {
  const normalized = normalizeSlashes(relativePath).replace(/^\.\//, "");
  const cleaned = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  return globToRegex(cleaned, true).test(normalized);
}

export function toAbsolutePath(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}
