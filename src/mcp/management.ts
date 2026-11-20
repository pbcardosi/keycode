import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "../util/fsx.js";
import { KeycodeError } from "../util/errors.js";
import { McpClient, type McpServerConfig } from "./client.js";

export type McpScope = "user" | "project" | "local";

export interface McpServerSettings extends McpServerConfig {
  enabled?: boolean | undefined;
  oauthRefreshedAt?: string | undefined;
}

export interface McpServerEntry {
  name: string;
  config: McpServerSettings;
  scope: McpScope;
  enabled: boolean;
}

interface JsonObject {
  mcpServers?: Record<string, McpServerSettings>;
  [key: string]: unknown;
}

function configPath(home: string, cwd: string, scope: McpScope): string {
  if (scope === "user") return join(home, "settings.json");
  if (scope === "project") return join(cwd, ".mcp.json");
  return join(cwd, ".keycode", "settings.local.json");
}

function readObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
  } catch {
    return {};
  }
}

function writeObject(path: string, data: JsonObject): void {
  atomicWrite(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function listMcpServers(home: string, cwd: string): McpServerEntry[] {
  const entries = new Map<string, McpServerEntry>();
  for (const scope of ["project", "local", "user"] as const) {
    const data = readObject(configPath(home, cwd, scope));
    for (const [name, config] of Object.entries(data.mcpServers ?? {})) {
      if (entries.has(name)) continue;
      entries.set(name, { name, config, scope, enabled: config.enabled !== false });
    }
  }
  return [...entries.values()];
}

export function addMcpServer(
  home: string,
  cwd: string,
  name: string,
  config: McpServerSettings,
  scope: McpScope = "user",
): void {
  const path = configPath(home, cwd, scope);
  const data = readObject(path);
  data.mcpServers = { ...(data.mcpServers ?? {}), [name]: config };
  writeObject(path, data);
}

export function removeMcpServer(home: string, cwd: string, name: string): boolean {
  let removed = false;
  for (const scope of ["project", "local", "user"] as const) {
    const path = configPath(home, cwd, scope);
    const data = readObject(path);
    if (data.mcpServers && name in data.mcpServers) {
      delete data.mcpServers[name];
      writeObject(path, data);
      removed = true;
    }
  }
  return removed;
}

export function setMcpEnabled(home: string, cwd: string, name: string, enabled: boolean): boolean {
  const entry = listMcpServers(home, cwd).find((server) => server.name === name);
  if (!entry) return false;
  const path = configPath(home, cwd, entry.scope);
  const data = readObject(path);
  const config = data.mcpServers?.[name];
  if (!config) return false;
  config.enabled = enabled;
  writeObject(path, data);
  return true;
}

export async function reconnectMcp(
  home: string,
  cwd: string,
  name: string,
): Promise<{ tools: string[] }> {
  const entry = listMcpServers(home, cwd).find((server) => server.name === name);
  if (!entry) throw new KeycodeError("MCP_INIT_FAILED", `MCP server not found: ${name}`);
  const client = new McpClient(name, { ...entry.config, cwd });
  await client.connect();
  try {
    const tools = await client.listTools();
    return { tools: tools.map((tool) => tool.name) };
  } finally {
    await client.close();
  }
}

export function oauthRefresh(home: string, cwd: string, name: string): boolean {
  const entry = listMcpServers(home, cwd).find((server) => server.name === name);
  if (!entry) return false;
  const path = configPath(home, cwd, entry.scope);
  const data = readObject(path);
  const config = data.mcpServers?.[name];
  if (!config) return false;
  config.oauthRefreshedAt = new Date().toISOString();
  writeObject(path, data);
  return true;
}
