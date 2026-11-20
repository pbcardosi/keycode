import { describe, expect, it } from "vitest";
import { accessibilityEnabled, reducedMotion, renderAccessible } from "../../dist/tui/accessibility.js";
import type { Message } from "../../dist/contracts/message.js";

const messages: Message[] = [
  { id: "1", role: "user", content: [{ type: "text", text: "hello" }], timestamp: "t" },
  { id: "2", role: "assistant", content: [{ type: "text", text: "hi there" }], timestamp: "t" },
];

describe("T-U4: accessibility", () => {
  it("renders flat text with labels and no ANSI or borders", () => {
    const text = renderAccessible(messages);
    expect(text).toContain("User:");
    expect(text).toContain("Assistant:");
    expect(text).toContain("hello");
    expect(text).not.toContain("\x1b");
    expect(text).not.toMatch(/[─│┌┐└┘]/);
    expect(accessibilityEnabled({ KEYCODE_AX: "1" })).toBe(true);
    expect(accessibilityEnabled({ KEYCODE_SCREEN_READER: "1" })).toBe(true);
    expect(accessibilityEnabled({})).toBe(false);
    expect(reducedMotion({ KEYCODE_REDUCED_MOTION: "1" })).toBe(true);
  });
});
