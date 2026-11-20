import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace } from "../helpers.js";

describe("T-C9: Transcript actions", () => {
  it("exports markdown and JSON transcripts", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    await setup.agent.runTurn("hello", new AbortController().signal);

    const mdOut: string[] = [];
    const md = await executeCommand("/export transcript.md", {
      setup,
      agent: setup.agent,
      out: (line) => mdOut.push(line),
      signal: new AbortController().signal,
    });
    expect(md.handled).toBe(true);
    expect(existsSync(join(ws, "transcript.md"))).toBe(true);
    expect(readFileSync(join(ws, "transcript.md"), "utf8")).toContain("keycode session");

    const jsonOut: string[] = [];
    const json = await executeCommand("/export transcript.json", {
      setup,
      agent: setup.agent,
      out: (line) => jsonOut.push(line),
      signal: new AbortController().signal,
    });
    expect(json.handled).toBe(true);
    expect(existsSync(join(ws, "transcript.json"))).toBe(true);
    expect(readFileSync(join(ws, "transcript.json"), "utf8")).toContain('"type"');
  });

  it("copies the Nth-latest assistant response", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    await setup.agent.runTurn("hello", new AbortController().signal);
    const out: string[] = [];
    await executeCommand("/copy 1", { setup, agent: setup.agent, out: (line) => out.push(line), signal: new AbortController().signal });
    expect(out.join("\n")).toContain("fake response");
  });

  it("renames the session", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const id = setup.sessionId;
    const out: string[] = [];
    await executeCommand("/rename mysession", { setup, agent: setup.agent, out: (line) => out.push(line), signal: new AbortController().signal });
    expect(setup.store.load(id).name).toBe("mysession");
  });

  it("clears the session", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const result = await executeCommand("/clear", {
      setup,
      agent: setup.agent,
      out: () => undefined,
      signal: new AbortController().signal,
    });
    expect(result.clear).toBe(true);
  });
});
