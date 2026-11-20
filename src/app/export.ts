import type { Message } from "../contracts/message.js";
import { messageText } from "../contracts/message.js";
import type { SessionView } from "../contracts/session.js";

export function exportMarkdown(view: SessionView): string {
  const lines: string[] = [
    `# keycode session ${view.header.id}`,
    "",
    `- name: ${view.name}`,
    `- cwd: ${view.header.cwd}`,
    `- provider: ${view.header.provider}`,
    `- model: ${view.header.model}`,
    `- created: ${view.header.createdAt}`,
    view.header.parentId ? `- parent: ${view.header.parentId}` : "",
    "",
  ].filter((line) => line.length > 0);

  for (const message of view.messages) {
    const role = message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "System";
    lines.push(`## ${role}`, "");
    for (const block of message.content) {
      if (block.type === "text") {
        lines.push(block.text, "");
      } else if (block.type === "tool_call") {
        lines.push(`Tool call: \`${block.name}\``, "", "```json", JSON.stringify(block.input, null, 2), "```", "");
      } else if (block.type === "image") {
        lines.push(`[image ${block.mime}]`, "");
      }
    }
    if (message.interrupted) lines.push("_interrupted_", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function exportJson(view: SessionView): string {
  return `${JSON.stringify(
    {
      id: view.header.id,
      name: view.name,
      cwd: view.header.cwd,
      provider: view.header.provider,
      model: view.header.model,
      createdAt: view.header.createdAt,
      parentId: view.header.parentId,
      messages: view.messages,
    },
    null,
    2,
  )}\n`;
}

export function latestAssistantText(view: SessionView, index = 1): string {
  const assistant = view.messages.filter(
    (message) => message.role === "assistant" && messageText(message).length > 0,
  );
  const selected = assistant[assistant.length - index];
  return selected ? messageText(selected) : "";
}

export function allAssistantText(messages: Message[]): string {
  return messages
    .filter((message) => message.role === "assistant")
    .map((message) => messageText(message))
    .join("\n");
}
