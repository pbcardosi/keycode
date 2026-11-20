export type Role = "user" | "assistant" | "system";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number | undefined;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; ok: boolean; content: ContentBlock[] };

export interface Message {
  id: string;
  role: Role;
  content: ContentBlock[];
  timestamp: string;
  usage?: Usage | undefined;
  interrupted?: boolean | undefined;
}

export function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

export function messageText(message: Message): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}
