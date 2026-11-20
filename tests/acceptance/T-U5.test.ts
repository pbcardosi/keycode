import { describe, expect, it } from "vitest";
import { renderFooter } from "../../dist/tui/format.js";

describe("T-U5: status footer", () => {
  it("renders model, tokens, cost, branch, tasks, and progress", () => {
    const footer = renderFooter({
      model: "gemini-2.5-flash",
      tokensIn: 1000,
      tokensOut: 250,
      costUsd: 0.001,
      branch: "main",
      tasks: 2,
      progress: "generating",
    });
    expect(footer).toContain("model: gemini-2.5-flash");
    expect(footer).toContain("1,000 in / 250 out");
    expect(footer).toContain("cost:");
    expect(footer).toContain("branch: main");
    expect(footer).toContain("tasks: 2");
    expect(footer).toContain("generating");
  });

  it("omits optional fields when absent", () => {
    const footer = renderFooter({ model: "m", tokensIn: 0, tokensOut: 0, costUsd: 0, branch: null, tasks: 0 });
    expect(footer).toContain("model: m");
    expect(footer).not.toContain("branch:");
    expect(footer).not.toContain("tasks:");
  });
});
