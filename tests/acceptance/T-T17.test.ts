import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LspClient } from "../../dist/lsp/client.js";
import { createLspTool } from "../../dist/tools/lsp.js";
import { createAgentSetup } from "../../dist/app/factory.js";
import {
  makeHome,
  makeToolCtx,
  makeWorkspace,
  textOf,
  writeFakeLspServer,
  writeJson,
} from "../helpers.js";

describe("T-T17: LSP", () => {
  it("starts a server, publishes diagnostics, and answers hover, definition, and references", async () => {
    const ws = makeWorkspace();
    const script = join(ws, "lsp-server.mjs");
    writeFakeLspServer(script);
    const client = new LspClient({
      command: process.execPath,
      args: [script],
      cwd: ws,
      rootUri: "file:///",
      timeoutMs: 5000,
    });
    await client.start();
    await client.initialize();
    client.openDocument("file:///test.ts", "typescript", "const x = 1;");

    const diagnostics = await client.waitForDiagnostics("file:///test.ts");
    expect(diagnostics[0]?.message).toBe("fake diagnostic");

    const hover = (await client.hover("file:///test.ts", 0, 1)) as { contents: { value: string } };
    expect(hover.contents.value).toBe("hover text");

    const definition = (await client.definition("file:///test.ts", 0, 1)) as { uri: string };
    expect(definition.uri).toBe("file:///def.ts");

    const references = (await client.references("file:///test.ts", 0, 1)) as Array<{ uri: string }>;
    expect(references[0]?.uri).toBe("file:///ref.ts");

    await expect(client.request("unknown/method", {}, 200)).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });
    client.stop();
  });

  it("exposes LSP actions as a tool and loads servers from settings", async () => {
    const ws = makeWorkspace();
    const home = makeHome();
    const script = join(ws, "lsp-server.mjs");
    writeFakeLspServer(script);
    writeFileSync(join(ws, "test.ts"), "const x = 1;\n");

    const tool = createLspTool({
      servers: {
        typescript: { command: process.execPath, args: [script] },
      },
      cwd: ws,
      roots: [ws],
      timeoutMs: 5_000,
    });
    const ctx = makeToolCtx({ cwd: ws, home });
    try {
      const diagnostics = await tool.execute({ action: "diagnostics", file: "test.ts" }, ctx);
      expect(diagnostics.ok).toBe(true);
      expect(textOf(diagnostics)).toContain("test.ts:1:1 error: fake diagnostic");

      const hover = await tool.execute(
        { action: "hover", file: "test.ts", line: 1, character: 2 },
        ctx,
      );
      expect(textOf(hover)).toContain("hover text");

      const definition = await tool.execute(
        { action: "definition", file: "test.ts", line: 1, character: 2 },
        ctx,
      );
      expect(textOf(definition)).toContain("def.ts");

      const missingPosition = await tool.execute(
        { action: "definition", file: "test.ts" },
        ctx,
      );
      expect(missingPosition.ok).toBe(false);

      const outside = await tool.execute(
        { action: "diagnostics", file: "../outside.ts" },
        ctx,
      );
      expect(outside.ok).toBe(false);
      expect(textOf(outside)).toContain("PERMISSION_DENIED");
    } finally {
      tool.stop();
    }

    writeJson(join(home, "settings.json"), {
      lsp: { typescript: { command: process.execPath, args: [script] } },
    });
    const setup = await createAgentSetup({
      cwd: ws,
      home,
      provider: "fake",
      trust: true,
      env: {
        ...process.env,
        KEYCODE_HOME: home,
        KEYCODE_PROVIDER: "fake",
        KEYCODE_FAKE_SCRIPT: JSON.stringify({
          turns: [
            [
              {
                type: "tool_call",
                id: "lsp1",
                name: "LSP",
                input: { action: "diagnostics", file: "test.ts" },
              },
              { type: "done", stopReason: "tool_use" },
            ],
            [{ type: "text", delta: "checked" }, { type: "done", stopReason: "end_turn" }],
          ],
        }),
      },
    });
    try {
      expect(setup.toolNames).toContain("LSP");
      const result = await setup.agent.runTurn("check diagnostics", new AbortController().signal);
      expect(result.stopReason).toBe("end_turn");
      expect(JSON.stringify(setup.store.load(setup.sessionId).messages)).toContain("fake diagnostic");
    } finally {
      setup.lsp?.stop();
      await Promise.all(setup.mcpClients.map((client) => client.close()));
    }
  });
});
