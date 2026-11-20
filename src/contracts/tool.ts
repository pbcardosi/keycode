import type { ZodType } from "zod";
import type { Clock } from "../util/clock.js";
import type { Logger } from "../util/logger.js";
import type { ContentBlock } from "./message.js";

export interface PermissionDecision {
  behavior: "allow" | "deny" | "ask";
  reason: string;
  rule?: string | undefined;
  source?: string | undefined;
}

export interface PermissionRequest {
  tool: string;
  input: unknown;
  cwd: string;
  readOnly: boolean;
  preview?: string | undefined;
  diff?: string | undefined;
}

export interface PermissionGate {
  check(request: PermissionRequest): Promise<PermissionDecision>;
  recordSessionAllow?(tool: string, pattern?: string | undefined): void;
}

export interface QuestionOption {
  label: string;
  description?: string | undefined;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean | undefined;
}

export interface QuestionResult {
  answers: Array<{ header: string; selected: string[]; custom?: string | undefined }>;
  cancelled?: boolean | undefined;
}

export interface ToolResult {
  ok: boolean;
  content: ContentBlock[];
  display?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ToolState {
  readFiles: Set<string>;
  todos: Array<{
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority?: string | undefined;
  }>;
  metadata: Map<string, unknown>;
}

export interface ToolContext {
  sessionId: string;
  cwd: string;
  workspaceRoots: string[];
  signal: AbortSignal;
  permissions: PermissionGate;
  logger: Logger;
  clock: Clock;
  state: ToolState;
  home: string;
  askQuestions?: ((questions: Question[]) => Promise<QuestionResult>) | undefined;
  onMutation?: ((paths: string[]) => void) | undefined;
}

export interface Tool<I = unknown> {
  name: string;
  description: string;
  input: ZodType<I>;
  readOnly: boolean;
  concurrency: "parallel" | "exclusive";
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
}

export function toolError(message: string, metadata?: Record<string, unknown>): ToolResult {
  return {
    ok: false,
    content: [{ type: "text", text: message }],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function toolOk(text: string, metadata?: Record<string, unknown>): ToolResult {
  return {
    ok: true,
    content: [{ type: "text", text }],
    ...(metadata === undefined ? {} : { metadata }),
  };
}
