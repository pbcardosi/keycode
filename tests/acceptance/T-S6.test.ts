import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeWorkspace, writeJson, writeText } from "../helpers.js";

describe("T-S6: restricted modes", () => {
  it("restricted removes code-running tools and WebFetch unless explicitly named", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true, restricted: true });
    expect(setup.toolNames).not.toContain("Bash");
    expect(setup.toolNames).not.toContain("PowerShell");
    expect(setup.toolNames).not.toContain("Agent");
    expect(setup.toolNames).not.toContain("WebFetch");
    expect(setup.toolNames).toContain("Read");

    const named = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      restricted: true,
      allowedTools: ["Bash"],
    });
    expect(named.toolNames).toContain("Bash");
  });

  it("safe mode disables custom commands", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(join(ws, ".keycode", "commands", "review.md"), "---\ndescription: Review\n---\nReview it.\n");
    const normal = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    expect(normal.commands.some((command) => command.name === "review")).toBe(true);

    const safe = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true, safeMode: true });
    expect(safe.commands).toEqual([]);
  });

  it("bare mode skips memory", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(join(ws, "CLAUDE.md"), "BARE_MEMORY_MARKER\n");
    const normal = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    expect(normal.agent.prompt).toContain("BARE_MEMORY_MARKER");

    const bare = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true, bare: true });
    expect(bare.agent.prompt).not.toContain("BARE_MEMORY_MARKER");
  });

  it("managed policy still applies in restricted modes", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const managed = join(ws, "managed.json");
    writeJson(managed, { permissions: { deny: ["Bash"] } });
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      restricted: true,
      allowedTools: ["Bash"],
      env: { ...process.env, KEYCODE_MANAGED_SETTINGS: managed },
    });
    expect(setup.toolNames).not.toContain("Bash");
  });
});
