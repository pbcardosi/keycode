import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpClient } from "../../dist/mcp/client.js";
import { createMcpTools } from "../../dist/mcp/tools.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import {
  makeHome,
  makeToolCtx,
  makeWorkspace,
  textOf,
  writeFakeMcpServer,
  writeJson,
} from "../helpers.js";

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

  it("auto-connects MCP servers from settings and exposes their tools", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const script = join(ws, "mcp-server.mjs");
    writeFakeMcpServer(script);
    writeJson(join(home, "settings.json"), {
      mcpServers: {
        fake: { type: "stdio", command: process.execPath, args: [script] },
      },
    });

    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      permissionMode: "bypassPermissions",
      env: {
        ...process.env,
        KEYCODE_HOME: home,
        KEYCODE_PROVIDER: "fake",
        KEYCODE_FAKE_SCRIPT: JSON.stringify({
          turns: [
            [
              { type: "tool_call", id: "m1", name: "mcp__fake__echo", input: { x: 2 } },
              { type: "done", stopReason: "tool_use" },
            ],
            [{ type: "text", delta: "mcp done" }, { type: "done", stopReason: "end_turn" }],
          ],
        }),
      },
    });

    try {
      expect(setup.toolNames).toContain("mcp__fake__echo");
      const result = await setup.agent.runTurn("call the MCP tool", new AbortController().signal);
      expect(result.stopReason).toBe("end_turn");
      const view = setup.store.load(setup.sessionId);
      const record = view.records.find((entry) => entry.type === "tool_result") as
        | { content?: Array<{ type: string; text?: string }> }
        | undefined;
      expect(record?.content?.[0]?.text).toContain('"x":2');
    } finally {
      await Promise.all(setup.mcpClients.map((client) => client.close()));
    }
  });
});
