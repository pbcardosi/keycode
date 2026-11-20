export interface SseEvent {
  event?: string | undefined;
  data: string;
}

function toReader(body: unknown): {
  read(): Promise<{ value: Uint8Array | undefined; done: boolean }>;
  cancel?(): void;
} {
  if (body !== null && typeof body === "object" && "getReader" in body) {
    const stream = body as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    return {
      read: async () => {
        const result = await reader.read();
        return { value: result.value, done: result.done };
      },
      cancel: () => reader.cancel().catch(() => undefined),
    };
  }
  if (body !== null && typeof body === "object" && Symbol.asyncIterator in body) {
    const iterator = (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
    return {
      read: async () => {
        const result = await iterator.next();
        return {
          value: result.value === undefined ? undefined : new Uint8Array(result.value),
          done: result.done === true,
        };
      },
    };
  }
  throw new Error("Unsupported SSE body");
}

function parseChunk(chunk: string): { event?: string | undefined; data: string } | null {
  const lines = chunk.split(/\r?\n/);
  let eventName: string | undefined;
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    if (field === "data") data.push(value);
  }
  if (data.length === 0 && eventName === undefined) return null;
  return { event: eventName, data: data.join("\n") };
}

export async function* readSse(body: unknown, signal: AbortSignal): AsyncIterable<SseEvent> {
  const reader = toReader(body);
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal.aborted) {
      reader.cancel?.();
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.search(/\r?\n\r?\n/);
    while (split !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, "");
      const parsed = parseChunk(raw);
      if (parsed) yield parsed;
      split = buffer.search(/\r?\n\r?\n/);
    }
  }
  buffer += decoder.decode();
  const parsed = parseChunk(buffer);
  if (parsed) yield parsed;
}
