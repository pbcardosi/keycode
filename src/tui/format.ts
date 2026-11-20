import type { ContentBlock, Message } from "../contracts/message.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinnerFrame(index: number): string {
  return SPINNER_FRAMES[index % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0] ?? "*";
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function wrapText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length > safeWidth) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

export function renderMarkdown(text: string): string {
  return text
    .replace(/^(#{1,6})\s+(.*)$/gm, (_match, hashes: string, heading: string) => `${hashes.toLowerCase()} ${heading}`)
    .replace(/```[a-zA-Z]*/g, "    ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

export function renderToolRow(status: "pending" | "success" | "error" | "denied" | "aborted", name: string, detail: string): string {
  const icons: Record<string, string> = {
    pending: "◐",
    success: "✓",
    error: "✗",
    denied: "⊘",
    aborted: "■",
  };
  return `${icons[status] ?? "○"} ${name}${detail.length > 0 ? ` — ${detail}` : ""}`;
}

export function renderTodos(todos: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>): string {
  return todos
    .map((todo) => {
      const mark = todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[>]" : "[ ]";
      return `${mark} ${todo.content}`;
    })
    .join("\n");
}

export function renderTranscript(messages: Message[]): string {
  return messages
    .map((message) => {
      const label = message.role === "user" ? "You" : "keycode";
      const text = message.content
        .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
        .map((block) => renderMarkdown(block.text))
        .join("\n")
        .trim();
      const tools = message.content
        .filter((block): block is Extract<ContentBlock, { type: "tool_call" }> => block.type === "tool_call")
        .map((block) => `Tool: ${block.name}`);
      return [`${label}:`, text, ...tools].filter((line) => line.length > 0).join("\n");
    })
    .filter((section) => section.length > 0)
    .join("\n\n");
}

export function renderFooter(fields: {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  branch: string | null;
  tasks?: number | undefined;
  checkpoints?: number | undefined;
  progress?: string | undefined;
}): string {
  const parts = [
    `model: ${fields.model}`,
    `tokens: ${fields.tokensIn.toLocaleString()} in / ${fields.tokensOut.toLocaleString()} out`,
    `cost: $${fields.costUsd.toFixed(4)}`,
  ];
  if (fields.branch) parts.push(`branch: ${fields.branch}`);
  if ((fields.tasks ?? 0) > 0) parts.push(`tasks: ${fields.tasks}`);
  if ((fields.checkpoints ?? 0) > 0) parts.push(`checkpoints: ${fields.checkpoints}`);
  if (fields.progress) parts.push(fields.progress);
  return parts.join("  ");
}
