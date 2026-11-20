import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "editors", "vscode");
const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
const failures = [];

if (pkg.engines?.vscode === undefined) failures.push("engines.vscode is required");
if (typeof pkg.main !== "string") failures.push("main is required");
const main = typeof pkg.main === "string" ? resolve(dir, pkg.main) : "";
if (main.length > 0 && !existsSync(main)) failures.push(`main file not found: ${pkg.main}`);

const commands = new Set((pkg.contributes?.commands ?? []).map((command) => command.command));
if (!(pkg.activationEvents ?? []).includes("onUri")) {
  failures.push("activationEvents must include onUri for the deep link");
}
for (const id of [
  "keycode.openChat",
  "keycode.restartServer",
  "keycode.stopServer",
  "keycode.openInBrowser",
  "keycode.showLog",
]) {
  if (!commands.has(id)) failures.push(`missing command ${id}`);
}

const properties = pkg.contributes?.configuration?.properties ?? {};
for (const key of [
  "keycode.executable",
  "keycode.provider",
  "keycode.model",
  "keycode.permissionMode",
  "keycode.cwd",
  "keycode.openIn",
  "keycode.forwardSelection",
]) {
  if (!(key in properties)) failures.push(`missing setting ${key}`);
}

if (main.length > 0 && existsSync(main)) {
  const check = spawnSync(process.execPath, ["--check", main], { encoding: "utf8" });
  if (check.status !== 0) failures.push(`syntax error: ${check.stderr || check.stdout}`);

  const source = readFileSync(main, "utf8");
  if (!source.includes("simpleBrowser.show")) failures.push("extension must open the Simple Browser");
  if (!source.includes('"remote"')) failures.push("extension must launch the remote server");
  if (!source.includes("sanitize")) failures.push("extension must redact tokens from logs");
}

const libPath = resolve(dir, "lib.js");
if (!existsSync(libPath)) {
  failures.push("lib.js is missing");
} else {
  const check = spawnSync(process.execPath, ["--check", libPath], { encoding: "utf8" });
  if (check.status !== 0) failures.push(`lib syntax error: ${check.stderr || check.stdout}`);
  const require = createRequire(import.meta.url);
  const lib = require(libPath);
  if (!lib.sanitize("prefix token=secret&x=1").includes("token=…")) {
    failures.push("sanitize must redact tokens");
  }
  const url = lib.parseRemoteUrl("Remote Control: http://127.0.0.1:1234/#token=abc");
  if (url !== "http://127.0.0.1:1234/#token=abc") {
    failures.push("parseRemoteUrl must extract the printed URL");
  }
  const launched = lib.launch("C:\\Program Files\\keycode\\keycode.cmd", ["remote"], "win32", "cmd.exe");
  if (launched.command !== "cmd.exe" || !launched.args.at(-1).includes("keycode.cmd")) {
    failures.push("launch must quote Windows executables");
  }
}

if (failures.length > 0) {
  process.stderr.write(`extension validation failed:\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`extension ok: ${pkg.name}@${pkg.version}\n`);
}
