import { describe, expect, it } from "vitest";
import { createQuestionTool } from "../../dist/tools/question.js";
import { makeWorkspace, makeToolCtx } from "../helpers.js";

const QUESTION = {
  questions: [
    {
      question: "Pick one",
      header: "Pick",
      options: [
        { label: "alpha", description: "first" },
        { label: "beta" },
      ],
    },
  ],
};

describe("T-T12: AskUserQuestion", () => {
  it("returns typed answers when the channel provides them", async () => {
    const ctx = makeToolCtx({
      cwd: makeWorkspace(),
      askQuestions: async () => ({ answers: [{ header: "Pick", selected: ["alpha"], custom: undefined }] }),
    });
    const result = await createQuestionTool().execute(QUESTION, ctx);
    expect(result.ok).toBe(true);
    expect(result.content[0]?.text).toContain("alpha");
  });

  it("returns USER_CANCELLED when cancelled", async () => {
    const ctx = makeToolCtx({
      cwd: makeWorkspace(),
      askQuestions: async () => ({ cancelled: true, answers: [] }),
    });
    const result = await createQuestionTool().execute(QUESTION, ctx);
    expect(result.ok).toBe(false);
    expect((result.metadata as { code?: string } | undefined)?.code).toBe("USER_CANCELLED");
  });

  it("returns PERMISSION_PROMPT_UNAVAILABLE without a channel", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const result = await createQuestionTool().execute(QUESTION, ctx);
    expect(result.ok).toBe(false);
    expect((result.metadata as { code?: string } | undefined)?.code).toBe("PERMISSION_PROMPT_UNAVAILABLE");
  });
});
