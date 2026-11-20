# KeyCode

A free, local-first, bring-your-own-key coding agent for the terminal.

`KeyCode` is a clean-room reimplementation of the observable workflow of Claude
Code v2.1.322. It is not affiliated with Anthropic and does not require an
Anthropic account.

**Status:** working alpha. All 90 features have passing acceptance tests. Install
from npm, Homebrew, the Windows portable build, or the VS Code Marketplace.

---

## Why

Coding agents should not require a subscription to be useful. `KeyCode` is built
around three rules:

1. **Free by default.** Every feature works with a free-tier API key or a local
   model.
2. **Bring your own key.** No shared keys, no proxy, no account required.
3. **Local-first.** Your code, prompts, and sessions stay on your machine
   unless you choose a hosted provider.

See `FEATURES.md` for the full free-key matrix.

---

## Install

```bash
npm install -g keycode-ai
keycode --version
```

The package ships `dist/`, `README.md`, `LICENSE`, and `CHANGELOG.md` only.
Tests, sources, and `node_modules` are excluded. `scripts/validate-package.mjs`
checks the bin mapping, version, shebang, and license. CI runs `npm run verify`
on Windows, macOS, and Linux with Node 22 and 24, plus a tarball install test.

Alternatives:

- Windows x64: download `keycode-<version>-win-x64.zip` from the
  [releases page](https://github.com/pbcardosi/keycode/releases), unzip it, and
  run `keycode.exe`. The zip bundles Node.js and the CLI.
- macOS and Linux: `brew tap pbcardosi/keycode && brew install keycode`.
- VS Code: install the
  [KeyCode extension](https://marketplace.visualstudio.com/items?itemName=keycode.keycode-vscode)
  from the Marketplace, or install `keycode-vscode-<version>.vsix` from the
  [releases page](https://github.com/pbcardosi/keycode/releases).

### From source

```bash
npm install
npm run build
npm link
keycode --version
```

Build a tarball and install it globally:

```bash
npm pack
npm install -g ./keycode-ai-<version>.tgz
keycode --version
```

Run without installing:

```bash
npm install
npm run build
node dist/cli/index.js --provider ollama
```

### Upgrade and remove

```bash
npm install -g keycode-ai@latest
npm uninstall -g keycode-ai
```

---

## Quickstart

```bash
# Option A: a free hosted key (macOS/Linux)
export GEMINI_API_KEY="your-key"
keycode --provider gemini --model gemini-2.5-flash

# Option A on Windows PowerShell
$env:GEMINI_API_KEY="your-key"
keycode --provider gemini --model gemini-2.5-flash

# Option B: a local model, no key
ollama serve
ollama pull gemma4:e2b
keycode --provider ollama --model gemma4:e2b
```

Then, inside the TUI:

```
> explain this repository and run the tests
```

If you run from source instead, replace `keycode` with
`node dist/cli/index.js`.

---

## Model guidance

Native tool calling produces the most reliable results. Free and local options:

| Provider | Recommended | Notes |
|---|---|---|
| Ollama | `qwen3-coder`, `llama3.1` | Best local tool use. `gemma4:e2b` is the smallest default; it can stop early or repeat work. |
| LM Studio / llama.cpp | Qwen3-Coder, Devstral | Pick a model whose template supports tools. |
| Gemini | `gemini-2.5-flash` | Large context, strong tool use. |
| Groq | `llama-3.3-70b-versatile`, `openai/gpt-oss-120b` | Fast; no vision. |
| OpenRouter | `qwen/qwen3-coder:free` | Free tier rates vary. |
| Cerebras | `qwen-3-32b` | Fast; no vision. |
| Mistral | `mistral-small-latest`, `codestral-latest` | |
| GitHub Models | `openai/gpt-4o-mini`, `openai/gpt-4.1` | |

The agent protects against common small-model failures:

- **Repeated calls:** three consecutive identical tool calls are blocked with
  `REPEATED_TOOL_CALL` so the model must verify or finish.
- **Already-applied edits:** `Edit` returns a successful no-op instead of
  failing and provoking a retry loop.
- **No native tools:** when a model declares `tools: false`, KeyCode appends a
  documented text protocol to the prompt and parses this fenced block:

  ````text
  ```keycode-tool
  {"name":"Read","input":{"file_path":"src/index.ts"}}
  ```
  ````

  Native tool calls are always preferred; the text protocol is a fallback and
  still goes through the permission pipeline.

If a model claims work is done without calling tools, ask it to verify with a
tool, or switch to a tool-capable model.

---

## Release

Tag a commit with `v<version>` and push the tag. The release workflow reruns
`npm run verify` and `npm run pack:smoke`, packs the tarball, writes
`SHA256SUMS`, and attaches both to a GitHub release.

The npm package is `keycode-ai`; the executable is `keycode`. Publishing uses
the **Publish npm** workflow with an `NPM_TOKEN` secret, or a local
`npm publish --provenance --access public`. See `docs/releasing.md` and
`docs/install.md`.

---

## Web UI

`keycode remote` serves a local browser interface:

```powershell
keycode remote --provider ollama
# Remote Control: http://127.0.0.1:<port>/#token=...
```

Add `--open` to launch the default browser automatically. If the pairing dialog
appears, paste either the token or the full printed URL.

Open the printed URL. The interface supports:

- streamed replies and tool rows,
- neon glass theme with a grid background, SVG tool icons, and reduced-motion support,
- Markdown rendering, fenced code blocks, and copy buttons,
- edit and write diffs in the approval dialog,
- multiple-choice `AskUserQuestion` dialogs with radio/checkbox options and free-form answers,
- allow once / always / session / deny / cancel,
- session list, new session, resume with history, rename, fork, and delete,
- artifact panel with versioned HTML previews rendered inside the UI,
- provider/model switching that keeps the current session,
- editor context from the VS Code extension: active file and selection shown
  above the composer and attached to prompts; **Detach** clears it,
- stop and reconnect,
- pairing by token, with the server bound to loopback only.

Static assets are public, but every conversation action and the WebSocket
require the token. The page reads it from the URL fragment, so it is not sent
with static file requests or written to logs; the WebSocket handshake sends it
once as a query parameter. `--permission-mode` defaults to `manual`, since
approvals happen in the browser.

If the token is lost, stop the server and run the command again; a new token is
generated. Pass `--token <value>` to reuse one on a trusted loopback setup.

---

## VS Code

`editors/vscode` contains an extension that starts `keycode remote` and opens the
same web UI in a VS Code editor tab.

```powershell
cd editors/vscode
npx @vscode/vsce package
code --install-extension keycode-vscode-0.1.2.vsix
```

You can also download the packaged VSIX from the
[releases page](https://github.com/pbcardosi/keycode/releases).

Then run **KeyCode: Open Chat** from the Command Palette. The extension has
settings for executable, provider, model, permission mode, working directory,
and whether to open in an editor tab or the external browser. The server is
stopped when the extension deactivates.

The extension is plain CommonJS, so there is no build step. It requires the
KeyCode CLI on `PATH` or an absolute `keycode.executable`. `npm run
extension:smoke` loads the extension with a mocked VS Code API and verifies the
real server launch in a temp workspace.

---

## Language servers

When language servers are configured, the agent gets an `LSP` tool for
diagnostics, hover, definition, and references:

```json
{
  "lsp": {
    "typescript": { "command": "typescript-language-server", "args": ["--stdio"] },
    "python": { "command": "pyright-langserver", "args": ["--stdio"] }
  }
}
```

Servers are started on first use and keyed by language id. The tool resolves
`.ts`, `.tsx`, `.js`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.json`,
`.md`, `.css`, `.html`, `.sh`, and `.ps1`, and accepts a `"*"` fallback. Line
and character inputs are 1-based. Requests time out; a failing server returns an
error result instead of breaking the turn.

KeyCode does not bundle language servers. Install them separately or point at
an absolute path. For TypeScript projects without a local `typescript`
installation, point the server at a `tsserver.js`:

```json
{
  "lsp": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "initializationOptions": {
        "tsserver": { "path": "C:/Users/me/AppData/Roaming/npm/node_modules/typescript/lib/tsserver.js" }
      }
    }
  }
}
```

`--bare` and `--safe-mode` skip LSP; `--restricted` removes the `LSP` tool.
LSP settings are ignored in untrusted workspaces.

---

## Artifacts, browser, and Code Mode

These are agent tools, not CLI-only features.

**Artifacts** are enabled by default. The `Artifact` tool can create, update,
list, inspect, comment on, set data for, and preview versioned local HTML files.
Previews bind to loopback and require a token. Disable them with:

```json
{ "artifacts": { "enabled": false } }
```

**Code Mode** is opt-in. Enable it with:

```json
{ "codeMode": true }
```

It runs JavaScript in a `node:vm` context with a persistent `state` object, a
`console.log` bridge, and `tools.call(name, input)`. It is permission-gated and
is not a security boundary.

**Browser** automation works out of the box through `playwright-core` and an
installed Chrome:

```json
{
  "browser": {
    "enabled": true,
    "allowedDomains": ["example.com", "docs.example.com"],
    "headless": true
  }
}
```

Set `channel` (default `chrome`), `executablePath`, `headless`, and `timeoutMs`
as needed. The driver launches lazily on the first navigation and closes with
the session.

A custom driver module is still supported:

```json
{
  "browser": {
    "driver": "./browser-driver.mjs",
    "allowedDomains": ["example.com"]
  }
}
```

The module must export `createBrowserDriver(options)` or a default driver with
`navigate`, `click`, `type`, `readDom`, `screenshot`, and optional `close`.
Origins outside the allowlist are denied before the driver is called. Browser
settings are ignored in untrusted workspaces. `--restricted` removes the tool.

---

## Workspace trust

Project settings can run hooks, MCP servers, language servers, browser drivers,
and commands, and can add permission rules. Before any of that applies, KeyCode
shows a review:

- TUI: a terminal prompt lists each item and asks for approval.
- Web UI and VS Code: a project-trust banner opens a review dialog with
  **Keep restricted** and **Trust workspace**.

The review lists:

- permission `allow`/`ask` rules,
- hook commands by event,
- MCP servers with their command or URL,
- LSP commands,
- browser driver modules,
- environment keys,
- project commands, skills, agents, and output styles with content hashes.

Approval is stored in `~/.keycode/trust.json` with a fingerprint. If any
project-controlled item changes, KeyCode asks again instead of silently applying
the new configuration.

Headless runs cannot prompt, so they stay restricted unless you pass `--trust`.
Untrusted project settings are ignored.

---

## Runtime operations

**Auto-memory** extraction is scheduled after every fifth completed turn by
default. Change it with `autoMemoryEvery`, or disable it with
`"autoMemory": false`. A fact is stored only when the model returns a durable
sentence; paused memory skips extraction and recall.

**Notifications** support a webhook and optional terminal OSC/bell:

```json
{
  "notifications": {
    "webhook": "http://127.0.0.1:9999/notify",
    "terminal": false,
    "dedupeMs": 5000
  }
}
```

Events include `permission_required`, `input_needed`, and `task_complete`.
Webhook payloads contain `{ event, text, timestamp }`.

**OpenTelemetry** requires explicit privacy consent:

```json
{
  "otel": {
    "endpoint": "http://127.0.0.1:4318/v1/metrics",
    "serviceName": "keycode",
    "sampleRate": 1
  }
}
```

Metrics are emitted for turns, input/output tokens, cost, and tool-call counts.
`telemetryEnabled()` still honors `privacy.json`, `KEYCODE_TELEMETRY=0`, and
`DO_NOT_TRACK=1`; without consent, no metrics are recorded.

---

## Security checks

- **WebFetch** resolves each hostname before requesting it and blocks results in
  loopback, private, link-local, CGNAT, documentation, benchmark, multicast, and
  metadata ranges. Redirects are re-validated with a fresh DNS lookup. An
  explicitly allowlisted host bypasses these checks.
- **Write** and **Edit** scan content for common credentials before touching
  disk. A new AWS, GitHub, Slack, Anthropic, OpenAI, Google, Groq, bearer, or
  generic `api_key`/`token`/`secret`/`password` value is refused with
  `SECRET_DETECTED`. Editing a file that already contains a credential is
  allowed as long as the edit does not add another.
- **Audit logs** and transcripts continue to redact known secret formats.

DNS checks reduce SSRF risk but do not eliminate DNS rebinding between the check
and the connection; a pinned-IP transport is still future work.

---

## Permissions

Every tool call goes through one permission pipeline, including MCP tools.

- **Modes:** `manual` (default), `acceptEdits`, `plan`, `auto`, `dontAsk`,
  `bypassPermissions`.
- **TUI:** when a tool needs approval, a dialog shows the request with a
  command preview or an edit diff. Choose allow once / allow always / allow for
  session / deny / cancel.
- **Headless:** there is no prompt, so an unapproved call is denied and the
  result names the exact rule to add, for example:
  `Add --allow "Bash(npm test)" or run interactively.`
- **Rules:** repeatable and evaluated deny â†’ ask â†’ allow:

```bash
node dist/cli/index.js --provider ollama \
  --deny "Read(./.env)" \
  --allow "Bash(npm test:*)" \
  --allow "Edit(src/**)" \
  -p "run the tests and fix failures"
```

A command rule without `:*` matches exactly, so `Bash(npm test)` does not
allow `npm test; curl ...`. Use `Bash(npm test:*)` to allow that command with
any arguments, or a glob such as `Bash(git *)` to opt into a family of
commands. Allow rules never extend to compound shell commands unless the rule
itself contains the operator.

`allow always` in the TUI persists a specific rule (command or path), not a
whole-tool grant.

---

## Sandbox

`--sandbox` confines commands to the workspace roots (plus `--add-dir` roots)
and blocks network egress by default.

```bash
node dist/cli/index.js --provider ollama --sandbox -p "run the tests"
node dist/cli/index.js --sandbox --sandbox-network --sandbox-allow-host api.example.com ...
```

Or in `settings.json`:

```json
{
  "sandbox": { "enabled": true, "allowNetwork": false, "allowedHosts": ["api.example.com"] }
}
```

The JSON above belongs in a settings file, not in a PowerShell prompt:
`~/.keycode/settings.json` (all projects), `.keycode/settings.json` (project),
or `.keycode/settings.local.json` (local). Project layers only apply when the
workspace is trusted.

Enforcement:

- **macOS:** wraps commands with `/usr/bin/sandbox-exec` and a Seatbelt profile
  that denies writes outside the roots and denies network unless allowed.
- **Linux:** wraps commands with `bwrap` (`--unshare-net`, read-only root,
  writable workspace roots) when installed.
- **Windows (fallback):** no kernel sandbox. A static guard blocks redirection,
  common write commands, and known network commands that target paths outside
  the roots or hosts outside the allowlist, and startup prints the documented
  fallback warning. Commands that perform I/O indirectly (for example a script
  launched by an interpreter) are not contained by this fallback.

The guard also runs before every command on all platforms, so an approved
`bypassPermissions` command still cannot redirect output outside the roots.

Process-count and memory limits are not enforced yet.

---

## MCP servers

Enabled entries in `settings.json` under `mcpServers` (stdio or HTTP/SSE) are
connected on startup and exposed as `mcp__<server>__<tool>` tools. A failing
server produces a warning and does not abort the session.

```json
{
  "mcpServers": {
    "docs": { "type": "stdio", "command": "node", "args": ["server.mjs"] }
  }
}
```

---

## Documents

| File | Purpose |
|---|---|
| `AGENTS.md` | Rules for coding agents: clean-room, safety, tests, git, definition of done. |
| `FEATURES.md` | Scope, free-key policy, provider matrix, parity decisions, non-goals. |
| `SPEC.md` | Architecture, contracts, all 90 features, one acceptance test each, three-part build plan. |
| `EVIDENCE.md` | Provenance: target hash, extraction method, observations, limitations. |

---

## The 90 features

| Domain | Count |
|---|---:|
| Core runtime | 10 |
| Providers and free keys | 9 |
| Tools | 19 |
| Safety | 9 |
| Memory and context | 7 |
| Extensibility | 12 |
| Integrations | 10 |
| User experience | 8 |
| Platform and operations | 6 |
| **Total** | **90** |

Each feature has exactly one acceptance test, named `T-<feature ID>`.

---

## Build plan

1. **Part 1 â€” Free key, real work (weeks 1-4).** REPL, sessions, streaming,
   free providers, core tools, permissions, memory, basic TUI.
2. **Part 2 â€” Extensible and safe (weeks 5-8).** Web, MCP, LSP, subagents,
   sandbox, hooks, skills, agents, plugins, teams, workflows, telemetry.
3. **Part 3 â€” Scale and integrate (weeks 9-12).** SDK, GitHub, IDE, browser,
   Remote Control, self-hosted runner, background sessions, worktrees, release.

Details and exit gates are in `SPEC.md` section 12.

---

## Validate the spec

```bash
npm run validate:spec
```

This checks that all 90 features have unique IDs, exactly one matching test,
and a valid build part.

---

## License

Apache-2.0. See `LICENSE`.
