"use strict";

function sanitize(line) {
  return String(line).replace(/token=[^\s&]+/gi, "token=…");
}

function launch(executable, args, platform = process.platform, comspec = process.env.ComSpec) {
  if (platform !== "win32") return { command: executable, args };
  const quote = (value) =>
    /[\s"]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
  return {
    command: comspec || "cmd.exe",
    args: ["/d", "/s", "/c", [executable, ...args].map(quote).join(" ")],
  };
}

function parseRemoteUrl(line) {
  const match = /Remote Control:\s*(http\S+)/.exec(String(line));
  return match ? match[1] : null;
}

module.exports = { sanitize, launch, parseRemoteUrl };
