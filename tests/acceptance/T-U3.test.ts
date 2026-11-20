import { describe, expect, it } from "vitest";
import { Notifier, oscNotification } from "../../dist/notifications/index.js";

describe("T-U3: notifications", () => {
  it("deduplicates events, respects the idle threshold, and emits OSC", async () => {
    let now = 0;
    const sent: string[] = [];
    const notifier = new Notifier({
      dedupeMs: 1_000,
      idleThresholdMs: 100,
      now: () => now,
      channels: [{ name: "test", send: (event, text) => sent.push(`${event}:${text}`) }],
    });

    expect(await notifier.notify("permission_required", "approve Bash")).toBe(true);
    expect(await notifier.notify("permission_required", "approve Bash")).toBe(false);
    now = 1_500;
    expect(await notifier.notify("permission_required", "approve Bash")).toBe(true);

    now = 1_600;
    notifier.activity();
    expect(await notifier.checkIdle()).toBe(false);
    now = 1_701;
    expect(await notifier.checkIdle()).toBe(true);
    expect(sent.length).toBe(3);
    expect(oscNotification("hi")).toContain("\x1b]9;hi\x07");
  });
});
