const vscode = require("vscode");
const { spawn, spawnSync } = require("node:child_process");
const { homedir } = require("node:os");
const { launch, parseRemoteUrl, sanitize } = require("./lib.js");

let output = null;
let status = null;
let server = null;
let starting = null;

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
  killTree(server.child);
  server = null;
  setStatus("stopped");
}

async function openChat() {
  try {
    const current = await startServer();
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

function activate(context) {
  output = vscode.window.createOutputChannel("keycode");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "keycode.openChat";
  setStatus("stopped");
  status.show();

  context.subscriptions.push(
    output,
    status,
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
