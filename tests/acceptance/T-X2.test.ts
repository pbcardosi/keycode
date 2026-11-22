import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkills } from "../../dist/extensions/skills.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

const SKILL = [
  "---",
  "name: hello",
  "description: Hello skill",
  "allowed-tools: Read",
  "---",
  "Use only Read. Args: $ARGUMENTS",
].join("\n");

describe("T-X2: Skills", () => {
  it("lists metadata, does not inject the body, and reloads on change", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const file = join(ws, ".keycode", "skills", "hello", "SKILL.md");
    writeText(file, SKILL);

    const skills = discoverSkills({ cwd: ws, home, trusted: true });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("hello");
    expect(skills[0]?.description).toBe("Hello skill");
    expect(skills[0]?.allowedTools).toEqual(["Read"]);
    expect("body" in (skills[0] as object)).toBe(false);

    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    expect(setup.agent.prompt).toContain("# Available skills");
    expect(setup.agent.prompt).toContain("hello: Hello skill");
    expect(setup.agent.prompt).not.toContain("Use only Read");

    const out: string[] = [];
    await executeCommand("/skills", {
      setup,
      agent: setup.agent,
      out: (line) => out.push(line),
      signal: new AbortController().signal,
    });
    expect(out.join("\n")).toContain("hello");
    expect(out.join("\n")).toContain("Hello skill");

    writeText(file, SKILL.replace("Hello skill", "Updated skill"));
    const reloaded = discoverSkills({ cwd: ws, home, trusted: true });
    expect(reloaded[0]?.description).toBe("Updated skill");

    writeText(
      join(home, "skills", "user-only", "SKILL.md"),
      ["---", "name: user-only", "description: User skill", "---", "User body."].join("\n"),
    );
    writeText(join(home, "skills", "hello", "SKILL.md"), SKILL.replace("Hello skill", "User hello"));
    const merged = discoverSkills({ cwd: ws, home, trusted: true });
    expect(merged.map((skill) => skill.name)).toContain("user-only");
    expect(merged.find((skill) => skill.name === "hello")?.description).toBe("Updated skill");
  });
});
