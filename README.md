# keycode

A free, local-first, bring-your-own-key coding agent for the terminal.

`keycode` is a clean-room reimplementation of the observable workflow of Claude
Code v2.1.322. It is not affiliated with Anthropic and does not require an
Anthropic account.

**Status:** working alpha. All 90 features have passing acceptance tests; run
from `dist/` (no published package yet).

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

## Planned quickstart

```bash
git clone <repo> && cd keycode
npm install
npm run build

# Option A: a free hosted key (macOS/Linux)
export GEMINI_API_KEY="your-key"
node dist/cli/index.js --provider gemini --model gemini-2.5-flash

# Option A on Windows PowerShell
$env:GEMINI_API_KEY="your-key"
node dist/cli/index.js --provider gemini --model gemini-2.5-flash

# Option B: a local model, no key
ollama serve
ollama pull gemma4:e2b
node dist/cli/index.js --provider ollama --model gemma4:e2b
```

Then, inside the TUI:

```
> explain this repository and run the tests
```

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
