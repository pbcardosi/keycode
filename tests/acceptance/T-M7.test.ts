import { describe, expect, it } from "vitest";
import { cacheHitRate, orderForCache, planContext } from "../../dist/core/budget.js";
import { capOutput } from "../../dist/tools/shared.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeToolCtx, makeWorkspace } from "../helpers.js";

const FAKE_ENV = (home: string, script: unknown) => ({
  ...process.env,
  KEYCODE_HOME: home,
  KEYCODE_PROVIDER: "fake",
  KEYCODE_FAKE_SCRIPT: JSON.stringify(script),
});

describe("T-M7: context budgeting", () => {
  it("plans context, spills large output, orders for cache reuse, and reports cache hits", async () => {
    expect(planContext(170_000, 200_000).shouldCompact).toBe(true);
    expect(planContext(100_000, 200_000).shouldCompact).toBe(false);

    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const capped = capOutput("x".repeat(40_000), ctx, "m7");
    expect(capped.spilled).not.toBeNull();
    expect(capped.text).toContain("full output at");

    const ordered = orderForCache([
      { id: "u", role: "user", content: [], timestamp: "t" },
      { id: "s", role: "system", content: [], timestamp: "t" },
    ]);
    expect(ordered[0]?.role).toBe("system");

    const home = makeHome();
    const ws = makeWorkspace();
    const script = [
      { type: "usage", inputTokens: 100, outputTokens: 10, cachedTokens: 80 },
      { type: "text", delta: "hi" },
      { type: "done", stopReason: "end_turn" },
    ];
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      autoCompactThreshold: 1_000_000,
      env: FAKE_ENV(home, script),
    });
    await setup.agent.runTurn("hi", new AbortController().signal);
    expect(setup.agent.usage.cachedTokens).toBe(80);
    expect(cacheHitRate(setup.agent.usage)).toBeCloseTo(0.8);
  });
});
