import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "../util/fsx.js";
import { newId } from "../util/ids.js";

export type BackgroundStatus = "running" | "stopped" | "crashed";

export interface BackgroundSessionRecord {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number | null;
  startedAt: string;
  status: BackgroundStatus;
  log: string;
}

export interface StartBackgroundOptions {
  name?: string | undefined;
  command: string;
  args?: string[] | undefined;
  cwd: string;
  env?: Record<string, string> | undefined;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

const RUNNER_SOURCE = [
  'import { spawn } from "node:child_process";',
  'import { openSync, closeSync } from "node:fs";',
  "const [log, command, ...args] = process.argv.slice(2);",
  'const fd = openSync(log, "a");',
  'const child = spawn(command, args, { stdio: ["ignore", fd, fd], windowsHide: true, env: process.env });',
  "closeSync(fd);",
  "child.on(\"exit\", (code) => process.exit(code ?? 0));",
  "child.on(\"error\", () => process.exit(1));",
].join("\n");

export function isProcessAlive(pid: number): boolean {
  return processAlive(pid);
}

export class BackgroundSessions {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    ensureDir(dir);
    writeFileSync(join(dir, "runner.mjs"), RUNNER_SOURCE);
  }

  private recordPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private read(id: string): BackgroundSessionRecord | null {
    const path = this.recordPath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as BackgroundSessionRecord;
    } catch {
      return null;
    }
  }

  private write(record: BackgroundSessionRecord): void {
    ensureDir(this.dir);
    writeFileSync(this.recordPath(record.id), JSON.stringify(record, null, 2));
  }

  private refresh(record: BackgroundSessionRecord): BackgroundSessionRecord {
    if (record.status === "running" && record.pid !== null && !processAlive(record.pid)) {
      record.status = "crashed";
      this.write(record);
    }
    return record;
  }

  list(): BackgroundSessionRecord[] {
    return readdirSync(this.dir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => this.read(entry.replace(/\.json$/, "")))
      .filter((record): record is BackgroundSessionRecord => record !== null)
      .map((record) => this.refresh(record));
  }

  start(options: StartBackgroundOptions): BackgroundSessionRecord {
    const id = newId("bg");
    const log = join(this.dir, `${id}.log`);
    const child = spawn(
      process.execPath,
      [join(this.dir, "runner.mjs"), log, options.command, ...(options.args ?? [])],
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        windowsHide: true,
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();
    const record: BackgroundSessionRecord = {
      id,
      name: options.name ?? id.slice(0, 8),
      command: options.command,
      args: options.args ?? [],
      cwd: options.cwd,
      pid: child.pid ?? null,
      startedAt: new Date().toISOString(),
      status: "running",
      log,
    };
    this.write(record);
    return record;
  }

  attach(id: string): BackgroundSessionRecord {
    const record = this.read(id);
    if (!record) throw new Error(`Background session not found: ${id}`);
    return this.refresh(record);
  }

  logs(id: string, limit = 10_000): string {
    const record = this.read(id);
    if (!record) throw new Error(`Background session not found: ${id}`);
    try {
      return readFileSync(record.log, "utf8").slice(-limit);
    } catch {
      return "";
    }
  }

  stop(id: string): BackgroundSessionRecord {
    const record = this.read(id);
    if (!record) throw new Error(`Background session not found: ${id}`);
    if (record.pid !== null && processAlive(record.pid)) {
      killTree(record.pid);
    }
    record.status = "stopped";
    this.write(record);
    return record;
  }

  remove(id: string): boolean {
    const record = this.read(id);
    if (!record) return false;
    this.stop(id);
    try {
      rmSync(record.log, { force: true });
    } catch {
      // Ignore.
    }
    rmSync(this.recordPath(id), { force: true });
    return true;
  }

  respawn(id: string): BackgroundSessionRecord {
    const record = this.read(id);
    if (!record) throw new Error(`Background session not found: ${id}`);
    if (record.status === "running" && record.pid !== null && processAlive(record.pid)) {
      return record;
    }
    return this.start({
      name: record.name,
      command: record.command,
      args: record.args,
      cwd: record.cwd,
    });
  }
}
