# EVIDENCE.md

**Purpose:** record the provenance of behavior claims used in `SPEC.md` and
`FEATURES.md`. This file is descriptive, not a source of copied code.

**Rule:** evidence may describe behavior; it must not be used to copy
proprietary source, prompts, strings, assets, or bytecode. See `AGENTS.md`
section 3.1.

---

## 1. Target identity

| Field | Value |
|---|---|
| Artifact | `C:\Users\pbcar\.local\bin\claude.exe` |
| Product | Claude Code |
| Version | 2.1.322 (reported by `claude --version` and the embedded `cli.js` header) |
| Size | 346,496,160 bytes |
| SHA-256 | `345996b4bdbae21d817f750fae2f34cbf8d81224a5444c78136091d121beb298` |
| Format | Windows PE, x86-64, Bun `--compile` standalone |
| Signature | Authenticode signature at the end of the file (11,424 bytes) |

The binary was read locally. No network request was made to Anthropic, and no
account data was used.

---

## 2. Why the heavy tools were not used

Two REA paths were attempted and blocked:

1. `inspect_artifact` on the Bun payload failed with
   `Artifact admission reached artifact_limits.expanded_bytes`. The required
   limit scaled with the requested limit (for example, 2,075,810,326 bytes for
   a 2 GB request), so raising it did not resolve admission.
2. Ghidra `binary_overview` failed with `There is not enough space on the
   disk`. The C: drive had roughly 0.3 GB free, which is insufficient for a
   Ghidra import of a 346 MB PE with a 191 MB embedded payload.

Per `AGENTS.md`, the unchanged failing calls were not retried. A lighter,
direct method was used instead.

---

## 3. Method

### 3.1 PE section parsing

The PE headers were parsed to locate the `.bun` section:

| Field | Value |
|---|---|
| Section | `.bun` |
| Raw offset | `0x941E400` (155,313,152) |
| Raw size | 191,172,608 |
| Length prefix | 8 bytes, `0x0B650E13` = 191,172,115 |
| Payload base | 155,313,160 |

### 3.2 Bun module graph

The Bun standalone trailer was located at the end of the section:

| Field | Value |
|---|---|
| Trailer offset block | 346,485,228 |
| Trailer magic | `\n---- Bun! ----\n` at 346,485,260 |
| `byte_count` | 191,172,067 |
| Module table offset | 190,982,507 |
| Module table length | 163,644 |
| Entry module index | 7 |
| `argv` offset | 191,172,047 |
| `argv` length | 19 |
| Flags | 15,359 |

Module records are 52 bytes. The table contains 3,147 records
(`163,644 / 52`). Each record was parsed for:

- name offset and length;
- content offset and length;
- source-map offset and length;
- bytecode offset and length;
- module-info offset and length;
- bytecode-origin offset and length;
- encoding, loader, format, and side flags.

### 3.3 Extraction

The embedded JavaScript modules were copied to a temporary directory outside
the repository:

```
C:\Users\pbcar\AppData\Local\Temp\claude-js\
```

| Metric | Value |
|---|---|
| Modules with valid names | 3,147 |
| JavaScript modules extracted | 2,905 |
| Non-JS modules skipped | 242 |
| Extracted size | 52.34 MB |
| Entry module | `B:/~BUN/root/cli` |
| Entry content size | 26,667 bytes |
| Entry bytecode size | 109,252,760 bytes |

The extracted files are **not** committed to this repository and must not be.

### 3.4 Static analysis

The extracted modules were searched for:

- command registry objects (`type: "local"`, `type: "local-jsx"`,
  `type: "prompt"`);
- tool names and tool descriptions;
- permission modes and rule shapes;
- hook event names;
- settings keys;
- provider names and environment variables;
- CLI flags and subcommands.

Counts are approximate because the bundle contains duplicated strings and
minified aliases. They are used to establish presence, not exact cardinality.

---

## 4. Observations

### 4.1 Version and entry point

The extracted `cli.js` begins with:

```js
// @bun @bytecode
// (c) Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance.

// Version: 2.1.322
```

`claude --version` reports `2.1.322 (Claude Code)`.

### 4.2 CLI surface

`claude --help` reports:

