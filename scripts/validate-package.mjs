import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const cli = readFileSync(resolve(root, "src/cli/index.ts"), "utf8");
const failures = [];

if (pkg.bin?.keycode !== "./dist/cli/index.js") {
  failures.push("package.json bin.keycode must point at ./dist/cli/index.js");
}

const version = /export const VERSION = "([^"]+)"/.exec(cli)?.[1];
if (version === undefined) {
  failures.push("src/cli/index.ts must export VERSION");
} else if (version !== pkg.version) {
  failures.push(`VERSION ${version} does not match package.json ${pkg.version}`);
}

if (!cli.startsWith("#!/usr/bin/env node")) {
  failures.push("src/cli/index.ts must start with a node shebang");
}

if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) {
  failures.push('package.json files must include "dist"');
}

if (pkg.license !== "Apache-2.0") failures.push("license must be Apache-2.0");
if (pkg.private !== true) failures.push("private must stay true until a registry name is chosen");
if (pkg.engines?.node !== ">=22") failures.push("engines.node must be >=22");

if (failures.length > 0) {
  process.stderr.write(`package validation failed:\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`package ok: ${pkg.name}@${pkg.version}\n`);
}
