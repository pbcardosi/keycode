import { createHash } from "node:crypto";
import { KeycodeError } from "../util/errors.js";

export type UpdateChannel = "stable" | "latest";

export interface ReleaseInfo {
  version: string;
  channel: UpdateChannel;
  url: string;
  sha256: string;
  notes?: string | undefined;
}

export interface UpdateCheck {
  updateAvailable: boolean;
  currentVersion: string;
  release: ReleaseInfo | null;
}

function versionParts(version: string): number[] {
  return version.replace(/^v/, "").split(".").map((part) => Number(part) || 0);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(current);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}

export async function checkForUpdate(options: {
  feedUrl: string;
  channel: UpdateChannel;
  currentVersion: string;
  fetchImpl?: typeof fetch | undefined;
}): Promise<UpdateCheck> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.feedUrl);
  if (!response.ok) {
    throw new KeycodeError("PROVIDER_UNAVAILABLE", `Update feed returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as { releases?: ReleaseInfo[] } | ReleaseInfo[];
  const releases = Array.isArray(body) ? body : (body.releases ?? []);
  const matching = releases.filter((release) => release.channel === options.channel);
  const best = matching.sort((left, right) => (isNewerVersion(left.version, right.version) ? -1 : 1))[0] ?? null;
  return {
    updateAvailable: best !== null && isNewerVersion(best.version, options.currentVersion),
    currentVersion: options.currentVersion,
    release: best,
  };
}

export function verifyChecksum(data: Uint8Array, expected: string): boolean {
  const actual = createHash("sha256").update(data).digest("hex");
  return actual === expected.trim().toLowerCase();
}

export interface ApplyUpdateOptions {
  release: ReleaseInfo;
  fetchImpl?: typeof fetch | undefined;
  write: (bytes: Uint8Array) => Promise<void> | void;
  restore: () => Promise<void> | void;
}

export interface ApplyUpdateResult {
  updated: boolean;
  rolledBack: boolean;
  error?: string | undefined;
}

export async function applyUpdate(options: ApplyUpdateOptions): Promise<ApplyUpdateResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.release.url);
  if (!response.ok) {
    await options.restore();
    return { updated: false, rolledBack: true, error: `download failed with HTTP ${response.status}` };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!verifyChecksum(bytes, options.release.sha256)) {
    await options.restore();
    return { updated: false, rolledBack: true, error: "checksum mismatch" };
  }
  try {
    await options.write(bytes);
    return { updated: true, rolledBack: false };
  } catch (error) {
    await options.restore();
    return { updated: false, rolledBack: true, error: (error as Error).message };
  }
}
