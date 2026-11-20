import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BackgroundSessions } from "../../dist/integrations/background.js";
import { makeHome } from "../helpers.js";

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

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
    await sleep(500);
    expect(manager.logs(record.id)).toContain("ready");
    manager.stop(record.id);
    expect(manager.attach(record.id).status).toBe("stopped");

    const crash = manager.start({
      name: "crash",
      command: process.execPath,
      args: ["-e", script],
      cwd: dir,
    });
    await sleep(300);
    if (crash.pid !== null) process.kill(crash.pid, "SIGKILL");
    await sleep(300);
    expect(manager.attach(crash.id).status).toBe("crashed");

    const respawned = manager.respawn(crash.id);
    expect(respawned.id).not.toBe(crash.id);
    expect(respawned.status).toBe("running");
    manager.stop(respawned.id);
    expect(manager.remove(respawned.id)).toBe(true);
  });
});
