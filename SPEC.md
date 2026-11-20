# SPEC.md

**Product:** keycode
**Spec version:** 0.1.0
**Parity target:** Claude Code v2.1.322 (observed behavior; clean-room)
**Runtime:** Node.js >= 22, ESM, TypeScript strict
**License:** Apache-2.0
**Status:** specification; Part 1, Part 2, and Part 3 runtimes implemented and covered by 90 acceptance tests (`T-<ID>` per feature).

---

## 1. Purpose

This document is the implementation contract for `keycode`. It defines:

- the architecture and core contracts;
- every feature we intend to build, grouped by domain;
- **exactly one acceptance test per feature**;
- a three-part build plan with exit gates.

`FEATURES.md` defines scope and the free-key policy. `EVIDENCE.md` records where
behavior claims came from. `AGENTS.md` defines process and safety rules.

---

## 2. Scope

`KeyCode` is a terminal coding agent with:

- an interactive TUI and a headless mode;
- a provider-neutral model layer with free and local presets;
- file, search, shell, web, notebook, task, question, subagent, MCP, LSP, and
  artifact tools;
- a permission system, workspace trust, sandboxing, and audit logging;
- project memory, sessions, checkpoints, compaction, and resume;
- commands, skills, agents, teams, hooks, plugins, output styles, themes, and
  keybindings;
- integrations for GitHub, IDEs, browsers, remote control, background sessions,
  worktrees, and PR workflows;
- settings, managed policy, privacy controls, telemetry, and a local gateway.

Out of scope: Anthropic-hosted accounts, billing, cloud infrastructure, and
proprietary assets. See `FEATURES.md` section 7.

---

## 3. Goals and non-goals

### 3.1 Goals

1. A user with one free key or a local model can complete real coding work.
2. Behavior is predictable: every tool call is permission-checked, every turn
   is persisted, every failure has a typed error.
3. The core is provider-neutral and testable without a network.
4. Extensions use documented formats and cannot silently escalate privileges.
5. The same code runs on Windows, macOS, Linux, and WSL.

### 3.2 Non-goals

- Identical output, prompts, or visual design to Claude Code.
- Bit-for-bit compatibility with undocumented internal feature flags.
- A hosted service or a shared-key proxy.
- A model provider or a model trainer.
- Windows sandbox parity with macOS Seatbelt in Part 1.

---

## 4. Personas and jobs

| Persona | Job | Key features |
|---|---|---|
| Free-tier developer | Use a Gemini, Groq, or OpenRouter key to code without a subscription | C1, P4, T1-T7, S1-S3 |
| Local-first developer | Keep code and prompts on-device with Ollama or LM Studio | P5, O3, S5 |
| Power user | Automate reviews, refactors, and multi-agent work | T14, X4, X11, I9 |
| Team lead | Standardize settings, hooks, and policy | X5, X6, O1, O2 |
| CI engineer | Run headless, structured, reproducible sessions | C2, I1, I2 |
| Extension author | Ship commands, skills, agents, plugins, and MCP servers | X1-X10 |

---

## 5. Architecture

### 5.1 Layers

```
+-------------------------------------------------------------+
| CLI and TUI                                                 |
|   argument parsing, commands, Ink components, input         |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
| Application                                                 |
|   session orchestration, turn loop, compaction, checkpoints  |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
| Core contracts                                              |
|   Provider, Tool, Message, Permission, Hook, Extension      |
+------+----------------+----------------+--------------------+
       |                |                |
+------v------+  +------v------+  +------v------------------+
| Providers   |  | Tools       |  | Extensions              |
| adapters,   |  | built-ins,  |  | commands, skills,       |
| presets,    |  | MCP, LSP,   |  | agents, hooks, plugins, |
| retries     |  | subagents   |  | workflows               |
+------+------+  +------+------+  +------+------------------+
       |                |                |
       +--------+-------+--------+-------+
                |                |
         +------v------+  +------v------+
         | Permissions |  | Storage     |
         | rules,      |  | JSONL, JSON |
         | sandbox,    |  | checkpoints |
         | audit       |  | memory      |
         +-------------+  +-------------+
```

### 5.2 Module map

| Path | Responsibility | May import |
|---|---|---|
| `src/cli/` | argv parsing, exit codes, command dispatch | app, contracts |
| `src/tui/` | Ink components, input, rendering | app, contracts |
| `src/app/` | turn loop, session orchestration, compaction | core, contracts |
| `src/core/` | pure logic: context, rules, token estimates | contracts, util |
| `src/contracts/` | Provider, Tool, Message, Permission, Hook types | util |
| `src/providers/` | Anthropic, OpenAI-compatible, presets, retry | contracts, util |
| `src/tools/` | built-in tools, MCP, LSP, subagents | contracts, permissions |
| `src/permissions/` | rule engine, prompts, sandbox, audit | contracts, storage |
| `src/storage/` | session JSONL, settings, checkpoints, memory | contracts, util |
| `src/extensions/` | commands, skills, agents, teams, hooks, plugins | contracts, permissions |
| `src/integrations/` | GitHub, IDE, browser, remote, cloud, worktrees | contracts, app |
| `src/telemetry/` | OTel, local audit, privacy | contracts, util |
| `src/util/` | paths, fs, logger, result, ids, clock | none |

### 5.3 Dependency rule

`core` must not import `fs`, `http`, `child_process`, or `process`. All IO is
injected. This keeps the turn loop, compaction, and permission decisions unit
testable without a real environment.

---

## 6. Contracts

### 6.1 Provider

```ts
export interface ModelCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  jsonSchema: boolean;
  thinking: boolean;
}

export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  pricing?: { inputPerMTok: number; outputPerMTok: number };
}

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedTokens?: number }
  | { type: "done"; stopReason: "end_turn" | "tool_use" | "max_tokens" | "aborted" }
  | { type: "error"; error: KeycodeError };

export interface ModelRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  temperature?: number;
  maxOutputTokens?: number;
  jsonSchema?: unknown;
}

export interface Provider {
  readonly id: string;
  listModels(): Promise<ModelInfo[]>;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
```

Rules:

- Providers emit normalized events only.
- A provider must not mutate the request.
- A provider must close its stream on abort.
- A provider must report usage when the upstream does.
- Unknown stop reasons map to `end_turn` with a warning.

### 6.2 Tool

```ts
export interface ToolResult {
  ok: boolean;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; mime: string; data: string }
  >;
  display?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  sessionId: string;
  cwd: string;
  signal: AbortSignal;
  permissions: PermissionService;
  logger: Logger;
  clock: Clock;
}

export interface Tool<I> {
  name: string;
  description: string;
  input: ZodType<I>;
  readOnly: boolean;
  concurrency: "parallel" | "exclusive";
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
}
```

Rules:

- Input is validated before the permission check.
- A validation failure returns a tool error result; it never throws into the
  turn loop.
- `readOnly` tools may run in parallel; mutating tools run exclusively.
- Every result is capped at 30,000 characters; larger output spills to a file.
- Tool names are unique and match `^[A-Za-z][A-Za-z0-9_]*$`.
- MCP tools are named `mcp__<server>__<tool>`.

### 6.3 Message

```ts
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; ok: boolean; content: ContentBlock[] };

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: ContentBlock[];
  timestamp: string;
  usage?: Usage;
  interrupted?: boolean;
}
```

### 6.4 Error model

```ts
export class KeycodeError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}
```

