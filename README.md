# keycode

A free, local-first, bring-your-own-key coding agent for the terminal.

`keycode` is a clean-room reimplementation of the observable workflow of Claude
Code v2.1.322. It is not affiliated with Anthropic and does not require an
Anthropic account.

**Status:** working alpha. All 90 features have passing acceptance tests. Install
from a local tarball or run from `dist/`; no registry package yet.

---

## Why

Coding agents should not require a subscription to be useful. `keycode` is built
around three rules:

1. **Free by default.** Every feature works with a free-tier API key or a local
   model.
2. **Bring your own key.** No shared keys, no proxy, no account required.
3. **Local-first.** Your code, prompts, and sessions stay on your machine
   unless you choose a hosted provider.

See `FEATURES.md` for the full free-key matrix.

---

## Install

The package is not on a registry yet. Build a tarball and install it globally:

```bash
npm install
npm run pack:smoke      # verifies the tarball in a clean consumer project
npm pack
npm install -g ./keycode-cli-0.1.0.tgz
keycode --version
```

Or link the working tree while developing:

```bash
npm install
npm run build
npm link
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
npm install -g ./keycode-cli-<new-version>.tgz
npm uninstall -g keycode-cli
```

The package ships `dist/`, `README.md`, `LICENSE`, and `CHANGELOG.md` only.
Tests, sources, and `node_modules` are excluded. `scripts/validate-package.mjs`
checks the bin mapping, version, shebang, and license. CI runs `npm run verify`
on Windows, macOS, and Linux with Node 22 and 24, plus a tarball install test.

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
- **No native tools:** when a model declares `tools: false`, keycode appends a
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
`npm run verify` and `npm run pack:smoke`, packs the tarball, and attaches it to
a GitHub release. Publishing to npm requires choosing an available package
name, removing `"private": true`, and adding an `NPM_TOKEN`-based publish step.

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
- Markdown rendering, fenced code blocks, and copy buttons,
- edit and write diffs in the approval dialog,
- allow once / always / session / deny / cancel,
- session list, new session, resume with history, rename, fork, and delete,
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
code --install-extension keycode-vscode-0.1.0.vsix
```

Then run **keycode: Open Chat** from the Command Palette. The extension has
settings for executable, provider, model, permission mode, working directory,
and whether to open in an editor tab or the external browser. The server is
stopped when the extension deactivates.

The extension is plain CommonJS, so there is no build step. It requires the
`keycode` CLI on `PATH` or an absolute `keycode.executable`. `npm run
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

keycode does not bundle language servers. Install them separately or point at
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
- **Rules:** repeatable and evaluated deny → ask → allow:

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

1. **Part 1 — Free key, real work (weeks 1-4).** REPL, sessions, streaming,
   free providers, core tools, permissions, memory, basic TUI.
2. **Part 2 — Extensible and safe (weeks 5-8).** Web, MCP, LSP, subagents,
   sandbox, hooks, skills, agents, plugins, teams, workflows, telemetry.
3. **Part 3 — Scale and integrate (weeks 9-12).** SDK, GitHub, IDE, browser,
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
