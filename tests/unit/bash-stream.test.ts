import { describe, expect, it } from "vitest";
import { runCommand } from "../../dist/tools/bash.js";

const node = `"${process.execPath}"`;

describe("runCommand streaming", () => {
  it("streams stdout chunks and returns the buffered result", async () => {
    const chunks: Array<{ stream: string; text: string }> = [];
    const result = await runCommand({
      command: `${node} -e "process.stdout.write('alpha')"`,
      cwd: process.cwd(),
      timeoutMs: 30_000,
      onChunk: (stream, text) => chunks.push({ stream, text }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("alpha");
    expect(result.truncated).toBe(false);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe("alpha");
  });

  it("caps output and marks the result truncated", async () => {
    const result = await runCommand({
      command: `${node} -e "process.stdout.write('x'.repeat(200))"`,
      cwd: process.cwd(),
      timeoutMs: 30_000,
      maxOutputBytes: 10,
    });
    expect(result.stdout).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });
});
