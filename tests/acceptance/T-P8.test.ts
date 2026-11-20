import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  capabilitiesFrom,
  negotiateJsonSchema,
  negotiateMessages,
  negotiateTools,
} from "../../dist/providers/capabilities.js";
import type { Message } from "../../dist/contracts/message.js";
import type { ToolSpec } from "../../dist/contracts/provider.js";

const spec: ToolSpec[] = [{ name: "t", description: "d", inputSchema: { type: "object" } }];
const imageMessage: Message = {
  id: "m1",
  role: "user",
  content: [{ type: "image", mime: "image/png", data: "AAAA" }],
  timestamp: "2026-11-20T00:00:00Z",
};

describe("T-P8: capability negotiation is explicit", () => {
  it("rejects tool calls when the model lacks tools", () => {
    expect(() => negotiateTools({ ...ALL_CAPABILITIES, tools: false }, spec)).toThrowError();
    try {
      negotiateTools({ ...ALL_CAPABILITIES, tools: false }, spec);
    } catch (error) {
      expect((error as { code: string }).code).toBe("PROVIDER_CAPABILITY");
    }
    expect(negotiateTools(ALL_CAPABILITIES, spec)).toEqual(spec);
    expect(negotiateTools(ALL_CAPABILITIES, [])).toEqual([]);
  });

  it("rejects images when the model lacks vision", () => {
    expect(() => negotiateMessages({ ...ALL_CAPABILITIES, vision: false }, [imageMessage])).toThrowError();
    expect(negotiateMessages({ ...ALL_CAPABILITIES, vision: false }, [])).toEqual([]);
    expect(negotiateMessages(ALL_CAPABILITIES, [imageMessage])).toEqual([imageMessage]);
  });

  it("rejects JSON schema when unsupported", () => {
    expect(() =>
      negotiateJsonSchema({ ...ALL_CAPABILITIES, jsonSchema: false }, { type: "object" }),
    ).toThrowError();
    expect(() => negotiateJsonSchema(ALL_CAPABILITIES, undefined)).not.toThrow();
  });

  it("builds capabilities with safe defaults", () => {
    expect(capabilitiesFrom(undefined)).toEqual({
      streaming: true,
      tools: true,
      vision: true,
      jsonSchema: true,
      thinking: false,
    });
    expect(capabilitiesFrom({ tools: false }).tools).toBe(false);
  });
});
