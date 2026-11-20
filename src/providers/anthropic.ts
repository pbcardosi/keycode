import type {
  ModelCapabilities,
  ModelEvent,
  ModelInfo,
  ModelRequest,
  Provider,
  StopReason,
} from "../contracts/provider.js";
import type { ContentBlock, Message } from "../contracts/message.js";
import { KeycodeError } from "../util/errors.js";
import { readSse } from "./sse.js";

export interface AnthropicProviderOptions {
  id?: string | undefined;
  baseUrl: string;
  apiKey: string | null;
  headers?: Record<string, string> | undefined;
  models?: string[] | undefined;
  contextWindow?: number | undefined;
  maxOutputTokens?: number | undefined;
  capabilities?: { [K in keyof ModelCapabilities]?: boolean | undefined } | undefined;
  fetchImpl?: typeof fetch | undefined;
}

interface AnthropicBlockState {
  type: "text" | "tool_use" | "thinking";
  id?: string | undefined;
  name?: string | undefined;
  json: string;
}

function toAnthropicContent(block: ContentBlock): Record<string, unknown> {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "image") {
    return { type: "image", source: { type: "base64", media_type: block.mime, data: block.data } };
  }
  if (block.type === "tool_call") {
    return { type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} };
  }
  return {
    type: "tool_result",
    tool_use_id: block.toolCallId,
    content: block.content.map((item) =>
      item.type === "text" ? { type: "text", text: item.text } : { type: "text", text: "[image]" },
    ),
    is_error: !block.ok,
  };
}

function toAnthropicMessages(
  messages: Message[],
): Array<{ role: "user" | "assistant"; content: unknown[] }> {
  return messages
    .filter((message) => message.content.length > 0)
    .map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content.map(toAnthropicContent),
    }));
}

function mapStopReason(reason: string | undefined): StopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  return "end_turn";
}

export class AnthropicProvider implements Provider {
  readonly id: string;
  private readonly options: AnthropicProviderOptions;
  private readonly capabilities: ModelCapabilities;

  constructor(options: AnthropicProviderOptions) {
    this.id = options.id ?? "anthropic";
    this.options = options;
    const overrides = options.capabilities ?? {};
    this.capabilities = {
      streaming: overrides.streaming ?? true,
      tools: overrides.tools ?? true,
      vision: overrides.vision ?? true,
      jsonSchema: overrides.jsonSchema ?? false,
      thinking: overrides.thinking ?? true,
    };
  }

  private endpoint(path: string): string {
    return `${this.options.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      ...(this.options.apiKey ? { "x-api-key": this.options.apiKey } : {}),
      ...this.options.headers,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return (this.options.models ?? []).map((id) => this.modelInfo(id));
  }

  modelInfo(id: string): ModelInfo {
    return {
      id,
      provider: this.id,
      displayName: id,
      contextWindow: this.options.contextWindow ?? 200_000,
      maxOutputTokens: this.options.maxOutputTokens ?? 8_192,
      capabilities: this.capabilities,
    };
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? Math.min(this.options.maxOutputTokens ?? 8_192, 8_192),
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: toAnthropicMessages(request.messages),
      stream: true,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (this.capabilities.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
    }

    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(this.endpoint("v1/messages"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        yield { type: "done", stopReason: "aborted" };
        return;
      }
      throw new KeycodeError("PROVIDER_UNAVAILABLE", `Cannot reach ${this.id}: ${(error as Error).message}`, {
        cause: error,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new KeycodeError("PROVIDER_AUTH", `${this.id} rejected the API key`, {
          details: { status: response.status },
        });
      }
      if (response.status === 429) {
        throw new KeycodeError("PROVIDER_RATE_LIMIT", `${this.id} rate limit reached`);
      }
      throw new KeycodeError("PROVIDER_UNAVAILABLE", `${this.id} returned HTTP ${response.status}`, {
        details: { body: text.slice(0, 500) },
      });
    }
    if (!response.body) throw new KeycodeError("PROVIDER_UNAVAILABLE", `${this.id} returned an empty stream`);

    const blocks = new Map<number, AnthropicBlockState>();
    let stopReason: StopReason = "end_turn";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens: number | undefined;

    try {
      for await (const event of readSse(response.body, signal)) {
        const name = event.event ?? "";
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (name === "message_start") {
          const message = payload.message as
            | { usage?: { input_tokens?: number; cache_read_input_tokens?: number } }
            | undefined;
          inputTokens = message?.usage?.input_tokens ?? 0;
          cachedTokens = message?.usage?.cache_read_input_tokens;
        } else if (name === "content_block_start") {
          const index = Number(payload.index ?? 0);
          const block = payload.content_block as { type?: string; id?: string; name?: string } | undefined;
          if (block?.type === "tool_use") {
            blocks.set(index, { type: "tool_use", id: block.id ?? `tool_${index}`, name: block.name ?? "", json: "" });
          } else if (block?.type === "thinking") {
            blocks.set(index, { type: "thinking", json: "" });
          } else {
            blocks.set(index, { type: "text", json: "" });
          }
        } else if (name === "content_block_delta") {
          const index = Number(payload.index ?? 0);
          const state = blocks.get(index);
          const delta = payload.delta as
            | { type?: string; text?: string; partial_json?: string; thinking?: string }
            | undefined;
          if (!state || !delta) continue;
          if (delta.type === "text_delta" && delta.text) yield { type: "text", delta: delta.text };
          if (delta.type === "thinking_delta" && delta.thinking) {
            yield { type: "thinking", delta: delta.thinking };
          }
          if (delta.type === "input_json_delta" && delta.partial_json) state.json += delta.partial_json;
        } else if (name === "content_block_stop") {
          const index = Number(payload.index ?? 0);
          const state = blocks.get(index);
          if (state?.type === "tool_use") {
            let input: unknown = {};
            try {
              input = state.json.length > 0 ? JSON.parse(state.json) : {};
            } catch {
              input = { __raw: state.json };
            }
            yield { type: "tool_call", id: state.id ?? `tool_${index}`, name: state.name ?? "", input };
          }
          blocks.delete(index);
        } else if (name === "message_delta") {
          const delta = payload.delta as { stop_reason?: string } | undefined;
          const usage = payload.usage as { output_tokens?: number } | undefined;
          if (delta?.stop_reason) stopReason = mapStopReason(delta.stop_reason);
          if (usage?.output_tokens !== undefined) outputTokens = usage.output_tokens;
          yield {
            type: "usage",
            inputTokens,
            outputTokens,
            ...(cachedTokens === undefined ? {} : { cachedTokens }),
          };
        } else if (name === "message_stop") {
          yield { type: "done", stopReason };
          return;
        } else if (name === "error") {
          const error = payload.error as { type?: string; message?: string } | undefined;
          const message = error?.message ?? "Anthropic stream error";
          const code = error?.type === "rate_limit_error" ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE";
          throw new KeycodeError(code, message);
        }
      }
    } catch (error) {
      if (signal.aborted) {
        yield { type: "done", stopReason: "aborted" };
        return;
      }
      throw error;
    }

    yield { type: "usage", inputTokens, outputTokens, ...(cachedTokens === undefined ? {} : { cachedTokens }) };
    yield { type: "done", stopReason };
  }
}
