import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startGateway } from "../../dist/gateway/index.js";

let upstream: Server | undefined;
let upstreamUrl = "";
let lastAuthorization: string | undefined;

async function listenUpstream(): Promise<void> {
  upstream = createServer((req, res) => {
    lastAuthorization = req.headers.authorization;
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, received: raw }));
    });
  });
  await new Promise<void>((resolvePromise) => upstream?.listen(0, "127.0.0.1", resolvePromise));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
}

afterAll(() => {
  upstream?.close();
});

describe("T-O5: gateway", () => {
  it("authenticates, injects the provider key, rate limits, and blocks private targets", async () => {
    await listenUpstream();
    const gateway = await startGateway({
      apiKey: "provider-key",
      clientTokens: ["client-token"],
      allowPrivate: true,
      rateLimit: { requests: 1, windowMs: 60_000 },
    });
    const target = `${gateway.url}/?url=${encodeURIComponent(upstreamUrl)}`;

    const ok = await fetch(target, {
      method: "POST",
      headers: { authorization: "Bearer client-token", "content-type": "application/json" },
      body: '{"hello":1}',
    });
    expect(ok.status).toBe(200);
    expect(lastAuthorization).toBe("Bearer provider-key");
    expect(await ok.text()).toContain("hello");

    const unauthorized = await fetch(target, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(unauthorized.status).toBe(401);

    const limited = await fetch(target, {
      method: "POST",
      headers: { authorization: "Bearer client-token" },
    });
    expect(limited.status).toBe(429);
    expect(gateway.audit.some((entry) => entry.status === 200 && entry.allowed)).toBe(true);
    await gateway.close();

    const blockedGateway = await startGateway({
      apiKey: "k",
      clientTokens: ["t"],
      allowPrivate: false,
    });
    const blocked = await fetch(`${blockedGateway.url}/?url=${encodeURIComponent(upstreamUrl)}`, {
      headers: { authorization: "Bearer t" },
    });
    expect(blocked.status).toBe(403);
    await blockedGateway.close();
  });
});
