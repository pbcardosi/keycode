import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeWorkspace, writeJson } from "../helpers.js";

describe("T-O2: managed policy", () => {
  it("disables a tool and cannot be overridden by user or project settings", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const managed = join(ws, "managed-settings.json");
    writeJson(managed, { permissions: { deny: ["Bash"] } });
    writeJson(join(home, "settings.json"), { permissions: { allow: ["Bash"] } });
    writeJson(join(ws, ".keycode", "settings.json"), { permissions: { allow: ["Bash"] } });

    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: { ...process.env, KEYCODE_MANAGED_SETTINGS: managed },
    });
    expect(setup.toolNames).not.toContain("Bash");
    expect(setup.toolNames).toContain("Read");
  });
});
