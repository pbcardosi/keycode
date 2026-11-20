import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AnthropicProvider } from "../../dist/providers/anthropic.js";
import type { ModelRequest } from "../../dist/contracts/provider.js";

const bodies: Array<{ headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }> = [];
let server: Server;
let baseUrl = "";

async function listen(): Promise<void> {
  server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/messages") {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        bodies.push({ headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> });
        res.setHeader("content-type", "text/event-stream");
        res.write('event: message_start\ndata: {"message":{"usage":{"input_tokens":10,"cache_read_input_tokens":2}}}\n\n');
        res.write('event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"doit"}}\n\n');
        res.write('event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"x\\":2}"}}\n\n');
        res.write("event: content_block_stop\ndata: {\"index\":0}\n\n");
        res.write('event: message_delta\ndata: {"delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n');
        res.write("event: message_stop\ndata: {}\n\n");
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

describe("T-P2: Anthropic adapter streams tools and thinking support", () => {
  it("sends the Messages API shape and normalizes events", async () => {
    await listen();
    const provider = new AnthropicProvider({
      baseUrl,
      apiKey: "anthropic-key",
      models: ["claude-test"],
    });
    const request: ModelRequest = {
      model: "claude-test",
      system: "You are a test.",
      messages: [],
      tools: [{ name: "doit", description: "do it", inputSchema: { type: "object" } }],
    };
    const events: unknown[] = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);

    expect(events).toContainEqual({ type: "tool_call", id: "toolu_1", name: "doit", input: { x: 2 } });
    expect(events.some((event) => (event as { type: string }).type === "usage")).toBe(true);
    expect(events).toContainEqual({ type: "done", stopReason: "tool_use" });

    const sent = bodies[0];
    expect(sent?.headers["x-api-key"]).toBe("anthropic-key");
    expect(String(sent?.headers["anthropic-beta"] ?? "")).toContain("prompt-caching");
    expect(sent?.body.model).toBe("claude-test");
    expect(Array.isArray(sent?.body.tools)).toBe(true);
    expect((sent?.body.system as Array<{ cache_control?: { type: string } }>)[0]?.cache_control).toEqual({
      type: "ephemeral",
    });
  });
});
