import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fingerprint } from "../util/ids.js";
import { atomicWrite } from "../util/fsx.js";

export interface CredentialResult {
  key: string | null;
  source: "env" | "config" | "keychain" | "helper" | null;
}

interface StoredCredentials {
  version: 1;
  providers: Record<string, string>;
}

interface HelperCacheEntry {
  key: string;
  expiresAt: number;
}

const helperCache = new Map<string, HelperCacheEntry>();

function credentialsPath(home: string): string {
  return join(home, "credentials.json");
}

function readStore(home: string): StoredCredentials {
  const path = credentialsPath(home);
  if (!existsSync(path)) return { version: 1, providers: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredCredentials>;
    return { version: 1, providers: parsed.providers ?? {} };
  } catch {
    return { version: 1, providers: {} };
  }
}

export interface ResolveCredentialOptions {
  providerId: string;
  apiKeyEnv?: string | null | undefined;
  apiKey?: string | undefined;
  apiKeyHelper?: string | undefined;
  helperTtlMs?: number | undefined;
  home: string;
  env?: NodeJS.ProcessEnv | undefined;
}

export function resolveCredential(options: ResolveCredentialOptions): CredentialResult {
  const env = options.env ?? process.env;

  if (options.apiKey && options.apiKey.length > 0) {
    return { key: options.apiKey, source: "config" };
  }

  if (options.apiKeyEnv) {
    const fromEnv = env[options.apiKeyEnv];
    if (fromEnv && fromEnv.length > 0) return { key: fromEnv, source: "env" };
  }

  const stored = readStore(options.home).providers[options.providerId];
  if (stored && stored.length > 0) return { key: stored, source: "keychain" };

  if (options.apiKeyHelper) {
    const cached = helperCache.get(options.providerId);
    if (cached && cached.expiresAt > Date.now()) {
      return { key: cached.key, source: "helper" };
    }
    try {
      const output = execFileSync(options.apiKeyHelper, {
        shell: true,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...env },
      }).trim();
      if (output.length > 0) {
        const ttl = options.helperTtlMs ?? 5 * 60_000;
        helperCache.set(options.providerId, { key: output, expiresAt: Date.now() + ttl });
        return { key: output, source: "helper" };
      }
    } catch {
      return { key: null, source: null };
    }
  }

  return { key: null, source: null };
}

export function setStoredCredential(home: string, providerId: string, key: string): void {
  const store = readStore(home);
  store.providers[providerId] = key;
  atomicWrite(credentialsPath(home), `${JSON.stringify(store, null, 2)}\n`);
}

export function removeStoredCredential(home: string, providerId: string): boolean {
  const store = readStore(home);
  if (!(providerId in store.providers)) return false;
  delete store.providers[providerId];
  atomicWrite(credentialsPath(home), `${JSON.stringify(store, null, 2)}\n`);
  return true;
}

export function credentialStatus(
  home: string,
  providerId: string,
): { configured: boolean; fingerprint: string | null } {
  const stored = readStore(home).providers[providerId];
  if (!stored) return { configured: false, fingerprint: null };
  return { configured: true, fingerprint: fingerprint(stored) };
}

export function resetHelperCache(): void {
  helperCache.clear();
}
