import type { ContentBlock, Message, Role, Usage } from "./message.js";

export interface SessionHeader {
  type: "session";
  version: 1;
  id: string;
  name: string | null;
  cwd: string;
  provider: string;
  model: string;
  createdAt: string;
  parentId: string | null;
}

export interface MessageRecord {
  type: "message";
  id: string;
  role: Role;
  content: ContentBlock[];
  timestamp: string;
  usage?: Usage | undefined;
  interrupted?: boolean | undefined;
}

export interface ToolResultRecord {
  type: "tool_result";
  toolCallId: string;
  ok: boolean;
  content: ContentBlock[];
  timestamp: string;
}

export interface CheckpointRecord {
  type: "checkpoint";
  id: string;
  turn: number;
  files: Array<{ path: string; backup: string | null }>;
  timestamp: string;
  conversationLength: number;
}

export interface SummaryRecord {
  type: "summary";
  id: string;
  replaces: string[];
  text: string;
  tokensBefore: number;
  tokensAfter: number;
  timestamp: string;
}

export interface RenameRecord {
  type: "rename";
  name: string;
  timestamp: string;
}

export interface ContextRecord {
  type: "context";
  systemPrompt: string;
  systemPromptHash: string;
  timestamp: string;
}

export interface RewindRecord {
  type: "rewind";
  checkpointId: string;
  keepMessages: number;
  timestamp: string;
}

export interface TodosRecord {
  type: "todos";
  todos: Array<{
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority?: string | undefined;
  }>;
  timestamp: string;
}

export type SessionRecord =
  | SessionHeader
  | MessageRecord
  | ToolResultRecord
  | CheckpointRecord
  | SummaryRecord
  | RenameRecord
  | ContextRecord
  | RewindRecord
  | TodosRecord
  | { type: string; [key: string]: unknown };

export interface SessionView {
  header: SessionHeader;
  records: SessionRecord[];
  messages: Message[];
  name: string;
  checkpoints: CheckpointRecord[];
  summaries: SummaryRecord[];
  systemPrompt: string | null;
  todos: Array<{
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority?: string | undefined;
  }>;
}

export function toMessage(record: MessageRecord): Message {
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    timestamp: record.timestamp,
    ...(record.usage === undefined ? {} : { usage: record.usage }),
    ...(record.interrupted === undefined ? {} : { interrupted: record.interrupted }),
  };
}
