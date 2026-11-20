import { describe, expect, it } from "vitest";
import { AuditLog } from "../../dist/permissions/audit.js";
import { PermissionService, type PromptChoice } from "../../dist/permissions/pipeline.js";
import { makeHome, makeWorkspace } from "../helpers.js";

describe("T-S3: permission prompt", () => {
  it("prompts and persists allow-always; cancel is typed", async () => {
    const home = makeHome();
    const cwd = makeWorkspace();
    const persisted: string[] = [];
    const prompts: string[] = [];
    const choice: PromptChoice = { behavior: "allow_always" };
    const service = new PermissionService({
      mode: "manual",
      cwd,
      roots: [cwd],
      prompter: {
        ask: async (request) => {
          prompts.push(request.tool);
          return choice;
        },
      },
      audit: new AuditLog(home),
      sessionId: "sess-s3",
      persistRule: (raw) => {
        persisted.push(raw);
      },
    });

    const decision = await service.check({ tool: "Write", input: { file_path: "a.txt" }, cwd, readOnly: false });
    expect(prompts).toEqual(["Write"]);
    expect(decision.behavior).toBe("allow");
    expect(persisted).toEqual(["Write"]);

    const cancelService = new PermissionService({
      mode: "manual",
      cwd,
      roots: [cwd],
      prompter: { ask: async () => ({ behavior: "cancel" }) },
    });
    await expect(
      cancelService.check({ tool: "Bash", input: { command: "echo hi" }, cwd, readOnly: false }),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });
});
