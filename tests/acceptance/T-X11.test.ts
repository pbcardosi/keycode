import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWorkflow } from "../../dist/extensions/workflows.js";
import { makeWorkspace, writeText } from "../helpers.js";

const SCRIPT = [
  'import { existsSync, appendFileSync } from "node:fs";',
  "export default {",
  '  name: "two",',
  "  steps: [",
  "    { id: \"one\", run: async (ctx) => { appendFileSync(ctx.context.counter, \"one\\n\"); return 1; } },",
  "    { id: \"two\", run: async (ctx) => { if (!existsSync(ctx.context.gate)) throw new Error(\"gate closed\"); appendFileSync(ctx.context.counter, \"two\\n\"); return 2; } },",
  "  ],",
  "};",
].join("\n");

describe("T-X11: workflows", () => {
  it("resumes after a failure and reuses completed steps", async () => {
    const ws = makeWorkspace();
    const scriptPath = join(ws, "two-step.mjs");
    writeText(scriptPath, SCRIPT);
    const counter = join(ws, "counter.txt");
    const gate = join(ws, "gate.txt");
    const checkpointDir = join(ws, "checkpoints");

    const first = await runWorkflow({
      scriptPath,
      checkpointDir,
      context: { counter, gate },
    });
    expect(first.status).toBe("failed");
    expect(first.completed).toEqual(["one"]);

    writeText(gate, "open");
    const resumed = await runWorkflow({
      scriptPath,
      checkpointDir,
      context: { counter, gate },
    });
    expect(resumed.status).toBe("completed");
    expect(resumed.completed).toEqual(["one", "two"]);

    const lines = readFileSync(counter, "utf8").split("\n").filter((line) => line.length > 0);
    expect(lines).toEqual(["one", "two"]);
    expect(existsSync(join(checkpointDir, "two.json"))).toBe(true);
  });
});
