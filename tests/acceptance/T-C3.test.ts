import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { createAgentSetup } from "../../dist/app/factory.js";
import { SessionStore } from "../../dist/storage/session.js";
import { makeHome, makeWorkspace, readJsonl, runCli } from "../helpers.js";

const FAKE_ENV = (home: string, text: string) => ({
  KEYCODE_HOME: home,
  KEYCODE_PROVIDER: "fake",
  KEYCODE_FAKE_SCRIPT: JSON.stringify([
    { type: "text", delta: text },
    { type: "done", stopReason: "end_turn" },
  ]),
});

describe("T-C3: Session persistence", () => {
  it(
    "persists sessions under KEYCODE_HOME/projects/<hash> and resumes by name",
    async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const env1 = FAKE_ENV(home, "first answer");
    const env2 = FAKE_ENV(home, "second answer");

    const first = runCli(["-p", "first question"], { env: env1, cwd: ws });
    expect(first.code).toBe(0);
    const second = runCli(["-p", "second question"], { env: env2, cwd: ws });
    expect(second.code).toBe(0);

    const store = new SessionStore(home, ws);
    const sessions = store.list();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const older = sessions.find((session) => session.messageCount >= 2);
    expect(older).toBeDefined();
    const view = store.load(older?.id ?? "");
    expect(view.messages.some((message) => message.role === "user")).toBe(true);
    expect(view.messages.some((message) => message.role === "assistant")).toBe(true);

    const resumed = runCli(["--resume", older?.name ?? "", "-p", "third"], { env: env1, cwd: ws });
    expect(resumed.code).toBe(0);
    const resumedView = store.load(older?.id ?? "");
    expect(resumedView.messages.length).toBeGreaterThan(view.messages.length);
    expect(resumedView.messages.some((message) => message.role === "user")).toBe(true);

    store.setModel(older?.id ?? "", "ollama", "qwen3-coder");
    expect(store.load(older?.id ?? "").header).toMatchObject({
      provider: "ollama",
      model: "qwen3-coder",
    });
    expect(store.list().find((session) => session.id === older?.id)).toMatchObject({
      provider: "ollama",
      model: "qwen3-coder",
    });
  }, 90000);

  it("forks a resumed session and keeps the original intact", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    runCli(["-p", "question"], { env: FAKE_ENV(home, "answer"), cwd: ws });
    const store = new SessionStore(home, ws);
    const original = store.latest();
    expect(original).toBeDefined();

    const forked = runCli(["--resume", original?.name ?? "", "--fork-session", "-p", "more"], {
      env: FAKE_ENV(home, "forked answer"),
      cwd: ws,
    });
    expect(forked.code).toBe(0);
    const forkView = store.load(original?.id ?? "");
    const forks = store.list().filter((session) => session.parentId === original?.id);
    expect(forks.length).toBeGreaterThanOrEqual(1);
    const forkId = forks[0]?.id;
    const forkRecord = store.load(forkId ?? "");
    expect(forkRecord.messages.length).toBeGreaterThanOrEqual(forkView.messages.length);
    expect(forkRecord.header.parentId).toBe(original?.id);
  }, 90000);

  it("accepts a user-specified session id", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const id = crypto.randomUUID();
    const result = runCli(["--session-id", id, "-p", "hello"], { env: FAKE_ENV(home, "ok"), cwd: ws });
    expect(result.code).toBe(0);
    const store = new SessionStore(home, ws);
    const view = store.load(id);
    expect(view.header.id).toBe(id);
  }, 90000);

  it("appends to the resumed session and restores messages and model", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const env = FAKE_ENV(home, "answer");
    runCli(["-p", "first"], { env, cwd: ws });
    const store = new SessionStore(home, ws);
    const original = store.latest();
    expect(original).toBeDefined();
    const before = store.load(original?.id ?? "").messages.length;

    const resumed = runCli(["--resume", original?.name ?? "", "-p", "second"], { env, cwd: ws });
    expect(resumed.code).toBe(0);
    const after = store.load(original?.id ?? "");
    expect(after.messages.length).toBeGreaterThan(before);
    expect(after.header.provider).toBe("fake");
    expect(after.header.model).toBe("fake-model");
  }, 90000);

  it("stores sessions as append-only JSONL with a session header", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    runCli(["-p", "hello"], { env: FAKE_ENV(home, "world"), cwd: ws });
    const store = new SessionStore(home, ws);
    const original = store.latest();
    const file = `${store.dir}/${original?.id}.jsonl`;
    const records = readJsonl(file);
    expect(records[0]).toMatchObject({ type: "session", version: 1 });
    expect(records.some((record) => (record as { type: string }).type === "message")).toBe(true);
    expect(records.some((record) => (record as { role?: string }).role === "user")).toBe(true);
    expect(records.some((record) => (record as { role?: string }).role === "assistant")).toBe(true);
  }, 90000);
});
