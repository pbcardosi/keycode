import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkNetwork,
  checkWrite,
  createSandboxPolicy,
  sandboxFallbackWarning,
} from "../../dist/sandbox/index.js";
import { makeWorkspace } from "../helpers.js";

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
});
