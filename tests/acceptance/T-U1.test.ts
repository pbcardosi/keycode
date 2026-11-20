import { describe, expect, it } from "vitest";
import { contextGrid } from "../../dist/core/context.js";
import { renderMarkdown, renderToolRow, spinnerFrame, renderTodos, renderTranscript } from "../../dist/tui/format.js";

describe("T-U1: TUI renderer", () => {
  it("renders markdown", () => {
    const text = renderMarkdown("# Title\n**bold**");
    expect(text).toContain("Title");
    expect(text).toContain("bold");
  });

  it("renders tool rows with icons and details", () => {
    const success = renderToolRow("success", "Bash", "ls -la");
    expect(success).toContain("Bash");
    expect(success).toContain("ls -la");
    const pending = renderToolRow("pending", "Read", "a.txt");
    expect(pending).toContain("Read");
    const denied = renderToolRow("denied", "Write", "out.txt");
    expect(denied).toContain("Write");
  });

  it("has a spinner cycle that wraps", () => {
    expect(spinnerFrame(0)).toBe(spinnerFrame(10));
    expect(spinnerFrame(0)).toBe(spinnerFrame(0));
  });

  it("renders todo rows", () => {
    expect(renderTodos([{ id: "t1", content: "do it", status: "completed" }])).toContain("[x] do it");
    expect(renderTodos([{ id: "t2", content: "active", status: "in_progress" }])).toContain("[>] active");
    expect(renderTodos([{ id: "t3", content: "idea", status: "pending" }])).toContain("[ ] idea");
  });

  it("renders the transcript with labels and text", () => {
    const transcript = renderTranscript([
      { id: "m1", role: "user", content: [{ type: "text", text: "hello" }], timestamp: "t" },
      { id: "m2", role: "assistant", content: [{ type: "text", text: "hi there" }], timestamp: "t" },
    ]);
    expect(transcript).toContain("You");
    expect(transcript).toContain("hello");
    expect(transcript).toContain("keycode");
    expect(transcript).toContain("hi there");
  });

  it("renders the context grid", () => {
    const grid = contextGrid(1000, 1000);
    expect(grid).toContain("Context:");
    expect(grid).toContain("100.0%");
  });
});
