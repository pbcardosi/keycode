import { describe, expect, it } from "vitest";
import {
  completeOnboarding,
  needsOnboarding,
  onboardingText,
  releaseNotes,
} from "../../dist/app/onboarding.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import { executeCommand } from "../../dist/app/commands.js";
import { makeHome, makeWorkspace } from "../helpers.js";
import { VERSION } from "../../dist/version.js";

describe("T-U6: onboarding and help", () => {
  it("shows onboarding on a fresh home, lists commands, and renders release notes", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    expect(needsOnboarding(home)).toBe(true);
    const text = onboardingText();
    expect(text).toContain("Theme");
    expect(text).toContain("Trust");
    expect(text).toContain("Provider");
    completeOnboarding(home);
    expect(needsOnboarding(home)).toBe(false);

    const setup = await createAgentSetup({ cwd: ws, home, provider: "fake", trust: true });
    const help: string[] = [];
    await executeCommand("/help", {
      setup,
      agent: setup.agent,
      out: (line) => help.push(line),
      signal: new AbortController().signal,
    });
    expect(help.join("\n")).toContain("/compact");
    expect(help.join("\n")).toContain("/permissions");

    const notes: string[] = [];
    await executeCommand("/release-notes", {
      setup,
      agent: setup.agent,
      out: (line) => notes.push(line),
      signal: new AbortController().signal,
    });
    expect(notes.join("\n")).toContain(`KeyCode ${VERSION}`);
    expect(releaseNotes()).toContain("Part 1");
  });
});
