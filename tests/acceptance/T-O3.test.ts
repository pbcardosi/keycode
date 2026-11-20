import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TelemetryRecorder,
  deleteData,
  exportData,
  savePrivacy,
  telemetryEnabled,
} from "../../dist/privacy/index.js";
import { makeHome, writeJson, writeText } from "../helpers.js";

describe("T-O3: privacy", () => {
  it("opting out suppresses telemetry and export/delete manage data", () => {
    const home = makeHome();
    savePrivacy(home, { consent: "denied", telemetry: false });
    expect(telemetryEnabled(home, {})).toBe(false);
    const disabled = new TelemetryRecorder(telemetryEnabled(home, {}));
    disabled.record({ type: "turn" });
    expect(disabled.recorded).toHaveLength(0);

    savePrivacy(home, { consent: "granted", telemetry: true });
    expect(telemetryEnabled(home, {})).toBe(true);
    expect(telemetryEnabled(home, { KEYCODE_TELEMETRY: "0" })).toBe(false);
    expect(telemetryEnabled(home, { DO_NOT_TRACK: "1" })).toBe(false);

    const enabled = new TelemetryRecorder(true);
    enabled.record({ type: "turn" });
    expect(enabled.recorded).toHaveLength(1);

    writeJson(join(home, "settings.json"), { model: "m" });
    writeText(join(home, "projects", "abc", "sessions", "s1.jsonl"), '{"type":"session"}\n');
    const exported = JSON.parse(exportData(home)) as { sessions: Array<{ records: unknown[] }> };
    expect(exported.sessions).toHaveLength(1);
    expect(exported.sessions[0]?.records).toHaveLength(1);

    const removed = deleteData(home);
    expect(removed.removed.some((path) => path.includes("projects"))).toBe(true);
    expect(existsSync(join(home, "projects"))).toBe(false);
  });
});