- 20 subcommands, including `agents`, `attach`, `auth`, `auto-mode`, `doctor`,
  `gateway`, `import`, `install`, `logs`, `mcp`, `plugin`, `purge`, `respawn`,
  `rm`, `setup-token`, `stop`, `ultrareview`, and `update`.
- More than 100 options, including `--print`, `--output-format`,
  `--input-format`, `--permission-mode`, `--model`, `--fallback-model`,
  `--effort`, `--add-dir`, `--mcp-config`, `--plugin-dir`, `--worktree`,
  `--bg`, `--remote-control`, `--teleport`, `--restricted`, `--safe-mode`, and
  `--bare`.

The full help text was captured at
`C:\Users\pbcar\AppData\Local\Temp\claude-help.txt` (313 lines).

### 4.3 Permission modes

`--permission-mode` accepts:

```
acceptEdits, auto, bypassPermissions, manual, dontAsk, plan
```

`manual` is the documented default in the help text; the binary also contains
`default` as an internal alias.

### 4.4 Slash commands

The command registry yielded 83 command objects with descriptions. Examples:

```
add-dir, advisor, artifacts, auto-mode-setup, autocompact, autofix-pr,
branch, btw, bug, cd, chrome, clear, cloud-plugins, color, compact, config,
context, copy, design-login, desktop, effort, export, feedback, focus, fork,
help, hooks, ide, import, insights, install-github-app, install-slack-app,
keybindings, logout, loops, mcp, memory, mobile, model, output-style,
permissions, plan, plugin, powerup, privacy-settings, project, radio,
release-notes, reload-plugins, reload-skills, rename, rewind, scroll-speed,
session, setup-bedrock, setup-vertex, skill-doctor, skills, status,
statusline, stickers, subtask, tasks, team-onboarding, teleport, theme, tui,
upgrade, usage, usage-credits, use-case, version, voice, wellbeing, workflows
```

Additional commands are defined with getters or runtime conditions and were
observed separately:

```
login, init, doctor, review, security-review, pr-comments, terminal-setup,
vim, sandbox, remote-control, goal, recap, batch, ultraplan, ultrareview,
worktree, install, purge, agents, background, stop, list-agents
```

Aliases observed include `settings` for `config`, `cost` and `stats` for
`usage`, `checkpoint` and `undo` for `rewind`, `reset` and `new` for `clear`,
`share` for `bug`, `tp` for `teleport`, `bashes` for `tasks`, `name` for
`rename`, and `allowed-tools` for `permissions`.

### 4.5 Built-in tools

Tool names observed in the bundle and help text:

```
Bash, PowerShell, Read, Write, Edit, MultiEdit, NotebookEdit, Glob, Grep,
WebFetch, WebSearch, TodoWrite, Task, Agent, TaskCreate, TaskGet, TaskList,
TaskUpdate, TaskStop, TaskOutput, AskUserQuestion, Skill, ExitPlanMode,
EnterPlanMode, ListMcpResourcesTool, ReadMcpResourceTool,
ReadMcpResourceDirTool, ListAgents, SendUserMessage, REPL, Eval, Workflow,
Artifact, ArtifactComments, ArtifactData, ArtifactCheck, LSP,
CronCreate, CronList, CronDelete, TeamCreate, TeamDelete,
SuggestBackgroundPR, AutofixPr, SearchMcpRegistry
```

Renamed tools observed in the bundle include:

```
Task -> Agent
KillShell, KillBash -> TaskStop
ListPeers -> ListAgents
Brief -> SendUserMessage
ListMcpResources -> ListMcpResourcesTool
ReadMcpResource -> ReadMcpResourceTool
ReadMcpResourceDir -> ReadMcpResourceDirTool
Eval -> REPL
```

Tool descriptions observed (paraphrased, not copied):

- Bash executes a shell command and returns output; shell state does not
  persist.
- Read reads text with line numbers, images, PDFs with page ranges, and
  notebooks.
- Write overwrites a file and requires a prior Read for an existing file.
- Edit performs exact string replacement and fails when the old string is not
  unique.
- Glob matches file paths and sorts by modification time.
- WebFetch fetches a URL, converts HTML to markdown, and processes it with a
  prompt.
- WebSearch returns search results and requires a sources list.

