import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STATUS_LINE_FALLBACK,
  resolveStatusLine,
  runStatusLine,
} from "../../dist/extensions/statusline.js";
import { makeWorkspace, writeText } from "../helpers.js";

describe("T-X8: status line", () => {
  it("runs a command with JSON stdin, falls back on timeout, and can be disabled", async () => {
    const ws = makeWorkspace();
    const script = join(ws, "status.js");
    writeText(
      script,
      'let d="";process.stdin.on("data",(c)=>d+=c);process.stdin.on("end",()=>{const p=JSON.parse(d);console.log("model:"+p.model+" cwd:"+p.cwd);});',
    );
    const result = await runStatusLine(`node "${script}"`, { model: "m", cwd: "/x" }, { cwd: ws, timeoutMs: 5000 });
    expect(result.failed).toBe(false);
    expect(result.text).toContain("model:m");
    expect(result.text).toContain("cwd:/x");

    const slow = await runStatusLine('node -e "setTimeout(()=>{}, 5000)"', {}, { cwd: ws, timeoutMs: 100 });
    expect(slow.failed).toBe(true);
    expect(slow.text).toBe(STATUS_LINE_FALLBACK);

    expect(resolveStatusLine({ statusLine: null })).toBeNull();
    expect(resolveStatusLine({ statusLine: { type: "command", command: "echo hi" } })).toBe("echo hi");
  });
});
