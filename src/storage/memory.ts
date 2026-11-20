import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { estimateTokens } from "../util/text.js";

export interface MemoryOptions {
  cwd: string;
  home: string;
  noMemory?: boolean | undefined;
  maxFileBytes?: number | undefined;
  maxTotalBytes?: number | undefined;
}

export interface MemoryResult {
  text: string;
  files: string[];
  warnings: string[];
  tokens: number;
}

const IMPORT_PATTERN = /^@(.+?)\s*$/;

function readLimited(path: string, maxBytes: number, warnings: string[]): string | null {
  try {
    const content = readFileSync(path, "utf8");
    if (Buffer.byteLength(content) <= maxBytes) return content;
    warnings.push(`${path} exceeds ${maxBytes} bytes and was truncated.`);
    return content.slice(0, maxBytes);
  } catch (error) {
    warnings.push(`Cannot read ${path}: ${(error as Error).message}`);
    return null;
  }
}

export function resolveImports(
  content: string,
  baseDir: string,
  options: {
    maxFileBytes: number;
    depth?: number | undefined;
    stack?: string[] | undefined;
    files?: string[] | undefined;
    warnings?: string[] | undefined;
  },
): string {
  const depth = options.depth ?? 0;
  const stack = options.stack ?? [];
  const files = options.files ?? [];
  const warnings = options.warnings ?? [];
  if (depth > 5) {
    warnings.push(`Import depth limit reached in ${baseDir}`);
    return content;
  }

  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let fenced = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      output.push(line);
      continue;
    }
    if (fenced) {
      output.push(line);
      continue;
    }
    const match = IMPORT_PATTERN.exec(line.trim());
    if (!match || match[1] === undefined) {
      output.push(line);
      continue;
    }
    const importPath = match[1].replace(/^["']|["']$/g, "");
    const resolved = resolve(baseDir, importPath);
    if (stack.includes(resolved)) {
      warnings.push(`Import cycle detected: ${resolved}`);
      output.push(`<!-- import cycle: ${importPath} -->`);
      continue;
    }
    if (!existsSync(resolved)) {
      warnings.push(`Import not found: ${importPath} (from ${baseDir})`);
      output.push(`<!-- missing import: ${importPath} -->`);
      continue;
    }
    const imported = readLimited(resolved, options.maxFileBytes, warnings);
    if (imported === null) continue;
    files.push(resolved);
    output.push(
      resolveImports(imported.trimEnd(), dirname(resolved), {
        ...options,
        depth: depth + 1,
        stack: [...stack, resolved],
        files,
        warnings,
      }),
    );
  }
  return output.join("\n");
}

function parentFiles(cwd: string): string[] {
  const chain: string[] = [];
  let current = resolve(cwd);
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const candidate = join(current, "CLAUDE.md");
    if (existsSync(candidate)) chain.unshift(candidate);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain;
}

export function loadMemory(options: MemoryOptions): MemoryResult {
  if (options.noMemory === true) return { text: "", files: [], warnings: [], tokens: 0 };
  const maxFileBytes = options.maxFileBytes ?? 32 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 100 * 1024;
  const warnings: string[] = [];
  const files: string[] = [];
  const sections: string[] = [];

  const userFiles = [join(options.home, "CLAUDE.md"), join(options.home, ".keycode", "CLAUDE.md")];
  const userFile = userFiles.find((path) => existsSync(path));
  if (userFile) files.push(userFile);

  const projectFiles = parentFiles(options.cwd);
  const localFiles = [
    join(options.cwd, "CLAUDE.local.md"),
    join(options.cwd, ".claude", "CLAUDE.local.md"),
  ];
  const localFile = localFiles.find((path) => existsSync(path));
  if (localFile) projectFiles.push(localFile);

  const seen = new Set<string>();
  for (const file of [...(userFile ? [userFile] : []), ...projectFiles]) {
    let real: string;
    try {
      real = realpathSync(file);
    } catch {
      real = file;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    const content = readLimited(file, maxFileBytes, warnings);
    if (content === null) continue;
    const expanded = resolveImports(content.trimEnd(), dirname(file), {
      maxFileBytes,
      stack: [file],
      files,
      warnings,
    });
    sections.push(expanded);
  }

  let text = sections.join("\n\n").trim();
  if (Buffer.byteLength(text) > maxTotalBytes) {
    text = text.slice(0, maxTotalBytes);
    warnings.push(`Combined memory exceeds ${maxTotalBytes} bytes and was truncated.`);
  }

  return { text, files: [...new Set(files)], warnings, tokens: estimateTokens(text) };
}
