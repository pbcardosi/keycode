import type { Message } from "../contracts/message.js";
import type { ModelCapabilities, ToolSpec } from "../contracts/provider.js";
import { KeycodeError } from "../util/errors.js";

export const ALL_CAPABILITIES: ModelCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  jsonSchema: true,
  thinking: false,
};

export function capabilitiesFrom(
  value: { [K in keyof ModelCapabilities]?: boolean | undefined } | undefined,
): ModelCapabilities {
  return {
    streaming: value?.streaming ?? ALL_CAPABILITIES.streaming,
    tools: value?.tools ?? ALL_CAPABILITIES.tools,
    vision: value?.vision ?? ALL_CAPABILITIES.vision,
    jsonSchema: value?.jsonSchema ?? ALL_CAPABILITIES.jsonSchema,
    thinking: value?.thinking ?? ALL_CAPABILITIES.thinking,
  };
}

export function negotiateTools(capabilities: ModelCapabilities, tools: ToolSpec[]): ToolSpec[] {
  if (tools.length === 0) return tools;
  if (capabilities.tools) return tools;
  throw new KeycodeError(
    "PROVIDER_CAPABILITY",
    "This model does not support tool calls. Choose a tool-capable model or remove the tools.",
  );
}

export function negotiateMessages(capabilities: ModelCapabilities, messages: Message[]): Message[] {
  if (capabilities.vision) return messages;
  const hasImage = messages.some((message) => message.content.some((block) => block.type === "image"));
  if (hasImage) {
    throw new KeycodeError(
      "PROVIDER_CAPABILITY",
      "This model does not support images. Remove image blocks or choose a vision-capable model.",
    );
  }
  return messages;
}

export function negotiateJsonSchema(capabilities: ModelCapabilities, schema: unknown): void {
  if (schema !== undefined && !capabilities.jsonSchema) {
    throw new KeycodeError(
      "PROVIDER_CAPABILITY",
      "This model does not support JSON schema responses.",
    );
  }
}
