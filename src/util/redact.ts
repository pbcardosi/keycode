const PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]{16,}/g, "[REDACTED:anthropic-key]"],
  [/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, "[REDACTED:openai-key]"],
  [/AIza[0-9A-Za-z_-]{30,}/g, "[REDACTED:google-key]"],
  [/gsk_[A-Za-z0-9]{20,}/g, "[REDACTED:groq-key]"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED:github-token]"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED:github-token]"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED:slack-token]"],
  [/(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g, "[REDACTED:aws-key]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED:token]"],
  [/(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/gi, "[REDACTED:credential]"],
];

export function redact(input: string): string {
  let output = input;
  for (const [pattern, replacement] of PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function scanSecrets(input: string): Array<{ kind: string; count: number }> {
  const findings: Array<{ kind: string; count: number }> = [];
  for (const [pattern, replacement] of PATTERNS) {
    const kind = replacement.replace(/^\[REDACTED:|\]$/g, "");
    const matches = input.match(pattern);
    if (matches && matches.length > 0) findings.push({ kind, count: matches.length });
  }
  return findings;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T;
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = /key|token|secret|password/i.test(key) ? "[REDACTED]" : redactDeep(item);
    }
    return result as T;
  }
  return value;
}
