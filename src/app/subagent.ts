import type { PermissionMode } from "../contracts/permissions.js";
import type { ToolContext } from "../contracts/tool.js";

export interface SubagentSpec {
  prompt: string;
  model?: string | undefined;
  tools?: string[] | undefined;
  permissionMode?: PermissionMode | undefined;
  name?: string | undefined;
  body?: string | undefined;
}

export interface SubagentResult {
  sessionId: string;
  text: string;
}

export type SubagentRunner = (spec: SubagentSpec, ctx: ToolContext) => Promise<SubagentResult>;

const RANK: Record<PermissionMode, number> = {
  plan: 0,
  dontAsk: 0,
  manual: 1,
  auto: 1,
  acceptEdits: 1,
  bypassPermissions: 2,
};

export function narrowPermissionMode(
  parent: PermissionMode,
  requested: PermissionMode | undefined,
): PermissionMode {
  if (requested === undefined) return parent;
  return RANK[requested] > RANK[parent] ? parent : requested;
}
