#!/usr/bin/env node
/**
 * Validates the 1:1 feature/test traceability in SPEC.md.
 *
 * Rules:
 *  - Every feature ID is unique and matches ^[A-Z][0-9]+$.
 *  - Every feature has exactly one acceptance test named T-<feature ID>.
 *  - Every feature has exactly one build part in {1, 2, 3}.
 *  - Totals match the plan: 90 features, 43 / 33 / 14.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const specPath = join(root, "SPEC.md");
const spec = readFileSync(specPath, "utf8");

const PIPE = "\u0000PIPE\u0000";
const expected = {
  total: 90,
  parts: { 1: 43, 2: 33, 3: 14 },
};

const errors = [];
const rows = [];
const seenIds = new Set();
const seenTests = new Set();

let currentDomain = "";
let currentSection = "";

for (const rawLine of spec.split(/\r?\n/)) {
  const line = rawLine.trim();

  if (line.startsWith("### ")) {
    currentSection = line.slice(4).trim();
  }

  if (!line.startsWith("|")) continue;

  const cells = line
    .replaceAll("\\|", PIPE)
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.replaceAll(PIPE, "|").trim());

  if (cells.length !== 5) continue;

  const [id, feature, requirement, test, part] = cells;
  if (!/^[A-Z][0-9]+$/.test(id)) continue;

  const domain = id.replace(/[0-9]+$/, "");
  if (domain !== currentDomain) currentDomain = domain;

  if (seenIds.has(id)) errors.push(`duplicate feature ID: ${id}`);
  seenIds.add(id);

  if (!feature) errors.push(`${id}: empty feature name`);
  if (!requirement) errors.push(`${id}: empty requirement`);
  if (!test) errors.push(`${id}: missing acceptance test`);

  const expectedTest = `T-${id}`;
  const testIds = test.match(/T-[A-Z][0-9]+/g) ?? [];
  if (testIds.length !== 1) {
    errors.push(
      `${id}: expected exactly one test ID in the cell, found ${testIds.length}`,
    );
  } else if (testIds[0] !== expectedTest) {
    errors.push(`${id}: expected test "${expectedTest}", got "${testIds[0]}"`);
  } else if (!test.startsWith(`${expectedTest}:`)) {
    errors.push(`${id}: test cell must start with "${expectedTest}:"`);
  }

  if (seenTests.has(testIds[0])) {
    errors.push(`duplicate test ID: ${testIds[0]}`);
  }
  if (testIds[0]) seenTests.add(testIds[0]);

  const partNumber = Number(part);
  if (![1, 2, 3].includes(partNumber)) {
    errors.push(`${id}: invalid part "${part}"`);
  }

  rows.push({
    id,
    domain,
    feature,
    test,
    part: partNumber,
    section: currentSection,
  });
}

if (rows.length !== expected.total) {
  errors.push(`expected ${expected.total} features, found ${rows.length}`);
}

const counts = { 1: 0, 2: 0, 3: 0 };
for (const row of rows) {
  if (counts[row.part] !== undefined) counts[row.part] += 1;
}

for (const [part, count] of Object.entries(expected.parts)) {
  if (counts[part] !== count) {
    errors.push(
      `part ${part}: expected ${count} features, found ${counts[part]}`,
    );
  }
}

const domains = new Map();
for (const row of rows) {
  const entry = domains.get(row.domain) ?? { count: 0, section: row.section };
  entry.count += 1;
  domains.set(row.domain, entry);
}

const domainNames = {
  C: "Core runtime",
  P: "Providers and free keys",
  T: "Tools",
  S: "Safety",
  M: "Memory and context",
  X: "Extensibility",
  I: "Integrations",
  U: "User experience",
  O: "Platform and operations",
};

console.log("SPEC traceability");
console.log("=================");
for (const [prefix, entry] of [...domains.entries()].sort()) {
  console.log(
    `  ${prefix.padEnd(2)} ${(domainNames[prefix] ?? "Unknown").padEnd(26)} ${String(entry.count).padStart(2)}  ${entry.section}`,
  );
}
console.log(
  `  ${"".padEnd(2)} ${"TOTAL".padEnd(26)} ${String(rows.length).padStart(2)}`,
);
console.log(
  `  Parts: 1=${counts[1]}, 2=${counts[2]}, 3=${counts[3]}`,
);
console.log(`  Tests: ${seenTests.size} unique`);

if (errors.length > 0) {
  console.error("\nFAILED:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log("\nOK: every feature has exactly one test and one build part.");
