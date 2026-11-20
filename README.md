# keycode

A free, local-first, bring-your-own-key coding agent for the terminal.

`keycode` is a clean-room reimplementation of the observable workflow of Claude
Code v2.1.322. It is not affiliated with Anthropic and does not require an
Anthropic account.

**Status:** specification. The runtime is not implemented yet.

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
# Option A: a free hosted key (macOS/Linux)
export GEMINI_API_KEY="your-key"
keycode --provider gemini --model gemini-2.5-flash

# Option A on Windows PowerShell
$env:GEMINI_API_KEY="your-key"
keycode --provider gemini --model gemini-2.5-flash

# Option B: a local model, no key
ollama serve
ollama pull qwen3-coder
keycode --provider ollama --model qwen3-coder
```

Then, inside the TUI:

```
> explain this repository and run the tests
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
