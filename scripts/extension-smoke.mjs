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
let copied = "";
const editorText = "const answer = 42;\n";
const editorPath = join(workspace, "sample.ts");
let selectionHandler = null;
let uriHandler = null;

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
          forwardSelection: true,
        })[key],
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {
    activeTextEditor: {
      document: {
        uri: { scheme: "file", fsPath: editorPath },
        getText: () => editorText,
      },
      selection: { start: { line: 1 }, end: { line: 1 } },
    },
    onDidChangeTextEditorSelection: (handler) => {
      selectionHandler = handler;
      return { dispose() {} };
    },
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    registerUriHandler: (handler) => {
      uriHandler = handler;
      return { dispose() {} };
    },
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
  env: {
    openExternal: async (value) => opened.push(["external", value]),
    clipboard: {
      writeText: async (value) => {
        copied = value;
      },
    },
  },
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
  if (typeof uriHandler?.handleUri !== "function") {
    throw new Error("the extension did not register a URI handler");
  }

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

  const copyToken = commands.get("keycode.copyToken");
  if (typeof copyToken !== "function") throw new Error("copy-token command is missing");
  await copyToken();
  if (copied !== token) throw new Error("copy-token command did not copy the pairing token");

  const contextResponse = await fetch(`${new URL(url).origin}/context?token=${token}`);
  if (!contextResponse.ok) throw new Error(`context request failed: ${contextResponse.status}`);
  const { context: editorContext } = await contextResponse.json();
  if (
    editorContext === null ||
    editorContext.file !== editorPath ||
    editorContext.text !== editorText ||
    editorContext.startLine !== 2 ||
    editorContext.endLine !== 2
  ) {
    throw new Error(`selection was not forwarded: ${JSON.stringify(editorContext)}`);
  }

  if (typeof selectionHandler !== "function") {
    throw new Error("the extension did not subscribe to selection changes");
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
