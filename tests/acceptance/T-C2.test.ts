import { describe, expect, it } from "vitest";
import { makeHome, makeWorkspace, parseJsonl, runCli } from "../helpers.js";

const FAKE_ENV = (home: string, extra: Record<string, string> = {}) => ({
  KEYCODE_HOME: home,
  KEYCODE_PROVIDER: "fake",
  KEYCODE_FAKE_SCRIPT: JSON.stringify([
    { type: "text", delta: "hello world" },
    { type: "done", stopReason: "end_turn" },
  ]),
  ...extra,
});

describe("T-C2: Headless print mode", () => {
  it("prints text in print mode and exits 0", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const result = runCli(["-p", "hi"], { env: FAKE_ENV(home), cwd: ws });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hello world");
  });

  it("emits one result object in json mode", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const result = runCli(["-p", "hi", "--output-format", "json"], { env: FAKE_ENV(home), cwd: ws });
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      subtype: string;
      result: string;
      session_id: string;
      usage: { inputTokens: number; outputTokens: number };
      num_turns: number;
    };
    expect(parsed.subtype).toBe("success");
    expect(parsed.result).toContain("hello world");
    expect(typeof parsed.session_id).toBe("string");
    expect(typeof parsed.usage.inputTokens).toBe("number");
    expect(parsed.num_turns).toBe(1);
  });

  it("emits NDJSON events in stream-json mode", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const result = runCli(["-p", "hi", "--output-format", "stream-json"], { env: FAKE_ENV(home), cwd: ws });
    expect(result.code).toBe(0);
    const lines = parseJsonl(result.stdout);
    expect(lines[0]).toMatchObject({ type: "system", subtype: "init" });
    expect(lines.some((line) => (line as { type: string }).type === "stream_event")).toBe(true);
    expect(lines[lines.length - 1]).toMatchObject({ type: "result", subtype: "success" });
  });

  it("accepts NDJSON user messages with --input-format stream-json", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const input = `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "hello stdin" }] } })}\n`;
    const result = runCli(["--input-format", "stream-json", "--output-format", "json"], {
      env: FAKE_ENV(home),
      cwd: ws,
      input,
    });
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as { subtype: string; result: string };
    expect(parsed.subtype).toBe("success");
    expect(parsed.result).toContain("hello world");
  });
});
