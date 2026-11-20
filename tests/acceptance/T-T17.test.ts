import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LspClient } from "../../dist/lsp/client.js";
import { makeWorkspace, writeFakeLspServer } from "../helpers.js";

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
});
