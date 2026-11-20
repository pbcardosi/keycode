# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
semantic versioning.

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
- Packaging: `keycode` bin, `npm pack` tarball smoke test, package validation,
  and a cross-platform CI matrix.
- Text tool-call protocol for models without native tool support, and a guard
  that blocks three consecutive identical tool calls.
- Model guidance for free and local providers in the README.
- Local web UI for `keycode remote`: streaming replies, tool rows, diffs,
  browser approvals, stop, and token pairing on loopback.
- Web UI Markdown rendering with copyable code blocks, expandable tool output,
  and a session list with new-session and resume-with-history.

### Known limitations

- Windows sandboxing is a static guard, not kernel containment.
- Commands that perform I/O through an interpreter are not contained by the
  Windows fallback.
- Process-count and memory limits are not enforced.
- The package is private until an available registry name is chosen.
