import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LoopManager, matchesCron } from "../../dist/extensions/loops.js";
import { makeHome } from "../helpers.js";

describe("T-X12: loops and cron", () => {
  it("runs an every-minute loop twice, skips overlap, and survives restart", async () => {
    const home = makeHome();
    const file = join(home, "loops.json");
    const manager = new LoopManager(file);
    const job = manager.add({ cron: "* * * * *", command: "echo tick" });
    expect(manager.list()).toHaveLength(1);

    let runs = 0;
    const runner = async (): Promise<void> => {
      runs += 1;
    };
    const t0 = new Date("2026-01-01T00:00:00Z");
    expect(await manager.runDue(t0, runner)).toBe(1);
    expect(await manager.runDue(t0, runner)).toBe(0);

    const t1 = new Date(t0.getTime() + 60_000);
    expect(await manager.runDue(t1, runner)).toBe(1);
    expect(runs).toBe(2);

    manager.markRunning(job.id, true);
    const t2 = new Date(t1.getTime() + 60_000);
    expect(await manager.runDue(t2, runner)).toBe(0);
    manager.markRunning(job.id, false);

    const restarted = new LoopManager(file);
    expect(restarted.list()).toHaveLength(1);
    expect(matchesCron("* * * * *", t0)).toBe(true);
    expect(matchesCron("*/5 * * * *", t0)).toBe(true);
    expect(matchesCron("1 * * * *", t0)).toBe(false);
  });
});
