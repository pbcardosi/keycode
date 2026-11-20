import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";
import { findSkill, loadSkill, renderSkill, type SkillMetadata } from "../extensions/skills.js";

export const SkillInput = z.object({
  skill: z.string().min(1),
  args: z.string().optional(),
});

export type SkillInputType = z.infer<typeof SkillInput>;

export function createSkillTool(skills: SkillMetadata[]): Tool<SkillInputType> {
  return {
    name: "Skill",
    description:
      "Load a skill's instructions by name and apply its allowed-tools restriction to the rest of the turn.",
    input: SkillInput,
    readOnly: true,
    concurrency: "exclusive",
    async execute(input: SkillInputType, ctx: ToolContext): Promise<ToolResult> {
      const metadata = findSkill(skills, input.skill);
      if (!metadata) {
        return toolError(`Skill not found: ${input.skill}. Use /skills to list available skills.`, {
          code: "TOOL_INPUT_INVALID",
        });
      }
      const skill = loadSkill(metadata);
      const rendered = renderSkill(skill, input.args ?? "");
      ctx.state.metadata.set("skill.name", skill.name);
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        ctx.state.metadata.set("skill.allowedTools", skill.allowedTools);
      } else {
        ctx.state.metadata.delete("skill.allowedTools");
      }
      return toolOk(`# Skill: ${skill.name}\n\n${rendered}`, {
        skill: skill.name,
        allowedTools: skill.allowedTools ?? null,
      });
    },
  };
}
