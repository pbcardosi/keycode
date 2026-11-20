import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

describe("T-C7: Checkpoints and rewind", () => {
  it("restores files and truncates messages for conversation+files rewind", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const store = setup.store;
    const id = setup.sessionId;
    const file = join(ws, "f.txt");
    writeText(file, "v1");
    const checkpoint = setup.checkpoints.create(id, 1, [file], 0);
    writeText(file, "v2");
    store.appendMessage(id, {
      id: "m1",
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: new Date().toISOString(),
    });
    expect(store.load(id).messages.length).toBe(1);

    const out: string[] = [];
    const result = await executeCommand(`/rewind ${checkpoint.id} both`, {
      setup,
      agent: setup.agent,
      out: (line) => out.push(line),
      signal: new AbortController().signal,
    });
    expect(result.handled).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("v1");
    expect(store.load(id).messages.length).toBe(0);
  });

  it("restores files only with mode files", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const store = setup.store;
    const id = setup.sessionId;
    const file = join(ws, "g.txt");
    writeText(file, "v1");
    const checkpoint = setup.checkpoints.create(id, 1, [file], 0);
    writeText(file, "v2");
    store.appendMessage(id, {
      id: "m1",
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: new Date().toISOString(),
    });
    await executeCommand(`/rewind ${checkpoint.id} files`, {
      setup,
      agent: setup.agent,
      out: () => undefined,
      signal: new AbortController().signal,
    });
    expect(readFileSync(file, "utf8")).toBe("v1");
    expect(store.load(id).messages.length).toBe(1);
  });
});
