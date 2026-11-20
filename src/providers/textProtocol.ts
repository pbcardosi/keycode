import { newId } from "../util/ids.js";

export interface TextToolCall {
  id: string;
  name: string;
  input: unknown;
}

const FENCE = /```keycode-tool[^\n]*\n([\s\S]*?)```/g;

export const TEXT_TOOL_PROTOCOL = [
  "# Tool protocol",
  "",
  "This model cannot emit native tool calls. When a tool is needed, emit exactly one",
  "fenced block and nothing after it:",
  "",
  "```keycode-tool",
  '{"name":"ToolName","input":{}}',
  "```",
  "",
  "Use only tools listed in the tools section. Wait for the tool result before",
  "continuing. Never invent a tool result and never repeat the same call.",
].join("\n");

export function parseTextToolCalls(text: string): { text: string; calls: TextToolCall[] } {
  const calls: TextToolCall[] = [];
  let cleaned = "";
  let last = 0;

  for (const match of text.matchAll(FENCE)) {
    const body = match[1] ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name.length === 0) continue;
    const input = record.input ?? record.arguments ?? {};
    calls.push({ id: newId("textcall"), name: record.name, input });
    const index = match.index ?? 0;
    cleaned += text.slice(last, index);
    last = index + match[0].length;
  }

  if (calls.length === 0) return { text, calls };
  cleaned += text.slice(last);
  return { text: cleaned.trim(), calls };
}
