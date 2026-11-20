import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { OtelExporter } from "../../dist/telemetry/otel.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeWorkspace, writeJson } from "../helpers.js";

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

  it("emits turn metrics from a real agent turn when telemetry is enabled", async () => {
    await listen();
    bodies.length = 0;
    const home = makeHome();
    const ws = makeWorkspace();
    writeJson(join(home, "privacy.json"), { consent: "granted", telemetry: true });
    writeJson(join(home, "settings.json"), {
      otel: { endpoint, serviceName: "keycode-runtime" },
    });
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: {
        ...process.env,
        KEYCODE_HOME: home,
        KEYCODE_PROVIDER: "fake",
        KEYCODE_FAKE_SCRIPT: JSON.stringify([
          { type: "text", delta: "hello" },
          { type: "done", stopReason: "end_turn" },
        ]),
      },
    });
    await setup.agent.runTurn("hi", new AbortController().signal);
    await setup.telemetry?.flush();
    const deadline = Date.now() + 5_000;
    while (bodies.length === 0 && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 50));
    }
    const metrics = bodies.flatMap((body) => {
      const payload = body as {
        resourceMetrics?: Array<{
          scopeMetrics?: Array<{ metrics?: Array<{ name: string }> }>;
        }>;
      };
      return payload.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics ?? [];
    });
    expect(metrics.map((metric) => metric.name)).toEqual(
      expect.arrayContaining([
        "keycode.turns",
        "keycode.tokens.input",
        "keycode.tokens.output",
        "keycode.cost.usd",
        "keycode.tool_calls",
      ]),
    );
  });
});
