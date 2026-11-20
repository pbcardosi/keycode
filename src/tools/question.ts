import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError } from "../contracts/tool.js";

export const QuestionInput = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        header: z.string().min(1).max(30),
        options: z
          .array(
            z.object({
              label: z.string().min(1),
              description: z.string().optional(),
            }),
          )
          .min(2)
          .max(4),
        multiSelect: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(4),
});

export type QuestionInputType = z.infer<typeof QuestionInput>;

export function createQuestionTool(): Tool<QuestionInputType> {
  return {
    name: "AskUserQuestion",
    description:
      "Ask the user one to four multiple-choice questions. Use when a decision cannot be inferred from the repository.",
    input: QuestionInput,
    readOnly: true,
    concurrency: "exclusive",
    async execute(input: QuestionInputType, ctx: ToolContext): Promise<ToolResult> {
      if (!ctx.askQuestions) {
        return toolError("AskUserQuestion requires an interactive session.", {
          code: "PERMISSION_PROMPT_UNAVAILABLE",
        });
      }
      const result = await ctx.askQuestions(
        input.questions.map((question) => ({
          question: question.question,
          header: question.header,
          options: question.options,
          multiple: question.multiSelect,
        })),
      );
      if (result.cancelled) {
        return toolError("User cancelled the question.", { code: "USER_CANCELLED" });
      }
      return {
        ok: true,
        content: [{ type: "text", text: JSON.stringify({ answers: result.answers }, null, 2) }],
        metadata: { answers: result.answers },
      };
    },
  };
}
