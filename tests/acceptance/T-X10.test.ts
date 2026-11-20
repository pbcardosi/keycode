import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addMcpServer,
  listMcpServers,
  oauthRefresh,
  reconnectMcp,
  removeMcpServer,
  setMcpEnabled,
} from "../../dist/mcp/management.js";
import { makeHome, makeWorkspace, writeFakeMcpServer } from "../helpers.js";

describe("T-X10: MCP management", () => {
  it("adds, lists, disables, reconnects, removes, and refreshes a server", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const script = join(ws, "mcp-server.mjs");
    writeFakeMcpServer(script);

    addMcpServer(
      home,
      ws,
      "fake",
      { type: "stdio", command: process.execPath, args: [script] },
      "user",
    );
    let servers = listMcpServers(home, ws);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.enabled).toBe(true);
    expect(servers[0]?.scope).toBe("user");

    const reconnected = await reconnectMcp(home, ws, "fake");
    expect(reconnected.tools).toEqual(["echo"]);

    expect(setMcpEnabled(home, ws, "fake", false)).toBe(true);
    servers = listMcpServers(home, ws);
    expect(servers[0]?.enabled).toBe(false);

    expect(oauthRefresh(home, ws, "fake")).toBe(true);
    expect(listMcpServers(home, ws)[0]?.config.oauthRefreshedAt).toBeTruthy();

    expect(removeMcpServer(home, ws, "fake")).toBe(true);
    expect(listMcpServers(home, ws)).toEqual([]);
  });
});
