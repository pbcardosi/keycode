import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalLoad = Module._load;
const root = resolve(import.meta.dirname, "..");
const extensionDir = resolve(root, "editors", "vscode");
const workspace = mkdtempSync(join(tmpdir(), "keycode-vscode-"));
const home = join(workspace, "home");
const logs = [];
const opened = [];
const commands = new Map();

const mockVscode = {
  StatusBarAlignment: { Left: 1 },
  Uri: { parse: (value) => value },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: workspace } }],
    getConfiguration: () => ({
      get: (key) =>
        ({
          executable: process.env.KEYCODE_EXECUTABLE ?? "keycode",
          provider: "fake",
          model: "fake-model",
          permissionMode: "manual",
          cwd: workspace,
          openIn: "editor",
        })[key],
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {
    createOutputChannel: () => ({
      appendLine: (line) => logs.push(line),
      show() {},
      dispose() {},
    }),
    createStatusBarItem: () => ({
      show() {},
      dispose() {},
      text: "",
      tooltip: "",
      command: "",
    }),
    showErrorMessage: (message) => opened.push(["error", message]),
    showInformationMessage: () => undefined,
  },
  commands: {
    registerCommand: (id, handler) => {
      commands.set(id, handler);
      return { dispose() {} };
    },
    executeCommand: async (id, value) => {
      opened.push([id, value]);
    },
  },
  env: { openExternal: async (value) => opened.push(["external", value]) },
};

Module._load = function load(request, parent, isMain) {
  if (request === "vscode") return mockVscode;
  return originalLoad.call(this, request, parent, isMain);
};

process.env.KEYCODE_HOME = home;
process.env.KEYCODE_PROVIDER = "fake";
process.env.KEYCODE_FAKE_SCRIPT = JSON.stringify({
  turns: [[{ type: "text", delta: "vscode smoke" }, { type: "done", stopReason: "end_turn" }]],
});

const extension = require(resolve(extensionDir, "extension.js"));
const context = { subscriptions: [] };

try {
  extension.activate(context);
  await commands.get("keycode.openChat")();

  const entry = opened.find(([id]) => id === "simpleBrowser.show");
  if (!entry) {
    throw new Error(`Simple Browser was not opened. Output:\n${logs.join("\n")}`);
  }
  const url = entry[1];
  if (!url.startsWith("http://127.0.0.1:") || !url.includes("#token=")) {
    throw new Error(`unexpected URL: ${url}`);
  }
  const token = new URL(url).hash.replace(/^#token=/, "");
  if (!logs.every((line) => !line.includes(token))) {
    throw new Error("the token leaked into the output channel");
  }

  const health = await fetch(`${new URL(url).origin}/health`);
  if (!health.ok) throw new Error(`health check failed: ${health.status}`);
  const body = await health.json();
  if (body.ok !== true) throw new Error(`unexpected health body: ${JSON.stringify(body)}`);

  commands.get("keycode.stopServer")();
  await new Promise((done) => setTimeout(done, 300));
  process.stdout.write(`extension smoke ok: ${url.replace(/#token=.*/, "#token=…")}\n`);
} finally {
  extension.deactivate();
  Module._load = originalLoad;
  rmSync(workspace, { recursive: true, force: true });
}
