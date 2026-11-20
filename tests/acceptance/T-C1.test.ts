import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { TuiApp } from "../../dist/tui/app.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { messageText } from "../../dist/contracts/message.js";
import { makeHome, makeWorkspace } from "../helpers.js";

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

describe("T-C1: Interactive REPL", () => {
  it("opens a TUI, streams a reply, and appends user and assistant messages", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let output = "";
    stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const app = render(createElement(TuiApp, { setup }), {
      stdin,
      stdout,
      patchConsole: false,
      exitOnCtrlC: false,
    });
    stdin.write("hello");
    await sleep(200);
    stdin.write("\n");
    await sleep(600);
    app.unmount();

    const view = setup.store.load(setup.sessionId);
    expect(view.messages.some((message) => message.role === "user" && messageText(message) === "hello")).toBe(true);
    expect(view.messages.some((message) => message.role === "assistant" && messageText(message).length > 0)).toBe(true);
    expect(output).toContain("fake response");
  });
});
