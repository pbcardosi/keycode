export interface ShellCommand {
  command: string;
  args: string[];
}

export function selectShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): ShellCommand {
  if (platform === "win32") {
    return {
      command: env.KEYCODE_POWERSHELL ?? "powershell",
      args: ["-NoLogo", "-NoProfile", "-Command"],
    };
  }
  return {
    command: env.SHELL ?? "/bin/bash",
    args: ["-lc"],
  };
}

export function isWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.WSL_DISTRO_NAME ?? env.WSL_INTEROP);
}

export function normalizePath(path: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? path.replaceAll("/", "\\") : path.replaceAll("\\", "/");
}

export interface TerminalCapabilities {
  color: boolean;
  unicode: boolean;
  hyperlinks: boolean;
}

export function terminalCapabilities(env: NodeJS.ProcessEnv = process.env): TerminalCapabilities {
  const term = env.TERM ?? "";
  const color = env.NO_COLOR === undefined && (term !== "dumb" || Boolean(env.COLORTERM) || Boolean(env.WT_SESSION));
  const unicode = env.KEYCODE_ASCII !== "1" && env.LANG !== "C";
  const hyperlinks = term.includes("xterm") || Boolean(env.WT_SESSION) || Boolean(env.TERM_PROGRAM);
  return { color, unicode, hyperlinks };
}

export function displayWidth(text: string): number {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  let width = 0;
  for (const char of stripped) {
    if (/[\u0300-\u036f\u20d0-\u20ff]/u.test(char)) continue;
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function toCRLF(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

export function fromCRLF(text: string): string {
  return text.replace(/\r\n/g, "\n");
}
