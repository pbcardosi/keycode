import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const target = resolve(process.argv[2] ?? "artifacts");
const files = [];

function collect(path) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path).sort()) collect(join(path, entry));
    return;
  }
  if (/\.(tgz|vsix|zip|tar\.gz|exe)$/i.test(path)) files.push(path);
}

collect(target);
const lines = files.map((file) => {
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  return `${digest}  ${basename(file)}`;
});
const output = join(target, "SHA256SUMS");
writeFileSync(output, `${lines.join("\n")}\n`);
process.stdout.write(`wrote ${output} (${files.length} files)\n`);
