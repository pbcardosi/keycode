import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { createBrowserTool, type BrowserDriver } from "../../dist/integrations/browser.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

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
});
