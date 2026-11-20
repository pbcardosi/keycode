import { createElement } from "react";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../../dist/permissions/audit.js";
import { PermissionService, type PromptChoice } from "../../dist/permissions/pipeline.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { PermissionBroker } from "../../dist/tui/permission.js";
import { TuiApp } from "../../dist/tui/app.js";
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

  it("renders a TUI permission dialog and resolves allow-always", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const broker = new PermissionBroker();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let output = "";
    stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const app = render(createElement(TuiApp, { setup, permissions: broker }), {
      stdin,
      stdout,
      patchConsole: false,
      exitOnCtrlC: false,
    });
    const answer = broker.ask(
      {
        tool: "Bash",
        input: { command: "echo hi" },
        cwd: ws,
        readOnly: false,
        preview: "$ echo hi",
      },
      { behavior: "ask", reason: "Manual mode requires approval", source: "mode" },
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    expect(output).toContain("Permission required");
    expect(output).toContain("Bash");
    expect(output).toContain("$ echo hi");

    stdin.write("2");
    const choice = await answer;
    expect(choice.behavior).toBe("allow_always");
    app.unmount();
  });
});