| Code | Meaning | Retryable | CLI exit |
|---|---|---:|---:|
| `CONFIG_INVALID` | Settings or frontmatter failed validation | no | 2 |
| `PROVIDER_NOT_FOUND` | Unknown provider ID | no | 2 |
| `PROVIDER_AUTH` | Missing or rejected credentials | no | 3 |
| `PROVIDER_RATE_LIMIT` | 429 or quota exhausted | yes | 4 |
| `PROVIDER_UNAVAILABLE` | Network or 5xx failure | yes | 4 |
| `PROVIDER_CAPABILITY` | Model cannot do the requested operation | no | 2 |
| `BUDGET_EXCEEDED` | Spend cap reached | no | 5 |
| `PERMISSION_DENIED` | Rule or user denied the call | no | 6 |
| `PERMISSION_PROMPT_UNAVAILABLE` | No interactive channel to ask | no | 6 |
| `PATH_OUTSIDE_WORKSPACE` | Path escapes allowed roots | no | 6 |
| `TOOL_INPUT_INVALID` | Tool input failed schema validation | no | 2 |
| `TOOL_TIMEOUT` | Tool exceeded its deadline | yes | 7 |
| `TOOL_UNSUPPORTED` | Tool unavailable on this platform | no | 2 |
| `SANDBOX_DENIED` | Sandbox blocked the operation | no | 6 |
| `MCP_INIT_FAILED` | MCP server failed to initialize | yes | 7 |
| `HOOK_FAILED` | Hook failed or timed out | yes | 7 |
| `SESSION_CORRUPT` | Session file is unreadable | no | 2 |
| `ABORTED` | User cancelled the turn | no | 130 |

Errors shown to the user include the code, a one-line cause, and a remedy. Stack
traces appear only with `--debug`.

---

## 7. Data model

### 7.1 Session storage

```
KEYCODE_HOME/
  settings.json
  projects/
    <sha256(realpath(cwd))[0..12]>/
      sessions/
        <session-id>.jsonl
      checkpoints/
        <checkpoint-id>/
      memory.json
  skills/
  agents/
  plugins/
  themes/
  keybindings.json
  logs/
    keycode.log
    audit.jsonl
```

A session is append-only JSONL:

```jsonl
{"type":"session","version":1,"id":"0f8f...","name":"fix-auth","cwd":"C:/repo","provider":"gemini","model":"gemini-2.5-flash","createdAt":"2026-11-19T10:00:00Z","parentId":null}
{"type":"message","id":"m1","role":"user","content":[{"type":"text","text":"fix the failing test"}],"timestamp":"2026-11-19T10:00:01Z"}
{"type":"message","id":"m2","role":"assistant","content":[{"type":"text","text":"I will inspect the test."},{"type":"tool_call","id":"t1","name":"Read","input":{"file_path":"src/auth.test.ts"}}],"usage":{"inputTokens":1200,"outputTokens":80},"timestamp":"2026-11-19T10:00:03Z"}
{"type":"tool_result","toolCallId":"t1","ok":true,"content":[{"type":"text","text":"..."}],"timestamp":"2026-11-19T10:00:03Z"}
{"type":"checkpoint","id":"c1","turn":1,"files":[{"path":"src/auth.ts","backup":"checkpoints/c1/src/auth.ts"}],"timestamp":"2026-11-19T10:00:04Z"}
{"type":"summary","id":"s1","replaces":["m1","m2"],"text":"...","tokensBefore":42000,"tokensAfter":6000,"timestamp":"2026-11-19T10:05:00Z"}
{"type":"model","provider":"ollama","model":"qwen3-coder","timestamp":"2026-11-19T10:06:00Z"}
```

Rules:

- Append with a single write; fsync at turn boundaries.
- A truncated final line is ignored with a warning and repaired on resume.
- Unknown record types are preserved but ignored.
- Session IDs are UUID v4.
- `--session-id` must be a valid UUID.
- Fork copies messages up to the current point and sets `parentId`.
- The latest `model` record overrides the header for resume and session lists.
- `clear` starts a new session; the old file is never deleted.
- Remote Control can delete a non-active session; the active session cannot be deleted.

### 7.2 Settings

```json
{
  "$schema": "https://keycode.dev/schema/settings.json",
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "effort": "medium",
  "permissions": {
    "defaultMode": "manual",
    "allow": ["Read(./**)", "Glob(./**)", "Grep(./**)"],
    "deny": ["Read(./.env)", "Bash(rm -rf *)"],
    "ask": ["Bash(git push *)", "WebFetch(domain:*)"] 
  },
  "providers": {
    "gemini": {
      "kind": "openai-compatible",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/",
      "apiKeyEnv": "GEMINI_API_KEY",
      "models": ["gemini-2.5-flash"]
    }
  },
  "hooks": {},
  "mcpServers": {},
  "statusLine": null,
  "outputStyle": "default",
  "telemetry": "off"
}
```

### 7.3 Permission rule grammar

```
Tool
Tool(pattern)
Bash(git *)
Bash(npm run *)
Read(./src/**)
Edit(./src/**)
WebFetch(domain:example.com)
mcp__github__create_issue
```

- `Tool` without a pattern matches every use of that tool.
- Path patterns are resolved against the workspace root; `..` is rejected.
- `Bash` patterns match the command prefix and support `*` as a glob.
- Domain patterns match the host and its subdomains.
- MCP names match exactly.
- A rule can be scoped to `user`, `project`, `local`, or `session`.
- Deny always wins. Ask beats allow. Allow beats the mode default.

---

## 8. Permission pipeline

Every tool call follows this sequence:

1. **Normalize.** Resolve the tool, canonicalize paths, trim the command.
2. **Validate.** Parse input with the tool schema. On failure, return
   `TOOL_INPUT_INVALID` without executing.
3. **Trust.** If the workspace is untrusted, ignore project settings, hooks,
   plugins, and MCP servers from the project.
4. **Deny rules.** Any matching deny rule returns `PERMISSION_DENIED`.
5. **Ask rules.** Any matching ask rule prompts, even in `acceptEdits`.
6. **Allow rules.** A matching allow rule proceeds.
7. **Mode default.**
   - `manual`: prompt for writes and commands; reads are allowed inside the
     workspace.
   - `acceptEdits`: allow file edits inside the workspace; prompt for commands
     and network.
   - `plan`: deny all mutations; reads and analysis only.
   - `auto`: allow low-risk operations, prompt for risky ones; the classifier
     can never allow a deny rule.
   - `dontAsk`: deny anything that would prompt.
   - `bypassPermissions`: allow everything except managed denies; requires an
     explicit opt-in and a visible warning.
8. **Sandbox policy.** Apply filesystem and network limits. A sandbox denial is
   final for that call.
9. **Prompt.** Show the tool, a diff or command preview, and the choices:
   allow once, allow always, allow for session, deny with a note, edit input,
   cancel.
10. **Execute.** Run with a timeout, output cap, and abort signal.
11. **Audit.** Append the decision, matched rule, redacted input, duration, and
    outcome.

Invariants:

- A subagent inherits the parent's ceiling and can only narrow it.
- A hook can deny or ask, but cannot grant a permission the user denied.
- A tool result cannot modify permission rules.
- `bypassPermissions` is unavailable in restricted mode and can be disabled by
  managed policy.

---

## 9. Feature catalog

Every feature has exactly one acceptance test. Test IDs are `T-<feature ID>`.
The `Part` column is the build-plan part.

### 9.1 Core runtime (C1-C10)

