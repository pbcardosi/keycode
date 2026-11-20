import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteLine, discoverThemes, loadKeybindings } from "../../dist/extensions/themes.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

describe("T-X9: themes and keys", () => {
  it("loads themes and keybindings, warns on invalid bindings, and supports vim dd", () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(
      join(ws, ".keycode", "themes", "ocean.json"),
      JSON.stringify({ name: "ocean", colors: { accent: "blue" } }),
    );
    writeText(join(ws, ".keycode", "keybindings.json"), JSON.stringify({ submit: "ctrl+s" }));

    const themes = discoverThemes({ cwd: ws, home, trusted: true });
    expect(themes.some((theme) => theme.name === "ocean")).toBe(true);
    expect(themes.some((theme) => theme.name === "default")).toBe(true);

    const { bindings, warnings } = loadKeybindings({ cwd: ws, home, trusted: true });
    expect(bindings.submit).toContain("ctrl+s");
    expect(warnings).toEqual([]);

    expect(deleteLine("a\nb\nc\n", 1)).toBe("a\nc\n");

    writeText(join(ws, ".keycode", "keybindings.json"), JSON.stringify({ submit: "ctrl+shift+ " }));
    const invalid = loadKeybindings({ cwd: ws, home, trusted: true });
    expect(invalid.warnings.length).toBeGreaterThan(0);
    expect(invalid.bindings.submit).toEqual(["return", "enter"]);
  });
});
