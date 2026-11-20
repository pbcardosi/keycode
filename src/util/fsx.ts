import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function atomicWrite(path: string, content: string | Uint8Array): void {
  ensureDir(dirname(path));
  const temp = join(
    dirname(path),
    `.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    writeFileSync(temp, content);
    renameSync(temp, path);
  } catch (error) {
    try {
      if (existsSync(temp)) renameSync(temp, `${temp}.failed`);
    } catch {
      // Best-effort cleanup; surface the original error.
    }
    throw error;
  }
}

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
