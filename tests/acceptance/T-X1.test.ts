import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverCommands, findCommand, renderCommand } from "../../dist/extensions/commands.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

describe("T-X1: Custom commands", () => {
  it("loads frontmatter, renders args and approved injections, and lists in /help", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(
      join(ws, ".keycode", "commands", "review.md"),
      [
        "---",
        "description: Review code",
        "argument-hint: <path>",
        "allowed-tools: Read, Grep",
        "---",
        "Review $ARGUMENTS at $1.",
        "!echo injected",
      ].join("\n"),
    );

    const commands = discoverCommands({ cwd: ws, home, trusted: true });
    const review = findCommand(commands, "review");
    expect(review).toBeDefined();
    expect(review?.description).toBe("Review code");
    expect(review?.argumentHint).toBe("<path>");
    expect(review?.allowedTools).toEqual(["Read", "Grep"]);

    const approvals: string[] = [];
    const rendered = renderCommand(review as NonNullable<typeof review>, "src/a.ts", {
      runInjection: (command) => {
        approvals.push(command);
        return "injected-out";
      },
    });
    expect(rendered).toContain("Review src/a.ts at src/a.ts");
    expect(rendered).toContain("injected-out");
    expect(approvals).toEqual(["echo injected"]);

    const denied = renderCommand(review as NonNullable<typeof review>, "src/a.ts");
    expect(denied).toContain("[injection denied]");

    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    expect(setup.commands.some((command) => command.name === "review")).toBe(true);
    const out: string[] = [];
    await executeCommand("/help", {
      setup,
      agent: setup.agent,
      out: (line) => out.push(line),
      signal: new AbortController().signal,
    });
    expect(out.join("\n")).toContain("/review");
    expect(out.join("\n")).toContain("Review code");
  });
});
