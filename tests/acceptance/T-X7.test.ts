import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverStyles } from "../../dist/extensions/styles.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

const STYLE = [
  "---",
  "name: concise",
  "description: Short answers",
  "---",
  "Be very concise. Avoid preamble.",
].join("\n");

describe("T-X7: output styles", () => {
  it("injects a custom style into the prompt, lists it, and keeps it on resume", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(join(ws, ".keycode", "output-styles", "concise.md"), STYLE);

    const styles = discoverStyles({ cwd: ws, home, trusted: true });
    expect(styles.some((style) => style.name === "concise" && style.body.includes("Be very concise"))).toBe(true);

    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      outputStyle: "concise",
    });
    expect(setup.outputStyle).toBe("concise");
    expect(setup.agent.prompt).toContain("Be very concise");

    const out: string[] = [];
    await executeCommand("/output-style", {
      setup,
      agent: setup.agent,
      out: (line) => out.push(line),
      signal: new AbortController().signal,
    });
    expect(out.join("\n")).toContain("concise");

    const resumed = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      resume: setup.sessionId,
    });
    expect(resumed.agent.prompt).toContain("Be very concise");
  });
});
