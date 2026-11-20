import type { Message } from "../contracts/message.js";

export function accessibilityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KEYCODE_AX === "1" || env.KEYCODE_SCREEN_READER === "1";
}

export function reducedMotion(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KEYCODE_REDUCED_MOTION === "1";
}

function textOf(message: Message): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function renderAccessible(messages: Message[]): string {
  return messages
    .map((message) => {
      const label = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System";
      const text = textOf(message);
      return text.length > 0 ? `${label}:\n${text}` : "";
    })
    .filter((section) => section.length > 0)
    .join("\n\n");
}
