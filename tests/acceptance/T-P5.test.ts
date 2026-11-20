import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProvider } from "../../dist/providers/registry.js";
import type { ModelRequest } from "../../dist/contracts/provider.js";
import { makeHome } from "../helpers.js";

const requests: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> = [];

let server: Server;
let baseUrl = "";

async function listen(): Promise<void> {
  server = createServer((req, res) => {
    requests.push({ url: req.url ?? "", headers: req.headers });
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }));
      return;
    }
    if (req.url === "/v1/chat/completions") {
      res.setHeader("content-type", "text/event-stream");
      res.write('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n');
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

afterAll(() => {
  server?.close();
});

function turn(): ModelRequest {
  return { model: "m1", system: "", messages: [], tools: [] };
}

async function collect(provider: { stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<unknown> }): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of provider.stream(turn(), new AbortController().signal)) events.push(event);
  return events;
}

describe("T-P5: local presets work without a key", () => {
  it("lists models on a local server and sends no Authorization header", async () => {
    await listen();
    const home = makeHome();
    const provider = createProvider({
      id: "ollama",
      home,
      settings: { providers: { ollama: { baseUrl: `${baseUrl}/v1` } } },
    });
    expect(provider.local).toBe(true);
    const models = await provider.provider.listModels();
    expect(models.map((model) => model.id).sort()).toEqual(["m1", "m2"]);

    const events = await collect(provider.provider);
    expect(events.some((event) => (event as { type: string }).type === "text")).toBe(true);

    const sent = requests.find((request) => request.url === "/v1/chat/completions");
    expect(sent).toBeDefined();
    expect(sent?.headers.authorization).toBeUndefined();
  });
});
