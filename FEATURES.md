# FEATURES.md

**Product:** keycode — a free, local-first, bring-your-own-key coding agent.
**Version target:** behavior parity with Claude Code v2.1.322, reimplemented
clean-room.
**Status:** specification.

This document defines **scope** and **our own free keys**. The complete feature
catalog, one acceptance test per feature, and the three-part build plan live in
`SPEC.md`. Provenance lives in `EVIDENCE.md`.

---

## 1. What we are building

`keycode` is a terminal coding agent that can:

- read, search, edit, and run code in a repository;
- hold a streaming conversation with a model;
- call tools through a permission system;
- remember project instructions and sessions;
- load commands, skills, subagents, hooks, plugins, and MCP servers;
- run headless in scripts and CI;
- work with **free-tier API keys** or **local models** from day one.

It is not a wrapper around Anthropic's service, and it does not require an
Anthropic account.

---

## 2. What "free" means

"Free" is a product contract, not a marketing claim.

| Guarantee | Meaning |
|---|---|
| No subscription | Every feature is available without a paid plan. |
| No required account | The default path works with a local model and no sign-in. |
| BYOK | Users bring their own provider key. We never ship or proxy keys. |
| Free-tier first | At least one free hosted provider and one local provider are validated for every release. |
| No paywalled features | Paid providers may improve quality, but they never unlock a feature. |
| No telemetry by default | Opt-in only; local logging is on by default. |
| Open source | Apache-2.0, no contributor license agreement, no proprietary dependencies. |

**Non-negotiable:** if a feature only works with a paid provider, it is not a
keycode feature. It is an optional adapter and must be documented as such.

---

## 3. Our own free keys

These are the keys and local endpoints **we** support. A key is always supplied
by the user, stored in an environment variable or the OS keychain, and never
committed to the repository.

### 3.1 Free hosted keys

| Provider | Get a key | Environment variable | OpenAI-compatible base URL | Free tier | Suggested model |
|---|---|---|---|---|---|
| Google Gemini | https://aistudio.google.com/apikey | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta/openai/` | Yes, AI Studio free tier | `gemini-2.5-flash` |
| Groq | https://console.groq.com/keys | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` | Yes, rate-limited | `llama-3.3-70b-versatile` |
| OpenRouter | https://openrouter.ai/keys | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` | Selected `:free` models | any model ending in `:free` |
| Cerebras | https://cloud.cerebras.ai/ | `CEREBRAS_API_KEY` | `https://api.cerebras.ai/v1` | Yes, rate-limited | `llama-3.3-70b` |
| Mistral | https://console.mistral.ai/api-keys | `MISTRAL_API_KEY` | `https://api.mistral.ai/v1` | Free experiment tier | `mistral-small-latest` |
| GitHub Models | https://github.com/marketplace/models | `GITHUB_TOKEN` | `https://models.github.ai/inference` | Yes, with a GitHub account | `openai/gpt-4o-mini` |

### 3.2 Local keys (no key at all)

| Provider | Install | Base URL | Cost | Notes |
|---|---|---|---|---|
| Ollama | https://ollama.com/download | `http://127.0.0.1:11434/v1` | Free | Pull a tool-capable model first, for example `ollama pull gemma4:12b`. |
| LM Studio | https://lmstudio.ai/ | `http://127.0.0.1:1234/v1` | Free | Enable the local server and load a tool-capable model. |
| llama.cpp | https://github.com/ggml-org/llama.cpp | `http://127.0.0.1:8080/v1` | Free | Run `llama-server` with a GGUF model that supports tools. |

### 3.3 Optional paid providers

| Provider | Environment variable | Why it is optional |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Best Claude parity, but paid and never required. |
| Amazon Bedrock | AWS credentials | Enterprise hosting; optional adapter. |
| Google Vertex AI | Google Cloud credentials | Enterprise hosting; optional adapter. |
| Microsoft Foundry | Azure credentials | Enterprise hosting; optional adapter. |

