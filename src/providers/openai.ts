import type {
  ModelCapabilities,
  ModelEvent,
  ModelInfo,
  ModelRequest,
  Provider,
} from "../contracts/provider.js";
import type { ContentBlock, Message } from "../contracts/message.js";
import { KeycodeError } from "../util/errors.js";
import { readSse } from "./sse.js";

export type CapabilityOverrides = { [K in keyof ModelCapabilities]?: boolean | undefined };

export interface OpenAiProviderOptions {
  id: string;
  baseUrl: string;
  apiKey: string | null;
  headers?: Record<string, string> | undefined;
  models?: string[] | undefined;
  defaultModel?: string | undefined;
  contextWindow?: number | undefined;
  maxOutputTokens?: number | undefined;
  capabilities?: CapabilityOverrides | undefined;
  fetchImpl?: typeof fetch | undefined;
}

interface OpenAiToolCallState {
  id: string;
  name: string;
  arguments: string;
}

function contentForMessage(
  message: Message,
): { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }[] {
  const results: { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }[] = [];
  const toolResults = message.content.filter(
    (block): block is Extract<ContentBlock, { type: "tool_result" }> => block.type === "tool_result",
  );

  if (toolResults.length > 0) {
    for (const result of toolResults) {
      results.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        content: result.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n"),
      });
    }
    return results;
  }

  const textParts: unknown[] = [];
  const toolCalls: unknown[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      textParts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      textParts.push({ type: "image_url", image_url: { url: `data:${block.mime};base64,${block.data}` } });
    } else if (block.type === "tool_call") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }

  const onlyText = textParts.every((part) => (part as { type: string }).type === "text");
  const content = onlyText
    ? textParts.map((part) => (part as { text: string }).text).join("")
    : textParts;

  results.push({
    role: message.role,
    content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  });
  return results;
}

function mapFinishReason(reason: string | null | undefined): ModelEvent {
  if (reason === "length") return { type: "done", stopReason: "max_tokens" };
  if (reason === "tool_calls" || reason === "function_call") return { type: "done", stopReason: "tool_use" };
  return { type: "done", stopReason: "end_turn" };
}

export class OpenAiCompatibleProvider implements Provider {
  readonly id: string;
  private readonly options: OpenAiProviderOptions;
  private readonly capabilities: ModelCapabilities;

  constructor(options: OpenAiProviderOptions) {
    this.id = options.id;
    this.options = options;
    const overrides = options.capabilities ?? {};
    this.capabilities = {
      streaming: overrides.streaming ?? true,
      tools: overrides.tools ?? true,
      vision: overrides.vision ?? true,
      jsonSchema: overrides.jsonSchema ?? true,
      thinking: overrides.thinking ?? false,
    };
  }

  private endpoint(path: string): string {
    return `${this.options.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
      ...this.options.headers,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const staticModels = this.options.models ?? [];
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.endpoint("models"), {
        headers: this.headers(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { data?: Array<{ id?: string }> };
      const ids = (body.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
      if (ids.length > 0) return ids.map((id) => this.modelInfo(id));
    } catch {
      // Fall back to configured models; callers surface health separately.
    }
    return staticModels.map((id) => this.modelInfo(id));
  }

  modelInfo(id: string): ModelInfo {
    return {
      id,
      provider: this.id,
      displayName: id,
      contextWindow: this.options.contextWindow ?? 128_000,
      maxOutputTokens: this.options.maxOutputTokens ?? 16_384,
      capabilities: this.capabilities,
    };
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const messages = [
      ...(request.system.length > 0 ? [{ role: "system", content: request.system }] : []),
      ...request.messages.flatMap((message) => contentForMessage(message)),
    ];

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
      ...(request.jsonSchema === undefined
        ? {}
        : { response_format: { type: "json_schema", json_schema: request.jsonSchema } }),
    };

    if (this.capabilities.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
    }

    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(this.endpoint("chat/completions"), {
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
      const retryAfter = Number(response.headers.get("retry-after"));
      if (response.status === 401 || response.status === 403) {
        throw new KeycodeError("PROVIDER_AUTH", `${this.id} rejected the API key`, {
          details: { status: response.status, body: text.slice(0, 500) },
        });
      }
      if (response.status === 429) {
        throw new KeycodeError("PROVIDER_RATE_LIMIT", `${this.id} rate limit reached`, {
          retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
        });
      }
      throw new KeycodeError("PROVIDER_UNAVAILABLE", `${this.id} returned HTTP ${response.status}`, {
        details: { body: text.slice(0, 500) },
      });
    }

    if (!response.body) {
      throw new KeycodeError("PROVIDER_UNAVAILABLE", `${this.id} returned an empty stream`);
    }

    const calls = new Map<number, OpenAiToolCallState>();
    let finishReason: string | null = null;
    let sawDone = false;

    try {
      for await (const event of readSse(response.body, signal)) {
        if (event.data === "[DONE]") {
          sawDone = true;
          break;
        }
        let payload: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          } | null;
        };
        try {
          payload = JSON.parse(event.data) as typeof payload;
        } catch {
          continue;
        }

        for (const choice of payload.choices ?? []) {
          const delta = choice.delta;
          if (delta?.content) yield { type: "text", delta: delta.content };
          for (const call of delta?.tool_calls ?? []) {
            const index = call.index ?? 0;
            const state = calls.get(index) ?? { id: call.id ?? `call_${index}`, name: "", arguments: "" };
            if (call.id) state.id = call.id;
            if (call.function?.name) state.name += call.function.name;
            if (call.function?.arguments) state.arguments += call.function.arguments;
            calls.set(index, state);
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        if (payload.usage) {
          yield {
            type: "usage",
            inputTokens: payload.usage.prompt_tokens ?? 0,
            outputTokens: payload.usage.completion_tokens ?? 0,
            ...(payload.usage.prompt_tokens_details?.cached_tokens === undefined
              ? {}
              : { cachedTokens: payload.usage.prompt_tokens_details.cached_tokens }),
          };
        }
      }
    } catch (error) {
      if (signal.aborted) {
        yield { type: "done", stopReason: "aborted" };
        return;
      }
      throw error;
    }

    for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      let input: unknown = {};
      try {
        input = call.arguments.length > 0 ? JSON.parse(call.arguments) : {};
      } catch {
        input = { __raw: call.arguments };
      }
      yield { type: "tool_call", id: call.id || `call_${index}`, name: call.name, input };
    }

    if (finishReason === "tool_calls" || calls.size > 0) {
      yield { type: "done", stopReason: "tool_use" };
    } else if (sawDone || finishReason !== null) {
      yield mapFinishReason(finishReason);
    } else {
      yield { type: "done", stopReason: "end_turn" };
    }
  }
}
