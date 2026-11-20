import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { atomicWrite, ensureDir } from "../util/fsx.js";

interface TrustStore {
  version: 1;
  trusted: string[];
}

function trustPath(home: string): string {
  return join(home, "trust.json");
}

function readStore(home: string): TrustStore {
  const path = trustPath(home);
  if (!existsSync(path)) return { version: 1, trusted: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TrustStore>;
    const trusted = Array.isArray(parsed.trusted)
      ? parsed.trusted.filter((value): value is string => typeof value === "string")
      : [];
    return { version: 1, trusted };
  } catch {
    return { version: 1, trusted: [] };
  }
}

function writeStore(home: string, store: TrustStore): void {
  ensureDir(home);
  atomicWrite(trustPath(home), `${JSON.stringify(store, null, 2)}\n`);
}

export function isTrusted(home: string, cwd: string): boolean {
  const key = resolve(cwd);
  return readStore(home).trusted.some((entry) => resolve(entry) === key);
}

export function trustWorkspace(home: string, cwd: string): void {
  const key = resolve(cwd);
  const store = readStore(home);
  if (!store.trusted.some((entry) => resolve(entry) === key)) {
    store.trusted.push(key);
    writeStore(home, store);
  }
}

export function untrustWorkspace(home: string, cwd: string): void {
  const key = resolve(cwd);
  const store = readStore(home);
  const next = store.trusted.filter((entry) => resolve(entry) !== key);
  if (next.length !== store.trusted.length) writeStore(home, { version: 1, trusted: next });
}

export function trustedWorkspaces(home: string): string[] {
  return readStore(home).trusted;
}
