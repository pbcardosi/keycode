import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "keycode-pack-"));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageName = packageJson.name;
const packagePath = join(consumerRoot(), "node_modules", ...packageName.split("/"));
const binName = Object.keys(packageJson.bin ?? {})[0] ?? "keycode";

function consumerRoot() {
  return join(work, "consumer");
}

function run(command, args, options) {
  const shared = {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  };
  const result =
    process.platform === "win32"
      ? spawnSync(
          [command, ...args]
            .map((value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
            .join(" "),
          { ...shared, shell: true },
        )
      : spawnSync(command, args, shared);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const packed = run("npm", ["pack", "--json", "--pack-destination", work], { cwd: root });
  const jsonStart = Math.min(
    ...["{", "["].map((token) => {
      const index = packed.stdout.indexOf(token);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    }),
  );
  const payload = JSON.parse(packed.stdout.slice(jsonStart));
  const entries = Array.isArray(payload) ? payload : Object.values(payload);
  assert(entries.length === 1, "npm pack should produce one tarball");
  const entry = entries[0];
  const files = new Set(
    (entry.files ?? []).map((file) => file.path.replace(/^package\//, "")),
  );

  for (const required of [
    "dist/cli/index.js",
    "dist/web/public/index.html",
    "dist/web/public/app.js",
    "dist/web/public/markdown.js",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
  ]) {
    assert(files.has(required), `tarball is missing ${required}`);
  }
  for (const path of files) {
    assert(!path.startsWith("src/"), `tarball should not contain ${path}`);
    assert(!path.startsWith("tests/"), `tarball should not contain ${path}`);
    assert(!path.includes("node_modules/"), `tarball should not contain ${path}`);
  }

  const tarball = join(work, entry.filename);
  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "keycode-consumer", private: true }, null, 2)}\n`,
  );
  run("npm", ["install", tarball, "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: consumer,
  });

  const installed = JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
  const installedBin = installed.bin?.[binName];
  assert(
    installedBin === "./dist/cli/index.js" || installedBin === "dist/cli/index.js",
    `installed bin mapping is wrong: ${binName}=${JSON.stringify(installedBin)} all=${JSON.stringify(installed.bin)}`,
  );

  const entrypoint = join(packagePath, "dist", "cli", "index.js");
  assert(
    readFileSync(entrypoint, "utf8").startsWith("#!/usr/bin/env node"),
    "installed entry point lost its shebang",
  );

  const bin = join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${binName}.cmd` : binName,
  );
  const version = run(bin, ["--version"], { cwd: consumer });
  assert(version.stdout.trim() === installed.version, `unexpected version: ${version.stdout}`);

  const home = join(work, "home");
  const turn = run(
    bin,
    ["--provider", "fake", "-p", "package smoke", "--output-format", "json"],
    {
      cwd: consumer,
      env: {
        KEYCODE_HOME: home,
        KEYCODE_PROVIDER: "fake",
        KEYCODE_FAKE_SCRIPT: JSON.stringify({
          turns: [
            [{ type: "text", delta: "packaged ok" }, { type: "done", stopReason: "end_turn" }],
          ],
        }),
      },
    },
  );
  const result = JSON.parse(turn.stdout);
  assert(result.is_error === false, "packaged CLI reported an error");
  assert(result.result === "packaged ok", `unexpected result: ${result.result}`);

  process.stdout.write(`pack smoke ok: ${entry.filename} (${files.size} files)\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