| ID | Feature | Requirement | Acceptance test (exactly one) | Part |
|---|---|---|---|---|
| C1 | Interactive REPL | Running `keycode` with no arguments opens a TUI in the current directory; a submitted prompt streams a model reply and appends both messages to the session file. | T-C1: Spawn `keycode` with the fake provider in a temp workspace, submit "hello", assert the streamed reply appears and the session JSONL contains user and assistant messages. | 1 |
| C2 | Headless print mode | `keycode -p "prompt"` prints text and exits 0; `--output-format json` emits one result object; `stream-json` emits NDJSON events; `--input-format stream-json` accepts NDJSON user messages. | T-C2: Run all three output formats and stream-json input against the fake provider, parse the output, and assert the schemas and exit codes. | 1 |
| C3 | Session persistence | Sessions persist under `KEYCODE_HOME/projects/<hash>/`; `--continue`, `--resume <id-or-name>`, `--fork-session`, and `--session-id <uuid>` behave as specified and restore messages and model. | T-C3: Create two sessions, resume the older by name, fork it, and assert the new ID, copied history, and unchanged original. | 1 |
| C4 | Streaming turn loop | The loop streams model events, executes tool calls in order, appends results, and repeats until `end_turn`; Esc or Ctrl+C aborts the in-flight request and preserves partial text. | T-C4: Fake provider emits text, a tool call, then text; abort after the first delta; assert the tool did not run and the turn is marked interrupted. | 1 |
| C5 | Compaction | `/compact [instructions]` summarizes older turns, keeps recent turns and system context, writes a summary record, and leaves the original transcript on disk; auto-compaction triggers at the configured threshold. | T-C5: Seed 100 messages, run `/compact`, assert a summary record, a reduced context estimate, and that the original messages remain readable. | 1 |
| C6 | Usage and context views | `/usage`, `/cost`, `/stats`, and `/context` report per-turn and session tokens, cost, provider quota, and a context grid. | T-C6: Fake provider returns exact usage; assert `/cost` totals and `/context` grid cells match the fixture. | 1 |
| C7 | Checkpoints and rewind | A checkpoint is created before each turn and before each file mutation; `/rewind` restores conversation only, files only, or both. | T-C7: Edit a file, run `/rewind` choosing both, assert the file content is restored and messages are truncated to the checkpoint. | 1 |
| C8 | Branch and side questions | `/branch [name]` creates a new session from the current point with a parent link; `/btw <question>` answers without adding the side exchange to the main transcript. | T-C8: Branch and assert the new session plus parent ID; run `/btw` and assert the main transcript length is unchanged. | 1 |
| C9 | Transcript actions | `/export [file]` writes markdown or JSON; `/copy [N]` copies the Nth-latest response; `/clear` starts a new session; `/rename` updates metadata. | T-C9: Export to a temp file and assert content; rename and assert session metadata plus resume by the new name. | 1 |
| C10 | Model and effort selection | `--model`, `/model`, aliases, `--effort low\|medium\|high\|xhigh\|max`, and `--fallback-model` select the model and effort per session; fallback is used only after the primary fails. | T-C10: Configure a failing primary and a working fake fallback; assert the fallback is used and the effort value is present in the request. | 1 |

### 9.2 Providers and free keys (P1-P9)

| ID | Feature | Requirement | Acceptance test (exactly one) | Part |
|---|---|---|---|---|
| P1 | Provider contract and registry | A single `Provider` contract and registry resolve providers by ID from config; unknown IDs produce `PROVIDER_NOT_FOUND`. | T-P1: Register two fake providers, resolve each, assert capabilities, and assert the unknown-ID error. | 1 |
| P2 | Anthropic adapter | The adapter supports Messages API streaming, tool_use and tool_result, thinking blocks, prompt caching headers, API key and OAuth. | T-P2: A mock HTTP server asserts the request shape and streams a tool call; the adapter emits normalized events. | 1 |
| P3 | OpenAI-compatible adapter | The adapter supports `/chat/completions` streaming, tools, tool_calls, images, and JSON mode with configurable headers. | T-P3: A mock server asserts the request and streams a tool call; the adapter normalizes text, tool call, usage, and done. | 1 |
| P4 | Free hosted presets | Built-in presets for Gemini, Groq, OpenRouter, Cerebras, Mistral, and GitHub Models resolve base URL, key env, default model, and headers without network access. | T-P4: Table-driven resolution of all six presets; assert each field and that no request is made. | 1 |
| P5 | Local presets | Ollama, LM Studio, and llama.cpp work without a key and expose model discovery plus a health check. | T-P5: A mock local server lists models; select Ollama, complete a turn, and assert no Authorization header is sent. | 1 |
| P6 | Credentials and apiKeyHelper | Credentials resolve in order env > keychain > config; `apiKeyHelper` runs with a TTL; `keycode auth set/status/logout` manage secrets; values are masked. | T-P6: A helper script returns a key; the adapter uses it; logs and status show only a masked fingerprint; the key rotates after the TTL. | 1 |
| P7 | Retry and fallback | Retries use exponential backoff with jitter for 429, 5xx, and network errors; `Retry-After` is honored; fallback models are tried in order; attempts are capped. | T-P7: Mock a 429 with Retry-After then 200 and assert two attempts and the delay; exhaust the primary and assert fallback order. | 1 |
| P8 | Capability negotiation | Capability negotiation filters tools and attachments per model; unsupported inputs fail with `PROVIDER_CAPABILITY` and are never silently dropped. | T-P8: A model without vision rejects an image with the typed error; a model without tools returns a clear capability error or uses the documented text protocol. | 1 |
| P9 | Budget and diagnostics | `--max-budget-usd` stops before a request that would exceed the budget; `keycode doctor` tests provider connectivity and reports latency and auth status. | T-P9: A budget of $0.01 with usage that exceeds it stops with `BUDGET_EXCEEDED`; doctor reports reachable and unreachable fake providers. | 1 |

### 9.3 Tools (T1-T19)

