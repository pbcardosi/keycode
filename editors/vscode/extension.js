const vscode = require("vscode");
const { spawn, spawnSync } = require("node:child_process");
const { homedir } = require("node:os");
const http = require("node:http");
const { launch, pairingToken, parseRemoteUrl, sanitize } = require("./lib.js");

let output = null;
let status = null;
let server = null;
let starting = null;
let contextTimer = null;
let lastContext = null;
let contextDisposable = null;

function setStatus(state) {
  if (!status) return;
  if (state === "running") {
    status.text = "$(comment-discussion) keycode";
    status.tooltip = "keycode is running · click to open chat";
  } else if (state === "starting") {
    status.text = "$(sync~spin) keycode";
    status.tooltip = "Starting the keycode server";
  } else {
    status.text = "$(circle-slash) keycode";
    status.tooltip = "keycode is stopped · click to start";
  }
}

function log(line) {
  if (output) output.appendLine(sanitize(line));
}

function postContext(payload) {
  if (!server) return Promise.resolve();
  const parsed = new URL(server.url);
  const token = new URLSearchParams(parsed.hash.replace(/^#/, "")).get("token") ?? "";
  const body = JSON.stringify(payload);
  return new Promise((resolve) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: parsed.port,
        path: `/context?token=${encodeURIComponent(token)}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        response.on("end", resolve);
      },
    );
    request.on("error", (error) => {
      log(`context update failed: ${error.message}`);
      resolve();
    });
    request.end(body);
  });
}

function currentSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") return null;
  const selection = editor.selection;
  const selected = editor.document.getText(selection);
  return {
    file: editor.document.uri.fsPath,
    text: selected,
    ...(selected.length > 0
      ? { startLine: selection.start.line + 1, endLine: selection.end.line + 1 }
      : {}),
  };
}

async function forwardSelection(force = false) {
  const config = vscode.workspace.getConfiguration("keycode");
  if (config.get("forwardSelection") === false) {
    if (lastContext !== null || force) await postContext(null);
    lastContext = null;
    return;
  }
  const payload = currentSelection();
  const key = JSON.stringify(payload);
  if (!force && key === lastContext) return;
  lastContext = key;
  if (payload === null) {
    log("context: none");
  } else {
    const lines =
      payload.startLine === undefined ? "active file" : `lines ${payload.startLine}-${payload.endLine}`;
    log(`context: ${payload.file} (${lines})`);
  }
  await postContext(payload);
}

function scheduleContext() {
  if (contextTimer !== null) clearTimeout(contextTimer);
  contextTimer = setTimeout(() => {
    contextTimer = null;
    void forwardSelection();
  }, 120);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // The process already exited.
  }
}

function startServer() {
  if (server) return Promise.resolve(server);
  if (starting) return starting;

  starting = new Promise((resolve, reject) => {
    const config = vscode.workspace.getConfiguration("keycode");
    const executable = String(config.get("executable") || "keycode").trim();
    const provider = String(config.get("provider") || "").trim();
    const model = String(config.get("model") || "").trim();
    const permissionMode = String(config.get("permissionMode") || "manual").trim();
    const configuredCwd = String(config.get("cwd") || "").trim();
    const cwd =
      configuredCwd.length > 0
        ? configuredCwd
        : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir());

    const args = ["remote", "--permission-mode", permissionMode];
    if (provider.length > 0) args.push("--provider", provider);
    if (model.length > 0) args.push("--model", model);

    const command = launch(executable, args);
    log(`starting: ${executable} ${args.join(" ")}`);
    log(`cwd: ${cwd}`);
    setStatus("starting");

    let settled = false;
    let buffer = "";
    let errors = "";
    const child = spawn(command.command, command.args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child);
      setStatus("stopped");
      reject(new Error(message));
    };

    const timer = setTimeout(() => {
      fail("keycode did not print a Remote Control URL within 20 seconds.");
    }, 20_000);

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        fail(
          `Cannot find "${executable}". Install keycode with "npm install -g keycode-cli" or set keycode.executable.`,
        );
        return;
      }
      fail(error.message);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      errors = `${errors}${text}`.slice(-2_000);
      for (const line of text.split(/\r?\n/)) if (line.trim().length > 0) log(line);
    });

    child.stdout?.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        log(line);
        const match = parseRemoteUrl(line);
        if (match && !settled) {
          settled = true;
          clearTimeout(timer);
          server = { child, url: match };
          setStatus("running");
          resolve(server);
        }
        index = buffer.indexOf("\n");
      }
    });

    child.on("exit", (code) => {
      if (server?.child === child) {
        server = null;
        setStatus("stopped");
      }
      if (!settled) {
        fail(`keycode exited with code ${code ?? "null"}. ${errors.trim()}`);
      }
    });
  }).finally(() => {
    starting = null;
  });

  return starting;
}

function stopServer() {
  if (!server) {
    setStatus("stopped");
    return;
  }
  log("stopping keycode");
  void postContext(null);
  killTree(server.child);
  server = null;
  lastContext = null;
  setStatus("stopped");
}

async function openChat() {
  try {
    const current = await startServer();
    await forwardSelection(true);
    const config = vscode.workspace.getConfiguration("keycode");
    const openIn = String(config.get("openIn") || "editor");
    if (openIn === "external") {
      await vscode.env.openExternal(vscode.Uri.parse(current.url));
      return;
    }
    try {
      await vscode.commands.executeCommand("simpleBrowser.show", current.url);
    } catch {
      await vscode.env.openExternal(vscode.Uri.parse(current.url));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output?.show(true);
    void vscode.window.showErrorMessage(`keycode: ${message}`);
  }
}

async function copyPairingToken() {
  try {
    const current = await startServer();
    const token = pairingToken(current.url);
    await vscode.env.clipboard.writeText(token);
    void vscode.window.showInformationMessage(
      "keycode pairing token copied. Paste it into the browser prompt.",
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `keycode: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function activate(context) {
  output = vscode.window.createOutputChannel("keycode");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "keycode.openChat";
  setStatus("stopped");
  status.show();

  if (vscode.window.onDidChangeTextEditorSelection) {
    contextDisposable = vscode.window.onDidChangeTextEditorSelection(() => scheduleContext());
  }
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor?.(() => scheduleContext());

  context.subscriptions.push(
    output,
    status,
    { dispose: () => contextDisposable?.dispose() },
    ...(activeEditorListener ? [activeEditorListener] : []),
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path === "/open" || uri.path === "") void openChat();
        else if (uri.path === "/token") void copyPairingToken();
      },
    }),
    vscode.commands.registerCommand("keycode.openChat", openChat),
    vscode.commands.registerCommand("keycode.restartServer", async () => {
      stopServer();
      await openChat();
    }),
    vscode.commands.registerCommand("keycode.stopServer", () => {
      stopServer();
      void vscode.window.showInformationMessage("keycode server stopped.");
    }),
    vscode.commands.registerCommand("keycode.openInBrowser", async () => {
      try {
        const current = await startServer();
        await vscode.env.openExternal(vscode.Uri.parse(current.url));
      } catch (error) {
        void vscode.window.showErrorMessage(
          `keycode: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand("keycode.copyToken", copyPairingToken),
    vscode.commands.registerCommand("keycode.showLog", () => output.show(true)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("keycode") && server) {
        void vscode.window.showInformationMessage(
          "keycode settings changed. Run “keycode: Restart Server” to apply them.",
        );
      }
    }),
    { dispose: stopServer },
  );
}

function deactivate() {
  stopServer();
}

module.exports = { activate, deactivate };
