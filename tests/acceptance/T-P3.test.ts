import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAiCompatibleProvider } from "../../dist/providers/openai.js";
import type { ModelRequest } from "../../dist/contracts/provider.js";

const bodies: Array<{ body: Record<string, unknown> }> = [];
let server: Server;
let baseUrl = "";

async function listen(): Promise<void> {
  server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        bodies.push({ body: JSON.parse(raw) as Record<string, unknown> });
        res.setHeader("content-type", "text/event-stream");
        res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"echo","arguments":"{\\"a\\":1}"}}]},"finish_reason":null}]}\n\n');
        res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
      });
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

describe("T-P3: OpenAI-compatible adapter streams tools and usage", () => {
  it("normalizes text, tool calls, and done", async () => {
    await listen();
    const provider = new OpenAiCompatibleProvider({
      id: "openai-test",
      baseUrl: `${baseUrl}/v1`,
      apiKey: "test-key",
      models: ["test-model"],
    });
    const models = await provider.listModels();
    expect(models.map((model) => model.id)).toEqual(["test-model"]);

    const request: ModelRequest = {
      model: "test-model",
      system: "",
      messages: [],
      tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" } }],
    };
    const events: unknown[] = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);

    expect(events).toContainEqual({ type: "tool_call", id: "call_1", name: "echo", input: { a: 1 } });
    expect(events).toContainEqual({ type: "done", stopReason: "tool_use" });

    const body = bodies[0]?.body;
    expect(body?.model).toBe("test-model");
    expect(Array.isArray(body?.tools)).toBe(true);
    const tools = body?.tools as Array<{ type: string; function: { name: string; parameters: unknown } }>;
    expect(tools[0]?.type).toBe("function");
    expect(tools[0]?.function.name).toBe("echo");
    expect(tools[0]?.function.parameters).toEqual({ type: "object" });
  });
});
