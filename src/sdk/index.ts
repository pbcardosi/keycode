import { createAgentSetup, type AgentSetupOptions } from "../app/factory.js";
import type { AgentEvent, TurnResult } from "../app/agent.js";
import { parseStructuredOutput } from "./structured.js";

export interface CreateAgentOptions extends AgentSetupOptions {
  signal?: AbortSignal | undefined;
}

export interface SdkAgent {
  sessionId: string;
  run(prompt: string, signal?: AbortSignal): Promise<TurnResult>;
  stream(prompt: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  runStructured(prompt: string, schema: unknown, signal?: AbortSignal): Promise<unknown>;
  abort(): void;
  close(): void;
}

export async function createAgent(options: CreateAgentOptions): Promise<SdkAgent> {
  const setup = await createAgentSetup(options);
  let controller = new AbortController();

  return {
    sessionId: setup.sessionId,
    async run(prompt: string, signal?: AbortSignal): Promise<TurnResult> {
      return await setup.agent.runTurn(prompt, signal ?? controller.signal);
    },
    async *stream(prompt: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
      const queue: AgentEvent[] = [];
      let finished = false;
      let failure: unknown = null;
      const unsubscribe = setup.agent.subscribe((event) => queue.push(event));
      const running = setup.agent
        .runTurn(prompt, signal ?? controller.signal)
        .then((result) => {
          queue.push({ type: "done", stopReason: result.stopReason });
          finished = true;
        })
        .catch((error: unknown) => {
          failure = error;
          finished = true;
        });
      try {
        while (!finished || queue.length > 0) {
          const event = queue.shift();
          if (event) {
            yield event;
          } else {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
          }
        }
      } finally {
        unsubscribe();
      }
      await running;
      if (failure !== null) throw failure;
    },
    async runStructured(prompt: string, schema: unknown, signal?: AbortSignal): Promise<unknown> {
      const result = await setup.agent.runTurn(prompt, signal ?? controller.signal);
      return parseStructuredOutput(result.text, schema);
    },
    abort(): void {
      controller.abort();
      controller = new AbortController();
    },
    close(): void {
      controller.abort();
    },
  };
}
