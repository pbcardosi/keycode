import { describe, expect, it } from "vitest";
import { PRESETS, FREE_PRESET_IDS } from "../../dist/providers/presets.js";

const HOSTED = ["gemini", "groq", "openrouter", "cerebras", "mistral", "github"];
const LOCAL = ["ollama", "lmstudio", "llamacpp"];

describe("T-P4: free hosted presets resolve offline", () => {
  it("has the documented hosted and local provider matrix", () => {
    for (const id of HOSTED) {
      const preset = PRESETS[id];
      expect(preset, id).toBeDefined();
      expect(preset?.free).toBe(true);
      expect(preset?.local).toBe(false);
      expect(preset?.baseUrl).toMatch(/^https?:\/\//);
      expect(preset?.apiKeyEnv).toBeTruthy();
      expect(preset?.defaultModel).toBeTruthy();
      expect(preset?.contextWindow).toBeGreaterThan(0);
    }
  });

  it("exposes openrouter headers and the free-model convention", () => {
    expect(PRESETS.openrouter?.headers).toEqual(
      expect.objectContaining({ "X-Title": "KeyCode", "HTTP-Referer": expect.any(String) }),
    );
  });

  it("marks local presets free with no key", () => {
    for (const id of LOCAL) {
      const preset = PRESETS[id];
      expect(preset, id).toBeDefined();
      expect(preset?.local).toBe(true);
      expect(preset?.apiKeyEnv).toBeNull();
    }
  });

  it("keeps anthropic paid and last", () => {
    expect(PRESETS.anthropic?.free).toBe(false);
    expect(Object.keys(PRESETS)).toContain("anthropic");
  });

  it("flags free presets in FREE_PRESET_IDS", () => {
    for (const id of [...HOSTED, ...LOCAL]) expect(FREE_PRESET_IDS).toContain(id);
  });
});
