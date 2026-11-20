import { existsSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite, ensureDir } from "../util/fsx.js";

export const ONBOARDING_VERSION = 1;

export function onboardingPath(home: string): string {
  return join(home, "onboarded.json");
}

export function needsOnboarding(home: string): boolean {
  return !existsSync(onboardingPath(home));
}

export function completeOnboarding(home: string): void {
  ensureDir(home);
  atomicWrite(
    onboardingPath(home),
    `${JSON.stringify({ version: ONBOARDING_VERSION, completedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

export function onboardingText(): string {
  return [
    "Welcome to KeyCode.",
    "1. Theme: pick a theme (default, dark, or light).",
    "2. Trust: choose whether to trust this workspace's project settings and hooks.",
    "3. Provider: choose a free provider (Gemini, Groq, OpenRouter) or a local model (Ollama, LM Studio, llama.cpp).",
    "Run /help to see all commands.",
  ].join("\n");
}

export function releaseNotes(): string {
  return [
    "KeyCode 0.1.0",
    "- Part 1: interactive and headless sessions, free/local providers, core tools, permissions, memory, and TUI.",
    "- Part 2: hooks, commands, skills, subagents, web tools, notebooks, background tasks, sandbox, policy, privacy, and accessibility.",
    "See SPEC.md for the full feature catalog.",
  ].join("\n");
}
