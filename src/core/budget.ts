import type { Message, Usage } from "../contracts/message.js";

export interface ContextPlan {
  tokens: number;
  contextWindow: number;
  reserveTokens: number;
  availableTokens: number;
  shouldCompact: boolean;
}

export function planContext(
  tokens: number,
  contextWindow: number,
  reserveRatio = 0.2,
): ContextPlan {
  const reserveTokens = Math.floor(contextWindow * reserveRatio);
  const availableTokens = Math.max(0, contextWindow - reserveTokens);
  return {
    tokens,
    contextWindow,
    reserveTokens,
    availableTokens,
    shouldCompact: tokens >= availableTokens,
  };
}

export function cacheHitRate(usage: Usage): number {
  if (usage.inputTokens <= 0) return 0;
  return (usage.cachedTokens ?? 0) / usage.inputTokens;
}

export function orderForCache(messages: Message[]): Message[] {
  const stable = messages.filter((message) => message.role === "system");
  const volatile = messages.filter((message) => message.role !== "system");
  return [...stable, ...volatile];
}
