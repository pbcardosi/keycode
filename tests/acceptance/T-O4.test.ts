import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { OtelExporter } from "../../dist/telemetry/otel.js";

let server: Server;
let endpoint = "";
const bodies: unknown[] = [];

async function listen(): Promise<void> {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        bodies.push(JSON.parse(raw) as unknown);
      } catch {
        bodies.push(raw);
      }
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/metrics`;
}

afterAll(() => {
  server?.close();
});

describe("T-O4: OpenTelemetry", () => {
  it("exports token, cost, and tool-latency metrics with redacted attributes", async () => {
    await listen();
    const exporter = new OtelExporter({ endpoint, serviceName: "keycode-test" });
    exporter.record({ name: "keycode.tokens", value: 10, attributes: { input: 10, model: "fake" } });
    exporter.record({ name: "keycode.cost", value: 0.01, attributes: { usd: 0.01 } });
    exporter.record({
      name: "keycode.tool.latency",
      value: 12,
      attributes: { tool: "Bash", apiKey: "sk-ant-abc1234567890123" },
    });
    expect(exporter.pending).toBe(3);
    expect(await exporter.flush()).toBe(true);

    const body = bodies[0] as {
      resourceMetrics: Array<{
        resource: { attributes: unknown[] };
        scopeMetrics: Array<{ metrics: Array<{ name: string; gauge: unknown }> }>;
      }>;
    };
    const metrics = body.resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? [];
    expect(metrics.map((metric) => metric.name)).toEqual([
      "keycode.tokens",
      "keycode.cost",
      "keycode.tool.latency",
    ]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("sk-ant-abc1234567890123");
    expect(serialized).toContain("[REDACTED:anthropic-key]");

    const sampledOff = new OtelExporter({ endpoint, sampleRate: 0 });
    sampledOff.record({ name: "keycode.tokens", value: 1, attributes: {} });
    expect(sampledOff.pending).toBe(0);
  });
});
