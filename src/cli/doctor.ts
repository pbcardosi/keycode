import { copyFileSync, existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadSettings, permissionSettings, settingsCandidatePaths } from "../storage/settings.js";
import { SettingsSchema } from "../storage/schema.js";
import { managedSettingsPath, keycodeHome } from "../util/paths.js";
import { createProvider, availableProviderIds } from "../providers/registry.js";
import { KeycodeError } from "../util/errors.js";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  cwd: string;
  home?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  fix?: boolean | undefined;
  provider?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

function checkNode(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 22
    ? { name: "node", status: "ok", detail: process.versions.node }
    : { name: "node", status: "fail", detail: `${process.versions.node} is below the required 22` };
}

function checkHome(home: string, fix: boolean): DoctorCheck {
  if (existsSync(home)) return { name: "home", status: "ok", detail: home };
  if (fix) {
    try {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, ".keep"), "");
      return { name: "home", status: "ok", detail: `created ${home}` };
    } catch (error) {
      return { name: "home", status: "fail", detail: `cannot create ${home}: ${(error as Error).message}` };
    }
  }
  return { name: "home", status: "warn", detail: `${home} does not exist; run with --fix` };
}

function checkGit(cwd: string): DoctorCheck {
  const result = spawnSync("git", ["--version"], { cwd, encoding: "utf8", windowsHide: true, timeout: 5_000 });
  return result.status === 0
    ? { name: "git", status: "ok", detail: result.stdout.trim() }
    : { name: "git", status: "warn", detail: "git is not available; checkpoints still work" };
}

function checkRipgrep(): DoctorCheck {
  const result = spawnSync("rg", ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
  return result.status === 0
    ? { name: "ripgrep", status: "ok", detail: result.stdout.split(/\r?\n/)[0] ?? "rg" }
    : { name: "ripgrep", status: "warn", detail: "rg is not installed; the built-in search is used" };
}

async function ollamaReachable(fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl("http://127.0.0.1:11434/v1/models", {
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function repairSettingsFiles(cwd: string, home: string, env: NodeJS.ProcessEnv): string[] {
  const repaired: string[] = [];
  for (const path of settingsCandidatePaths({ cwd, home, env })) {
    if (!existsSync(path)) continue;
    let valid = false;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      valid = SettingsSchema.safeParse(raw).success;
    } catch {
      valid = false;
    }
    if (valid) continue;
    try {
      copyFileSync(path, `${path}.bak`);
      writeFileSync(path, "{}\n");
      repaired.push(path);
    } catch {
      // Leave unreadable files in place.
    }
  }
  return repaired;
}

function checkDisk(home: string): DoctorCheck {
  try {
    const stats = statfsSync(home);
    const free = Number(stats.bsize) * Number(stats.bavail);
    const mb = Math.round(free / 1024 / 1024);
    return mb > 100
      ? { name: "disk", status: "ok", detail: `${mb} MB free` }
      : { name: "disk", status: "warn", detail: `only ${mb} MB free` };
  } catch {
    return { name: "disk", status: "warn", detail: "could not read free disk space" };
  }
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const home = options.home ?? keycodeHome(env);
  const checks: DoctorCheck[] = [];
  checks.push(checkNode());
  checks.push(checkHome(home, options.fix === true));
  checks.push(checkGit(options.cwd));
  checks.push(checkRipgrep());
  checks.push(checkDisk(existsSync(home) ? home : options.cwd));

  if (options.fix === true) {
    const repaired = repairSettingsFiles(options.cwd, home, env);
    if (repaired.length > 0) {
      checks.push({ name: "repair", status: "ok", detail: `repaired ${repaired.join(", ")}` });
    }
  }

  const loaded = loadSettings({ cwd: options.cwd, home, env });
  const invalidSettings = loaded.warnings.some(
    (warning) => warning.includes("Ignoring invalid") || warning.includes("unreadable"),
  );
  if (loaded.warnings.length > 0) {
    checks.push({
      name: "settings",
      status: invalidSettings ? "fail" : "warn",
      detail: loaded.warnings.join("; "),
    });
  } else {
    checks.push({
      name: "settings",
      status: "ok",
      detail: `${loaded.sources.length} file(s); mode ${permissionSettings(loaded.settings).defaultMode}`,
    });
  }

  checks.push({
    name: "permissions",
    status: "ok",
    detail: `mode ${permissionSettings(loaded.settings).defaultMode}`,
  });
  const mcpServers = Object.keys(loaded.settings.mcpServers ?? {});
  checks.push({
    name: "mcp",
    status: mcpServers.length > 0 ? "ok" : "warn",
    detail: mcpServers.length > 0 ? `${mcpServers.length} server(s)` : "no MCP servers configured",
  });

  const managed = managedSettingsPath(env);
  checks.push({
    name: "managed policy",
    status: existsSync(managed) ? "ok" : "warn",
    detail: existsSync(managed) ? managed : "no managed settings file",
  });

  let providerId = options.provider ?? env.KEYCODE_PROVIDER ?? loaded.settings.provider;
  if (providerId === undefined) {
    if (await ollamaReachable(options.fetchImpl ?? fetch)) {
      providerId = "ollama";
    } else if (env.GEMINI_API_KEY) {
      providerId = "gemini";
    } else if (env.GROQ_API_KEY) {
      providerId = "groq";
    } else if (env.OPENROUTER_API_KEY) {
      providerId = "openrouter";
    }
  }

  if (!providerId) {
    checks.push({
      name: "provider",
      status: "warn",
      detail: `No provider selected. Configure one of: ${availableProviderIds().join(", ")}`,
    });
  } else {
    try {
      const resolved = createProvider({
        id: providerId,
        home,
        settings: loaded.settings,
        env,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      });
      const started = Date.now();
      try {
        const models = await resolved.provider.listModels();
        checks.push({
          name: "provider",
          status: "ok",
          detail: `${providerId}: ${models.length} model(s), ${Date.now() - started} ms`,
        });
      } catch (error) {
        checks.push({
          name: "provider",
          status: "fail",
          detail: `${providerId}: ${(error as Error).message}`,
        });
      }
    } catch (error) {
      const keycode = error instanceof KeycodeError ? error : null;
      checks.push({
        name: "provider",
        status: keycode?.code === "PROVIDER_AUTH" ? "warn" : "fail",
        detail: keycode ? `${keycode.code}: ${keycode.userMessage}` : String(error),
      });
    }
  }

  const ok = checks.every((check) => check.status !== "fail");
  return { ok, checks };
}

export function formatDoctor(report: DoctorReport): string {
  return report.checks
    .map((check) => `${check.status === "ok" ? "OK  " : check.status === "warn" ? "WARN" : "FAIL"}  ${check.name.padEnd(16)} ${check.detail}`)
    .join("\n");
}