| ID | Feature | Requirement | Acceptance test (exactly one) | Part |
|---|---|---|---|---|
| T1 | Bash | Bash runs a command in the session cwd with a timeout, output cap, file spill, background mode, stdin, and environment overrides; every call is permission-checked. | T-T1: Run printf, a timeout, a large-output command, and a background command; assert output, spill file, timeout error, and task ID. | 1 |
| T2 | PowerShell | PowerShell runs on Windows via `pwsh` or `powershell` with the same contract as Bash; other platforms return `TOOL_UNSUPPORTED`. | T-T2: On win32 run `Write-Output`; on non-win32 assert the typed unsupported error. | 1 |
| T3 | Read | Read returns text with line numbers, supports offset and limit, images, PDF page ranges, and notebook cells; binary files are detected. | T-T3: Read text, image, PDF, and ipynb fixtures; assert line numbers, image block, page range, cell rendering, and binary rejection. | 1 |
| T4 | Write | Write creates or overwrites a file, requires a prior Read for an existing file, creates parent directories, and writes atomically. | T-T4: Create a new file, overwrite after Read, attempt overwrite without Read and assert failure, and assert no partial file remains on error. | 1 |
| T5 | Edit | Edit performs exact replacement, fails on a non-unique match, supports `replace_all`, preserves line endings, and returns a diff. | T-T5: A unique edit succeeds, a duplicate fails, `replace_all` replaces every occurrence, and CRLF is preserved. | 1 |
| T6 | Glob | Glob matches patterns, sorts by modification time, excludes `.git` and `node_modules` by default, respects limits, and does not follow symlink loops. | T-T6: A fixture tree with ignored directories and a symlink loop asserts matches, order, exclusions, and a bounded result count. | 1 |
| T7 | Grep | Grep searches file contents with regex or literal mode, glob and type filters, context lines, output modes, result limits, and binary skipping. | T-T7: Fixture files assert matches, context, file filter, truncated result count, and binary file exclusion. | 1 |
| T8 | WebFetch | WebFetch validates URLs, upgrades HTTP to HTTPS, converts HTML to markdown, extracts with a prompt, follows bounded redirects, and blocks loopback, private, link-local, and metadata addresses. Hostnames are resolved and re-checked after redirects. | T-T8: A mock HTTP server returns HTML and asserts markdown extraction; 127.0.0.1 and 169.254.169.254 are blocked; a hostname resolving to a private address and a redirect to one are blocked. | 2 |
| T9 | WebSearch | WebSearch uses a pluggable provider (Brave, Tavily, SearXNG, or Google CSE), supports domain filters, and returns cited results; with no provider it is disabled with a clear message. | T-T9: A fake search provider returns results; assert formatted sources, the domain filter, and disabled behavior without a provider. | 2 |
| T10 | TodoWrite | TodoWrite replaces or merges a structured todo list with statuses and renders it in the TUI; state persists for the session. | T-T10: Write three todos, update one to completed, assert the tool result and TUI rows, and assert persistence after resume. | 1 |
| T11 | NotebookEdit | NotebookEdit replaces, inserts, and deletes cells with a cell type, preserves outputs, and keeps valid ipynb JSON. | T-T11: A fixture notebook performs each operation and asserts valid JSON plus expected cell content and outputs. | 2 |
| T12 | AskUserQuestion | AskUserQuestion asks 1-4 questions with 2-4 options, supports multi-select and a custom answer, and returns a typed result; cancel and timeout are distinct. | T-T12: A fake TUI selects an option and types a custom answer; assert the result shape; cancel returns `USER_CANCELLED`. | 1 |
| T13 | Skill tool | The Skill tool loads a `SKILL.md` by name, injects its instructions only on invocation, passes arguments, and enforces its allowed-tools list. | T-T13: A fixture skill with a restricted tool is invoked; assert instructions injected and a disallowed tool call is denied. | 2 |
| T14 | Subagents | The Agent tool spawns a child session with its own prompt, model, tools, and permission ceiling; it returns a final report and can run in parallel or be stopped. | T-T14: A fake provider child returns a report; assert the parent tool result, child session file, and that a restricted child cannot call Bash. | 2 |
| T15 | Background tasks | Background task tools create, get, list, update, stop, and read output from long-running processes; tasks persist and are killed as a process tree. | T-T15: Start a long task, list it, read output, stop it, and assert exit plus no orphan process. | 2 |
| T16 | MCP | MCP supports stdio, SSE, and HTTP transports; initialize, tools/list, tools/call, resources/list, resources/read, and prompts/get; OAuth and per-server timeouts are supported. | T-T16: A fake stdio server exposes a tool, resource, and prompt; assert each call, schema validation, and a timeout error. | 2 |
| T17 | LSP | LSP starts a language server, publishes diagnostics after edits, and supports hover, definition, and references with per-request timeouts. Configured servers are exposed to the agent as the `LSP` tool. | T-T17: A fake LSP server returns diagnostics and a definition; assert formatted results and a timeout; assert the tool is loaded from settings and called through the agent. | 2 |
| T18 | Code Mode | Code Mode provides an opt-in persistent JS REPL with a tool bridge, output capture, a separate `node:vm` context, and reset; settings enable it for the agent. | T-T18: Evaluate an expression, call a tool, assert output and persisted state, then reset and assert state cleared; disabled mode returns a typed error; settings enable the tool. | 2 |
| T19 | Artifacts | The `Artifact` tool creates, publishes, versions, previews, inspects, comments on, and stores data for local HTML artifacts; preview is loopback-only and token-gated. | T-T19: Publish a fixture, fetch the preview, assert version increment and local-only binding; unauthorized access is denied; the tool creates, updates, inspects, and previews. | 2 |

### 9.4 Safety (S1-S9)

