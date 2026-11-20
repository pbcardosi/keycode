import { describe, expect, it } from "vitest";
import type { ModelEvent, ModelInfo, ModelRequest, Provider } from "../../dist/contracts/provider.js";
import { Agent } from "../../dist/app/agent.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { FakeProvider } from "../../dist/providers/fake.js";
import { RetryingProvider } from "../../dist/providers/retry.js";
import { PermissionService } from "../../dist/permissions/pipeline.js";
import { makeHome, makeWorkspace } from "../helpers.js";

class RecordingProvider implements Provider {
  readonly id: string;
  readonly requests: ModelRequest[] = [];
  private readonly script: ModelEvent[];

  constructor(id: string, script: ModelEvent[]) {
    this.id = id;
    this.script = script;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: this.id,
        provider: this.id,
        displayName: this.id,
        contextWindow: 1000,
        maxOutputTokens: 100,
        capabilities: { streaming: true, tools: true, vision: true, jsonSchema: true, thinking: false },
      },
    ];
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    for (const event of this.script) yield event;
  }
}

describe("T-C10: Model and effort selection", () => {
  it("selects the model and effort per session and updates via /model and /effort", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", model: "fake-v2", effort: "high", trust: true });
    expect(setup.model).toBe("fake-v2");
    expect(setup.store.load(setup.sessionId).header.model).toBe("fake-v2");
    expect(setup.agent.effort).toBe("high");

    setup.agent.setModel("fake-v3");
    expect(setup.agent.model).toBe("fake-v3");
    setup.agent.setEffort("low");
    expect(setup.agent.effort).toBe("low");
  });

  it("uses the fallback model after the primary fails and includes effort", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const cwd = ws;
    const store = new (await import("../../dist/storage/session.js")).SessionStore(home, cwd);
    const header = store.create({ provider: "fake", model: "primary" });

    const failing = new FakeProvider({ script: [{ type: "error", code: "PROVIDER_RATE_LIMIT", message: "limit" }] });
    const fallback = new RecordingProvider("fallback", [
      { type: "text", delta: "fallback ok" },
      { type: "done", stopReason: "end_turn" },
    ]);

    const agent = new Agent({
      sessionId: header.id,
      store,
      provider: new RetryingProvider(failing, { attempts: 1 }),
      providerId: "fake",
      model: "primary",
      tools: [],
      permissions: new PermissionService({ mode: "bypassPermissions", cwd, roots: [cwd] }),
      home,
      cwd,
      workspaceRoots: [cwd],
      systemPrompt: "",
      fallback: { provider: fallback, model: "fb-model" },
      effort: "high",
    });

    const result = await agent.runTurn("hi", new AbortController().signal);
    expect(result.text).toContain("fallback ok");
    expect(fallback.requests[0]?.model).toBe("fb-model");
    expect(fallback.requests[0]?.effort).toBe("high");
  });
});
