import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ALL_CAPABILITIES,
  capabilitiesFrom,
  negotiateJsonSchema,
  negotiateMessages,
  negotiateTools,
} from "../../dist/providers/capabilities.js";
import { parseTextToolCalls, TEXT_TOOL_PROTOCOL } from "../../dist/providers/textProtocol.js";
import { Agent } from "../../dist/app/agent.js";
import { PermissionService } from "../../dist/permissions/pipeline.js";
import { SessionStore } from "../../dist/storage/session.js";
import { toolOk } from "../../dist/contracts/tool.js";
import type { Message } from "../../dist/contracts/message.js";
import type { Provider, ToolSpec } from "../../dist/contracts/provider.js";
import type { Tool } from "../../dist/contracts/tool.js";
import { makeHome, makeWorkspace } from "../helpers.js";

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

  it("parses the documented text tool protocol", () => {
    expect(TEXT_TOOL_PROTOCOL).toContain("keycode-tool");
    const parsed = parseTextToolCalls(
      'Let me look.\n```keycode-tool\n{"name":"Read","input":{"file_path":"a.ts"}}\n```',
    );
    expect(parsed.text).toBe("Let me look.");
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.calls[0]).toMatchObject({ name: "Read", input: { file_path: "a.ts" } });
    expect(parsed.calls[0]?.id).toMatch(/^textcall_/);

    const invalid = parseTextToolCalls("```keycode-tool\nnot json\n```");
    expect(invalid.calls).toHaveLength(0);
    expect(invalid.text).toContain("not json");
  });

  it("runs a text-protocol tool call when the model has no native tools", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const store = new SessionStore(home, ws);
    const header = store.create({ provider: "text-only", model: "tiny" });
    let turn = 0;
    const provider: Provider = {
      id: "text-only",
      async listModels() {
        return [];
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "text" as const,
            delta: '```keycode-tool\n{"name":"Echo","input":{"text":"hi"}}\n```',
          };
          yield { type: "done" as const, stopReason: "end_turn" as const };
          return;
        }
        yield { type: "text" as const, delta: "finished" };
        yield { type: "done" as const, stopReason: "end_turn" as const };
      },
    };
    const echo: Tool<{ text: string }> = {
      name: "Echo",
      description: "echo text",
      input: z.object({ text: z.string() }),
      readOnly: true,
      concurrency: "parallel",
      async execute(input) {
        return toolOk(`echo:${input.text}`);
      },
    };
    const agent = new Agent({
      sessionId: header.id,
      store,
      provider,
      providerId: "text-only",
      model: "tiny",
      tools: [echo],
      permissions: new PermissionService({
        mode: "bypassPermissions",
        cwd: ws,
        roots: [ws],
      }),
      home,
      cwd: ws,
      workspaceRoots: [ws],
      systemPrompt: "test",
      capabilities: {
        streaming: true,
        tools: false,
        vision: false,
        jsonSchema: false,
        thinking: false,
      },
    });

    const result = await agent.runTurn("go", new AbortController().signal);
    expect(result.text).toBe("finished");
    expect(JSON.stringify(store.load(header.id).messages)).toContain("echo:hi");
  });
});