| ID | Feature | Requirement | Acceptance test (exactly one) | Part |
|---|---|---|---|---|
| S1 | Permission modes | Modes `manual`, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions` control writes and commands; plan mode blocks mutation. | T-S1: Table-driven run of a Write and a Bash call in each mode; assert allow, deny, or prompt, and that plan mode blocks writes. | 1 |
| S2 | Rule engine | Allow, deny, and ask rules support tool patterns, path globs, domain patterns, MCP names, and scopes; precedence is deny > ask > allow > mode. | T-S2: A rule matrix including `Bash(git *)`, `Read(./src/**)`, and a deny override asserts the decision and matched rule. | 1 |
| S3 | Permission prompt | The prompt shows a diff or command preview and supports allow once, allow always, allow for session, deny with a note, edit input, and cancel. | T-S3: A fake TUI chooses allow always; assert the rule is persisted and the tool runs; cancel asserts no execution. | 1 |
| S4 | Workspace trust | Workspace trust is requested on first use with a review of project permissions, hooks, MCP, LSP, browser drivers, env keys, and customization files; approval stores a fingerprint and changes re-prompt; trusted roots allow project settings and hooks, untrusted roots run restricted. | T-S4: An untrusted directory blocks project hooks and settings; after trust, the same hook runs; a manifest lists executable items and a changed fingerprint returns to a changed state. | 1 |
| S5 | Sandbox | The sandbox restricts filesystem writes to allowed roots, network egress to an allowlist, and process limits; it uses Seatbelt, bubblewrap, or Windows job objects with a documented fallback warning. | T-S5: A sandboxed command cannot write outside the root or reach the network; a write inside the root succeeds; fallback emits a warning. | 2 |
| S6 | Restricted modes | `--restricted` removes code-running tools and WebFetch unless explicitly named; `--safe-mode` disables customizations; `--bare` skips hooks, LSP, plugin sync, and memory; managed settings still apply. | T-S6: Run each flag with fixture config and assert the effective tool list, settings sources, and hook behavior. | 2 |
| S7 | Secret redaction | Redaction detects common key formats and bearer tokens in logs, transcripts, telemetry, and error output, replacing them with stable placeholders. Write and Edit refuse to introduce new credentials. | T-S7: A command prints fake AWS, GitHub, and bearer tokens; assert placeholders in the session JSONL and logs and no raw value; a write or edit that adds a credential is refused. | 1 |
| S8 | Dangerous command detection | Detection classifies destructive patterns such as `rm -rf`, `curl \| sh`, `chmod 777`, force push, `dd`, and disk format; the mode decides warn or deny. | T-S8: A table of commands asserts each classification and the resulting prompt or denial. | 1 |
| S9 | Audit log | An append-only audit log records permission decisions, matched rules, tool calls, redacted arguments, duration, and outcome; it rotates and is readable with `keycode audit`. | T-S9: Run allowed and denied tools; assert audit entries with decision, rule, and no secrets; assert rotation at the size limit. | 2 |

### 9.5 Memory and context (M1-M7)

| ID | Feature | Requirement | Acceptance test (exactly one) | Part |
|---|---|---|---|---|
| M1 | CLAUDE.md hierarchy | CLAUDE.md loads from user, project, and local scopes plus parent directories, with documented precedence and size limits. | T-M1: Fixtures at three levels assert assembled prompt order, deduplication, and size truncation. | 1 |
| M2 | Imports | `@path` imports in CLAUDE.md resolve relative to the file, support recursion, detect cycles, and ignore imports inside code fences. | T-M2: A imports B and B imports A; assert a cycle warning and that content appears once; a fenced import is ignored. | 1 |
| M3 | Auto-memory | Auto-memory extracts durable facts after selected turns every `autoMemoryEvery` turns, stores them outside the project, recalls relevant memories, and supports pause and manual editing. | T-M3: A fake provider proposes a memory; assert storage, recall in a new session, pause disables both, and a completed turn triggers extraction. | 2 |
| M4 | System prompt assembly | The system prompt assembles base instructions, tool docs, memory, environment, and git status; `--system-prompt`, `--append-system-prompt`, and snapshot on/off are supported. | T-M4: A custom prompt replaces the base, append adds to it, and a resumed session reuses the snapshot until compaction. | 1 |
| M5 | Additional directories | `--add-dir`, `/add-dir`, and `/cd` extend the workspace; permissions and trust apply to added roots; path display updates. | T-M5: Read a file outside cwd before and after add-dir; assert denial then success, and assert `/cd` changes the session cwd. | 1 |
| M6 | Ignore-aware discovery | File discovery respects `.gitignore`, `.ignore`, and global excludes; hidden files and large files have explicit policies; symlink loops are bounded. | T-M6: A fixture with ignored files asserts Glob and Grep exclude them, `--no-ignore` includes them, and a symlink loop terminates. | 1 |
| M7 | Context budgeting | Context budgeting estimates tokens, reserves output space, truncates or spills large tool results, orders the prompt for cache reuse, and reports cache hits. | T-M7: A 200K-token fixture triggers compaction; a large tool result is truncated or spilled; the second request reports cached tokens. | 2 |

### 9.6 Extensibility (X1-X12)

| ID | Feature | Requirement | Acceptance test (exactly one) | Part |
|---|---|---|---|---|
| X1 | Custom commands | Commands load from `.keycode/commands` and `.claude/commands`, support frontmatter, `$ARGUMENTS`, positional args, `!` bash injection, namespacing, and the permission pipeline. | T-X1: A command with args and a bash injection renders the prompt, runs the injection only after approval, and is listed by `/help`. | 2 |
| X2 | Skills | Skills load from `.keycode/skills` and `.claude/skills`, expose name and description metadata, load the body on demand, honor allowed tools, and reload on change. | T-X2: A skill appears in `/skills`; before invocation only metadata is loaded; invocation injects the body and a disallowed tool is denied. | 2 |
| X3 | Custom agents | Agents load from `.keycode/agents` and `.claude/agents`, support tools, model, and permission frontmatter, and are invocable by name or mention. | T-X3: An agent restricted to Read cannot call Bash; its report returns to the parent and the restriction is enforced. | 2 |
| X4 | Agent teams | Teams create a shared task list, message members, emit idle and completed events, enforce a member cap, and clean up. | T-X4: Two fake agents claim tasks and exchange a message; assert task states, events, and team deletion. | 2 |
| X5 | Hooks | Hooks support PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, UserPromptSubmit, Stop, SubagentStart, SubagentStop, PreCompact, PostCompact, SessionStart, SessionEnd, Notification, Setup, ConfigChange, WorktreeCreate, WorktreeRemove, TeammateIdle, and TaskCompleted. | T-X5: A PreToolUse hook returns a deny decision in JSON; assert the tool is blocked with the reason; a PostToolUse hook receives the result. | 2 |
| X6 | Plugins and marketplaces | Plugins package commands, agents, skills, hooks, and MCP servers; marketplaces support add, install, enable, disable, update, and version pinning with a trust prompt. | T-X6: A local plugin with a command and hook installs, the command runs, the hook fires, disable removes both, and the trust prompt is recorded. | 2 |
| X7 | Output styles | Output styles load built-in and custom styles from `.keycode/output-styles`, inject style instructions, and persist per session. | T-X7: A custom style changes the system prompt, `/output-style` lists it, and resume keeps the selection. | 2 |
| X8 | Status line | The status line runs a user command with a JSON payload on stdin, displays one line, refreshes on an interval, times out, and can be disabled. | T-X8: A fake statusline script echoes model and cwd; assert the footer text, timeout fallback, and disabled state. | 2 |
| X9 | Themes and keys | Themes, keybindings, and vim mode are configurable; keybindings are scoped by context; conflicts and invalid bindings warn without crashing. | T-X9: Rebind submit and assert the new key submits; vim `dd` deletes a line; an invalid binding warns and keeps defaults. | 2 |
| X10 | MCP management | MCP management supports add, remove, list, get, enable, disable, reconnect, and OAuth login across user, project, and local scopes. | T-X10: Add a stdio server, list it, disable it, reconnect it, remove it, and complete a fake OAuth refresh. | 2 |
| X11 | Workflows | Workflows run a JS script with agent and tool steps, parallel branches, checkpoints, budget, and resume; completed steps are reused after a failure. | T-X11: A two-step parallel workflow fails at step two; resume reuses step one and completes without re-running it. | 2 |
| X12 | Loops and cron | Loops support cron expressions, run-once timestamps, durable jobs, list, delete, timezone, and an overlap policy. | T-X12: An every-minute loop with a fake clock runs twice, does not overlap, and survives a restart. | 2 |

### 9.7 Integrations (I1-I10)

| ID | Feature | Requirement | Acceptance test (exactly one) | Part |
|---|---|---|---|---|
| I1 | SDK and structured output | A programmatic SDK exposes `createAgent`, streaming events, abort, and `--json-schema` structured output with validation. | T-I1: Run with a schema and assert the parsed object; a mismatched object returns a validation error. | 3 |
| I2 | GitHub Actions | The integration provides a workflow template, `@claude` mention handling, PR and issue context, least-privilege token guidance, and comment posting. | T-I2: A fixture pull_request event produces a prompt with the diff and a mock API comment payload. | 3 |
| I3 | IDE bridge | A local WebSocket server with a discovery file sends selection and diagnostics context and requests diff views. | T-I3: A fake IDE client connects, sends a selection, and receives a diff request; the prompt contains the selection. | 3 |
| I4 | Browser automation | The `Browser` tool loads a configured driver for navigate, click, type, screenshot, and DOM read, with a per-origin permission and domain allowlist; driver settings require a trusted workspace. | T-I4: A local fixture page changes after a click; assert the DOM change, screenshot artifact, and denied origin; assert a driver module from settings is exposed through the agent. | 3 |
| I5 | Remote Control | A local web UI over HTTP and WebSocket uses a pairing token or QR code, mirrors the session, supports approve, answer questions, and stop, and keeps busy state synchronized. The VS Code extension forwards the active file and selection over the authenticated loopback endpoint; context is shown above the composer and prepended to prompts. | T-I5: A client with the token sends a prompt and receives the streamed reply; a wrong token is rejected; the server binds to loopback by default; editor context appears in the prompt and can be detached; an `AskUserQuestion` request is delivered and answered. | 3 |
| I6 | Cloud and self-hosted sessions | A Docker runner uploads and downloads session state, configures the environment, and supports teleport between local and remote. | T-I6: A fake runner creates a session, teleports it back, and the local session contains the remote history. | 3 |
| I7 | Background sessions | `--bg`, `agents`, `attach`, `logs`, `stop`, `rm`, and `respawn` work with a daemon, persistence, and crash recovery. | T-I7: Start a background session, list it, read logs, stop it, and resume it after a simulated crash. | 3 |
| I8 | Worktrees and tmux | `--worktree [name]`, git worktree create and remove, tmux or iTerm2 panes, and an uncommitted-changes guard are supported. | T-I8: In a temp git repo, create a worktree, run a session, exit, and assert the cleanup prompt and worktree state. | 3 |
| I9 | PR workflows | `gh` integration supports review, security review, PR comments, and autofix, scoped to the branch diff. | T-I9: A mock `gh` returns a diff; assert review findings and the comment payload; a clean diff produces no findings. | 3 |
| I10 | Import | Import converts Codex, Gemini, and Cursor configuration into settings, commands, and agents, with a dry run and a backup. | T-I10: Fixture configs convert correctly, dry run writes nothing, and a second run is idempotent. | 3 |

### 9.8 User experience (U1-U8)

| ID | Feature | Requirement | Acceptance test (exactly one) | Part |
|---|---|---|---|---|
| U1 | TUI renderer | The TUI renders streaming markdown, code highlighting, diffs, tool rows, spinners, and scrollback in default and fullscreen modes. | T-U1: Render a fixture transcript and assert markdown, diff, tool status, and spinner states in the snapshot. | 1 |
| U2 | Input and completion | Input supports multiline, history, Ctrl+R search, `@file` completion, a slash-command menu, image paste, external editor, and draft persistence. | T-U2: Type multiline text, search history, complete a file, and submit; assert the payload and restored draft. | 1 |
| U3 | Notifications | Notifications fire for idle, permission required, task complete, and input needed via terminal bell or OSC, desktop notification, or webhook, with deduplication. Runtime hooks send permission, question, and task-complete events. | T-U3: A fake notifier triggers idle and permission events; assert the events, threshold, and deduplication; a real turn sends a task-complete webhook. | 3 |
| U4 | Accessibility | Accessibility mode provides flat text, no decorative borders or animations, reduced motion, high contrast, and screen-reader labels. | T-U4: Run with `--ax-screen-reader` and assert no ANSI borders or animations and that labels are present. | 2 |
| U5 | Status footer | The footer shows model, tokens, cost, git branch, PR badge, background tasks, and progress, and updates without corrupting scrollback. | T-U5: In a fake git repo, assert the footer fields and progress updates after a tool call. | 1 |
| U6 | Onboarding and help | First-run onboarding covers theme, trust, and provider choice; `/help` and `?` list commands; tips and `/release-notes` render. | T-U6: A fresh `KEYCODE_HOME` shows onboarding; `/help` lists all commands; release notes render. | 2 |
| U7 | Doctor | `keycode doctor` checks the binary, config, providers, MCP, ripgrep, git, disk, and permissions, supports `--fix`, and emits JSON. | T-U7: A broken config fixture produces the expected diagnostics and exit code; `--fix` repairs the file; JSON output parses. | 2 |
| U8 | Updates and install | Updates check a release feed, support stable and latest channels, verify checksums, install via native, npm, brew, or winget, and roll back on failure. | T-U8: A fake release feed triggers an update prompt; a checksum mismatch aborts and restores the previous version. | 3 |

### 9.9 Platform and operations (O1-O6)

| ID | Feature | Requirement | Acceptance test (exactly one) | Part |
|---|---|---|---|---|
| O1 | Settings hierarchy | Settings load from user, project, local, and managed layers with JSON Schema validation, env interpolation, precedence, and hot reload; invalid files warn and are ignored. | T-O1: The same key at four layers resolves to managed; an invalid file warns and is ignored; a hot reload applies a valid change. | 1 |
| O2 | Managed policy | Managed policy supports per-OS paths, policy gates for tools, providers, telemetry, and MCP, and cannot be overridden by user settings. | T-O2: A managed file disables Bash; the tool is absent and cannot be enabled by user or project settings. | 2 |
| O3 | Privacy | Privacy settings provide first-run consent, `/privacy-settings`, opt-out environment variables, local-only defaults, and data export and deletion. | T-O3: Opt out, run a turn, and assert no telemetry events; export and delete remove the expected data. | 2 |
| O4 | OpenTelemetry | OTel exports metrics, logs, and traces over OTLP HTTP or gRPC with resource attributes, sampling, and redaction. Runtime turns export turn, token, cost, and tool-count metrics when privacy consent is granted. | T-O4: A fake OTLP collector receives token, cost, and tool-latency metrics with the expected attributes and no secrets; a real agent turn exports turn metrics. | 2 |
| O5 | Gateway | The gateway is a local reverse proxy that injects provider keys, authenticates clients, enforces rate limits, audits requests, and blocks SSRF. | T-O5: The proxy routes to a fake upstream, injects the key, rejects an unauthorized client, and blocks a private-IP target. | 3 |
| O6 | Cross-platform | Windows, macOS, Linux, and WSL have correct path handling, shell selection, terminal capabilities, Unicode width, and CRLF behavior. | T-O6: A CI matrix runs path, shell, and width fixtures on all four platforms and asserts platform-specific expectations. | 3 |

---

## 10. Cross-cutting behavior

### 10.1 Session lifecycle

1. Resolve `KEYCODE_HOME` (default `~/.keycode`).
2. Canonicalize the workspace with `realpath`.
3. Load settings layers and validate.
4. Load or create the session.
5. On first run, request workspace trust.
6. Assemble context and enter the turn loop.
7. On exit, flush the session, checkpoints, and audit log.

Session resume must be tolerant: a corrupt final line is dropped with a
warning; a corrupt middle line fails with `SESSION_CORRUPT` and a recovery hint.

### 10.2 Streaming and cancellation

- The provider stream is an `AsyncIterable<ModelEvent>`.
- Text deltas render immediately; the assistant message is committed when the
  stream ends or aborts.
- Tool calls are buffered until their arguments are complete.
- Abort uses a single `AbortController` per turn. Esc aborts; a second Esc opens
  the exit prompt.
- On abort, partial text is persisted with `interrupted: true` and
  `stopReason: "aborted"`.
- A provider that ignores the abort signal is terminated after a 5-second grace
  period.

### 10.3 Compaction

- Trigger when estimated tokens exceed `contextWindow - reserve`, where reserve
  defaults to 20% of the window.
- Keep the last 4 turns, the current user request, and any tool results those
  turns reference.
- Summarize older turns with the active model and a dedicated prompt.
- Write a `summary` record; do not delete original messages.
- On failure, keep the original context, warn once, and retry on the next turn.
- `/compact` accepts custom instructions and always runs immediately.

### 10.4 Context assembly order

1. Base system prompt.
2. Output style.
3. Tool documentation.
4. User CLAUDE.md.
5. Project CLAUDE.md (root to cwd).
6. Local CLAUDE.md.
7. Auto-memory.
8. Environment block (cwd, platform, date, git status).
9. Conversation summary.
10. Recent messages and tool results.

The stable prefix comes first and the volatile environment block comes last to
maximize prompt-cache reuse.

### 10.5 Tool execution

- Validate input before permission checks.
- Read-only tools run in parallel up to 8; mutating tools run exclusively.
- A turn may issue at most 20 tool calls by default; excess calls return an
  error result.
- Three consecutive identical tool calls are not executed after the second;
  the third returns `REPEATED_TOOL_CALL` so the model must verify or finish.
- Models declaring `tools: false` receive a documented fenced `keycode-tool`
  protocol in the system prompt. Parsed calls use the same validation,
  permission pipeline, and repeat guard as native tool calls.
- Output is capped at 30,000 characters; larger output is written to
  `KEYCODE_HOME/tool-output/<id>.txt` and the result contains a path plus a
  preview.
- A tool timeout defaults to 120 seconds; Bash defaults to 120 seconds and can
  be overridden per call up to 600 seconds.
- Every tool result includes `ok`, `content`, and a short `display` summary.

### 10.6 Hooks

Hook configuration:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "./scripts/check.sh", "timeout": 30 }
        ]
      }
    ]
  }
}
```

Contract:

- stdin: JSON with `session_id`, `hook_event_name`, `cwd`, `tool_name`,
  `tool_input`, and event-specific fields.
- stdout: optional JSON `{ "decision": "allow|deny|ask", "reason": "...",
  "updatedInput": {...}, "additionalContext": "..." }`.
- exit 0: success; exit 2: block with stderr as the reason; other: non-blocking
  error.
- Matchers support exact names, `*`, and `/regex/`.
- Default timeout 60 seconds; output cap 10,000 characters.
- Environment: `KEYCODE_PROJECT_DIR`, `KEYCODE_SESSION_ID`,
  `KEYCODE_HOOK_EVENT`.
- Hooks run only after explicit trust; project hooks are ignored in an
  untrusted workspace.
- A hook can deny or ask, but cannot override a deny rule.

### 10.7 MCP

- Transports: stdio, SSE, and streamable HTTP.
- Lifecycle: `initialize` -> `tools/list` -> `resources/list` -> `prompts/list`
  -> notifications.
- Tool names: `mcp__<server>__<tool>`.
- OAuth 2.1 with PKCE; tokens are stored in the OS keychain per server.
- Default init timeout 30 seconds; tool call timeout 60 seconds.
- Validate tool input and output against the advertised schema.
- One server's failure is isolated; the session continues.
- Server trust is explicit; project-scoped servers require workspace trust.
- Tool results are capped and redacted like built-in tool results.

### 10.8 Extension discovery

| Kind | Project paths | User paths | Precedence |
|---|---|---|---|
| Commands | `.keycode/commands`, `.claude/commands` | `~/.keycode/commands` | project `.keycode` > project `.claude` > user > built-in |
| Skills | `.keycode/skills`, `.claude/skills` | `~/.keycode/skills` | project > user > built-in |
| Agents | `.keycode/agents`, `.claude/agents` | `~/.keycode/agents` | project > user > built-in |
| Hooks | `.keycode/hooks.json`, settings | `~/.keycode/settings.json` | project > user; managed adds denies |
| Plugins | `.keycode/plugins` | `~/.keycode/plugins` | project > user |
| Output styles | `.keycode/output-styles` | `~/.keycode/output-styles` | project > user > built-in |
| Themes | `.keycode/themes` | `~/.keycode/themes` | project > user > built-in |
| Keybindings | `.keycode/keybindings.json` | `~/.keycode/keybindings.json` | project > user |
| MCP | `.mcp.json`, settings | `~/.keycode/settings.json` | project > user; `--strict-mcp-config` overrides |

Duplicate names: the higher-precedence entry wins and a warning is logged.

### 10.9 Free-key provider resolution

Resolution order:

1. `--provider` and `--model`.
2. Session override.
3. Project settings.
4. User settings.
5. Environment autodetect:
   - healthy local Ollama;
   - `GEMINI_API_KEY`;
   - `GROQ_API_KEY`;
   - `OPENROUTER_API_KEY`;
   - `CEREBRAS_API_KEY`;
   - `MISTRAL_API_KEY`;
   - `GITHUB_TOKEN`;
   - `ANTHROPIC_API_KEY`.
6. First-run provider picker.

A paid provider is never selected without explicit user action. If no provider
is available, the CLI prints setup instructions for Gemini free tier and Ollama
and exits with `PROVIDER_AUTH`.

---

## 11. Test plan

### 11.1 One test per feature

- Exactly 90 acceptance tests, one per feature.
- File naming: `tests/acceptance/T-<ID>.test.ts`.
- Test title: `T-<ID>: <feature>`.
- No feature may have two acceptance tests.
- A bug fix extends the feature's existing test; it does not add a new
  acceptance test.

### 11.2 Harness

```ts
const result = await runCli({
  args: ["-p", "hello"],
  env: {
    KEYCODE_HOME: tempHome,
    KEYCODE_PROVIDER: "fake",
    KEYCODE_FAKE_SCRIPT: JSON.stringify([
      { type: "text", delta: "hi" },
      { type: "done", stopReason: "end_turn" }
    ])
  },
  cwd: tempWorkspace
});
```

- `runCli` spawns the built CLI, captures stdout and stderr, and returns the
  exit code.
- The fake provider reads a scripted event list from an env var or fixture
  file.
- Tests never call a real network. HTTP tests use a local mock server bound to
  127.0.0.1.
- Every test gets a fresh `KEYCODE_HOME` and workspace.
- Tests clean up child processes and temp directories.

### 11.3 Fixtures

```
tests/fixtures/
  workspaces/basic/
  workspaces/ignored/
  sessions/legacy.jsonl
  notebooks/simple.ipynb
  images/pixel.png
  pdfs/three-pages.pdf
  skills/hello/SKILL.md
  commands/review.md
  agents/reviewer.md
  hooks/deny.sh
  mcp/stdio-server.mjs
  lsp/fake-server.mjs
  plugins/hello/
  workflows/two-step.mjs
  provider/anthropic-stream.txt
  provider/openai-stream.txt
```

### 11.4 CI

- Node 22 and 24.
- Windows, macOS, Linux.
- Acceptance tests run on all three; platform-specific tests skip with a
  reason.
- `npm run verify` is required.
- Coverage gates: 85% lines in `core`, `permissions`, and `providers`; 100% of
  permission decision branches.
- No snapshot may contain a real secret.

### 11.5 Performance budgets

| Metric | Budget |
|---|---|
| Cold start to prompt | < 300 ms |
| TUI frame render | < 16 ms for a 200-row transcript |
| Memory, 1,000 messages | < 300 MB |
| Session append | < 5 ms per record |
| Permission decision | < 2 ms for 1,000 rules |
| Compaction | < 30 s for 100K tokens on a free provider |

---

## 12. Three-part build plan

### Part 1 — "Free key, real work" (weeks 1-4)

**Goal:** a usable coding agent that runs with one free key or a local model.

**Features (43):** C1-C10, P1-P9, T1-T7, T10, T12, S1-S4, S7, S8, M1, M2, M4,
M5, M6, O1, U1, U2, U5.

**Workstreams:**

1. **Foundation:** repo, TypeScript, Biome, Vitest, CLI skeleton, config
   schema, logger, error model, `KEYCODE_HOME`.
2. **Providers:** contract, registry, OpenAI-compatible adapter, free presets,
   local presets, credentials, retries, capability checks, budget guard.
3. **Core loop:** session store, streaming, tool batching, abort, compaction,
   usage accounting, checkpoints.
4. **Tools:** Bash, PowerShell, Read, Write, Edit, Glob, Grep, TodoWrite,
   AskUserQuestion.
5. **Safety:** permission modes, rule engine, prompt UX, workspace trust,
   secret redaction, dangerous command detection.
6. **Context:** CLAUDE.md, imports, system prompt, add-dir, ignore-aware
   discovery.
7. **UX:** basic Ink TUI, input and completion, footer.

**Deliverables:**

- `keycode` installs and starts with Gemini free tier or Ollama.
- Reads, searches, edits, and runs tests in a repo.
- Sessions persist, resume, fork, compact, and rewind.
- Permission prompts work; deny rules are enforced.
- Part 1 acceptance tests green.

**Exit gate:**

- Demo: fix a failing test in a sample repo using only a free provider.
- `npm run verify` green.
- 43 acceptance tests passing.
- No paid provider required.

### Part 2 — "Extensible and safe" (weeks 5-8)

**Goal:** a platform that teams can extend and trust.

**Features (33):** T8, T9, T11, T13-T19, S5, S6, S9, M3, M7, X1-X12, O2, O3,
O4, U4, U6, U7.

**Workstreams:**

1. **More tools:** WebFetch, WebSearch, NotebookEdit, Skill, subagents,
   background tasks, MCP, LSP, Code Mode, artifacts.
2. **Sandbox and policy:** Seatbelt, bubblewrap, Windows job objects,
   restricted and safe modes, audit log.
3. **Extensions:** commands, skills, agents, teams, hooks, plugins,
   marketplaces, output styles, status line, themes, keybindings, workflows,
   loops.
4. **Context:** auto-memory, context budgeting and cache reporting.
5. **Operations:** managed policy, privacy controls, OpenTelemetry.
6. **UX:** accessibility, onboarding and help, doctor.

**Deliverables:**

- Hooks can block or modify tool calls.
- Skills, commands, agents, and plugins load with correct precedence.
- MCP servers expose tools, resources, and prompts.
- Sandbox blocks escapes and network egress.
- `keycode doctor` diagnoses a broken setup.
- Part 2 acceptance tests green.

**Exit gate:**

- Demo: install a local plugin that adds a command, a skill, a hook, and an MCP
  server; the hook blocks a dangerous command.
- 76 cumulative acceptance tests passing (43 + 33).
- Sandbox escape tests pass on macOS and Linux; Windows limits documented.

### Part 3 — "Scale and integrate" (weeks 9-12)

**Goal:** fit into real workflows and teams.

**Features (14):** I1-I10, U3, U8, O5, O6.

**Workstreams:**

1. **Automation:** SDK and structured output, GitHub Actions, PR workflows,
   import.
2. **Environment:** IDE bridge, browser automation, worktrees and tmux,
   background sessions and daemon.
3. **Remote:** Remote Control web UI, self-hosted Docker runner, teleport.
4. **Operations:** gateway, cross-platform certification.
5. **Polish:** notifications, updates and install.

**Deliverables:**

- Headless SDK with JSON schema output.
- GitHub Action that reviews a PR with a free key.
- IDE selection context and diff view.
- Browser tool with per-origin permissions.
- Background sessions survive a crash.
- Remote Control works on a phone browser over the local network.
- Installers for npm, brew, winget, and a native binary.
- Part 3 acceptance tests green.

**Exit gate:**

- Demo: a GitHub PR review, a background session, and a phone Remote Control
  session, all using free providers.
- 90 cumulative acceptance tests passing.
- Cross-platform CI green.
- Release candidate signed and reproducible.

### 12.1 Dependency graph

```
Part 1
  contracts -> providers -> core loop -> tools -> permissions -> TUI
      |            |            |          |          |
      +------------+------------+----------+----------+
                              |
Part 2                       v
  tools (web/MCP/LSP) -> sandbox -> extensions -> policy/telemetry -> UX
                              |
Part 3                       v
  SDK/GitHub -> IDE/browser -> remote/cloud -> worktrees/background -> release
```

### 12.2 Parallel tracks

- Track A: providers and model quality.
- Track B: tools and permissions.
- Track C: context, memory, and compaction.
- Track D: TUI and UX.
- Track E: extensions and integrations.

Each track owns its acceptance tests and can merge independently once the
contracts in Part 1 are stable.

### 12.3 Weekly milestones

Weeks are planning targets. The exit gates are the commitment; a week may slip
without changing scope.

| Week | Focus | Features completed | Gate |
|---:|---|---|---|
| 1 | Foundation, contracts, registry, OpenAI-compatible adapter, free and local presets | P1, P3, P4, P5 | `keycode --version` runs; presets resolve offline |
| 2 | Turn loop, sessions, headless mode, credentials, retries, budgets, model selection | C1-C4, C10, P2, P6-P9 | One streamed turn works with Gemini and Ollama |
| 3 | Core tools and the permission pipeline | T1-T7, T10, T12, S1-S4, S7, S8 | Edits and commands are permission-checked |
| 4 | Compaction, usage, checkpoints, memory basics, settings, TUI, Part 1 gate | C5-C9, M1, M2, M4-M6, O1, U1, U2, U5 | 43 tests; demo fixes a failing test on a free provider |
| 5 | Web, search, notebooks, MCP, LSP | T8, T9, T11, T16, T17 | MCP server exposes tools; WebFetch blocks SSRF |
| 6 | Skills, subagents, background tasks, Code Mode, artifacts | T13-T15, T18, T19 | A restricted subagent cannot escalate |
| 7 | Commands, skills, agents, teams, hooks, plugins, styles, keys, workflows, loops, memory, context budgeting | X1-X12, M3, M7 | A local plugin adds a command, skill, hook, and MCP server |
| 8 | Sandbox, restricted modes, audit, managed policy, privacy, OTel, accessibility, onboarding, doctor, Part 2 gate | S5, S6, S9, O2-O4, U4, U6, U7 | 76 tests; sandbox escape tests pass |
| 9 | SDK, structured output, GitHub Actions, PR workflows, import | I1, I2, I9, I10 | A PR review runs headless with a free key |
| 10 | IDE bridge, browser automation, worktrees, background sessions | I3, I4, I7, I8 | Background session survives a crash |
| 11 | Remote Control, self-hosted runner, gateway | I5, I6, O5 | Phone browser controls a local session |
| 12 | Notifications, updates, cross-platform certification, release | U3, U8, O6 | 90 tests; signed release candidate |

Milestone rules:

- A week is done when its features' `T-<ID>` tests pass, not when code is
  merged.
- A feature that slips moves to the next week; it does not move to another part
  without a spec change.
- The Part 1 contracts are frozen at the end of week 2. Later parts extend them
  only through additive changes.

---

## 13. Traceability

`scripts/validate-spec.mjs` enforces:

1. Every feature ID is unique and matches `^[A-Z][0-9]+$`.
2. Every test ID is unique and equals `T-<feature ID>`.
3. Every feature has exactly one test and one part.
4. Part values are 1, 2, or 3.
5. Counts match: 90 features, 43 in Part 1, 33 in Part 2, 14 in Part 3.
6. Every domain has at least one feature.

`npm run validate:spec` runs this check in CI.

The mapping is intentionally 1:1. If a feature needs more coverage, the single
acceptance test may contain multiple assertions, but it remains one test.

---

## 14. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Free-tier quotas or model changes | A provider stops working | Presets are editable data; CI uses fakes; release smoke tests cover three free providers. |
| Weak tool calling on small models | Poor agent behavior | Capability negotiation, clear errors, recommended model list, text protocol fallback. |
| Windows sandbox gaps | Security claims overstated | Document limits, default to deny for risky commands, add job-object limits, keep sandbox optional. |
| TUI performance in long sessions | Unusable UI | Virtualized transcript, incremental rendering, 200-row frame budget, profiling in CI. |
| Provider schema drift | Broken adapter | Contract tests with recorded fixtures, schema validation, versioned adapters. |
| MCP supply-chain risk | Code execution | Trust prompt, schema validation, per-server permissions, timeouts, output caps. |
| Scope creep | Missed milestones | Feature IDs and part gates are fixed; new ideas go to a backlog, not the current part. |
| Prompt injection via repo or web | Data exfiltration | Untrusted-content labels, no permission changes from content, sandbox egress deny, secret redaction. |
| Disk or tooling limits during development | Blocked verification | Prefer light parsers over Ghidra; record limitations; do not retry unchanged failing commands. |

---

## 15. Decisions and open questions

### 15.1 Decisions

| Decision | Choice | Rationale |
|---|---|---|
| License | Apache-2.0 | Permissive, patent grant, compatible with a free product. |
| Runtime | Node.js >= 22, ESM | Widely available; no Bun requirement. |
| TUI | Ink + React | Proven terminal model; component reuse. |
| CLI parser | Commander | Small, stable, well documented. |
| Validation | Zod | One schema system for config, tools, MCP, hooks. |
| Tests | Vitest | Fast, ESM-native, good mocking. |
| Lint and format | Biome | Single tool, fast, no plugin sprawl. |
| Storage | JSONL sessions, JSON config | Append-only, debuggable, no native dependency. |
| Default provider | Ollama if healthy, else Gemini free tier | Local-first, then free hosted. |
| Telemetry | Off by default | Privacy and trust. |
| Package name | `keycode-cli` (placeholder) | `keycode` is likely taken on npm; rename before publish. |
| Artifact preview | Loopback-only static server | No public exposure by default. |
| Remote Control | Loopback plus explicit LAN opt-in | Safer default. |

### 15.2 Open questions

1. Should the VS Code extension ship in Part 3 or be a separate repository?
2. Do we need a Python Code Mode runtime in Part 2, or is JS sufficient?
3. Should auto-memory be on by default, or opt-in after the first week?
4. Which search provider is the default when multiple keys are present?
5. Do we ship a signed native binary in Part 3, or only npm and package
   managers?
6. How much of the `.claude/` format do we support before it becomes a
   compatibility burden?

These do not block Part 1. Resolve them with an ADR before the relevant part
starts.
