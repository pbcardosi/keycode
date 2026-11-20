import { describe, expect, it } from "vitest";
import { createPowerShellTool } from "../../dist/tools/powershell.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

describe("T-T2: PowerShell", () => {
  it("runs on Windows and reports TOOL_UNSUPPORTED elsewhere", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createPowerShellTool();
    const result = await tool.execute({ command: "Write-Output hello" }, ctx);
    if (process.platform === "win32") {
      expect(result.ok).toBe(true);
      expect(textOf(result)).toContain("hello");
    } else {
      expect(result.ok).toBe(false);
      expect((result.metadata as { code?: string } | undefined)?.code).toBe("TOOL_UNSUPPORTED");
    }
  });
});
