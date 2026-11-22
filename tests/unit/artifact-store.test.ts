import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../dist/artifacts/store.js";
import { makeTempRoot } from "../helpers.js";

describe("ArtifactStore.remove", () => {
  it("deletes the artifact and its backing file", () => {
    const root = join(makeTempRoot(), "artifacts");
    const store = new ArtifactStore(root);
    const artifact = store.create("demo", "<h1>hi</h1>");
    const file = join(root, `${artifact.id}.json`);

    expect(existsSync(file)).toBe(true);
    expect(store.list()).toHaveLength(1);

    expect(store.remove(artifact.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(existsSync(file)).toBe(false);

    expect(store.remove(artifact.id)).toBe(false);
  });
});
