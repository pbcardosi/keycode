import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  credentialStatus,
  resetHelperCache,
  resolveCredential,
  setStoredCredential,
} from "../../dist/providers/credentials.js";
import { fingerprint } from "../../dist/util/ids.js";
import { makeHome, writeText } from "../helpers.js";

const SLEEP = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

describe("T-P6: credentials, apiKeyHelper, and masked status", () => {
  it("uses a helper, stores keys, and masks status fingerprints", () => {
    const home = makeHome();
    const file = join(home, "token.txt");
    writeText(file, "helper-key-value-1234567890");
    resetHelperCache();
    const helper = `node -e "console.log(require('fs').readFileSync('${file.replaceAll("\\", "/")}', 'utf8').trim())"`;

    const viaHelper = resolveCredential({ providerId: "gem", home, apiKeyHelper: helper, env: {} });
    expect(viaHelper.key).toBe("helper-key-value-1234567890");
    expect(viaHelper.source).toBe("helper");

    setStoredCredential(home, "gem", "stored-key-abc");
    const status = credentialStatus(home, "gem");
    expect(status.configured).toBe(true);
    expect(status.fingerprint).toBe(fingerprint("stored-key-abc"));
    expect(status.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(status.fingerprint).not.toContain("stored-key-abc");

    const none = credentialStatus(home, "missing");
    expect(none.configured).toBe(false);
  });

  it("rotates helper keys after the TTL", async () => {
    const home = makeHome();
    const file = join(home, "token.txt");
    writeText(file, "key-A");
    resetHelperCache();
    const helper = `node -e "console.log(require('fs').readFileSync('${file.replaceAll("\\", "/")}', 'utf8').trim())"`;

    const first = resolveCredential({ providerId: "rot", home, apiKeyHelper: helper, helperTtlMs: 40, env: {} });
    expect(first.key).toBe("key-A");
    writeText(file, "key-B");
    const second = resolveCredential({ providerId: "rot", home, apiKeyHelper: helper, helperTtlMs: 40, env: {} });
    expect(second.key).toBe("key-A");
    await SLEEP(60);
    const third = resolveCredential({ providerId: "rot", home, apiKeyHelper: helper, helperTtlMs: 40, env: {} });
    expect(third.key).toBe("key-B");
    resetHelperCache();
  });
});
