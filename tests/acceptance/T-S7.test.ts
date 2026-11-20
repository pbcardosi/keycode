import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redact, redactDeep } from "../../dist/util/redact.js";
import { findSessionFile, makeHome, makeWorkspace, readJsonl, runCli } from "../helpers.js";

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
});
