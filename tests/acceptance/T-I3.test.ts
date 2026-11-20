import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IdeBridge } from "../../dist/integrations/ide.js";
import { connectWebSocket, makeHome, makeWorkspace } from "../helpers.js";

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

describe("T-I3: IDE bridge", () => {
  it("writes a discovery file, accepts a selection, and requests a diff", async () => {
    const home = makeHome();
    const ws = makeWorkspace();
    const bridge = new IdeBridge({ home, cwd: ws, token: "ide-token" });
    const start = await bridge.start();
    expect(start.port).toBeGreaterThan(0);

    const discovery = JSON.parse(readFileSync(start.discoveryFile, "utf8")) as {
      port: number;
      token: string;
    };
    expect(discovery.port).toBe(start.port);
    expect(discovery.token).toBe("ide-token");

    const client = await connectWebSocket(start.port);
    await sleep(100);
    client.send(
      JSON.stringify({
        type: "selection",
        selection: { file: "src/a.ts", text: "const x = 1;" },
      }),
    );
    await sleep(150);
    expect(bridge.selectionContext()).toContain("const x = 1;");

    const received = client.nextMessage(3000);
    expect(bridge.requestDiff("old", "new")).toBe(true);
    const message = JSON.parse(await received) as { type: string; modified: string };
    expect(message.type).toBe("diff");
    expect(message.modified).toBe("new");

    client.close();
    await bridge.stop();
  });
});
