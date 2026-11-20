import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../dist/core/context.js";
import { makeWorkspace } from "../helpers.js";

describe("T-M4: system prompt assembly", () => {
  it("assembles base, tool docs, memory, environment, and git status", () => {
    const prompt = buildSystemPrompt({
      cwd: makeWorkspace(),
      model: "m",
      provider: "p",
      memoryText: "mem-text",
      tools: [{ name: "Bash", description: "run things", inputSchema: { type: "object" } }],
      git: { branch: "main", status: " M file.txt" },
    });
    expect(prompt).toContain("You are keycode");
    expect(prompt).toContain("# Available tools");
    expect(prompt).toContain("- Bash: run things");
    expect(prompt).toContain("# Project memory");
    expect(prompt).toContain("mem-text");
    expect(prompt).toContain("# Environment");
    expect(prompt).toContain("model: p/m");
    expect(prompt).toContain("git branch: main");
    expect(prompt).toContain("git status:\n M file.txt");
  });

  it("replaces the base prompt and appends extra instructions", () => {
    const custom = buildSystemPrompt({
      cwd: makeWorkspace(),
      model: "m",
      provider: "p",
      memoryText: "",
      tools: [],
      basePrompt: "custom-base-prompt",
    });
    expect(custom).toContain("custom-base-prompt");
    expect(custom).not.toContain("You are keycode");

    const appended = buildSystemPrompt({
      cwd: makeWorkspace(),
      model: "m",
      provider: "p",
      memoryText: "",
      tools: [],
      appendPrompt: "Do the thing.",
    });
    expect(appended).toContain("# Additional instructions");
    expect(appended).toContain("Do the thing.");
  });

  it("omits the memory section when empty", () => {
    const prompt = buildSystemPrompt({ cwd: makeWorkspace(), model: "m", provider: "p", memoryText: "", tools: [] });
    expect(prompt).not.toContain("# Project memory");
  });
});
