import type { Provider } from "../contracts/provider.js";
import type { ModelEvent } from "../contracts/provider.js";
import type { Sleep } from "../util/clock.js";
import { realSleep } from "../util/clock.js";
import { KeycodeError, isKeycodeError } from "../util/errors.js";

export interface RetryOptions {
  attempts?: number | undefined;
  baseDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  sleep?: Sleep | undefined;
  jitter?: (() => number) | undefined;
}

export interface RetryAttempt {
  attempt: number;
}

export async function withRetry<T>(
  operation: (attempt: RetryAttempt) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const base = options.baseDelayMs ?? 500;
  const max = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? realSleep;
  const jitter = options.jitter ?? (() => Math.random() * 0.25 + 0.875);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation({ attempt });
    } catch (error) {
      lastError = error;
      const keycode = isKeycodeError(error) ? error : null;
      if (keycode === null || !keycode.retryable || attempt === attempts) throw error;
      const backoff = keycode.retryAfterMs ?? base * 2 ** (attempt - 1);
      await sleep(Math.min(max, backoff * jitter()));
    }
  }
  throw lastError instanceof Error ? lastError : new KeycodeError("PROVIDER_UNAVAILABLE", String(lastError));
}

export class RetryingProvider implements Provider {
  readonly id: string;
  private readonly inner: Provider;
  private readonly options: RetryOptions;

  constructor(inner: Provider, options: RetryOptions = {}) {
    this.inner = inner;
    this.id = inner.id;
    this.options = options;
  }

  listModels(): Promise<import("../contracts/provider.js").ModelInfo[]> {
    return this.inner.listModels();
  }

  async *stream(...args: Parameters<Provider["stream"]>): AsyncIterable<ModelEvent> {
    const [request, signal] = args;
    let lastError: unknown;
    const attempts = Math.max(1, this.options.attempts ?? 3);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let emitted = false;
      try {
        for await (const event of this.inner.stream(request, signal)) {
          emitted = true;
          if (event.type === "error") throw event.error;
          yield event;
        }
        return;
      } catch (error) {
        lastError = error;
        if (signal.aborted) {
          yield { type: "done", stopReason: "aborted" };
          return;
        }
        const keycode = isKeycodeError(error) ? error : null;
        if (emitted || keycode === null || !keycode.retryable || attempt === attempts) throw error;
        const base = this.options.baseDelayMs ?? 500;
        const delay = Math.min(
          this.options.maxDelayMs ?? 30_000,
          keycode.retryAfterMs ?? base * 2 ** (attempt - 1),
        );
        await (this.options.sleep ?? realSleep)(delay);
      }
    }
    throw lastError;
  }
}
