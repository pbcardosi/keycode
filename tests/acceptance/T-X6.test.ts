import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverCommands, findCommand } from "../../dist/extensions/commands.js";
import {
  collectPluginHooks,
  enabledPluginDirs,
  installPlugin,
  listPlugins,
  pinPlugin,
  removePlugin,
  setPluginEnabled,
} from "../../dist/extensions/plugins.js";
import { makeHome, makeWorkspace, writeJson, writeText } from "../helpers.js";

describe("T-X6: plugins", () => {
  it("installs, discovers, disables, pins, and removes a local plugin", () => {
    const home = makeHome();
    const source = makeWorkspace("plugin-src");
    writeJson(join(source, "plugin.json"), { name: "hello", version: "1.0.1", description: "Hello plugin" });
    writeText(join(source, "commands", "hello.md"), "---\ndescription: Hello command\n---\nSay hello.\n");
    writeJson(join(source, "hooks.json"), {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo hook" }] }],
    });

    const installed = installPlugin(home, source, { trusted: true });
    expect(installed.trusted).toBe(true);
    expect(listPlugins(home)).toHaveLength(1);

    const commands = discoverCommands({
      cwd: makeWorkspace(),
      home,
      trusted: true,
      extraDirs: enabledPluginDirs(home).map((dir) => join(dir, "commands")),
    });
    expect(findCommand(commands, "hello")?.description).toBe("Hello command");
    expect(collectPluginHooks(home)).toHaveProperty("UserPromptSubmit");

    setPluginEnabled(home, "hello", false);
    expect(enabledPluginDirs(home)).toEqual([]);
    expect(collectPluginHooks(home)).toEqual({});

    expect(pinPlugin(home, "hello", "1.0.0")?.pinnedVersion).toBe("1.0.0");
    expect(removePlugin(home, "hello")).toBe(true);
    expect(listPlugins(home)).toHaveLength(0);
  });
});
