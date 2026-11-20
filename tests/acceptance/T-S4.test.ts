import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { isTrusted, trustWorkspace, untrustWorkspace } from "../../dist/app/trust.js";
import { loadSettings, permissionSettings } from "../../dist/storage/settings.js";
import { makeHome, makeWorkspace, writeJson } from "../helpers.js";

describe("T-S4: workspace trust", () => {
  it("ignores project settings when untrusted and applies them when trusted", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeJson(join(ws, ".keycode", "settings.json"), {
      permissions: { defaultMode: "plan" },
    });

    expect(isTrusted(home, ws)).toBe(false);
    const untrusted = loadSettings({ cwd: ws, home, projectLayers: isTrusted(home, ws) });
    expect(permissionSettings(untrusted.settings).defaultMode).toBe("manual");

    trustWorkspace(home, ws);
    expect(isTrusted(home, ws)).toBe(true);
    const trusted = loadSettings({ cwd: ws, home, projectLayers: isTrusted(home, ws) });
    expect(permissionSettings(trusted.settings).defaultMode).toBe("plan");

    untrustWorkspace(home, ws);
    expect(isTrusted(home, ws)).toBe(false);
    const back = loadSettings({ cwd: ws, home, projectLayers: isTrusted(home, ws) });
    expect(permissionSettings(back.settings).defaultMode).toBe("manual");
  });
});
