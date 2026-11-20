import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PermissionDecision, PermissionRequest } from "../contracts/tool.js";
import { ensureDir } from "../util/fsx.js";
import { redactDeep } from "../util/redact.js";
import { logsDir } from "../util/paths.js";

export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  tool: string;
  decision: PermissionDecision["behavior"];
  rule: string | null;
  source: string | null;
  reason: string;
  input: unknown;
  durationMs: number | null;
  outcome: string | null;
}

export const AUDIT_ROTATE_BYTES = 1_000_000;

export class AuditLog {
  private readonly path: string;
  private readonly maxBytes: number;

  constructor(home: string, options: { maxBytes?: number } = {}) {
    this.path = join(logsDir(home), "audit.jsonl");
    this.maxBytes = options.maxBytes ?? AUDIT_ROTATE_BYTES;
  }

  get file(): string {
    return this.path;
  }

  append(entry: AuditEntry): void {
    const dir = join(this.path, "..");
    ensureDir(dir);
    if (existsSync(this.path) && statSync(this.path).size >= this.maxBytes) {
      renameSync(this.path, `${this.path}.1`);
    }
    appendFileSync(this.path, `${JSON.stringify(redactDeep(entry))}\n`);
  }

  record(
    sessionId: string,
    request: PermissionRequest,
    decision: PermissionDecision,
    durationMs: number | null = null,
    outcome: string | null = null,
  ): void {
    this.append({
      timestamp: new Date().toISOString(),
      sessionId,
      tool: request.tool,
      decision: decision.behavior,
      rule: decision.rule ?? null,
      source: decision.source ?? null,
      reason: decision.reason,
      input: request.input,
      durationMs,
      outcome,
    });
  }

  read(limit = 100): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is AuditEntry => entry !== null);
  }
}
