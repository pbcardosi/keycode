import type { Message } from "../contracts/message.js";
import type { ModelRequest, Provider } from "../contracts/provider.js";
import type { SessionStore } from "../storage/session.js";
import type { SessionView, SummaryRecord } from "../contracts/session.js";
import { estimateTokens } from "../util/text.js";
import { newId } from "../util/ids.js";
import { KeycodeError } from "../util/errors.js";

export const COMPACT_PROMPT = [
  "Summarize the conversation so far for another engineer who must continue the work.",
  "Include: the user's goal, decisions made, files changed, commands run, failures, and the exact next step.",
  "Be concise but keep identifiers and paths. Do not invent facts.",
].join("\n");

export function messagesTokens(messages: Message[]): number {
  return messages.reduce((total, message) => total + estimateTokens(JSON.stringify(message.content)), 0);
}

export function effectiveMessages(view: SessionView): Message[] {
  let messages = [...view.messages];
  for (const summary of view.summaries) {
    const replaced = new Set(summary.replaces);
    messages = messages.filter((message) => !replaced.has(message.id));
    messages.push({
      id: summary.id,
      role: "system",
      content: [{ type: "text", text: `Summary of earlier conversation:\n${summary.text}` }],
      timestamp: summary.timestamp,
    });
  }
  return messages;
}

export interface CompactOptions {
  store: SessionStore;
  sessionId: string;
  provider: Provider;
  model: string;
  instructions?: string | undefined;
  keepRecentMessages?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface CompactResult {
  compacted: boolean;
  summary: SummaryRecord | null;
  tokensBefore: number;
  tokensAfter: number;
}

export async function compactSession(options: CompactOptions): Promise<CompactResult> {
  const view = options.store.load(options.sessionId);
  const effective = effectiveMessages(view);
  const tokensBefore = messagesTokens(effective);
  const keep = options.keepRecentMessages ?? 8;

  if (effective.length <= keep + 2) {
    return { compacted: false, summary: null, tokensBefore, tokensAfter: tokensBefore };
  }

  const older = effective.slice(0, effective.length - keep);
  const recent = effective.slice(effective.length - keep);
  const replacedIds = older.map((message) => message.id);

  let system = COMPACT_PROMPT;
  if (options.instructions && options.instructions.trim().length > 0) {
    system = `${COMPACT_PROMPT}\n\nAdditional instructions: ${options.instructions.trim()}`;
  }

  const request: ModelRequest = {
    model: options.model,
    system,
    messages: older,
    tools: [],
    temperature: 0,
  };

  let summaryText = "";
  for await (const event of options.provider.stream(request, options.signal ?? new AbortController().signal)) {
    if (event.type === "text") summaryText += event.delta;
    if (event.type === "error") throw event.error;
  }
  if (summaryText.trim().length === 0) {
    throw new KeycodeError("PROVIDER_UNAVAILABLE", "Compaction produced an empty summary");
  }

  const summary: SummaryRecord = {
    type: "summary",
    id: newId("summary"),
    replaces: replacedIds,
    text: summaryText.trim(),
    tokensBefore,
    tokensAfter: messagesTokens(recent) + estimateTokens(summaryText),
    timestamp: new Date().toISOString(),
  };
  options.store.appendSummary(options.sessionId, summary);

  return {
    compacted: true,
    summary,
    tokensBefore,
    tokensAfter: summary.tokensAfter,
  };
}
