import { describe, expect, it } from "vitest";
import { BudgetGuard } from "../../dist/providers/budget.js";
import { KeycodeError } from "../../dist/util/errors.js";
import { runCli, makeHome } from "../helpers.js";

describe("T-P9: budget guard and doctor diagnostics", () => {
  it("stops before the request when the budget is exhausted", () => {
    const guard = new BudgetGuard(0.01, { inputPerMTok: 1, outputPerMTok: 1 });
    expect(guard.isExhausted).toBe(false);
    guard.assertCanStart();
    guard.addUsage(10_000, 10_000);
    expect(guard.isExhausted).toBe(true);
    expect(() => guard.assertCanStart()).toThrowError(KeycodeError);
    try {
      guard.assertCanStart();
    } catch (error) {
      expect((error as KeycodeError).code).toBe("BUDGET_EXCEEDED");
    }
  });

  it("reports doctor reachable for the fake provider", () => {
    const home = makeHome();
    const result = runCli(["doctor", "--provider", "fake"], {
      env: { KEYCODE_HOME: home, KEYCODE_PROVIDER: "fake" },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  it("emits parseable JSON diagnostics", () => {
    const home = makeHome();
    const result = runCli(["doctor", "--json", "--provider", "fake"], {
      env: { KEYCODE_HOME: home, KEYCODE_PROVIDER: "fake" },
    });
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as { ok: boolean; checks: Array<{ name: string; status: string }> };
    expect(report.ok).toBe(true);
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.map((check) => check.name)).toContain("node");
  });

  it("flags an unknown provider in doctor", () => {
    const home = makeHome();
    const result = runCli(["doctor", "--provider", "does-not-exist"], {
      env: { KEYCODE_HOME: home },
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("FAIL");
  });
});
