import type { ModelEvent, ModelInfo, ModelRequest, Provider } from "../contracts/provider.js";
import { KeycodeError, type ErrorCode } from "../util/errors.js";

export type FakeStep =
  | Exclude<ModelEvent, { type: "error" }>
  | { type: "delay"; ms: number }
  | { type: "error"; code: ErrorCode; message: string };

export type FakeScript = FakeStep[] | FakeStep[][] | { turns: FakeStep[][] };

export interface FakeProviderOptions {
  script?: FakeScript | undefined;
  model?: string | undefined;
  contextWindow?: number | undefined;
  delayMs?: number | undefined;
}

function isTurnList(script: FakeScript): script is FakeStep[][] | { turns: FakeStep[][] } {
  if (Array.isArray(script)) {
    return script.length > 0 && Array.isArray(script[0]);
  }
  return "turns" in script;
}

export class FakeProvider implements Provider {
  readonly id = "fake";
  private readonly script: FakeScript;
  private readonly modelId: string;
  private readonly window: number;
  private callIndex = 0;

  constructor(options: FakeProviderOptions = {}) {
    this.script =
      options.script ?? [
        { type: "text", delta: "fake response" },
        { type: "done", stopReason: "end_turn" },
      ];
    this.modelId = options.model ?? "fake-model";
    this.window = options.contextWindow ?? 128_000;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: this.modelId,
        provider: "fake",
        displayName: "Fake model",
        contextWindow: this.window,
        maxOutputTokens: 8_192,
        capabilities: {
          streaming: true,
          tools: true,
          vision: true,
          jsonSchema: true,
          thinking: true,
        },
      },
    ];
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    void request;
    let steps: FakeStep[];
    if (isTurnList(this.script)) {
      const turns = Array.isArray(this.script) ? this.script : this.script.turns;
      steps = turns[Math.min(this.callIndex, turns.length - 1)] ?? [];
    } else {
      steps = this.script;
    }
    this.callIndex += 1;

    for (const step of steps) {
      if (signal.aborted) {
        yield { type: "done", stopReason: "aborted" };
        return;
      }
      if (step.type === "delay") {
        const aborted = await sleep(step.ms, signal);
        if (aborted) {
          yield { type: "done", stopReason: "aborted" };
          return;
        }
        continue;
      }
      if (step.type === "error") {
        yield { type: "error", error: new KeycodeError(step.code, step.message) };
        return;
      }
      yield step;
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function parseFakeScript(raw: string): FakeScript {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed as FakeStep[];
  if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { turns?: unknown }).turns)) {
    return parsed as { turns: FakeStep[][] };
  }
  throw new KeycodeError("CONFIG_INVALID", "KEYCODE_FAKE_SCRIPT must be a JSON array or { turns: [...] }");
}
