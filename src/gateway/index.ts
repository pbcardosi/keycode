import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface GatewayAuditEntry {
  timestamp: string;
  tokenPrefix: string;
  target: string;
  status: number;
  allowed: boolean;
  reason?: string | undefined;
}

export interface GatewayOptions {
  apiKey: string;
  clientTokens: string[];
  rateLimit?: { requests: number; windowMs: number } | undefined;
  allowPrivate?: boolean | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface GatewayServer {
  url: string;
  port: number;
  audit: GatewayAuditEntry[];
  close(): Promise<void>;
}

function isPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") return true;
  if (normalized === "169.254.169.254" || normalized.startsWith("169.254.")) return true;
  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  return false;
}

export async function startGateway(options: GatewayOptions): Promise<GatewayServer> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const audit: GatewayAuditEntry[] = [];
  const buckets = new Map<string, { count: number; reset: number }>();

  const server: Server = createServer(async (req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const entry: GatewayAuditEntry = {
      timestamp: new Date().toISOString(),
      tokenPrefix: token.slice(0, 4),
      target: "",
      status: 0,
      allowed: false,
    };

    if (!options.clientTokens.includes(token)) {
      res.statusCode = 401;
      res.end("unauthorized");
      audit.push({ ...entry, status: 401, reason: "unauthorized" });
      return;
    }

    if (options.rateLimit) {
      const now = Date.now();
      const bucket = buckets.get(token) ?? { count: 0, reset: now + options.rateLimit.windowMs };
      if (now >= bucket.reset) {
        bucket.count = 0;
        bucket.reset = now + options.rateLimit.windowMs;
      }
      bucket.count += 1;
      buckets.set(token, bucket);
      if (bucket.count > options.rateLimit.requests) {
        res.statusCode = 429;
        res.end("rate limited");
        audit.push({ ...entry, status: 429, reason: "rate limited" });
        return;
      }
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const targetRaw = url.searchParams.get("url");
    if (!targetRaw) {
      res.statusCode = 400;
      res.end("missing url");
      return;
    }
    let target: URL;
    try {
      target = new URL(targetRaw);
    } catch {
      res.statusCode = 400;
      res.end("invalid url");
      return;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      res.statusCode = 400;
      res.end("unsupported protocol");
      return;
    }
    if (options.allowPrivate !== true && isPrivateHost(target.hostname)) {
      res.statusCode = 403;
      res.end("blocked private target");
      audit.push({ ...entry, target: target.toString(), status: 403, reason: "private target" });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const body = Buffer.concat(chunks);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string" && !["host", "authorization", "content-length"].includes(key)) {
        headers[key] = value;
      }
    }
    headers.authorization = `Bearer ${options.apiKey}`;

    try {
      const init: RequestInit = { method: req.method ?? "GET", headers };
      if (req.method !== "GET" && req.method !== "HEAD") init.body = new Uint8Array(body);
      const upstream = await fetchImpl(target, init);
      res.statusCode = upstream.status;
      upstream.headers.forEach((value, key) => {
        if (!["content-encoding", "transfer-encoding"].includes(key)) res.setHeader(key, value);
      });
      res.end(await upstream.text());
      audit.push({ ...entry, target: target.toString(), status: upstream.status, allowed: true });
    } catch (error) {
      res.statusCode = 502;
      res.end("upstream error");
      audit.push({
        ...entry,
        target: target.toString(),
        status: 502,
        reason: (error as Error).message,
      });
    }
  });

  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    audit,
    close: () =>
      new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      }),
  };
}
