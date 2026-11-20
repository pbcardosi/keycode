import { describe, expect, it } from "vitest";
import { createWebSearchTool, type SearchProvider } from "../../dist/tools/websearch.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

const provider: SearchProvider = {
  name: "fake",
  async search() {
    return [
      { title: "Example", url: "https://example.com/a", snippet: "first result" },
      { title: "Other", url: "https://other.test/b", snippet: "second result" },
    ];
  },
};

describe("T-T9: WebSearch", () => {
  it("formats cited results and filters domains", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createWebSearchTool({ provider });
    const result = await tool.execute({ query: "hello" }, ctx);
    expect(result.ok).toBe(true);
    const text = textOf(result);
    expect(text).toContain("[1] Example");
    expect(text).toContain("https://example.com/a");
    expect(text).toContain("[2] Other");

    const filtered = await tool.execute({ query: "hello", allowed_domains: ["example.com"] }, ctx);
    expect(textOf(filtered)).toContain("example.com");
    expect(textOf(filtered)).not.toContain("other.test");

    const blocked = await tool.execute({ query: "hello", blocked_domains: ["example.com"] }, ctx);
    expect(textOf(blocked)).not.toContain("example.com");
    expect(textOf(blocked)).toContain("other.test");
  });

  it("is disabled without a provider", async () => {
    const ctx = makeToolCtx({ cwd: makeWorkspace() });
    const tool = createWebSearchTool({ provider: null });
    const result = await tool.execute({ query: "hello" }, ctx);
    expect(result.ok).toBe(false);
    expect(textOf(result)).toContain("disabled");
    expect((result.metadata as { code?: string } | undefined)?.code).toBe("TOOL_UNSUPPORTED");
  });
});
