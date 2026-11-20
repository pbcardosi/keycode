import { describe, expect, it } from "vitest";
import { ArtifactStore, startPreview } from "../../dist/artifacts/store.js";

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
});
