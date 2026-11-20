import { z } from "zod";
import type { Tool } from "../contracts/tool.js";
import type { McpClient } from "./client.js";

export async function createMcpTools(client: McpClient): Promise<Tool[]> {
  const definitions = await client.listTools();
  return definitions.map((definition) => ({
    name: `mcp__${client.name}__${definition.name}`,
    description: definition.description ?? `MCP tool ${client.name}/${definition.name}`,
    input: z.object({}).passthrough(),
    readOnly: false,
    concurrency: "parallel" as const,
    async execute(input: unknown) {
      const result = await client.callTool(definition.name, (input ?? {}) as Record<string, unknown>);
      const content = (result.content ?? []).map((block) =>
        block.type === "image"
          ? {
              type: "image" as const,
              mime: String(block.mimeType ?? "image/png"),
              data: String(block.data ?? ""),
            }
          : { type: "text" as const, text: block.text ?? "" },
      );
      return {
        ok: result.isError !== true,
        content: content.length > 0 ? content : [{ type: "text" as const, text: "(no content)" }],
      };
    },
  })) as Tool[];
}
