import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AutoMemoryStore, extractMemory } from "../../dist/storage/autoMemory.js";
import { FakeProvider } from "../../dist/providers/fake.js";
import { projectDir } from "../../dist/util/paths.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeWorkspace } from "../helpers.js";

describe("T-M3: auto-memory", () => {
  it("extracts a memory, recalls it in a new session, and pause disables recall", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const store = new AutoMemoryStore(join(projectDir(home, ws), "memory.json"));
    const provider = new FakeProvider({
      script: [
        { type: "text", delta: "The project uses pnpm workspaces." },
        { type: "done", stopReason: "end_turn" },
      ],
    });
    const message = {
      id: "m1",
      role: "user" as const,
      content: [{ type: "text" as const, text: "we use pnpm" }],
      timestamp: new Date().toISOString(),
    };
    const extracted = await extractMemory(provider, "fake-model", [message], new AbortController().signal);
    expect(extracted).toContain("pnpm");
    store.add(extracted ?? "");
    expect(store.list()).toHaveLength(1);

    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    expect(setup.agent.prompt).toContain("pnpm");
    expect(setup.autoMemory.list()).toHaveLength(1);

    store.pause();
    expect(store.recall()).toEqual([]);
    const paused = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    expect(paused.agent.prompt).not.toContain("pnpm");

    store.resume();
    store.add("Another durable fact.");
    expect(store.list()).toHaveLength(2);
  });
});
