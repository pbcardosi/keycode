import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KeycodeError } from "../util/errors.js";
import { ensureDir } from "../util/fsx.js";
import { newId } from "../util/ids.js";

export interface ArtifactVersion {
  version: number;
  html: string;
  createdAt: string;
  comments: string[];
  data: Record<string, unknown>;
}

export interface Artifact {
  id: string;
  name: string;
  versions: ArtifactVersion[];
}

export interface ArtifactSummary {
  id: string;
  name: string;
  latestVersion: number;
  createdAt: string;
}

export class ArtifactStore {
  private readonly artifacts = new Map<string, Artifact>();
  private readonly root: string | undefined;

  constructor(root?: string) {
    this.root = root;
  }

  private fileFor(id: string): string | null {
    return this.root === undefined ? null : join(this.root, `${id}.json`);
  }

  private save(artifact: Artifact): void {
    if (this.root === undefined) return;
    ensureDir(this.root);
    const file = this.fileFor(artifact.id);
    if (file) writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`);
  }

  private load(id: string): Artifact | null {
    const existing = this.artifacts.get(id);
    if (existing) return existing;
    const file = this.fileFor(id);
    if (!file || !existsSync(file)) return null;
    try {
      const artifact = JSON.parse(readFileSync(file, "utf8")) as Artifact;
      this.artifacts.set(id, artifact);
      return artifact;
    } catch {
      return null;
    }
  }

  create(name: string, html: string): Artifact {
    const artifact: Artifact = {
      id: newId("artifact"),
      name,
      versions: [
        {
          version: 1,
          html,
          createdAt: new Date().toISOString(),
          comments: [],
          data: {},
        },
      ],
    };
    this.artifacts.set(artifact.id, artifact);
    this.save(artifact);
    return artifact;
  }

  publish(id: string, html: string): Artifact {
    const artifact = this.load(id);
    if (!artifact) throw new KeycodeError("CONFIG_INVALID", `Artifact not found: ${id}`);
    artifact.versions.push({
      version: artifact.versions.length + 1,
      html,
      createdAt: new Date().toISOString(),
      comments: [],
      data: {},
    });
    this.save(artifact);
    return artifact;
  }

  get(id: string, version?: number): ArtifactVersion | null {
    const artifact = this.load(id);
    if (!artifact) return null;
    const target = version ?? artifact.versions.at(-1)?.version;
    return artifact.versions.find((entry) => entry.version === target) ?? null;
  }

  list(): ArtifactSummary[] {
    if (this.root !== undefined && existsSync(this.root)) {
      for (const file of readdirSync(this.root)) {
        if (file.endsWith(".json")) this.load(file.replace(/\.json$/, ""));
      }
    }
    return [...this.artifacts.values()].map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      latestVersion: artifact.versions.length,
      createdAt: artifact.versions[0]?.createdAt ?? "",
    }));
  }

  comment(id: string, version: number, text: string): boolean {
    const target = this.get(id, version);
    const artifact = this.load(id);
    if (!target || !artifact) return false;
    target.comments.push(text);
    this.save(artifact);
    return true;
  }

  setData(id: string, version: number, key: string, value: unknown): boolean {
    const target = this.get(id, version);
    const artifact = this.load(id);
    if (!target || !artifact) return false;
    target.data[key] = value;
    this.save(artifact);
    return true;
  }

  inspect(id: string, version?: number): Record<string, unknown> | null {
    const target = this.get(id, version);
    if (!target) return null;
    return {
      version: target.version,
      bytes: Buffer.byteLength(target.html),
      comments: [...target.comments],
      data: { ...target.data },
    };
  }
}

export interface PreviewOptions {
  token?: string | undefined;
}

export interface PreviewServer {
  url: string;
  port: number;
  address: string;
  close(): Promise<void>;
}

export async function startPreview(
  store: ArtifactStore,
  options: PreviewOptions = {},
): Promise<PreviewServer> {
  const token = options.token ?? "preview";
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.searchParams.get("token") !== token) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
    const match = /^\/artifacts\/([^/]+)(?:\/(\d+))?$/.exec(url.pathname);
    if (!match || !match[1]) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const version = match[2] === undefined ? undefined : Number(match[2]);
    const artifact = store.get(match[1], version);
    if (!artifact) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(artifact.html);
  });

  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    address: address.address,
    close: () =>
      new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      }),
  };
}
