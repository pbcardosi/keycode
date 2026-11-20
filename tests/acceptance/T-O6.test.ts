import { describe, expect, it } from "vitest";
import {
  displayWidth,
  fromCRLF,
  isWsl,
  normalizePath,
  selectShell,
  terminalCapabilities,
  toCRLF,
} from "../../dist/platform/index.js";

describe("T-O6: cross-platform", () => {
  it("selects shells, normalizes paths, and handles terminal and Unicode rules", () => {
    expect(selectShell("win32", {}).command).toContain("powershell");
    expect(selectShell("linux", { SHELL: "/bin/zsh" }).command).toBe("/bin/zsh");
    expect(selectShell("linux", {}).args).toContain("-lc");
    expect(selectShell("darwin", {}).command).toBe("/bin/bash");

    expect(isWsl({ WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
    expect(isWsl({})).toBe(false);
    expect(normalizePath("a/b", "win32")).toBe("a\\b");
    expect(normalizePath("a\\b", "linux")).toBe("a/b");

    expect(displayWidth("a你")).toBe(3);
    expect(displayWidth("\x1b[31mred\x1b[0m")).toBe(3);
    expect(displayWidth("😀")).toBe(2);
    expect(toCRLF("a\nb")).toBe("a\r\nb");
    expect(fromCRLF("a\r\nb")).toBe("a\nb");
    expect(terminalCapabilities({ NO_COLOR: "1" }).color).toBe(false);
  });
});
