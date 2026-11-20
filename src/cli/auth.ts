import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { credentialStatus, removeStoredCredential, setStoredCredential } from "../providers/credentials.js";
import { getPreset, PRESETS } from "../providers/presets.js";
import { canonicalProviderId } from "../providers/registry.js";

export interface AuthOptions {
  home: string;
  env?: NodeJS.ProcessEnv | undefined;
  provider?: string | undefined;
  key?: string | undefined;
}

export async function authCommand(action: string, options: AuthOptions): Promise<number> {
  const env = options.env ?? process.env;
  const providerId = options.provider ? canonicalProviderId(options.provider) : undefined;

  if (action === "status") {
    const lines: string[] = [];
    for (const preset of Object.values(PRESETS)) {
      const stored = credentialStatus(options.home, preset.id);
      const envValue = preset.apiKeyEnv ? env[preset.apiKeyEnv] : undefined;
      const local = preset.local ? "local" : "";
      const state = envValue
        ? `env:${preset.apiKeyEnv}`
        : stored.configured
          ? `keychain:${stored.fingerprint}`
          : preset.local
            ? "no key needed"
            : "not configured";
      lines.push(`${preset.id.padEnd(12)} ${state}${local ? ` (${local})` : ""}`);
    }
    stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  if (!providerId) {
    stdout.write("Usage: keycode auth <set|status|logout> <provider>\n");
    return 2;
  }
  const preset = getPreset(providerId);
  if (!preset) {
    stdout.write(`Unknown provider: ${providerId}\n`);
    return 2;
  }

  if (action === "set") {
    if (preset.local) {
      stdout.write(`${providerId} is local and does not need a key.\n`);
      return 0;
    }
    let key = options.key;
    if (!key) {
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        key = (await rl.question(`API key for ${providerId}: `)).trim();
      } finally {
        rl.close();
      }
    }
    if (!key) {
      stdout.write("No key provided.\n");
      return 2;
    }
    setStoredCredential(options.home, providerId, key);
    const status = credentialStatus(options.home, providerId);
    stdout.write(`Stored key for ${providerId} (fingerprint ${status.fingerprint}).\n`);
    return 0;
  }

  if (action === "logout") {
    const removed = removeStoredCredential(options.home, providerId);
    stdout.write(removed ? `Removed stored key for ${providerId}.\n` : `No stored key for ${providerId}.\n`);
    return 0;
  }

  stdout.write(`Unknown auth action: ${action}. Use set, status, or logout.\n`);
  return 2;
}