### 4.6 Hook events

The following hook event names were found in the bundle:

```
PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest,
UserPromptSubmit, Stop, SubagentStart, SubagentStop, PreCompact, PostCompact,
SessionStart, SessionEnd, Notification, Setup, ConfigChange,
WorktreeCreate, WorktreeRemove, TeammateIdle, TaskCompleted
```

### 4.7 Settings keys

Settings keys observed include:

```
apiKeyHelper, awsAuthRefresh, awsCredentialExport, statusLine,
includeCoAuthoredBy, cleanupPeriodDays, enableAllProjectMcpServers,
disabledMcpjsonServers, forceLoginMethod, forceLoginOrgUUID,
autoUpdatesChannel, alwaysThinkingEnabled, spinnerTipsEnabled, outputStyle,
permissions, hooks, mcpServers, env, model, theme, sandbox, attribution,
autoCompactEnabled, autoMemoryEnabled, respectGitignore, enabledPlugins,
extraKnownMarketplaces, otelHeadersHelper, telemetry, autoUploadSessions
```

The settings schema is layered across several modules; this list is not
exhaustive.

### 4.8 Providers and authentication

Provider paths observed:

- Anthropic API key and OAuth.
- Amazon Bedrock (`CLAUDE_CODE_USE_BEDROCK`).
- Google Vertex AI (`CLAUDE_CODE_USE_VERTEX`).
- Microsoft Foundry (`CLAUDE_CODE_USE_FOUNDRY`).
- `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` overrides.
- `apiKeyHelper` with a TTL.

The binary contains extensive Anthropic account, plan, billing, and cloud
session logic. That logic is out of scope for keycode and is replaced by free
BYOK providers.

### 4.9 Session, memory, and context

Observed behavior:

- Sessions are persisted per project and can be resumed, continued, forked, and
  named.
- Checkpoints support conversation and file rewind.
- Compaction summarizes older turns and can run automatically.
- CLAUDE.md is loaded from user, project, and local scopes, with imports.
- Auto-memory extracts and recalls durable facts.
- Additional directories extend the workspace.
- File discovery respects `.gitignore`.
- Context usage is visualized and token usage is reported per turn.

### 4.10 Extensions and integrations

Observed behavior:

- Custom slash commands with frontmatter, arguments, and bash injection.
- Skills with `SKILL.md` and progressive disclosure.
- Custom agents with tool and model restrictions.
- Agent teams with shared tasks and messaging.
- Hooks with JSON input and output.
- Plugins and marketplaces.
- Output styles, status line, themes, keybindings, and vim mode.
- MCP over stdio, SSE, and HTTP, with OAuth.
- LSP integration.
- Workflows and scheduled loops.
- GitHub Actions, IDE integration, browser control, Remote Control, cloud
  sessions, teleport, background sessions, worktrees, and PR workflows.

---

## 5. What was not established

- The Bun bytecode was not decompiled. Behavior claims come from the embedded
  JavaScript source, the CLI help, and public documentation.
- 242 non-JS modules (native addons, assets, and other payloads) were not
  analyzed.
- Internal feature flags (`tengu_*`) were counted but not exhaustively mapped.
  They are implementation details and are not part of the keycode spec.
- Exact prompt text and UI copy were not copied and are not reproduced.
- No runtime behavior was tested against a live Anthropic account.
- Free-tier limits and model names change; `FEATURES.md` treats them as
  user-editable data, not guarantees.

---

## 6. Corroboration

Public sources used only to confirm names and user-facing behavior:

- `C:\Users\pbcar\claude-code\CHANGELOG.md` (through 2.1.326).
- `C:\Users\pbcar\claude-code\README.md`.
- `https://code.claude.com/docs` (product documentation).
- The `@anthropic-ai/claude-code@2.1.322` npm metadata.

Where the binary and public docs disagree, the binary is the primary source for
the installed version, and the spec notes the difference.

---

## 7. Clean-room statement

The extracted modules were used to enumerate features and observe behavior.
They were not copied into this repository, and no proprietary prompt, string,
icon, or asset is reproduced. `keycode` is an independent implementation with
its own architecture, copy, and UI.

The temporary extraction directory is outside the repository and must be
deleted when it is no longer needed.
