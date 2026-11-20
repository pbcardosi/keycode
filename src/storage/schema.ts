import { z } from "zod";
import { PERMISSION_MODES } from "../contracts/permissions.js";

export const ProviderConfigSchema = z
  .object({
    kind: z.enum(["openai-compatible", "anthropic", "fake"]).optional(),
    baseUrl: z.string().optional(),
    apiKeyEnv: z.string().nullable().optional(),
    apiKey: z.string().optional(),
    apiKeyHelper: z.string().optional(),
    helperTtlMs: z.number().int().positive().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    models: z.array(z.string()).optional(),
    defaultModel: z.string().optional(),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    capabilities: z
      .object({
        streaming: z.boolean().optional(),
        tools: z.boolean().optional(),
        vision: z.boolean().optional(),
        jsonSchema: z.boolean().optional(),
        thinking: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

export const PermissionsSchema = z
  .object({
    defaultMode: z.enum(PERMISSION_MODES as [string, ...string[]]).optional(),
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    ask: z.array(z.string()).optional(),
  })
  .passthrough();

export const SandboxSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowNetwork: z.boolean().optional(),
    allowedHosts: z.array(z.string()).optional(),
  })
  .passthrough();

export const SettingsSchema = z
  .object({
    $schema: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    fallbackModel: z.string().optional(),
    maxBudgetUsd: z.number().nonnegative().optional(),
    permissions: PermissionsSchema.optional(),
    providers: z.record(z.string(), ProviderConfigSchema).optional(),
    hooks: z.record(z.string(), z.unknown()).optional(),
    mcpServers: z.record(z.string(), z.unknown()).optional(),
    sandbox: SandboxSchema.optional(),
    statusLine: z
      .union([z.string(), z.object({ type: z.string(), command: z.string() })])
      .nullable()
      .optional(),
    outputStyle: z.string().optional(),
    theme: z.string().optional(),
    telemetry: z.union([z.boolean(), z.enum(["off", "local", "otlp"])]).optional(),
    autoCompact: z.boolean().optional(),
    autoCompactThreshold: z.number().int().positive().optional(),
    autoMemory: z.boolean().optional(),
    respectGitignore: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    includeCoAuthoredBy: z.boolean().optional(),
    cleanupPeriodDays: z.number().int().positive().optional(),
  })
  .passthrough();

export type Settings = z.infer<typeof SettingsSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
