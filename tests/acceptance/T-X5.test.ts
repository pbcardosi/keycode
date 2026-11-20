import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeWorkspace, writeText } from "../helpers.js";

function fakeEnv(home: string, script: unknown): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KEYCODE_HOME: home,
    KEYCODE_PROVIDER: "fake",
    KEYCODE_FAKE_SCRIPT: JSON.stringify(script),
  };
}

describe("T-X5: hooks", () => {
  it("a PreToolUse hook can deny a tool call", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const denyPath = join(ws, "deny.js");
    writeText(
      denyPath,
      'let d="";process.stdin.on("data",(c)=>d+=c);process.stdin.on("end",()=>{JSON.parse(d);process.stdout.write(JSON.stringify({decision:"deny",reason:"blocked by test hook"}));});',
    );
    const script = {
      turns: [
        [
          { type: "tool_call", id: "t1", name: "Bash", input: { command: 'node -e "require(\'fs\').writeFileSync(\'ran.txt\',\'yes\')"' } },
          { type: "done", stopReason: "tool_use" },
        ],
        [{ type: "text", delta: "done" }, { type: "done", stopReason: "end_turn" }],
      ],
    };
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: fakeEnv(home, script),
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `node "${denyPath}"`, timeout: 10 }] }],
      },
    });
    const result = await setup.agent.runTurn("run it", new AbortController().signal);
    expect(result.stopReason).toBe("end_turn");
    const serialized = JSON.stringify(setup.store.load(setup.sessionId).messages);
    expect(serialized).toContain("blocked by test hook");
    expect(existsSync(join(ws, "ran.txt"))).toBe(false);
  });

  it("a PostToolUse hook receives the tool result", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const postPath = join(ws, "post.js");
    writeText(
      postPath,
      'let d="";process.stdin.on("data",(c)=>d+=c);process.stdin.on("end",()=>{const p=JSON.parse(d);require("fs").appendFileSync(process.env.KEYCODE_PROJECT_DIR+"/post.log",JSON.stringify(p)+"\\n");process.stdout.write("{}");});',
    );
    const script = {
      turns: [
        [
          { type: "tool_call", id: "t2", name: "Bash", input: { command: "echo hook-ok" } },
          { type: "done", stopReason: "tool_use" },
        ],
        [{ type: "text", delta: "done" }, { type: "done", stopReason: "end_turn" }],
      ],
    };
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: fakeEnv(home, script),
      permissionMode: "bypassPermissions",
      hooks: {
        PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `node "${postPath}"`, timeout: 10 }] }],
      },
    });
    await setup.agent.runTurn("run it", new AbortController().signal);
    const log = readFileSync(join(ws, "post.log"), "utf8");
    expect(log).toContain("PostToolUse");
    expect(log).toContain("Bash");
    expect(log).toContain("hook-ok");
  });
});
