export type PermissionMode =
  | "manual"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "dontAsk"
  | "bypassPermissions";

export const PERMISSION_MODES: readonly PermissionMode[] = [
  "manual",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
];

export type RuleScope = "user" | "project" | "local" | "session" | "managed";

export interface PermissionRule {
  raw: string;
  tool: string;
  pattern?: string | undefined;
  scope: RuleScope;
  behavior: "allow" | "deny" | "ask";
}

export interface PermissionSettings {
  defaultMode: PermissionMode;
  allow: string[];
  deny: string[];
  ask: string[];
}
