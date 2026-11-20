import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importConfigs } from "../../dist/integrations/import.js";
import { makeHome, makeWorkspace, writeJson, writeText } from "../helpers.js";

describe("T-I10: import", () => {
  it("imports configs, dry-runs, backs up, and is idempotent", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeJson(join(home, "codex.json"), {
      provider: "gemini",
      model: "gemini-2.5-flash",
      mcpServers: { x: { command: "node" } },
    });
    writeJson(join(home, "gemini.json"), { mcpServers: { y: { command: "node" } } });
    writeText(join(ws, ".cursor", "rules", "style.mdc"), "Use tabs.\n");
    writeJson(join(home, "settings.json"), { model: "old-model" });

    const dry = await importConfigs({ home, cwd: ws, dryRun: true });
    expect(dry.changed.length).toBeGreaterThan(0);
    expect(dry.written).toEqual([]);
    expect((JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as { model: string }).model).toBe("old-model");

    const first = await importConfigs({ home, cwd: ws });
    expect(first.written.length).toBeGreaterThan(0);
    expect(first.backup).toBeTruthy();
    const settings = JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as {
      model: string;
      mcpServers: Record<string, unknown>;
    };
    expect(settings.model).toBe("gemini-2.5-flash");
    expect(Object.keys(settings.mcpServers).sort()).toEqual(["x", "y"]);
    expect(existsSync(join(home, "commands", "style.md"))).toBe(true);
    expect(readFileSync(join(home, "commands", "style.md"), "utf8")).toContain("Use tabs.");

    const second = await importConfigs({ home, cwd: ws });
    expect(second.changed).toEqual([]);
  });
});
