import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpClient } from "../../dist/mcp/client.js";
import { createMcpTools } from "../../dist/mcp/tools.js";
import { makeToolCtx, makeWorkspace, textOf, writeFakeMcpServer } from "../helpers.js";

describe("T-T16: MCP", () => {
  it("initializes, lists and calls tools, reads resources and prompts, and times out", async () => {
    const ws = makeWorkspace();
    const script = join(ws, "mcp-server.mjs");
    writeFakeMcpServer(script);
    const client = new McpClient("fake", {
      type: "stdio",
      command: process.execPath,
      args: [script],
      cwd: ws,
      timeoutMs: 5000,
    });
    await client.connect();

    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["echo"]);
    const call = await client.callTool("echo", { a: 1 });
    const callText = call.content?.[0]?.text ?? "";
    expect(JSON.parse(callText)).toEqual({ a: 1 });

    const resources = await client.listResources();
    expect(resources[0]?.uri).toBe("file:///a.txt");
    const contents = await client.readResource("file:///a.txt");
    expect(contents[0]?.text).toBe("hello resource");

    const prompts = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(["greet"]);
    expect(JSON.stringify(await client.getPrompt("greet"))).toContain("hi prompt");

    const mcpTools = await createMcpTools(client);
    expect(mcpTools[0]?.name).toBe("mcp__fake__echo");
    const result = await mcpTools[0]?.execute({ x: 2 }, makeToolCtx({ cwd: ws }));
    expect(result?.ok).toBe(true);
    expect(textOf(result as NonNullable<typeof result>)).toContain('"x":2');

    await expect(client.request("unknown/method", {}, 200)).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });
    await client.close();
  });
});
