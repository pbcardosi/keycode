import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { atomicWrite, ensureDir } from "../util/fsx.js";

interface TrustStore {
  version: 2;
  trusted: string[];
  approved: Record<string, string>;
}

function trustPath(home: string): string {
  return join(home, "trust.json");
}

function readStore(home: string): TrustStore {
  const path = trustPath(home);
  if (!existsSync(path)) return { version: 2, trusted: [], approved: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as {
      trusted?: unknown;
      approved?: unknown;
    };
    const trusted = Array.isArray(parsed.trusted)
      ? parsed.trusted.filter((value): value is string => typeof value === "string")
      : [];
    const approved: Record<string, string> = {};
    if (parsed.approved !== null && typeof parsed.approved === "object") {
      for (const [key, value] of Object.entries(parsed.approved as Record<string, unknown>)) {
        if (typeof value === "string") approved[key] = value;
      }
    }
    return { version: 2, trusted, approved };
  } catch {
    return { version: 2, trusted: [], approved: {} };
  }
}

function writeStore(home: string, store: TrustStore): void {
  ensureDir(home);
  atomicWrite(trustPath(home), `${JSON.stringify(store, null, 2)}\n`);
}

export type TrustStatus = "trusted" | "changed" | "untrusted";

export function trustStatus(home: string, cwd: string, fingerprint: string): TrustStatus {
  const key = resolve(cwd);
  const store = readStore(home);
  const approved = store.approved[key];
  if (approved !== undefined) return approved === fingerprint ? "trusted" : "changed";
  if (store.trusted.some((entry) => resolve(entry) === key)) {
    store.approved[key] = fingerprint;
    writeStore(home, store);
    return "trusted";
  }
  return "untrusted";
}

export function isTrusted(home: string, cwd: string, fingerprint?: string): boolean {
  if (fingerprint !== undefined) return trustStatus(home, cwd, fingerprint) === "trusted";
  const key = resolve(cwd);
  return readStore(home).trusted.some((entry) => resolve(entry) === key);
}

export function trustWorkspace(home: string, cwd: string, fingerprint?: string): void {
  const key = resolve(cwd);
  const store = readStore(home);
  if (!store.trusted.some((entry) => resolve(entry) === key)) {
    store.trusted.push(key);
  }
  if (fingerprint !== undefined) store.approved[key] = fingerprint;
  writeStore(home, store);
}

export function untrustWorkspace(home: string, cwd: string): void {
  const key = resolve(cwd);
  const store = readStore(home);
  const next = store.trusted.filter((entry) => resolve(entry) !== key);
  if (next.length !== store.trusted.length || store.approved[key] !== undefined) {
    delete store.approved[key];
    writeStore(home, { ...store, trusted: next });
  }
}

export function trustedWorkspaces(home: string): string[] {
  return readStore(home).trusted;
}
