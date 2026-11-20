import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createWebFetchTool } from "../../dist/tools/webfetch.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

let server: Server;
let baseUrl = "";

async function listen(): Promise<void> {
  server = createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end("<html><head><title>Doc</title></head><body><h1>Hello</h1><p>Hello <b>world</b></p></body></html>");
      return;
    }
    if (req.url === "/go") {
      res.statusCode = 302;
      res.setHeader("location", "/final");
      res.end();
      return;
    }
    if (req.url === "/final") {
      res.setHeader("content-type", "text/html");
      res.end("<html><body><h2>Final</h2></body></html>");
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterAll(() => {
  server?.close();
});

describe("T-T8: WebFetch", () => {
  it("converts HTML to markdown and follows bounded redirects", async () => {
    await listen();
    const ws = makeWorkspace();
    const ctx = makeToolCtx({ cwd: ws });
    const tool = createWebFetchTool({ allowHosts: ["127.0.0.1"] });
    const result = await tool.execute({ url: `${baseUrl}/` }, ctx);
    expect(result.ok).toBe(true);
    const text = textOf(result);
    expect(text).toContain("Hello");
    expect(text).toContain("world");

    const redirected = await tool.execute({ url: `${baseUrl}/go` }, ctx);
    expect(redirected.ok).toBe(true);
    expect(textOf(redirected)).toContain("Final");
  });

  it("blocks loopback and metadata addresses", async () => {
    const ws = makeWorkspace();
    const ctx = makeToolCtx({ cwd: ws });
    const tool = createWebFetchTool();
    const loopback = await tool.execute({ url: "http://127.0.0.1/" }, ctx);
    expect(loopback.ok).toBe(false);
    expect((loopback.metadata as { code?: string } | undefined)?.code).toBe("SANDBOX_DENIED");

    const metadata = await tool.execute({ url: "http://169.254.169.254/latest/meta-data/" }, ctx);
    expect(metadata.ok).toBe(false);
    expect((metadata.metadata as { code?: string } | undefined)?.code).toBe("SANDBOX_DENIED");
  });
});
