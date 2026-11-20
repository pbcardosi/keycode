import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite, ensureDir } from "../util/fsx.js";

export interface PrivacyState {
  consent: "granted" | "denied" | "unset";
  telemetry: boolean;
}

export interface TelemetryEvent {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

const DEFAULT_STATE: PrivacyState = { consent: "unset", telemetry: false };

export function privacyPath(home: string): string {
  return join(home, "privacy.json");
}

export function loadPrivacy(home: string): PrivacyState {
  if (!existsSync(privacyPath(home))) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(readFileSync(privacyPath(home), "utf8")) as Partial<PrivacyState>;
    return {
      consent:
        parsed.consent === "granted" || parsed.consent === "denied" ? parsed.consent : "unset",
      telemetry: parsed.telemetry === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function savePrivacy(home: string, state: PrivacyState): void {
  ensureDir(home);
  atomicWrite(privacyPath(home), `${JSON.stringify(state, null, 2)}\n`);
}

export function telemetryEnabled(home: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.KEYCODE_TELEMETRY === "0" || env.DO_NOT_TRACK === "1") return false;
  const state = loadPrivacy(home);
  return state.consent === "granted" && state.telemetry;
}

export class TelemetryRecorder {
  private readonly enabled: boolean;
  private readonly events: TelemetryEvent[] = [];

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  record(event: Omit<TelemetryEvent, "timestamp">): void {
    if (!this.enabled) return;
    this.events.push({ ...event, type: event.type, timestamp: new Date().toISOString() });
  }

  get recorded(): TelemetryEvent[] {
    return [...this.events];
  }
}

function readJsonl(path: string): unknown[] {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    return [];
  }
}

export function exportData(home: string): string {
  const sessions: Array<{ file: string; records: unknown[] }> = [];
  const projectsDir = join(home, "projects");
  if (existsSync(projectsDir)) {
    for (const project of readdirSync(projectsDir)) {
      const sessionDir = join(projectsDir, project, "sessions");
      if (!existsSync(sessionDir)) continue;
      for (const file of readdirSync(sessionDir)) {
        if (file.endsWith(".jsonl")) {
          sessions.push({ file: join(sessionDir, file), records: readJsonl(join(sessionDir, file)) });
        }
      }
    }
  }
  let settings: unknown = null;
  try {
    settings = JSON.parse(readFileSync(join(home, "settings.json"), "utf8"));
  } catch {
    settings = null;
  }
  return `${JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      privacy: loadPrivacy(home),
      settings,
      sessions,
    },
    null,
    2,
  )}\n`;
}

export function deleteData(home: string): { removed: string[] } {
  const removed: string[] = [];
  for (const entry of ["projects", "logs", "tool-output", "tasks"]) {
    const path = join(home, entry);
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    }
  }
  return { removed };
}
