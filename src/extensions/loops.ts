import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite, ensureDir } from "../util/fsx.js";
import { newId } from "../util/ids.js";

export interface LoopJob {
  id: string;
  cron: string;
  command: string;
  timezone?: string | undefined;
  createdAt: string;
  lastRun?: string | undefined;
  running?: boolean | undefined;
}

interface LoopFile {
  version: 1;
  jobs: LoopJob[];
}

export interface LoopOptions {
  cron: string;
  command: string;
  timezone?: string | undefined;
}

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    return step > 0 && value % step === 0;
  }
  return field.split(",").some((part) => {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return value >= (start ?? 0) && value <= (end ?? 0);
    }
    return Number(part) === value;
  });
}

export function matchesCron(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return (
    fieldMatches(fields[0] ?? "*", date.getMinutes()) &&
    fieldMatches(fields[1] ?? "*", date.getHours()) &&
    fieldMatches(fields[2] ?? "*", date.getDate()) &&
    fieldMatches(fields[3] ?? "*", date.getMonth() + 1) &&
    fieldMatches(fields[4] ?? "*", date.getDay())
  );
}

function minuteKey(iso: string): string {
  return iso.slice(0, 16);
}

export class LoopManager {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  private read(): LoopFile {
    if (!existsSync(this.file)) return { version: 1, jobs: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<LoopFile>;
      return { version: 1, jobs: parsed.jobs ?? [] };
    } catch {
      return { version: 1, jobs: [] };
    }
  }

  private write(data: LoopFile): void {
    ensureDir(join(this.file, ".."));
    atomicWrite(this.file, `${JSON.stringify(data, null, 2)}\n`);
  }

  list(): LoopJob[] {
    return this.read().jobs;
  }

  add(options: LoopOptions): LoopJob {
    const data = this.read();
    const job: LoopJob = {
      id: newId("loop"),
      cron: options.cron,
      command: options.command,
      ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
      createdAt: new Date().toISOString(),
    };
    data.jobs.push(job);
    this.write(data);
    return job;
  }

  remove(id: string): boolean {
    const data = this.read();
    const next = data.jobs.filter((job) => job.id !== id);
    if (next.length === data.jobs.length) return false;
    data.jobs = next;
    this.write(data);
    return true;
  }

  due(date: Date): LoopJob[] {
    return this.read().jobs.filter((job) => {
      if (job.running === true) return false;
      if (!matchesCron(job.cron, date)) return false;
      if (job.lastRun !== undefined && minuteKey(job.lastRun) === minuteKey(date.toISOString())) return false;
      return true;
    });
  }

  markRunning(id: string, running: boolean): void {
    const data = this.read();
    const job = data.jobs.find((entry) => entry.id === id);
    if (job) {
      job.running = running;
      this.write(data);
    }
  }

  async runDue(date: Date, runner: (job: LoopJob) => Promise<void>): Promise<number> {
    const jobs = this.due(date);
    let ran = 0;
    for (const job of jobs) {
      this.markRunning(job.id, true);
      try {
        await runner(job);
        ran += 1;
      } finally {
        const data = this.read();
        const current = data.jobs.find((entry) => entry.id === job.id);
        if (current) {
          current.running = false;
          current.lastRun = date.toISOString();
          this.write(data);
        }
      }
    }
    return ran;
  }
}
