import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BackgroundSessions } from "../../dist/integrations/background.js";
import { makeHome } from "../helpers.js";

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error("condition timed out");
}

describe("T-I7: background sessions", () => {
  it("starts, lists, logs, stops, detects a crash, respawns, and removes", async () => {
    const dir = join(makeHome(), "background");
    const manager = new BackgroundSessions(dir);
    const script = 'console.log("ready");setTimeout(()=>{},8000)';

    const record = manager.start({
      name: "bg",
      command: process.execPath,
      args: ["-e", script],
      cwd: dir,
    });
    expect(manager.list().some((entry) => entry.id === record.id && entry.status === "running")).toBe(true);
    await waitFor(() => manager.logs(record.id).includes("ready"));
    expect(manager.logs(record.id)).toContain("ready");
    manager.stop(record.id);
    expect(manager.attach(record.id).status).toBe("stopped");

    const crash = manager.start({
      name: "crash",
      command: process.execPath,
      args: ["-e", script],
      cwd: dir,
    });
    await waitFor(() => {
      const current = manager.attach(crash.id);
      return current.pid !== null || current.status === "crashed";
    });
    const current = manager.attach(crash.id);
    if (current.pid !== null) process.kill(current.pid, "SIGKILL");
    await waitFor(() => manager.attach(crash.id).status === "crashed");
    expect(manager.attach(crash.id).status).toBe("crashed");

    const respawned = manager.respawn(crash.id);
    expect(respawned.id).not.toBe(crash.id);
    expect(respawned.status).toBe("running");
    manager.stop(respawned.id);
    expect(manager.remove(respawned.id)).toBe(true);
  });
});
