import { describe, expect, it } from "vitest";
import { createProvider, canonicalProviderId, availableProviderIds } from "../../dist/providers/registry.js";
import { KeycodeError } from "../../dist/util/errors.js";
import { makeHome } from "../helpers.js";

describe("T-P1: provider contract and registry", () => {
  it("resolves two providers and rejects an unknown id", () => {
    const home = makeHome();
    const env = { KEYCODE_FAKE_SCRIPT: JSON.stringify([{ type: "done", stopReason: "end_turn" }]) };
    const fake = createProvider({ id: "fake", home, env });
    expect(fake.id).toBe("fake");
    expect(fake.capabilities).toMatchObject({ streaming: true, tools: true, vision: true });
    const custom = createProvider({
      id: "custom",
      home,
      settings: { providers: { custom: { kind: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1", models: ["m1"] } } },
    });
    expect(custom.id).toBe("custom");
    expect(custom.capabilities.tools).toBe(true);
    expect(availableProviderIds()).toContain("fake");
    expect(() => createProvider({ id: "nope", home, env })).toThrowError(KeycodeError);
    try {
      createProvider({ id: "nope", home, env });
    } catch (error) {
      expect((error as KeycodeError).code).toBe("PROVIDER_NOT_FOUND");
    }
  });

  it("canonicalizes aliases", () => {
    expect(canonicalProviderId("Google")).toBe("gemini");
    expect(canonicalProviderId("lm-studio")).toBe("lmstudio");
    expect(canonicalProviderId("llama.cpp")).toBe("llamacpp");
  });
});
