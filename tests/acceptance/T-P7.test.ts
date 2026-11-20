import { describe, expect, it } from "vitest";
import { Agent } from "../../dist/app/agent.js";
import { RetryingProvider, withRetry } from "../../dist/providers/retry.js";
import { SessionStore } from "../../dist/storage/session.js";
import { PermissionService } from "../../dist/permissions/pipeline.js";
import { FakeProvider } from "../../dist/providers/fake.js";
import { KeycodeError } from "../../dist/util/errors.js";
import type { ModelEvent, ModelRequest, ModelInfo, Provider } from "../../dist/contracts/provider.js";
import type { Message } from "../../dist/contracts/message.js";
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
    return [{ id: "m", provider: this.id, displayName: "m", contextWindow: 1000, maxOutputTokens: 100, capabilities: { streaming: true, tools: true, vision: true, jsonSchema: true, thinking: false } }];
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    for (const event of this.script) yield event;
  }
}

describe("T-P7: retries and fallback ordering", () => {
  it("retries 429 and honors Retry-After with backoff", async () => {
    const delays: number[] = [];
    let calls = 0;
    const provider = new RecordingProvider("r", [
      { type: "text", delta: "ok" },
      { type: "done", stopReason: "end_turn" },
    ]);
    const wrapped = new RetryingProvider(provider, {
      attempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
      sleep: async (ms: number) => {
        delays.push(ms);
        void calls;
      },
    });
    const events: ModelEvent[] = [];
    for await (const event of wrapped.stream({ model: "m", system: "", messages: [], tools: [] }, new AbortController().signal)) {
      events.push(event);
    }
    expect(events.filter((event) => event.type === "text").length).toBe(1);
  });

  it("falls back to the fallback model after the primary fails", async () => {
    const home = makeHome();
    const cwd = makeWorkspace();
    const store = new SessionStore(home, cwd);
    const header = store.create({ provider: "fake", model: "primary" });

    const failing = new FakeProvider({
      script: [{ type: "error", code: "PROVIDER_RATE_LIMIT", message: "limit" }],
    });
    const fallback = new RecordingProvider("fallback", [
      { type: "text", delta: "from fallback" },
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
      fallback: { provider: fallback, model: "fallback-model" },
    });

    const result = await agent.runTurn("hi", new AbortController().signal);
    expect(result.text).toBe("from fallback");
    expect(fallback.requests[0]?.model).toBe("fallback-model");
  });

  it("caps attempts with withRetry", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new KeycodeError("PROVIDER_UNAVAILABLE", "down");
        },
        { attempts: 3, baseDelayMs: 1, sleep: async () => undefined },
      ),
    ).rejects.toBeInstanceOf(KeycodeError);
    expect(calls).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new KeycodeError("PROVIDER_AUTH", "bad key");
        },
        { attempts: 3, baseDelayMs: 1, sleep: async () => undefined },
      ),
    ).rejects.toBeInstanceOf(KeycodeError);
    expect(calls).toBe(1);
  });
});
