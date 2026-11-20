import { Buffer } from "node:buffer";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBrowserTool, type BrowserDriver } from "../../dist/integrations/browser.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { makeHome, makeToolCtx, makeWorkspace, textOf, writeJson, writeText } from "../helpers.js";

function fixtureDriver(): BrowserDriver {
  let html = '<button id="go">Go</button><p id="status">idle</p>';
  return {
    async navigate() {
      return { title: "Fixture", html };
    },
    async click(selector) {
      if (selector === "#go") html = html.replace("idle", "clicked");
    },
    async type(_selector, text) {
      html = html.replace(/idle|clicked/, text);
    },
    async readDom() {
      return html;
    },
    async screenshot() {
      return { mime: "image/png", data: Buffer.from("png-bytes").toString("base64") };
    },
  };
}

describe("T-I4: browser automation", () => {
  it("navigates an allowed origin, mutates the DOM, screenshots, and denies other origins", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createBrowserTool({ driver: fixtureDriver(), allowedDomains: ["example.com"] });

    const navigated = await tool.execute({ action: "navigate", url: "https://example.com/page" }, ctx);
    expect(navigated.ok).toBe(true);
    expect(textOf(navigated)).toContain("Fixture");

    const before = await tool.execute({ action: "read_dom" }, ctx);
    expect(textOf(before)).toContain("idle");

    await tool.execute({ action: "click", selector: "#go" }, ctx);
    const after = await tool.execute({ action: "read_dom" }, ctx);
    expect(textOf(after)).toContain("clicked");

    const typed = await tool.execute({ action: "type", selector: "#status", text: "typed value" }, ctx);
    expect(typed.ok).toBe(true);

    const screenshot = await tool.execute({ action: "screenshot" }, ctx);
    expect(screenshot.ok).toBe(true);
    expect(screenshot.content.some((block) => block.type === "image")).toBe(true);

    const denied = await tool.execute({ action: "navigate", url: "https://evil.test/page" }, ctx);
    expect(denied.ok).toBe(false);
    expect((denied.metadata as { code?: string } | undefined)?.code).toBe("SANDBOX_DENIED");
  });

  it("loads a configured browser driver as an agent tool", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    writeText(
      join(ws, "driver.mjs"),
      `export function createBrowserDriver() {
        return {
          async navigate(url) { return { title: "Configured", html: "<p id='status'>ready</p>" + url }; },
          async click() {},
          async type() {},
          async readDom() { return "<p id='status'>ready</p>"; },
          async screenshot() { return { mime: "image/png", data: "" }; },
        };
      }`,
    );
    writeJson(join(home, "settings.json"), {
      browser: { driver: "driver.mjs", allowedDomains: ["example.com"] },
    });
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      permissionMode: "bypassPermissions",
      env: {
        ...process.env,
        KEYCODE_HOME: home,
        KEYCODE_PROVIDER: "fake",
        KEYCODE_FAKE_SCRIPT: JSON.stringify({
          turns: [
            [
              {
                type: "tool_call",
                id: "b1",
                name: "Browser",
                input: { action: "navigate", url: "https://example.com/page" },
              },
              { type: "done", stopReason: "tool_use" },
            ],
            [{ type: "text", delta: "browsed" }, { type: "done", stopReason: "end_turn" }],
          ],
        }),
      },
    });
    try {
      expect(setup.toolNames).toContain("Browser");
      const result = await setup.agent.runTurn("browse", new AbortController().signal);
      expect(result.stopReason).toBe("end_turn");
      expect(JSON.stringify(setup.store.load(setup.sessionId).messages)).toContain("Configured");
    } finally {
      await Promise.all(setup.mcpClients.map((client) => client.close()));
    }
  });
});
