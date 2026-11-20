import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";
import { ArtifactStore, startPreview, type PreviewServer } from "../artifacts/store.js";
import { newId } from "../util/ids.js";
import { KeycodeError } from "../util/errors.js";

export const ArtifactInput = z.object({
  action: z.enum(["create", "update", "list", "inspect", "comment", "set_data", "preview"]),
  id: z.string().optional(),
  name: z.string().optional(),
  html: z.string().optional(),
  version: z.number().int().positive().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  value: z.unknown().optional(),
});

export type ArtifactInputType = z.infer<typeof ArtifactInput>;

export interface ArtifactToolOptions {
  store: ArtifactStore;
  allowPreview?: boolean | undefined;
}

const MAX_HTML_BYTES = 500_000;

function htmlError(html: string): string | null {
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) {
    return `HTML exceeds the ${MAX_HTML_BYTES} byte artifact limit.`;
  }
  return null;
}

export function createArtifactTool(
  options: ArtifactToolOptions,
): Tool<ArtifactInputType> & { stop(): void } {
  let preview: PreviewServer | null = null;
  let previewToken = "";

  const previewFor = async (id: string, version?: number): Promise<string> => {
    if (!preview) {
      previewToken = newId("preview");
      preview = await startPreview(options.store, { token: previewToken });
    }
    const path = version === undefined ? "" : `/${version}`;
    return `${preview.url}/artifacts/${encodeURIComponent(id)}${path}?token=${encodeURIComponent(previewToken)}`;
  };

  return {
    name: "Artifact",
    description:
      "Create, update, list, inspect, comment on, or preview versioned local HTML artifacts. Previews bind to loopback and require a token.",
    input: ArtifactInput,
    readOnly: false,
    concurrency: "exclusive",
    stop(): void {
      if (preview) {
        void preview.close();
        preview = null;
      }
    },
    async execute(input: ArtifactInputType, _ctx: ToolContext): Promise<ToolResult> {
      try {
        if (input.action === "create") {
          if (!input.name || input.html === undefined) {
            return toolError("create requires name and html.", { code: "TOOL_INPUT_INVALID" });
          }
          const invalid = htmlError(input.html);
          if (invalid) return toolError(invalid, { code: "TOOL_INPUT_INVALID" });
          const artifact = options.store.create(input.name, input.html);
          return toolOk(
            `Created artifact ${artifact.id} (${input.name}), version 1.`,
            { id: artifact.id, version: 1, name: input.name },
          );
        }

        if (input.action === "list") {
          const artifacts = options.store.list();
          if (artifacts.length === 0) return toolOk("No artifacts.");
          return toolOk(
            artifacts
              .map(
                (artifact) =>
                  `${artifact.id} · ${artifact.name} · version ${artifact.latestVersion} · ${artifact.createdAt}`,
              )
              .join("\n"),
            { count: artifacts.length },
          );
        }

        if (!input.id) {
          return toolError(`${input.action} requires id.`, { code: "TOOL_INPUT_INVALID" });
        }

        if (input.action === "update") {
          if (input.html === undefined) {
            return toolError("update requires html.", { code: "TOOL_INPUT_INVALID" });
          }
          const invalid = htmlError(input.html);
          if (invalid) return toolError(invalid, { code: "TOOL_INPUT_INVALID" });
          const artifact = options.store.publish(input.id, input.html);
          const version = artifact.versions.at(-1)?.version ?? 1;
          return toolOk(`Published artifact ${artifact.id}, version ${version}.`, {
            id: artifact.id,
            version,
          });
        }

        if (input.action === "inspect") {
          const inspected = options.store.inspect(input.id, input.version);
          if (!inspected) return toolError(`Artifact not found: ${input.id}`, { code: "TOOL_INPUT_INVALID" });
          return toolOk(JSON.stringify(inspected, null, 2), inspected);
        }

        if (input.action === "comment") {
          if (input.version === undefined || input.text === undefined) {
            return toolError("comment requires version and text.", { code: "TOOL_INPUT_INVALID" });
          }
          if (!options.store.comment(input.id, input.version, input.text)) {
            return toolError(`Artifact or version not found: ${input.id}@${input.version}`, {
              code: "TOOL_INPUT_INVALID",
            });
          }
          return toolOk(`Commented on ${input.id}@${input.version}.`);
        }

        if (input.action === "set_data") {
          if (input.version === undefined || input.key === undefined) {
            return toolError("set_data requires version and key.", { code: "TOOL_INPUT_INVALID" });
          }
          if (!options.store.setData(input.id, input.version, input.key, input.value)) {
            return toolError(`Artifact or version not found: ${input.id}@${input.version}`, {
              code: "TOOL_INPUT_INVALID",
            });
          }
          return toolOk(`Set ${input.key} on ${input.id}@${input.version}.`);
        }

        if (options.allowPreview === false) {
          return toolError("Artifact previews are disabled.", { code: "TOOL_UNSUPPORTED" });
        }
        const version = input.version ?? options.store.get(input.id)?.version;
        if (version === undefined) {
          return toolError(`Artifact not found: ${input.id}`, { code: "TOOL_INPUT_INVALID" });
        }
        const url = await previewFor(input.id, version);
        return toolOk(`Preview: ${url}`, { url, id: input.id, version });
      } catch (error) {
        const keycode = error instanceof KeycodeError ? error : null;
        return toolError(
          keycode ? `${keycode.code}: ${keycode.userMessage}` : (error as Error).message,
          { code: keycode?.code ?? "TOOL_INPUT_INVALID" },
        );
      }
    },
  };
}
