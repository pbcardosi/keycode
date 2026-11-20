import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";
import type { AgentDefinition } from "../extensions/customAgents.js";
import { findAgentDefinition } from "../extensions/customAgents.js";
import type { SubagentRunner } from "../app/subagent.js";

export const AgentToolInput = z.object({
  prompt: z.string().min(1),
  description: z.string().optional(),
  subagent_type: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

export type AgentToolInputType = z.infer<typeof AgentToolInput>;

export function createAgentTool(
  definitions: AgentDefinition[],
  runner: SubagentRunner,
): Tool<AgentToolInputType> {
  return {
    name: "Agent",
    description:
      "Run a subagent with its own prompt, model, tools, and permission ceiling, then return its final report.",
    input: AgentToolInput,
    readOnly: false,
    concurrency: "parallel",
    async execute(input: AgentToolInputType, ctx: ToolContext): Promise<ToolResult> {
      const definition = input.subagent_type
        ? findAgentDefinition(definitions, input.subagent_type)
        : undefined;
      if (input.subagent_type !== undefined && definition === undefined) {
        return toolError(`Unknown subagent type "${input.subagent_type}".`, { code: "TOOL_INPUT_INVALID" });
      }
      if (ctx.signal.aborted) {
        return toolError("Subagent aborted.", { code: "ABORTED" });
      }
      const model = input.model ?? definition?.model;
      const tools = input.tools ?? definition?.tools;
      const name = input.description ?? definition?.name;
      const result = await runner(
        {
          prompt: input.prompt,
          ...(model === undefined ? {} : { model }),
          ...(tools === undefined ? {} : { tools }),
          ...(definition?.permissionMode === undefined ? {} : { permissionMode: definition.permissionMode }),
          ...(name === undefined ? {} : { name }),
          ...(definition?.body === undefined ? {} : { body: definition.body }),
        },
        ctx,
      );
      return toolOk(result.text.length > 0 ? result.text : "(subagent returned no report)", {
        sessionId: result.sessionId,
      });
    },
  };
}
