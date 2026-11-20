import { spawnSync } from "node:child_process";

interface ClipboardCommand {
  command: string;
  args: string[];
}

function candidates(): ClipboardCommand[] {
  if (process.platform === "win32") return [{ command: "clip", args: [] }];
  if (process.platform === "darwin") return [{ command: "pbcopy", args: [] }];
  return [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ];
}

export function copyToClipboard(text: string): boolean {
  for (const candidate of candidates()) {
    try {
      const result = spawnSync(candidate.command, candidate.args, {
        input: text,
        windowsHide: true,
        timeout: 5_000,
      });
      if (result.status === 0) return true;
    } catch {
      // Try the next clipboard helper.
    }
  }
  return false;
}