### 3.4 Free-tier caveats

Free tiers change without notice. Quotas, model names, and tool-calling support
are controlled by the provider. `keycode` treats provider presets as editable
data, so a user can override the base URL, model, headers, and limits.

`keycode` will never:

- bundle a shared key;
- proxy requests through a project-operated key;
- rotate keys to evade quotas;
- ignore a provider's rate limit or terms.

---

## 4. Provider capability matrix

Legend: yes = supported; model = depends on the selected model; no = not
supported.

| Provider | Streaming | Tool calls | Vision | JSON mode | Context |
|---|---|---|---|---|---|
| Gemini (free) | yes | yes | yes | yes | up to 1M |
| Groq (free) | yes | yes | model | yes | model-dependent |
| OpenRouter (free) | yes | model | model | model | model-dependent |
| Cerebras (free) | yes | yes | no | model | model-dependent |
| Mistral (free) | yes | yes | yes | yes | model-dependent |
| GitHub Models (free) | yes | yes | model | yes | model-dependent |
| Ollama (local) | yes | model | model | yes | model-dependent |
| LM Studio (local) | yes | model | model | yes | model-dependent |
| llama.cpp (local) | yes | model | model | yes | model-dependent |
| Anthropic (paid) | yes | yes | yes | yes | 200K or more |

The agent **must degrade explicitly**, never silently: if a model lacks vision,
an image attachment is rejected with a typed error; if it lacks tool calling,
the session either uses a documented text protocol or stops with a clear
message.

---

## 5. Feature scope

The full catalog is in `SPEC.md`. This is the domain summary.

| Domain | Count | IDs | What it covers |
|---|---:|---|---|
| Core runtime | 10 | C1-C10 | REPL, headless mode, sessions, streaming, compaction, usage, rewind, branching, export, model selection |
| Providers and free keys | 9 | P1-P9 | provider contract, Anthropic and OpenAI-compatible adapters, free and local presets, credentials, retries, capabilities, budgets |
| Tools | 19 | T1-T19 | Bash, PowerShell, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, todos, notebooks, questions, skills, subagents, background tasks, MCP, LSP, Code Mode, artifacts |
| Safety | 9 | S1-S9 | permission modes, rule engine, prompts, workspace trust, sandbox, restricted modes, secret redaction, dangerous commands, audit |
| Memory and context | 7 | M1-M7 | CLAUDE.md hierarchy, imports, auto-memory, system prompt, extra directories, gitignore discovery, context budgeting |
| Extensibility | 12 | X1-X12 | custom commands, skills, custom agents, agent teams, hooks, plugins, output styles, status line, themes and keys, MCP management, workflows, loops |
| Integrations | 10 | I1-I10 | SDK, GitHub Actions, IDE bridge, browser, remote control, cloud runner, background sessions, worktrees, PR workflows, import |
| User experience | 8 | U1-U8 | TUI, input, notifications, accessibility, footer, onboarding, doctor, updates |
| Platform and operations | 6 | O1-O6 | settings hierarchy, managed policy, privacy, OpenTelemetry, gateway, cross-platform |

**Total: 90 features. One acceptance test per feature.**

---

## 6. Parity decisions

Claude Code ships some capabilities that depend on Anthropic-hosted
infrastructure. We either build a local equivalent, make it optional, or
explicitly skip it.

