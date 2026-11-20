import { describe, expect, it } from "vitest";
import { PermissionService } from "../../dist/permissions/pipeline.js";
import { parseRule } from "../../dist/permissions/rules.js";
import { makeWorkspace } from "../helpers.js";

describe("T-S2: rule engine", () => {
  it("deny beats ask beats allow beats the mode default", () => {
    const ws = makeWorkspace();
    const service = new PermissionService({
      mode: "manual",
      cwd: ws,
      roots: [ws],
      rules: [
        parseRule("Bash(git *)", "user", "allow"),
        parseRule("Bash(git push *)", "user", "deny"),
        parseRule("Read(./src/**)", "user", "allow"),
        parseRule("Bash(rm *)", "user", "ask"),
      ],
    });

    const bashAllow = service.evaluate({ tool: "Bash", input: { command: "git log" }, cwd: ws, readOnly: false });
    expect(bashAllow.behavior).toBe("allow");
    expect(bashAllow.rule).toBe("Bash(git *)");

    const bashDeny = service.evaluate({ tool: "Bash", input: { command: "git push origin main" }, cwd: ws, readOnly: false });
    expect(bashDeny.behavior).toBe("deny");
    expect(bashDeny.rule).toBe("Bash(git push *)");

    const readAllow = service.evaluate({ tool: "Read", input: { file_path: "src/a.ts" }, cwd: ws, readOnly: true });
    expect(readAllow.behavior).toBe("allow");

    const readDefault = service.evaluate({ tool: "Read", input: { file_path: "docs/readme.md" }, cwd: ws, readOnly: true });
    expect(readDefault.behavior).toBe("allow");

    const askRule = service.evaluate({ tool: "Bash", input: { command: "rm file.txt" }, cwd: ws, readOnly: false });
    expect(askRule.behavior).toBe("ask");
    expect(askRule.rule).toBe("Bash(rm *)");
  });

  it("does not let a simple allow rule cover a compound command", () => {
    const ws = makeWorkspace();
    const service = new PermissionService({
      mode: "manual",
      cwd: ws,
      roots: [ws],
      rules: [
        parseRule("Bash(echo hi)", "user", "allow"),
        parseRule("Bash(npm test:*)", "user", "allow"),
        parseRule('Bash(printf "a; b")', "user", "allow"),
      ],
    });

    const exact = service.evaluate({
      tool: "Bash",
      input: { command: "echo hi" },
      cwd: ws,
      readOnly: false,
    });
    expect(exact.behavior).toBe("allow");

    const chained = service.evaluate({
      tool: "Bash",
      input: { command: "echo hi && rm -rf ." },
      cwd: ws,
      readOnly: false,
    });
    expect(chained.behavior).toBe("ask");
    expect(chained.rule).toBeUndefined();

    const extraArgs = service.evaluate({
      tool: "Bash",
      input: { command: "echo hi there" },
      cwd: ws,
      readOnly: false,
    });
    expect(extraArgs.behavior).toBe("ask");

    const prefixed = service.evaluate({
      tool: "Bash",
      input: { command: "npm test -- --watch" },
      cwd: ws,
      readOnly: false,
    });
    expect(prefixed.behavior).toBe("allow");

    const quoted = service.evaluate({
      tool: "Bash",
      input: { command: 'printf "a; b"' },
      cwd: ws,
      readOnly: false,
    });
    expect(quoted.behavior).toBe("allow");
  });
});
