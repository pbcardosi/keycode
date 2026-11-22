# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
semantic versioning.

## [Unreleased]

### Added

- Artifacts panel can add a removable example artifact and delete stored
  artifacts. Opening the panel now creates and previews the example
  automatically when it is missing. The CLI gains
  `keycode artifacts remove <id>`.

### Changed

- The topbar no longer has a Providers button; provider management opens from
  Settings → **Manage providers**.

### Removed

- The live dashboard view and its Settings controls from `keycode remote`. The
  chat view is the only view again; provider management, custom providers,
  Settings, and the composer session metadata are unchanged.
- The neon dashboard prototype (`prototype/`) and `scripts/extract-trace.mjs`.

## [0.1.4] - 2026-11-21

### Added

- Optional live dashboard view in `keycode remote`: an execution field,
  event stream, provider and usage rails, and the real chat in one shell.
  The default chat view remains available from the same toggle.
- Provider manager can add future providers: OpenAI-compatible or Anthropic
  endpoints, custom IDs and names, model lists, default models, environment
  variable names, local/free flags, and a local API key.
- Settings tab for permission mode, Chat/Dashboard view, dashboard animation,
  current model, session ID, and status.

### Changed

- Session metadata now sits under the composer instead of the topbar.
- Custom provider configs can carry a display name plus free/local flags.

## [0.1.3] - 2026-11-21

Provider management release.

### Added

- Provider manager in `keycode remote`: browse providers, switch models, save
  and remove API keys, see the key source and fingerprint, and handle local
  providers without keys.
- WebSocket messages for provider status, provider key save, and provider key
  removal.
- `scripts/extract-trace.mjs` and the neon dashboard prototype under
  `prototype/`, including a real session trace mode.

### Changed

- Static web assets are served with `cache-control: no-store` and versioned
  URLs so a running server picks up UI updates.

## [0.1.2] - 2026-11-20

Packaging and distribution release.

### Added

- Windows x64 portable build with bundled Node.js, published as a release
  artifact.
- Validated winget manifests under `packaging/winget` for the portable build.
- Homebrew tap at `pbcardosi/homebrew-keycode`.
- npm repository, homepage, and issue-tracker metadata.

### Changed

- Installation docs now cover npm, Homebrew, the Windows portable build, the
  VSIX, and tarball verification.

## [0.1.1] - 2026-11-20

Cross-platform fixes found by the first CI release run.

### Fixed

- macOS `apiKeyHelper` commands now inherit `PATH`, so helpers that invoke
  `node` or other tools outside the default shell path run correctly.
- Seatbelt sandbox profiles include canonical paths, so writes inside
  workspaces under symlinked temporary roots (for example `/var` on macOS)
  are allowed as intended.
- Settings hot reload polls the merged result instead of relying on
  filesystem events, which missed atomic replaces and rapid writes.
- Tests resolve the canonical project directory and let Ink render in CI,
  removing platform-specific failures.

## [0.1.0] - 2026-11-20

First alpha.

### Added

- Terminal agent with streaming TUI, headless print mode, JSON and stream-JSON
  output, sessions, resume, fork, checkpoints, and compaction.
- Free provider matrix: Ollama and LM Studio defaults, plus free-tier hosted
  keys for Gemini, Groq, OpenRouter, Mistral, and GitHub Models.
- Core tools: read, write, edit, glob, grep, bash, PowerShell, tasks, todos,
  questions, notebooks, subagents, skills, and web fetch/search.
- Permission pipeline with modes, allow/ask/deny rules, a TUI approval dialog
  with previews and diffs, specific allow-always rules, and actionable headless
  denials.
- Sandbox enforcement for shell commands: Seatbelt on macOS, bubblewrap on
  Linux, a static guard plus documented warning on Windows.
- MCP client with automatic connection of enabled servers from settings.
- Extensions: hooks, custom commands, skills, agents, plugins, output styles,
  status line, themes, keybindings, teams, workflows, and loops.
- Integrations: LSP, Code Mode, artifacts, browser, SDK, GitHub, IDE bridge,
  Remote Control, background sessions, worktrees, PR review, and notifications.
- Operations: audit log, managed policy, privacy controls, OpenTelemetry,
  accessibility mode, onboarding, doctor, and update checks.
- Packaging: `keycode` bin, `keycode-ai` npm package, `npm pack` tarball smoke
  test, package validation, and a cross-platform CI matrix.
- Text tool-call protocol for models without native tool support, and a guard
  that blocks three consecutive identical tool calls.
- Model guidance for free and local providers in the README.
- Local web UI for `keycode remote`: streaming replies, tool rows, diffs,
  browser approvals, stop, and token pairing on loopback.
- Web UI Markdown rendering with copyable code blocks, expandable tool output,
  and a session list with new-session and resume-with-history.
- Web UI session rename, fork, and delete, plus provider/model switching that
  keeps the current session and persists in the session file.
- Neon glass web UI theme: charcoal base, cyan/magenta/lime accents, grid
  background, glass panels, SVG tool icons, glow states, and reduced-motion
  support. Fonts use local stacks with no network requests.
- Web UI question dialogs for `AskUserQuestion` with radio/checkbox options,
  free-form answers, and cancellation.
- Busy-state broadcasts keep the browser and server in sync after errors,
  aborted turns, and model/session switches.
- WebFetch now resolves hostnames and re-checks DNS on redirects, blocking
  private, loopback, link-local, CGNAT, metadata, and multicast addresses.
- Write and Edit refuse to introduce new credentials with `SECRET_DETECTED`,
  while still allowing unrelated edits to files that already contain one.
- First-class `Artifact`, `Browser`, and opt-in `Code Mode` agent tools:
  versioned HTML previews, a trusted allowlisted browser driver, and a
  persistent JavaScript tool bridge configured from settings.
- Built-in Playwright browser driver using installed Chrome, with lazy launch,
  screenshots, and session cleanup; custom driver modules still supported.
- Web UI artifact panel: lists local artifacts, resolves tokenized previews, and
  renders versions in a sandboxed iframe.
- LSP, browser, and Code Mode configuration is ignored in untrusted workspaces.
- Workspace trust review in the TUI and web UI: project permissions, hooks, MCP,
  LSP, browser drivers, env keys, and customization files are listed before
  approval, with a fingerprint that re-prompts when they change.
- Runtime auto-memory extraction every fifth turn (`autoMemoryEvery`), webhook
  and terminal notifications for permissions, questions, and turn completion,
  and OTLP turn/token/cost/tool-count metrics gated by privacy consent.
- VS Code extension that starts `keycode remote` and opens the shared web UI in
  a Simple Browser tab, with model, permission, and lifecycle settings.
- VS Code editor context forwarding: active file and selection reach the web UI
  over the authenticated loopback endpoint and are prepended to prompts.
- `vscode://keycode.keycode-vscode/open` deep link for the VS Code extension.
- VS Code command to copy the pairing token for Chrome or another browser, with
  a `vscode://keycode.keycode-vscode/token` deep link.
- `LSP` agent tool for diagnostics, hover, definition, and references, configured
  under `lsp` in settings and started on demand.
- UTF-8 BOM handling for settings files, and Windows `.cmd` language-server
  launch support.

### Known limitations

- Windows sandboxing is a static guard, not kernel containment.
- Commands that perform I/O through an interpreter are not contained by the
  Windows fallback.
- Process-count and memory limits are not enforced.
- The package is private until an available registry name is chosen.
