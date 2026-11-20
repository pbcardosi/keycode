import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadSettings, watchSettings, settingsCandidatePaths } from "../../dist/storage/settings.js";
import { makeHome, makeWorkspace, writeJson, writeText } from "../helpers.js";

describe("T-O1: settings hierarchy", () => {
  it("loads user, project, local, and managed layers; invalid files warn and are ignored", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeJson(join(home, "settings.json"), { model: "user-model" });
    writeJson(join(ws, ".keycode", "settings.json"), { model: "project-model" });
    writeJson(join(ws, ".keycode", "settings.local.json"), { model: "local-model" });
    const managedPath = join(ws, "managed-settings.json");
    writeJson(managedPath, { model: "managed-model" });
    const env = { KEYCODE_MANAGED_SETTINGS: managedPath };

    expect(loadSettings({ cwd: ws, home, env }).settings.model).toBe("managed-model");
    rmSync(managedPath);
    expect(loadSettings({ cwd: ws, home, env }).settings.model).toBe("local-model");
    writeJson(join(ws, ".keycode", "settings.json"), { model: 123 });
    rmSync(join(ws, ".keycode", "settings.local.json"));
    const invalid = loadSettings({ cwd: ws, home, env });
    expect(invalid.settings.model).toBe("user-model");
    expect(invalid.warnings.some((warning) => warning.includes("Ignoring invalid settings file"))).toBe(true);
  });

  it("interpolates environment variables in settings", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeJson(join(home, "settings.json"), { model: "${KEYCODE_TEST_MODEL}" });
    const loaded = loadSettings({ cwd: ws, home, env: { KEYCODE_TEST_MODEL: "env-model" } });
    expect(loaded.settings.model).toBe("env-model");
  });

  it("applies hot-reload changes to settings", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeJson(join(ws, ".keycode", "settings.json"), { model: "v1" });
    const seen: string[] = [];
    const unwatch = watchSettings({ cwd: ws, home }, (loaded) => {
      seen.push(loaded.settings.model ?? "");
    });
    writeJson(join(ws, ".keycode", "settings.json"), { model: "v2" });
    await vi.waitFor(() => expect(seen).toContain("v2"), { timeout: 5000, interval: 100 });
    unwatch();
  });

  it("lists managed settings as the highest-precedence candidate", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const env = { KEYCODE_MANAGED_SETTINGS: join(ws, "managed.json") };
    const paths = settingsCandidatePaths({ cwd: ws, home, env });
    expect(paths.indexOf(join(ws, "managed.json"))).toBeGreaterThan(paths.indexOf(join(home, "settings.json")));
    expect(existsSync(join(home, "settings.json"))).toBe(false);
  });
});
