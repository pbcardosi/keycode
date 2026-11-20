import { isAbsolute, relative, resolve } from "node:path";
import type { PermissionRequest } from "../contracts/tool.js";
import type { PermissionRule, RuleScope } from "../contracts/permissions.js";
import { normalizeSlashes } from "../util/paths.js";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function globToRegex(pattern: string, pathMode = false): RegExp {
  let output = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          output += "(?:.*/)?";
        } else {
          output += ".*";
        }
      } else {
        output += pathMode ? "[^/]*" : ".*";
      }
    } else if (char === "?") {
      output += pathMode ? "[^/]" : ".";
    } else if (char === "/" && pathMode) {
      output += "[/\\\\]";
    } else {
      output += escapeRegex(char ?? "");
    }
  }
  output += "$";
  return new RegExp(output);
}

export function parseRule(
  raw: string,
  scope: RuleScope,
  behavior: "allow" | "deny" | "ask",
): PermissionRule {
  const trimmed = raw.trim();
  const match = /^([A-Za-z][A-Za-z0-9_]*)\((.*)\)$/.exec(trimmed);
  if (match && match[1] !== undefined) {
    return { raw: trimmed, tool: match[1], pattern: match[2], scope, behavior };
  }
  return { raw: trimmed, tool: trimmed, scope, behavior };
}

function canonical(path: string, cwd: string): string {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  return normalizeSlashes(absolute).toLowerCase();
}

function pathMatches(pattern: string, candidate: string, cwd: string): boolean {
  let normalized = pattern.trim().replaceAll("\\", "/");
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  const absolutePattern =
    normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
      ? normalized
      : normalizeSlashes(resolve(cwd, normalized));
  const target = canonical(candidate, cwd);
  const patternLower = absolutePattern.toLowerCase();

  if (!patternLower.includes("*") && !patternLower.includes("?")) {
    return target === patternLower || target.startsWith(`${patternLower}/`);
  }
  return globToRegex(patternLower, true).test(target);
}

function commandMatches(
  pattern: string,
  command: string,
  behavior: "allow" | "deny" | "ask",
): boolean {
  const trimmed = command.trim();
  const raw = pattern.trim();

  // An allow rule must not silently extend to a compound shell command:
  // "git status" must not allow "git status; rm -rf .".
  if (behavior === "allow" && hasUnquotedChain(trimmed) && !hasUnquotedChain(raw)) {
    return false;
  }

  if (raw.endsWith(":*")) {
    const prefix = raw.slice(0, -2).trim();
    return trimmed === prefix || trimmed.startsWith(`${prefix} `);
  }
  if (!raw.includes("*") && !raw.includes("?")) {
    return trimmed === raw;
  }
  return globToRegex(raw, false).test(trimmed);
}

function hasUnquotedChain(command: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "`" || char === ";" || char === "|" || char === "&" || char === "\n") {
      return true;
    }
    if (char === "$" && command[index + 1] === "(") return true;
  }
  return false;
}

function inputPath(input: unknown, cwd: string): string {
  if (input !== null && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of ["file_path", "path", "notebook_path", "cwd"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return isAbsolute(value) ? value : resolve(cwd, value);
      }
    }
  }
  return cwd;
}

function inputCommand(input: unknown): string {
  if (input !== null && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (typeof record.command === "string") return record.command;
  }
  return "";
}

function domainMatches(pattern: string, url: string): boolean {
  const domain = pattern.startsWith("domain:") ? pattern.slice("domain:".length) : pattern;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const expected = domain.toLowerCase();
    return host === expected || host.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

export function matchRule(rule: PermissionRule, request: PermissionRequest): boolean {
  if (rule.tool !== request.tool && rule.tool !== "*") return false;
  if (rule.pattern === undefined || rule.pattern === "" || rule.pattern === "*") return true;

  if (rule.tool === "Bash" || rule.tool === "PowerShell") {
    return commandMatches(rule.pattern, inputCommand(request.input), rule.behavior);
  }
  if (rule.tool === "WebFetch" || rule.tool === "WebSearch") {
    const input = request.input;
    const url = input !== null && typeof input === "object" ? (input as Record<string, unknown>).url : undefined;
    if (typeof url === "string") return domainMatches(rule.pattern, url);
    return true;
  }
  if (rule.tool.startsWith("mcp__")) {
    return rule.pattern === request.tool;
  }
  return pathMatches(rule.pattern, inputPath(request.input, request.cwd), request.cwd);
}

export function resolveRulePattern(rule: PermissionRule, cwd: string): string | undefined {
  if (rule.pattern === undefined) return undefined;
  if (rule.tool === "Bash" || rule.tool === "PowerShell" || rule.tool.startsWith("mcp__")) {
    return rule.pattern;
  }
  if (rule.pattern.startsWith("domain:")) return rule.pattern;
  const path = rule.pattern.replaceAll("\\", "/");
  return isAbsolute(path) ? path : normalizeSlashes(resolve(cwd, path));
}

export function isPathInsideRoots(path: string, roots: string[]): boolean {
  const target = canonical(path, roots[0] ?? process.cwd());
  return roots.some((root) => {
    const base = canonical(root, roots[0] ?? process.cwd());
    const rel = relative(base, target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}
