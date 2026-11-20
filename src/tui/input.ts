import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "../util/fsx.js";

export function historyPath(home: string): string {
  return join(home, "history.jsonl");
}

export function loadHistory(home: string): string[] {
  const path = historyPath(home);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

export function appendHistory(home: string, entry: string): void {
  const path = historyPath(home);
  ensureDir(home);
  appendFileSync(path, `${entry.replaceAll("\n", " ")}\n`);
}

export function searchHistory(history: string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return history.slice(-10);
  return history.filter((entry) => entry.toLowerCase().includes(needle));
}

export function completeFile(text: string, files: string[]): string[] {
  const at = text.lastIndexOf("@");
  if (at === -1) return [];
  const prefix = text.slice(at + 1).toLowerCase();
  return files
    .filter((file) => file.toLowerCase().includes(prefix))
    .sort((a, b) => a.localeCompare(b));
}

export function slashCompletions(input: string, commands: string[]): string[] {
  const needle = input.startsWith("/") ? input : input.includes("/") ? `/${input.slice(input.indexOf("/") + 1)}` : "";
  if (!needle) return [];
  return commands.filter((command) => command.toLowerCase().startsWith(needle.toLowerCase()));
}

export function draftPath(home: string, sessionId: string): string {
  return join(home, "drafts", `${sessionId}.txt`);
}

export function saveDraft(home: string, sessionId: string, text: string): void {
  const path = draftPath(home, sessionId);
  ensureDir(join(home, "drafts"));
  if (text.length === 0) return;
  appendFileSync(path, `${text}\n`);
}

export function readDrafts(home: string, sessionId: string): string[] {
  const path = draftPath(home, sessionId);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/\n$/, ""))
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
