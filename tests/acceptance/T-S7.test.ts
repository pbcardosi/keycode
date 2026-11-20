import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redact, redactDeep, scanSecrets } from "../../dist/util/redact.js";
import { createWriteTool } from "../../dist/tools/write.js";
import { createEditTool } from "../../dist/tools/edit.js";
import { findSessionFile, makeHome, makeToolCtx, makeWorkspace, readJsonl, runCli, textOf } from "../helpers.js";

describe("T-S7: secret redaction", () => {
  it("redacts key formats and bearer tokens in transcripts", () => {
    expect(redact("sk-ant-abc1234567890123")).toBe("[REDACTED:anthropic-key]");
    expect(redact("ghp_1234567890abcdef1234")).toContain("[REDACTED:github-token]");
    expect(redact("Bearer abcdefghijklmnopqrstuvwxyz0123")).toContain("Bearer [REDACTED:token]");
    expect(redactDeep({ apiKey: "sk-ant-abc1234567890123", ok: true })).toEqual({ apiKey: "[REDACTED]", ok: true });
  });

  it("redacts secrets from the session transcript", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const script = [
      { type: "text", delta: "the key is sk-ant-abc1234567890123 and also ghp_1234567890abcdef1234" },
      { type: "done", stopReason: "end_turn" },
    ];
    const result = runCli(["-p", "show keys"], {
      env: {
        KEYCODE_HOME: home,
        KEYCODE_PROVIDER: "fake",
        KEYCODE_FAKE_SCRIPT: JSON.stringify(script),
      },
      cwd: ws,
    });
    expect(result.code).toBe(0);

    const records = readJsonl(findSessionFile(home, ws));
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("sk-ant-abc1234567890123");
    expect(serialized).not.toContain("ghp_1234567890abcdef1234");
    expect(serialized).toContain("[REDACTED:anthropic-key]");
  });

  it("refuses to write new secrets and allows unrelated edits", async () => {
    const ws = makeWorkspace();
    const ctx = makeToolCtx({ cwd: ws });
    expect(scanSecrets("sk-ant-abc1234567890123")).toContainEqual({
      kind: "anthropic-key",
      count: 1,
    });

    const write = createWriteTool();
    const blocked = await write.execute(
      { file_path: "secret.ts", content: 'const key = "sk-ant-abc1234567890123";' },
      ctx,
    );
    expect(blocked.ok).toBe(false);
    expect((blocked.metadata as { code?: string } | undefined)?.code).toBe("SECRET_DETECTED");
    expect(textOf(blocked)).toContain("SECRET_DETECTED");
    expect(existsSync(join(ws, "secret.ts"))).toBe(false);

    const edit = createEditTool();
    writeFileSync(join(ws, "safe.ts"), "const value = 1;\n");
    const editBlocked = await edit.execute(
      {
        file_path: "safe.ts",
        old_string: "const value = 1;",
        new_string: 'const value = "sk-ant-abc1234567890123";',
      },
      ctx,
    );
    expect(editBlocked.ok).toBe(false);
    expect((editBlocked.metadata as { code?: string } | undefined)?.code).toBe("SECRET_DETECTED");
    expect(readFileSync(join(ws, "safe.ts"), "utf8")).toBe("const value = 1;\n");

    writeFileSync(
      join(ws, "existing.ts"),
      'const key = "sk-ant-abc1234567890123";\nconst value = 1;\n',
    );
    const allowed = await edit.execute(
      { file_path: "existing.ts", old_string: "const value = 1;", new_string: "const value = 2;" },
      ctx,
    );
    expect(allowed.ok).toBe(true);
    expect(readFileSync(join(ws, "existing.ts"), "utf8")).toContain("const value = 2;");
  });
});
