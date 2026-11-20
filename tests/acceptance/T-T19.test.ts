import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore, startPreview } from "../../dist/artifacts/store.js";
import { createArtifactTool } from "../../dist/tools/artifact.js";
import { makeHome, makeToolCtx, textOf } from "../helpers.js";

describe("T-T19: artifacts", () => {
  it("publishes versions and serves a local-only token-gated preview", async () => {
    const store = new ArtifactStore();
    const artifact = store.create("demo", "<h1>v1</h1>");
    expect(artifact.versions).toHaveLength(1);

    store.publish(artifact.id, "<h1>v2</h1>");
    expect(store.get(artifact.id)?.version).toBe(2);
    expect(store.get(artifact.id)?.html).toContain("v2");

    const preview = await startPreview(store, { token: "secret" });
    expect(preview.address).toBe("127.0.0.1");
    const authorized = await fetch(`${preview.url}/artifacts/${artifact.id}?token=secret`);
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toContain("v2");

    const unauthorized = await fetch(`${preview.url}/artifacts/${artifact.id}`);
    expect(unauthorized.status).toBe(403);

    expect(store.comment(artifact.id, 2, "nice")).toBe(true);
    expect(store.setData(artifact.id, 2, "k", "v")).toBe(true);
    const inspected = store.inspect(artifact.id, 2);
    expect(inspected?.comments).toEqual(["nice"]);
    expect((inspected?.data as Record<string, unknown>).k).toBe("v");

    await preview.close();
  });

  it("exposes artifact create, update, inspect, and preview as a tool", async () => {
    const home = makeHome();
    const store = new ArtifactStore(join(home, "artifacts"));
    const tool = createArtifactTool({ store });
    const ctx = makeToolCtx({ cwd: home, home });
    try {
      const created = await tool.execute(
        { action: "create", name: "report", html: "<h1>v1</h1>" },
        ctx,
      );
      expect(created.ok).toBe(true);
      const id = (created.metadata as { id?: string } | undefined)?.id;
      expect(id).toBeDefined();

      const updated = await tool.execute(
        { action: "update", id, html: "<h1>v2</h1>" },
        ctx,
      );
      expect(updated.ok).toBe(true);
      expect((updated.metadata as { version?: number } | undefined)?.version).toBe(2);

      const listed = await tool.execute({ action: "list" }, ctx);
      expect(textOf(listed)).toContain("report");

      const inspected = await tool.execute({ action: "inspect", id }, ctx);
      expect(textOf(inspected)).toContain('"version": 2');

      const preview = await tool.execute({ action: "preview", id }, ctx);
      expect(preview.ok).toBe(true);
      const url = (preview.metadata as { url?: string } | undefined)?.url ?? "";
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("v2");

      const unauthorized = await fetch(url.replace(/\?token=.*$/, ""));
      expect(unauthorized.status).toBe(403);
    } finally {
      tool.stop();
    }
  });
});
