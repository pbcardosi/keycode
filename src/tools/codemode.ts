import vm from "node:vm";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";

export const CodeModeInput = z.object({
  code: z.string().min(1),
  reset: z.boolean().optional(),
});

export type CodeModeInputType = z.infer<typeof CodeModeInput>;

export interface CodeModeOptions {
  enabled?: boolean | undefined;
  tools?: Tool[] | undefined;
  timeoutMs?: number | undefined;
}

interface CodeSandbox {
  state: Record<string, unknown>;
  console: { log: (...args: unknown[]) => void };
  tools: { call: (name: string, args: unknown) => Promise<string> };
  __out: string[];
}

function withImplicitReturn(code: string): string {
  const trimmed = code.trim();
  const lastSemicolon = trimmed.lastIndexOf(";");
  const head = lastSemicolon === -1 ? "" : trimmed.slice(0, lastSemicolon + 1);
  const tail = (lastSemicolon === -1 ? trimmed : trimmed.slice(lastSemicolon + 1)).trim();
  if (tail.length === 0) return trimmed;
  if (/^(return|const|let|var|if|for|while|function|class|throw|try|switch|import|export|\{|\})/.test(tail)) {
    return trimmed;
  }
  return `${head}\nreturn (${tail});`;
}

export function createCodeModeTool(options: CodeModeOptions = {}): Tool<CodeModeInputType> {
  let context: vm.Context | null = null;
  let sandbox: CodeSandbox | null = null;

  const createSandbox = (): void => {
    const output: string[] = [];
    sandbox = {
      state: {},
      console: { log: (...args: unknown[]) => output.push(args.map((arg) => String(arg)).join(" ")) },
      tools: { call: async () => "" },
      __out: output,
    };
    context = vm.createContext(sandbox, { name: "keycode-codemode" });
  };

  return {
    name: "CodeMode",
    description:
      "Opt-in persistent JavaScript REPL with a tool bridge, output capture, and reset. Not a security boundary.",
    input: CodeModeInput,
    readOnly: false,
    concurrency: "exclusive",
    async execute(input: CodeModeInputType, ctx: ToolContext): Promise<ToolResult> {
      if (options.enabled !== true) {
        return toolError("Code Mode is opt-in. Enable it in settings before calling this tool.", {
          code: "TOOL_UNSUPPORTED",
        });
      }
      if (input.reset || context === null || sandbox === null) createSandbox();
      const activeSandbox = sandbox as CodeSandbox;
      const activeContext = context as vm.Context;
      activeSandbox.__out.length = 0;
      activeSandbox.tools.call = async (name, args) => {
        const tool = options.tools?.find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`Unknown tool: ${name}`);
        const result = await tool.execute(args, ctx);
        return result.content
          .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
          .join("\n");
      };

      try {
        const script = new vm.Script(`(async () => {\n${withImplicitReturn(input.code)}\n})()`, {
          filename: "codemode.js",
        });
        const result = await script.runInContext(activeContext, { timeout: options.timeoutMs ?? 10_000 });
        const output = activeSandbox.__out.join("\n");
        const rendered =
          result === undefined
            ? ""
            : `=> ${typeof result === "string" ? result : JSON.stringify(result)}`;
        const text = [output, rendered].filter((entry) => entry.length > 0).join("\n");
        return toolOk(text.length > 0 ? text : "(no output)", {});
      } catch (error) {
        return toolError(`Code Mode error: ${(error as Error).message}`, { code: "TOOL_INPUT_INVALID" });
      }
    },
  };
}
