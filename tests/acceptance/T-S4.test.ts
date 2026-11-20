import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { isTrusted, trustWorkspace, untrustWorkspace } from "../../dist/app/trust.js";
import { buildTrustManifest } from "../../dist/app/trustManifest.js";
import { trustStatus } from "../../dist/app/trust.js";
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

  it("builds a manifest and re-prompts when project-controlled settings change", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const settingsPath = join(ws, ".keycode", "settings.json");
    writeJson(settingsPath, {
      permissions: { allow: ["Bash(npm test)"] },
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "node hook.mjs" }] }] },
      mcpServers: { docs: { command: "node", args: ["server.mjs"] } },
      lsp: { typescript: { command: "tsls", args: ["--stdio"] } },
      browser: { driver: "./driver.mjs" },
      env: { PRIVATE_FLAG: "1" },
    });

    const manifest = buildTrustManifest(ws);
    expect(manifest.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["permissions", "hooks", "mcp", "lsp", "browser", "env"]),
    );
    expect(manifest.fingerprint).toHaveLength(64);
    expect(trustStatus(home, ws, manifest.fingerprint)).toBe("untrusted");

    trustWorkspace(home, ws, manifest.fingerprint);
    expect(trustStatus(home, ws, manifest.fingerprint)).toBe("trusted");
    expect(isTrusted(home, ws, manifest.fingerprint)).toBe(true);

    writeJson(settingsPath, {
      permissions: { allow: ["Bash(npm test)", "Bash(npm run build)"] },
    });
    const changed = buildTrustManifest(ws);
    expect(trustStatus(home, ws, changed.fingerprint)).toBe("changed");
    expect(isTrusted(home, ws, changed.fingerprint)).toBe(false);

    trustWorkspace(home, ws, changed.fingerprint);
    expect(trustStatus(home, ws, changed.fingerprint)).toBe("trusted");
  });
});
