import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeHome, makeWorkspace, runCli, writeJson, writeText } from "../helpers.js";

describe("T-U7: doctor", () => {
  it("diagnoses a broken config, repairs it with --fix, and emits JSON", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const settingsPath = join(ws, ".keycode", "settings.json");
    writeText(settingsPath, "not json");

    const broken = runCli(["doctor"], { cwd: ws, env: { ...process.env, KEYCODE_HOME: home } });
    expect(broken.code).toBe(1);
    expect(broken.stdout).toContain("FAIL");
    expect(broken.stdout).toContain("settings");

    const fixed = runCli(["doctor", "--fix"], { cwd: ws, env: { ...process.env, KEYCODE_HOME: home } });
    expect(fixed.code).toBe(0);
    expect(() => JSON.parse(readFileSync(settingsPath, "utf8"))).not.toThrow();

    writeJson(settingsPath, { mcpServers: { demo: { command: "node" } } });
    const json = runCli(["doctor", "--json"], { cwd: ws, env: { ...process.env, KEYCODE_HOME: home } });
    expect(json.code).toBe(0);
    const report = JSON.parse(json.stdout) as { ok: boolean; checks: Array<{ name: string; status: string }> };
    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.name)).toContain("mcp");
    expect(report.checks.find((check) => check.name === "mcp")?.status).toBe("ok");
  }, 30000);
});
