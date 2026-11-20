import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "src", "web", "public");
const target = resolve(root, "dist", "web", "public");

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
process.stdout.write(`copied web assets to ${target}\n`);
