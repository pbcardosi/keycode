import { readFileSync } from "node:fs";
import { isAbsolute, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";
import { LspClient, type LspDiagnostic } from "../lsp/client.js";
import { KeycodeError } from "../util/errors.js";
import { isInside } from "../util/paths.js";

export const LspInput = z.object({
  action: z.enum(["diagnostics", "hover", "definition", "references"]),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  character: z.number().int().positive().optional(),
});

export type LspInputType = z.infer<typeof LspInput>;

export interface LspServerConfig {
  command: string;
  args?: string[] | undefined;
  language?: string | undefined;
  timeoutMs?: number | undefined;
  initializationOptions?: Record<string, unknown> | undefined;
}

export interface LspToolOptions {
  servers: Record<string, LspServerConfig>;
  cwd: string;
  roots?: string[] | undefined;
  timeoutMs?: number | undefined;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".json": "json",
  ".md": "markdown",
  ".css": "css",
  ".html": "html",
  ".sh": "shellscript",
  ".ps1": "powershell",
};

const SEVERITY: Record<number, string> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

function resolveServer(
  file: string,
  servers: Record<string, LspServerConfig>,
): { language: string; config: LspServerConfig } | null {
  const extension = extname(file).toLowerCase();
  const language = LANGUAGE_BY_EXTENSION[extension] ?? extension.replace(".", "");
  const config = servers[language] ?? servers[extension] ?? servers["*"];
  if (!config) return null;
  return { language: config.language ?? language, config };
}

function renderHover(value: unknown): string {
  if (value === null || value === undefined) return "No hover information.";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => renderHover(entry)).join("\n\n");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.contents !== undefined) return renderHover(record.contents);
    if (typeof record.value === "string") return record.value;
  }
  return JSON.stringify(value);
}

function position(range: unknown): string {
  if (range === null || typeof range !== "object") return "";
  const record = range as { start?: { line?: number; character?: number } };
  const line = record.start?.line;
  const character = record.start?.character;
  if (typeof line !== "number") return "";
  return `:${line + 1}:${typeof character === "number" ? character + 1 : 1}`;
}

function renderLocation(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as {
    uri?: string;
    targetUri?: string;
    range?: unknown;
    targetRange?: unknown;
  };
  const uri = record.uri ?? record.targetUri;
  if (typeof uri !== "string") return null;
  let display = uri;
  try {
    if (uri.startsWith("file:")) display = fileURLToPath(uri);
  } catch {
    display = uri;
  }
  return `${display}${position(record.targetRange ?? record.range)}`;
}

function renderLocations(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => renderLocations(entry));
  const single = renderLocation(value);
  return single === null ? [] : [single];
}

function errorCode(error: unknown): string {
  return error instanceof KeycodeError ? error.code : "TOOL_INPUT_INVALID";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLspTool(options: LspToolOptions): Tool<LspInputType> & { stop(): void } {
  const clients = new Map<string, LspClient>();
  const versions = new Map<string, number>();
  const roots = options.roots ?? [options.cwd];

  const clientFor = async (
    language: string,
    config: LspServerConfig,
  ): Promise<LspClient> => {
    const existing = clients.get(language);
    if (existing) return existing;
    const client = new LspClient({
      command: config.command,
      args: config.args ?? [],
      cwd: options.cwd,
      rootUri: pathToFileURL(options.cwd).href,
      timeoutMs: config.timeoutMs ?? options.timeoutMs ?? 10_000,
      ...(config.initializationOptions === undefined
        ? {}
        : { initializationOptions: config.initializationOptions }),
    });
    await client.start();
    await client.initialize();
    clients.set(language, client);
    return client;
  };

  return {
    name: "LSP",
    description:
      "Ask a configured language server for diagnostics, hover, definition, or references. Configure servers under \"lsp\" in settings.json, keyed by language id such as typescript or python.",
    input: LspInput,
    readOnly: true,
    concurrency: "exclusive",
    stop(): void {
      for (const client of clients.values()) client.stop();
      clients.clear();
      versions.clear();
    },
    async execute(input: LspInputType, ctx: ToolContext): Promise<ToolResult> {
      const absolute = isAbsolute(input.file) ? input.file : resolve(ctx.cwd, input.file);
      if (!roots.some((root) => isInside(root, absolute))) {
        return toolError(`PERMISSION_DENIED: ${input.file} is outside the workspace`, {
          code: "PERMISSION_DENIED",
        });
      }
      const target = resolveServer(absolute, options.servers);
      if (target === null) {
        return toolError(
          `No language server is configured for ${input.file}. Add one under "lsp" in settings.json.`,
          { code: "TOOL_UNSUPPORTED" },
        );
      }

      try {
        const client = await clientFor(target.language, target.config);
        const uri = pathToFileURL(absolute).href;
        const text = readFileSync(absolute, "utf8");
        const version = versions.get(uri) ?? 0;
        if (version === 0) {
          client.openDocument(uri, target.language, text);
          versions.set(uri, 1);
        } else {
          client.updateDocument(uri, text, version + 1);
          versions.set(uri, version + 1);
        }

        if (input.action === "diagnostics") {
          const diagnostics = await client.waitForDiagnostics(
            uri,
            target.config.timeoutMs ?? options.timeoutMs ?? 15_000,
          );
          if (diagnostics.length === 0) return toolOk(`No diagnostics for ${input.file}.`);
          return toolOk(
            diagnostics
              .map((diagnostic: LspDiagnostic) => {
                const line = diagnostic.range.start.line + 1;
                const character = diagnostic.range.start.character + 1;
                const severity = SEVERITY[diagnostic.severity ?? 3] ?? "info";
                const source = diagnostic.source ? ` (${diagnostic.source})` : "";
                return `${input.file}:${line}:${character} ${severity}: ${diagnostic.message}${source}`;
              })
              .join("\n"),
            { count: diagnostics.length },
          );
        }

        if (input.line === undefined || input.character === undefined) {
          return toolError(`${input.action} requires line and character (1-based).`, {
            code: "TOOL_INPUT_INVALID",
          });
        }
        const line = input.line - 1;
        const character = input.character - 1;

        if (input.action === "hover") {
          const hover = await client.hover(uri, line, character);
          return toolOk(renderHover(hover));
        }
        if (input.action === "definition") {
          const definition = renderLocations(await client.definition(uri, line, character));
          return toolOk(definition.length === 0 ? "No definition found." : definition.join("\n"));
        }
        const references = renderLocations(await client.references(uri, line, character));
        return toolOk(
          references.length === 0 ? "No references found." : references.join("\n"),
          { count: references.length },
        );
      } catch (error) {
        return toolError(`${errorCode(error)}: ${messageOf(error)}`, { code: errorCode(error) });
      }
    },
  };
}
