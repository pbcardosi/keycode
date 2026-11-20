import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyUpdate, checkForUpdate, verifyChecksum, type ReleaseInfo } from "../../dist/updates/index.js";

describe("T-U8: updates and install", () => {
  it("checks the feed and rolls back on a checksum mismatch", async () => {
    const bytes = Buffer.from("binary-release");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const release: ReleaseInfo = {
      version: "1.1.0",
      channel: "stable",
      url: "https://example.test/app",
      sha256: sha,
    };
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes("feed")) {
        return new Response(JSON.stringify({ releases: [release] }), { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    };

    const check = await checkForUpdate({
      feedUrl: "https://example.test/feed",
      channel: "stable",
      currentVersion: "1.0.0",
      fetchImpl,
    });
    expect(check.updateAvailable).toBe(true);
    expect(check.release?.version).toBe("1.1.0");

    let written = false;
    let restored = false;
    const ok = await applyUpdate({
      release,
      fetchImpl,
      write: () => {
        written = true;
      },
      restore: () => {
        restored = true;
      },
    });
    expect(ok.updated).toBe(true);
    expect(written).toBe(true);
    expect(restored).toBe(false);

    const bad = await applyUpdate({
      release: { ...release, sha256: "0".repeat(64) },
      fetchImpl,
      write: () => {
        throw new Error("must not write");
      },
      restore: () => {
        restored = true;
      },
    });
    expect(bad.updated).toBe(false);
    expect(bad.rolledBack).toBe(true);
    expect(bad.error).toContain("checksum");
    expect(restored).toBe(true);
    expect(verifyChecksum(bytes, sha)).toBe(true);
  });
});
