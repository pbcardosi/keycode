import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";
import { ensureDir } from "../util/fsx.js";
import { newId } from "../util/ids.js";
import { tasksDir } from "../util/paths.js";

export const TaskInput = z.object({
  action: z.enum(["create", "get", "list", "update", "stop", "output"]),
  command: z.string().optional(),
  task_id: z.string().optional(),
  status: z.enum(["running", "stopped", "completed", "failed"]).optional(),
  note: z.string().optional(),
  limit: z.number().int().positive().max(100_000).optional(),
  cwd: z.string().optional(),
});

export type TaskInputType = z.infer<typeof TaskInput>;

export interface TaskRecord {
  id: string;
  command: string;
  cwd: string;
  pid: number | null;
  startedAt: string;
  status: "running" | "stopped" | "completed" | "failed";
  log: string;
  note?: string | undefined;
}

function recordPath(home: string, id: string): string {
  return join(tasksDir(home), `${id}.json`);
}

function readRecord(home: string, id: string): TaskRecord | null {
  const path = recordPath(home, id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TaskRecord;
  } catch {
    return null;
  }
}

function writeRecord(home: string, record: TaskRecord): void {
  ensureDir(tasksDir(home));
  writeFileSync(recordPath(home, record.id), JSON.stringify(record, null, 2));
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
        // Already exited.
      }
    }
  }
}

export function createTaskTool(): Tool<TaskInputType> {
  return {
    name: "Task",
    description:
      "Create, inspect, list, update, stop, and read output from durable background tasks.",
    input: TaskInput,
    readOnly: false,
    concurrency: "exclusive",
    async execute(input: TaskInputType, ctx: ToolContext): Promise<ToolResult> {
      const dir = tasksDir(ctx.home);
      ensureDir(dir);

      if (input.action === "create") {
        if (!input.command) return toolError("command is required for create.");
        const id = newId("task");
        const log = join(dir, `${id}.log`);
        const fd = openSync(log, "a");
        const child = spawn(input.command, {
          cwd: input.cwd ?? ctx.cwd,
          env: process.env,
          shell: true,
          detached: false,
          windowsHide: true,
          stdio: ["ignore", fd, fd],
        });
        closeSync(fd);
        child.unref();
        const record: TaskRecord = {
          id,
          command: input.command,
          cwd: input.cwd ?? ctx.cwd,
          pid: child.pid ?? null,
          startedAt: new Date().toISOString(),
          status: "running",
          log,
        };
        writeRecord(ctx.home, record);
        return toolOk(JSON.stringify(record, null, 2), { task: record });
      }

      if (input.action === "list") {
        const records = readdirSync(dir)
          .filter((entry) => entry.endsWith(".json"))
          .map((entry) => readRecord(ctx.home, entry.replace(/\.json$/, "")))
          .filter((record): record is TaskRecord => record !== null);
        return toolOk(records.length === 0 ? "No tasks." : JSON.stringify(records, null, 2), {
          count: records.length,
        });
      }

      if (!input.task_id) return toolError(`task_id is required for ${input.action}.`);
      const record = readRecord(ctx.home, input.task_id);
      if (!record) return toolError(`Task not found: ${input.task_id}`);

      if (input.action === "get") {
        return toolOk(JSON.stringify(record, null, 2), { task: record });
      }

      if (input.action === "update") {
        if (input.status) record.status = input.status;
        if (input.note) record.note = input.note;
        writeRecord(ctx.home, record);
        return toolOk(JSON.stringify(record, null, 2), { task: record });
      }

      if (input.action === "stop") {
        if (record.pid !== null && record.status === "running") killTree(record.pid);
        record.status = "stopped";
        writeRecord(ctx.home, record);
        return toolOk(`Stopped task ${record.id}.`, { task: record });
      }

      const limit = input.limit ?? 10_000;
      let output = "";
      try {
        output = readFileSync(record.log, "utf8");
      } catch {
        output = "";
      }
      return toolOk(output.length === 0 ? "(no output)" : output.slice(-limit), {
        taskId: record.id,
        bytes: output.length,
      });
    },
  };
}
