import { isInside } from "../util/paths.js";

export interface SandboxPolicy {
  roots: string[];
  allowNetwork: boolean;
  allowedHosts: string[];
  platform: NodeJS.Platform;
}

export interface SandboxDecision {
  allowed: boolean;
  reason?: string | undefined;
}

export interface SandboxPolicyOptions {
  roots: string[];
  allowNetwork?: boolean | undefined;
  allowedHosts?: string[] | undefined;
  platform?: NodeJS.Platform | undefined;
}

export function createSandboxPolicy(options: SandboxPolicyOptions): SandboxPolicy {
  return {
    roots: options.roots,
    allowNetwork: options.allowNetwork ?? false,
    allowedHosts: options.allowedHosts ?? [],
    platform: options.platform ?? process.platform,
  };
}

export function checkWrite(policy: SandboxPolicy, path: string): SandboxDecision {
  if (policy.roots.some((root) => isInside(root, path))) return { allowed: true };
  return { allowed: false, reason: `${path} is outside the sandbox roots` };
}

export function checkNetwork(policy: SandboxPolicy, host: string): SandboxDecision {
  if (policy.allowNetwork) return { allowed: true };
  const normalized = host.toLowerCase();
  if (policy.allowedHosts.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`))) {
    return { allowed: true };
  }
  return { allowed: false, reason: `Network access to ${host} is blocked by the sandbox` };
}

export function sandboxSupported(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "linux";
}

export function sandboxFallbackWarning(platform: NodeJS.Platform): string | null {
  if (sandboxSupported(platform)) return null;
  return "Sandboxing is not fully supported on this platform; filesystem checks still apply, network and process limits use a documented fallback.";
}
