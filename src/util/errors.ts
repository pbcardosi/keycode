export type ErrorCode =
  | "CONFIG_INVALID"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_CAPABILITY"
  | "BUDGET_EXCEEDED"
  | "PERMISSION_DENIED"
  | "PERMISSION_PROMPT_UNAVAILABLE"
  | "PATH_OUTSIDE_WORKSPACE"
  | "TOOL_INPUT_INVALID"
  | "TOOL_TIMEOUT"
  | "TOOL_UNSUPPORTED"
  | "SANDBOX_DENIED"
  | "SECRET_DETECTED"
  | "MCP_INIT_FAILED"
  | "HOOK_FAILED"
  | "SESSION_CORRUPT"
  | "ABORTED";

const EXIT_CODES: Record<ErrorCode, number> = {
  CONFIG_INVALID: 2,
  PROVIDER_NOT_FOUND: 2,
  PROVIDER_AUTH: 3,
  PROVIDER_RATE_LIMIT: 4,
  PROVIDER_UNAVAILABLE: 4,
  PROVIDER_CAPABILITY: 2,
  BUDGET_EXCEEDED: 5,
  PERMISSION_DENIED: 6,
  PERMISSION_PROMPT_UNAVAILABLE: 6,
  PATH_OUTSIDE_WORKSPACE: 6,
  TOOL_INPUT_INVALID: 2,
  TOOL_TIMEOUT: 7,
  TOOL_UNSUPPORTED: 2,
  SANDBOX_DENIED: 6,
  SECRET_DETECTED: 6,
  MCP_INIT_FAILED: 7,
  HOOK_FAILED: 7,
  SESSION_CORRUPT: 2,
  ABORTED: 130,
};

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
  "TOOL_TIMEOUT",
  "MCP_INIT_FAILED",
  "HOOK_FAILED",
]);

export interface KeycodeErrorOptions {
  userMessage?: string | undefined;
  cause?: unknown;
  retryAfterMs?: number | undefined;
  details?: Record<string, unknown> | undefined;
}

export class KeycodeError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly exitCode: number;
  readonly retryAfterMs: number | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options: KeycodeErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "KeycodeError";
    this.code = code;
    this.userMessage = options.userMessage ?? message;
    this.retryable = RETRYABLE.has(code);
    this.exitCode = EXIT_CODES[code];
    this.retryAfterMs = options.retryAfterMs;
    this.details = options.details;
  }
}

export function isKeycodeError(value: unknown): value is KeycodeError {
  return value instanceof KeycodeError;
}

export function toKeycodeError(value: unknown): KeycodeError {
  if (isKeycodeError(value)) return value;
  if (value instanceof Error) {
    return new KeycodeError("PROVIDER_UNAVAILABLE", value.message, { cause: value });
  }
  return new KeycodeError("PROVIDER_UNAVAILABLE", String(value));
}

export function formatError(error: KeycodeError, debug = false): string {
  const lines = [`${error.code}: ${error.userMessage}`];
  if (debug && error.stack) lines.push(error.stack);
  return lines.join("\n");
}
