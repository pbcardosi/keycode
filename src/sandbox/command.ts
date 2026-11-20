import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { checkNetwork, checkWrite } from "./index.js";
import type { SandboxDecision, SandboxPolicy } from "./index.js";

const NETWORK_PATTERNS: RegExp[] = [
  /^(?:sudo\s+)?(?:curl|wget|ssh|scp|sftp|ftp|telnet|nc|netcat|ping|nslookup|dig|host)\b/,
  /^(?:Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer)\b/i,
  /^git\s+(?:clone|fetch|pull|push|ls-remote|submodule)\b/,
  /^(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add|publish|view|search|audit|update|upgrade)\b/,
  /^(?:pip3?|uv\s+pip)\s+install\b/,
  /^python3?\s+-m\s+pip\s+install\b/,
  /^cargo\s+(?:install|add|update|publish|fetch)\b/,
  /^go\s+(?:get|install)\b/,
  /^gem\s+install\b/,
  /^brew\s+(?:install|update|upgrade)\b/,
  /^apt(?:-get)?\s+(?:install|update|upgrade)\b/,
  /^docker\s+(?:pull|push|login)\b/,
  /^gh\s+\w+/,
];

const WRITE_ALL = new Set([
  "rm",
  "rmdir",
  "mkdir",
  "touch",
  "tee",
  "chmod",
  "chown",
  "set-content",
  "add-content",
  "out-file",
  "remove-item",
  "new-item",
  "copy-item",
  "move-item",
]);

const WRITE_LAST = new Set(["cp", "mv", "install", "ln", "rsync"]);

interface SandboxCommandResult extends SandboxDecision {
  reason?: string | undefined;
}

function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ";" || char === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    if ((char === "&" || char === "|") && command[index + 1] === char) {
      segments.push(current);
      current = "";
      index += 1;
      continue;
    }
    if (char === "|") {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

function splitArgs(segment: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  const flush = (): void => {
    if (current.length > 0) args.push(current);
    current = "";
  };
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index] ?? "";
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ">") {
      flush();
      if (segment[index + 1] === ">") {
        args.push(">>");
        index += 1;
      } else {
        args.push(">");
      }
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return args;
}

function commandPosition(args: string[]): number {
  let index = 0;
  while (index < args.length) {
    const token = (args[index] ?? "").toLowerCase();
    if (token === "sudo" || token === "command" || token === "time" || token === "nohup") {
      index += 1;
      continue;
    }
    if (token === "env") {
      index += 1;
      while (index < args.length && (args[index] ?? "").includes("=")) index += 1;
      continue;
    }
    break;
  }
  return index;
}

function writeTargets(args: string[], commandIndex: number): string[] {
  const targets: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if ((token === ">" || token === ">>") && args[index + 1] !== undefined) {
      targets.push(args[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (/^\d?>>?$/.test(token) && args[index + 1] !== undefined) {
      targets.push(args[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (/^of=/.test(token)) targets.push(token.slice(3));
  }

  const command = (args[commandIndex] ?? "").toLowerCase();
  const rest = args.slice(commandIndex + 1).filter((arg) => !arg.startsWith("-"));
  if (WRITE_ALL.has(command)) {
    for (let index = commandIndex + 1; index < args.length; index += 1) {
      const token = args[index] ?? "";
      if (token.startsWith("-")) continue;
      targets.push(token);
    }
  } else if (WRITE_LAST.has(command)) {
    const last = rest.at(-1);
    if (last !== undefined) targets.push(last);
  } else if (command === "git" && (args[commandIndex + 1] ?? "") === "clone") {
    const last = rest.at(-1);
    if (last !== undefined) targets.push(last);
  } else if (command === "dd") {
    for (const token of rest) if (token.startsWith("of=")) targets.push(token.slice(3));
  }
  return targets;
}

function unverifiablePath(target: string): boolean {
  return target.startsWith("~") || target.includes("$") || target.includes("%");
}

function extractHosts(command: string): string[] {
  const hosts: string[] = [];
  const pattern = /https?:\/\/([^\s/"'`?#]+)/gi;
  for (const match of command.matchAll(pattern)) {
    const host = match[1];
    if (host !== undefined) hosts.push(host.replace(/:\d+$/, ""));
  }
  return hosts;
}

function networkCommand(segment: string): boolean {
  const trimmed = segment.trim();
  return NETWORK_PATTERNS.some((pattern) => pattern.test(trimmed));
}

const DEVICE_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

export function checkCommand(
  policy: SandboxPolicy,
  command: string,
  cwd: string,
): SandboxCommandResult {
  for (const segment of splitSegments(command)) {
    const args = splitArgs(segment);
    const index = commandPosition(args);
    for (const target of writeTargets(args, index)) {
      const normalized = target.trim();
      if (normalized.length === 0 || DEVICE_TARGETS.has(normalized)) continue;
      if (unverifiablePath(normalized)) {
        return {
          allowed: false,
          reason: `Write target ${normalized} cannot be verified inside the sandbox roots`,
        };
      }
      const absolute = isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
      const decision = checkWrite(policy, absolute);
      if (!decision.allowed) return { allowed: false, reason: decision.reason };
    }

    if (!networkCommand(segment)) continue;
    if (policy.allowNetwork) continue;
    const hosts = extractHosts(segment);
    if (hosts.length > 0) {
      const blocked = hosts.find((host) => !checkNetwork(policy, host).allowed);
      if (blocked !== undefined) {
        return {
          allowed: false,
          reason: `Network access to ${blocked} is blocked by the sandbox`,
        };
      }
      continue;
    }
    return {
      allowed: false,
      reason: `Network command is blocked by the sandbox: ${segment.slice(0, 80)}`,
    };
  }
  return { allowed: true };
}

function escapeProfilePath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function seatbeltProfile(policy: SandboxPolicy): string {
  const writable = [...policy.roots, tmpdir()];
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${writable
      .map((root) => `(subpath "${escapeProfilePath(root)}")`)
      .join(" ")} (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty"))`,
  ];
  if (!policy.allowNetwork) lines.push("(deny network*)");
  return lines.join("\n");
}

export function bwrapArgs(
  policy: SandboxPolicy,
  command: string,
  cwd: string,
): string[] {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"];
  for (const root of policy.roots) args.push("--bind", root, root);
  if (!policy.allowNetwork) args.push("--unshare-net");
  args.push("--chdir", cwd, "--", "/bin/sh", "-c", command);
  return args;
}

export interface SandboxWrapper {
  kind: "seatbelt" | "bwrap";
  command: string;
  args: string[];
}

export function detectWrapper(
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): SandboxWrapper | null {
  if (platform === "darwin" && exists("/usr/bin/sandbox-exec")) {
    return { kind: "seatbelt", command: "/usr/bin/sandbox-exec", args: [] };
  }
  if (platform === "linux") {
    for (const candidate of ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"]) {
      if (exists(candidate)) return { kind: "bwrap", command: candidate, args: [] };
    }
  }
  return null;
}

export function sandboxSpawn(
  policy: SandboxPolicy,
  command: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; shell: boolean; wrapper: SandboxWrapper | null } {
  const wrapper = detectWrapper(platform);
  if (wrapper?.kind === "seatbelt") {
    return {
      command: wrapper.command,
      args: ["-p", seatbeltProfile(policy), "/bin/sh", "-c", command],
      shell: false,
      wrapper,
    };
  }
  if (wrapper?.kind === "bwrap") {
    return {
      command: wrapper.command,
      args: bwrapArgs(policy, command, cwd),
      shell: false,
      wrapper,
    };
  }
  return { command, args: [], shell: true, wrapper: null };
}
