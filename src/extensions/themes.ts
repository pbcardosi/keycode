import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Theme {
  name: string;
  colors: Record<string, string>;
  source: "builtin" | "project" | "user";
}

export const BUILTIN_THEMES: Record<string, Theme> = {
  default: {
    name: "default",
    colors: { accent: "cyan", success: "green", warning: "yellow", error: "red", muted: "gray" },
    source: "builtin",
  },
  dark: {
    name: "dark",
    colors: { accent: "magenta", success: "greenBright", warning: "yellowBright", error: "redBright", muted: "gray" },
    source: "builtin",
  },
  light: {
    name: "light",
    colors: { accent: "blue", success: "green", warning: "yellow", error: "red", muted: "black" },
    source: "builtin",
  },
};

export interface Keybindings {
  submit: string[];
  cancel: string[];
  newline: string[];
  [action: string]: string[];
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  submit: ["return", "enter"],
  cancel: ["escape", "ctrl+c"],
  newline: ["shift+return"],
};

export interface LoadKeybindingsOptions {
  cwd: string;
  home: string;
  trusted?: boolean | undefined;
}

const KEY_PATTERN = /^[A-Za-z0-9]+(\+[A-Za-z0-9]+)*$/;

export function validateKeybinding(value: string): boolean {
  if (value.trim().length === 0 || value.includes(" ")) return false;
  return KEY_PATTERN.test(value.trim());
}

export function loadKeybindings(options: LoadKeybindingsOptions): {
  bindings: Keybindings;
  warnings: string[];
} {
  const warnings: string[] = [];
  let bindings: Keybindings = {
    submit: [...DEFAULT_KEYBINDINGS.submit],
    cancel: [...DEFAULT_KEYBINDINGS.cancel],
    newline: [...DEFAULT_KEYBINDINGS.newline],
  };
  const candidates: Array<{ path: string; source: string }> = [];
  if (options.trusted !== false) {
    candidates.push({ path: join(options.cwd, ".keycode", "keybindings.json"), source: "project" });
  }
  candidates.push({ path: join(options.home, ".keycode", "keybindings.json"), source: "user" });

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(candidate.path, "utf8"));
    } catch (error) {
      warnings.push(`Ignoring unreadable keybindings ${candidate.path}: ${(error as Error).message}`);
      continue;
    }
    if (raw === null || typeof raw !== "object") {
      warnings.push(`Ignoring invalid keybindings ${candidate.path}`);
      continue;
    }
    for (const [action, value] of Object.entries(raw as Record<string, unknown>)) {
      const values = Array.isArray(value) ? value : [value];
      const valid: string[] = [];
      for (const entry of values) {
        if (typeof entry === "string" && validateKeybinding(entry)) valid.push(entry.trim());
        else warnings.push(`Invalid keybinding for ${action}: ${String(entry)}`);
      }
      if (valid.length > 0) bindings[action] = valid;
    }
  }
  return { bindings, warnings };
}

export function deleteLine(text: string, lineIndex: number): string {
  const lines = text.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return text;
  lines.splice(lineIndex, 1);
  return lines.join("\n");
}

export function discoverThemes(options: LoadKeybindingsOptions): Theme[] {
  const themes = new Map<string, Theme>(Object.entries(BUILTIN_THEMES));
  const candidates: Array<{ path: string; source: "project" | "user" }> = [];
  if (options.trusted !== false) {
    candidates.push({ path: join(options.cwd, ".keycode", "themes"), source: "project" });
  }
  candidates.push({ path: join(options.home, ".keycode", "themes"), source: "user" });
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    for (const entry of readdirSync(candidate.path)) {
      if (!entry.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(candidate.path, entry), "utf8")) as {
          name?: string;
          colors?: Record<string, string>;
        };
        const name = parsed.name ?? entry.replace(/\.json$/, "");
        themes.set(name, {
          name,
          colors: parsed.colors ?? {},
          source: candidate.source,
        });
      } catch {
        // Ignore malformed theme files.
      }
    }
  }
  return [...themes.values()];
}
