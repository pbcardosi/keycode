import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../../dist/permissions/audit.js";
import { PermissionService } from "../../dist/permissions/pipeline.js";
import { parseRule } from "../../dist/permissions/rules.js";
import { makeHome, makeWorkspace } from "../helpers.js";

describe("T-S9: audit log", () => {
  it("records decisions and rules, redacts secrets, and rotates", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const audit = new AuditLog(home, { maxBytes: 600 });
    const service = new PermissionService({
      mode: "manual",
      cwd: ws,
      roots: [ws],
      audit,
      sessionId: "sess-s9",
      rules: [parseRule("Bash(rm *)", "user", "deny")],
    });

    await service.check({ tool: "Read", input: { file_path: "a.txt" }, cwd: ws, readOnly: true });
    await service.check({
      tool: "Bash",
      input: { command: "rm file.txt", apiKey: "sk-ant-abc1234567890123" },
      cwd: ws,
      readOnly: false,
    });

    const entries = audit.read(10);
    expect(entries.some((entry) => entry.decision === "allow")).toBe(true);
    expect(entries.some((entry) => entry.decision === "deny" && entry.rule === "Bash(rm *)")).toBe(true);
    const raw = readFileSync(audit.file, "utf8");
    expect(raw).not.toContain("sk-ant-abc1234567890123");

    for (let index = 0; index < 20; index += 1) {
      audit.record(
        "sess-s9",
        { tool: "Read", input: { file_path: "a.txt" }, cwd: ws, readOnly: true },
        { behavior: "allow", reason: "ok" },
        1,
        "ok",
      );
    }
    expect(existsSync(`${audit.file}.1`)).toBe(true);
  });
});
