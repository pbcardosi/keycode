import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolOk } from "../contracts/tool.js";
import { newId } from "../util/ids.js";
import { ensureDir } from "../util/fsx.js";
import { tasksDir } from "../util/paths.js";
import { capOutput } from "./shared.js";

export const BashInput = z.object({
  command: z.string().min(1),
  description: z.string().optional(),
  timeout: z.number().int().positive().max(600_000).optional(),
  run_in_background: z.boolean().optional(),
  stdin: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type BashInputType = z.infer<typeof BashInput>;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
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
        // Process already exited.
      }
    }
  }
}

export async function runCommand(options: {
  command: string;
  cwd: string;
  env?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  stdin?: string | undefined;
  signal?: AbortSignal | undefined;
  shell?: boolean | undefined;
  args?: string[] | undefined;
}): Promise<CommandResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 120_000;

  return await new Promise((resolvePromise) => {
    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: options.shell ?? true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolvePromise({ stdout, stderr, exitCode, timedOut, durationMs: Date.now() - started });
    };

    const onAbort = (): void => {
      if (child.pid) killTree(child.pid);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 2_000_000) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 2_000_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += `${stderr.length > 0 ? "\n" : ""}${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}

export function createBashTool(): Tool<BashInputType> {
  return {
    name: "Bash",
    description:
      "Run a shell command in the session working directory and return its output. Shell state does not persist between calls. Use for builds, tests, and git.",
    input: BashInput,
    readOnly: false,
    concurrency: "exclusive",
    async execute(input: BashInputType, ctx: ToolContext): Promise<ToolResult> {
      if (input.run_in_background === true) {
        const id = newId("task");
        const dir = tasksDir(ctx.home);
        ensureDir(dir);
        const logPath = join(dir, `${id}.log`);
        const fd = openSync(logPath, "a");
        const child = spawn(input.command, {
          cwd: ctx.cwd,
          env: { ...process.env, ...input.env },
          shell: true,
          detached: true,
          windowsHide: true,
          stdio: ["ignore", fd, fd],
        });
        closeSync(fd);
        child.unref();
        const record = {
          id,
          command: input.command,
          cwd: ctx.cwd,
          pid: child.pid ?? null,
          startedAt: new Date().toISOString(),
          status: "running",
          log: logPath,
        };
        writeFileSync(join(dir, `${id}.json`), JSON.stringify(record, null, 2));
        return toolOk(
          `Background task ${id} started (pid ${child.pid ?? "unknown"}). Log: ${logPath}`,
          { taskId: id, pid: child.pid ?? null, log: logPath },
        );
      }

      const result = await runCommand({
        command: input.command,
        cwd: ctx.cwd,
        env: input.env,
        timeoutMs: input.timeout,
        stdin: input.stdin,
        signal: ctx.signal,
      });

      if (result.timedOut) {
        return {
          ok: false,
          content: [
            {
              type: "text",
              text: `Command timed out after ${input.timeout ?? 120_000} ms.\n${result.stdout}${result.stderr}`,
            },
          ],
          metadata: { code: "TOOL_TIMEOUT", exitCode: result.exitCode },
        };
      }
      if (ctx.signal.aborted) {
        return {
          ok: false,
          content: [{ type: "text", text: "Command aborted." }],
          metadata: { code: "ABORTED" },
        };
      }

      let output = result.stdout;
      if (result.stderr.length > 0) {
        output += `${output.length > 0 ? "\n" : ""}[stderr]\n${result.stderr}`;
      }
      if (output.trim() === "") output = "(no output)";
      if (result.exitCode !== 0) {
        output = `Exit code ${result.exitCode ?? "null"}\n${output}`;
      }
      const capped = capOutput(output, ctx, "bash");
      return {
        ok: result.exitCode === 0,
        content: [{ type: "text", text: capped.text }],
        display: `Bash: ${input.command.slice(0, 80)}`,
        metadata: {
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          ...(capped.spilled === null ? {} : { spilled: capped.spilled }),
        },
      };
    },
  };
}