| Claude Code capability | keycode decision | Notes |
|---|---|---|
| Anthropic OAuth, plans, billing, usage credits | Skip | Not part of a free BYOK product. |
| Anthropic API adapter | Optional | For users who already have a key. |
| Bedrock, Vertex, Foundry | Optional adapters | Paid enterprise paths; never required. |
| Cloud sessions and teleport | Adapt | Self-hosted Docker runner plus session upload/download. |
| Remote Control from phone or web | Adapt | Local HTTP/WebSocket UI with a pairing token. |
| Claude in Chrome | Adapt | Playwright/CDP browser tool with a domain allowlist. |
| IDE extensions | Adapt | Local WebSocket bridge and a VS Code extension. |
| GitHub Actions and `@claude` | Build | Uses a user's GitHub token; free for public repos. |
| Agent teams | Build | Local processes with a shared task list and messaging. |
| Dynamic workflows | Build | Local script runner with checkpoints and resume. |
| Artifacts | Adapt | Local static server with versioned HTML artifacts. |
| Ultrareview and ultraplan | Adapt | Local multi-agent review and planning, no cloud dependency. |
| Enterprise gateway | Adapt | Local reverse proxy that injects provider keys. |
| Self-hosted runner | Build (optional) | Docker-based worker for background sessions. |
| OpenTelemetry | Build | Local OTLP export, off by default. |
| Managed policy settings | Build | Per-OS managed paths and policy gates. |
| Import from Codex, Gemini, Cursor | Build | Best-effort conversion with a dry run. |
| Stickers, radio, merch, Claude FM | Skip | Not product features. |
| Claude.ai projects, design cloud, mobile app pairing | Skip | Account-bound services; no free local equivalent. |

---

## 7. Non-goals

- Reselling, pooling, or proxying Anthropic access.
- Bypassing provider quotas, billing, or terms of service.
- Reproducing Anthropic-hosted infrastructure or proprietary prompts.
- Guaranteeing identical model output or identical UI.
- Supporting every Claude Code internal feature flag.
- A Windows sandbox with macOS Seatbelt parity; document the gap instead.
- Shipping a model. `keycode` is a client, not a model provider.

---

## 8. Setup recipes

### 8.1 Gemini free tier

```bash
export GEMINI_API_KEY="your-key"
keycode --provider gemini --model gemini-2.5-flash
```

### 8.2 Groq free tier

```bash
export GROQ_API_KEY="your-key"
keycode --provider groq --model llama-3.3-70b-versatile
```

### 8.3 OpenRouter free model

```bash
export OPENROUTER_API_KEY="your-key"
keycode --provider openrouter --model "qwen/qwen3-coder:free"
```

### 8.4 Ollama, no key

```bash
ollama serve
ollama pull gemma4:12b
keycode --provider ollama --model gemma4:12b
```

### 8.5 Persistent configuration

`~/.keycode/settings.json`:

```json
{
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "providers": {
    "gemini": {
      "kind": "openai-compatible",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/",
      "apiKeyEnv": "GEMINI_API_KEY",
      "models": ["gemini-2.5-flash", "gemini-2.5-pro"]
    },
    "ollama": {
      "kind": "openai-compatible",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKeyEnv": null,
      "models": ["gemma4:12b", "llama3.1"]
    }
  }
}
```

### 8.6 Key handling rules

- Prefer the OS keychain via `keycode auth set <provider>`.
- Environment variables override config.
- `apiKeyHelper` may run a command to fetch a short-lived key.
- Keys are never written to project settings, transcripts, or logs.
- `keycode auth status` shows only a masked fingerprint.

---

## 9. Success criteria

A release is "free-complete" when:

- [ ] A new user can install `keycode`, set one free key or start Ollama, and
      complete a real coding task without paying.
- [ ] Every Part 1 feature works with at least one free provider.
- [ ] No feature requires an Anthropic account.
- [ ] All 90 acceptance tests pass in CI with the fake provider.
- [ ] At least three free hosted providers and all three local providers are
      smoke-tested manually per release.
- [ ] No telemetry is sent unless the user opts in.
- [ ] The quickstart in `README.md` is verified on Windows, macOS, and Linux.

---

## 10. Relationship to the spec

- `SPEC.md` is authoritative for behavior, test IDs, and the build plan.
- This file is authoritative for scope and free-key policy.
- If a feature cannot meet the free-key contract, it moves to "optional
  adapter" or "non-goal" before implementation.
