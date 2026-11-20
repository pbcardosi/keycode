import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkNetwork,
  checkWrite,
  createSandboxPolicy,
  sandboxFallbackWarning,
} from "../../dist/sandbox/index.js";
import { bwrapArgs, checkCommand, detectWrapper, seatbeltProfile } from "../../dist/sandbox/command.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { createBashTool } from "../../dist/tools/bash.js";
import {
  makeHome,
  makeToolCtx,
  makeWorkspace,
  textOf,
  writeJson,
} from "../helpers.js";

describe("T-S5: sandbox", () => {
  it("restricts writes to roots and blocks network egress by default", () => {
    const ws = makeWorkspace();
    const policy = createSandboxPolicy({ roots: [ws] });
    expect(checkWrite(policy, join(ws, "a.txt")).allowed).toBe(true);
    expect(checkWrite(policy, join(ws, "..", "outside.txt")).allowed).toBe(false);
    expect(checkNetwork(policy, "example.com").allowed).toBe(false);
    expect(checkNetwork(policy, "127.0.0.1").allowed).toBe(false);

    const allowed = createSandboxPolicy({
      roots: [ws],
      allowNetwork: false,
      allowedHosts: ["example.com"],
    });
    expect(checkNetwork(allowed, "api.example.com").allowed).toBe(true);
    expect(checkNetwork(allowed, "other.test").allowed).toBe(false);
  });

  it("emits a documented fallback warning off macOS/Linux", () => {
    expect(sandboxFallbackWarning("linux")).toBeNull();
    expect(sandboxFallbackWarning("darwin")).toBeNull();
    expect(sandboxFallbackWarning("win32")).toContain("not fully supported");
  });

  it("denies writes outside the root and network egress before execution", async () => {
    const ws = makeWorkspace();
    const outside = join(ws, "..", "sandbox-outside.txt");
    rmSync(outside, { force: true });
    const policy = createSandboxPolicy({ roots: [ws] });
    const tool = createBashTool();
    const ctx = makeToolCtx({ cwd: ws, sandbox: policy, home: makeHome() });

    const denied = await tool.execute({ command: "echo hello > ../sandbox-outside.txt" }, ctx);
    expect(denied.ok).toBe(false);
    expect(textOf(denied)).toContain("SANDBOX_DENIED");
    expect(existsSync(outside)).toBe(false);

    const inside = await tool.execute({ command: "echo hello > inside.txt" }, ctx);
    expect(inside.ok).toBe(true);
    expect(readFileSync(join(ws, "inside.txt"), "utf8")).toContain("hello");

    const blocked = await tool.execute({ command: "curl https://example.com" }, ctx);
    expect(blocked.ok).toBe(false);
    expect(textOf(blocked)).toContain("Network access to example.com");

    const allowed = checkCommand(
      createSandboxPolicy({ roots: [ws], allowedHosts: ["example.com"] }),
      "curl https://api.example.com/data",
      ws,
    );
    expect(allowed.allowed).toBe(true);
  });

  it("builds OS-level wrappers for macOS and Linux", () => {
    const ws = makeWorkspace();
    const policy = createSandboxPolicy({ roots: [ws] });
    const profile = seatbeltProfile(policy);
    expect(profile).toContain("(deny file-write*)");
    expect(profile).toContain(ws.replace(/\\/g, "\\\\"));
    expect(profile).toContain("(deny network*)");

    const args = bwrapArgs(policy, "echo hi", ws);
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--bind");
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", "echo hi"]);

    expect(detectWrapper("darwin", () => true)?.kind).toBe("seatbelt");
    expect(detectWrapper("linux", () => true)?.kind).toBe("bwrap");
    expect(detectWrapper("win32", () => true)).toBeNull();
  });

  it("ignores project sandbox settings in an untrusted workspace", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeJson(join(ws, ".keycode", "settings.json"), {
      sandbox: { enabled: true, allowNetwork: true },
    });
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: false,
      env: {
        ...process.env,
        KEYCODE_HOME: home,
        KEYCODE_PROVIDER: "fake",
        KEYCODE_FAKE_SCRIPT: JSON.stringify({
          turns: [[{ type: "text", delta: "ok" }, { type: "done", stopReason: "end_turn" }]],
        }),
      },
    });
    try {
      expect(setup.sandbox).toBeUndefined();
    } finally {
      await Promise.all(setup.mcpClients.map((client) => client.close()));
    }
  });
});
