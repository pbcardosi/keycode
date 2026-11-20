import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents } from "../../dist/extensions/customAgents.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

const AGENT = [
  "---",
  "name: restricted",
  "description: Read-only agent",
  "tools: Read",
  "model: fake-model",
  "permission-mode: manual",
  "---",
  "You may only read.",
].join("\n");

describe("T-X3: custom agents", () => {
  it("loads agent frontmatter and lists agents", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(join(ws, ".keycode", "agents", "restricted.md"), AGENT);

    const agents = discoverAgents({ cwd: ws, home, trusted: true });
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: "restricted",
      description: "Read-only agent",
      tools: ["Read"],
      model: "fake-model",
      permissionMode: "manual",
    });

    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const out: string[] = [];
    await executeCommand("/agents", {
      setup,
      agent: setup.agent,
      out: (line) => out.push(line),
      signal: new AbortController().signal,
    });
    expect(out.join("\n")).toContain("restricted");
    expect(out.join("\n")).toContain("Read-only agent");
  });
});
