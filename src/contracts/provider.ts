import type { KeycodeError } from "../util/errors.js";
import type { Message } from "./message.js";

export interface ModelCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  jsonSchema: boolean;
  thinking: boolean;
}

export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  pricing?: { inputPerMTok: number; outputPerMTok: number } | undefined;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "aborted";

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedTokens?: number | undefined }
  | { type: "done"; stopReason: StopReason }
  | { type: "error"; error: KeycodeError };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ModelRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  temperature?: number | undefined;
  maxOutputTokens?: number | undefined;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  jsonSchema?: unknown;
}

export interface Provider {
  readonly id: string;
  listModels(): Promise<ModelInfo[]>;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
