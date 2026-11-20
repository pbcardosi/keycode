import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError } from "../contracts/tool.js";
import { runCommand } from "./bash.js";
import { checkCommand } from "../sandbox/command.js";
import { capOutput } from "./shared.js";

export const PowerShellInput = z.object({
  command: z.string().min(1),
  description: z.string().optional(),
  timeout: z.number().int().positive().max(600_000).optional(),
  stdin: z.string().optional(),
});

export type PowerShellInputType = z.infer<typeof PowerShellInput>;

function findPowerShell(): { command: string; args: string[] } | null {
  if (process.platform !== "win32") return null;
  for (const candidate of ["pwsh", "powershell"]) {
    try {
      const result = spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], {
        windowsHide: true,
        timeout: 5_000,
      });
      if (result.status === 0) {
        return { command: candidate, args: ["-NoLogo", "-NoProfile", "-Command"] };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function createPowerShellTool(): Tool<PowerShellInputType> {
  return {
    name: "PowerShell",
    description: "Run a PowerShell command on Windows. Use Bash on macOS and Linux.",
    input: PowerShellInput,
    readOnly: false,
    concurrency: "exclusive",
    async execute(input: PowerShellInputType, ctx: ToolContext): Promise<ToolResult> {
      const shell = findPowerShell();
      if (shell === null) {
        return toolError("TOOL_UNSUPPORTED: PowerShell is only available on Windows.", {
          code: "TOOL_UNSUPPORTED",
        });
      }
      if (ctx.sandbox !== undefined) {
        const guarded = checkCommand(ctx.sandbox, input.command, ctx.cwd);
        if (!guarded.allowed) {
          return toolError(`SANDBOX_DENIED: ${guarded.reason ?? "blocked by the sandbox"}`, {
            code: "SANDBOX_DENIED",
          });
        }
      }
      const result = await runCommand({
        command: shell.command,
        args: [...shell.args, input.command],
        shell: false,
        cwd: ctx.cwd,
        timeoutMs: input.timeout,
        stdin: input.stdin,
        signal: ctx.signal,
      });
      if (result.timedOut) {
        return toolError(`PowerShell timed out after ${input.timeout ?? 120_000} ms.`, {
          code: "TOOL_TIMEOUT",
        });
      }
      let output = result.stdout;
      if (result.stderr.length > 0) {
        output += `${output.length > 0 ? "\n" : ""}[stderr]\n${result.stderr}`;
      }
      if (output.trim() === "") output = "(no output)";
      const capped = capOutput(output, ctx, "powershell");
      return {
        ok: result.exitCode === 0,
        content: [{ type: "text", text: capped.text }],
        metadata: { exitCode: result.exitCode, durationMs: result.durationMs },
      };
    },
  };
}
