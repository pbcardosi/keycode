import { z } from "zod";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";
import { KeycodeError } from "../util/errors.js";
import { capOutput } from "./shared.js";

export const WebFetchInput = z.object({
  url: z.string().min(1),
  prompt: z.string().optional(),
  max_chars: z.number().int().positive().max(200_000).optional(),
});

export type WebFetchInputType = z.infer<typeof WebFetchInput>;

interface ResolvedAddress {
  address: string;
  family: number;
}

export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

export interface WebFetchOptions {
  fetchImpl?: typeof fetch | undefined;
  allowHosts?: string[] | undefined;
  maxRedirects?: number | undefined;
  lookupImpl?: LookupFn | undefined;
}

function blockedHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "127.0.0.1" || normalized === "::1") return true;
  if (normalized === "169.254.169.254") return true;
  if (normalized.startsWith("169.254.")) return true;
  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  return false;
}

function blockedAddress(raw: string): boolean {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a = -1, b = -1, c = -1] = parts;
    if (a <= 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (family === 6) {
    if (address === "::" || address === "::1") return true;
    if (address.startsWith("fe8") || address.startsWith("fe9") || address.startsWith("fea") || address.startsWith("feb")) {
      return true;
    }
    if (address.startsWith("fc") || address.startsWith("fd")) return true;
    if (address.startsWith("ff")) return true;
    if (address.startsWith("::ffff:")) {
      const mapped = address.slice("::ffff:".length);
      if (isIP(mapped) === 4) return blockedAddress(mapped);
    }
    return false;
  }
  return true;
}

function validateUrl(raw: string, allowHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new KeycodeError("TOOL_INPUT_INVALID", `Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new KeycodeError("TOOL_INPUT_INVALID", `Only http and https URLs are supported, got ${url.protocol}`);
  }
  const allowed = allowHosts.includes(url.hostname);
  if (!allowed && blockedHost(url.hostname)) {
    throw new KeycodeError("SANDBOX_DENIED", `Blocked private or loopback address: ${url.hostname}`);
  }
  if (url.protocol === "http:" && !allowed) {
    url.protocol = "https:";
  }
  return url;
}

async function assertSafeUrl(
  url: URL,
  allowHosts: string[],
  lookup: LookupFn,
): Promise<void> {
  if (allowHosts.includes(url.hostname)) return;
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0) {
    if (blockedAddress(url.hostname)) {
      throw new KeycodeError("SANDBOX_DENIED", `Blocked private or loopback address: ${url.hostname}`);
    }
    return;
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(url.hostname);
  } catch (error) {
    throw new KeycodeError(
      "PROVIDER_UNAVAILABLE",
      `Cannot resolve ${url.hostname}: ${(error as Error).message}`,
    );
  }
  if (addresses.length === 0) {
    throw new KeycodeError("PROVIDER_UNAVAILABLE", `Cannot resolve ${url.hostname}`);
  }
  const unsafe = addresses.find((entry) => blockedAddress(entry.address));
  if (unsafe) {
    throw new KeycodeError(
      "SANDBOX_DENIED",
      `Blocked ${url.hostname}: resolves to private address ${unsafe.address}`,
    );
  }
}

export function htmlToMarkdown(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, body: string) => `\n${"#".repeat(Number(level))} ${body.trim()}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, body: string) => `\n- ${body.trim()}`)
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, body: string) => `[${body.replace(/<[^>]+>/g, "").trim()}](${href})`)
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return title.trim().length > 0 ? `# ${title.trim()}\n\n${text}` : text;
}

export function createWebFetchTool(options: WebFetchOptions = {}): Tool<WebFetchInputType> {
  return {
    name: "WebFetch",
    description:
      "Fetch a URL, convert HTML to markdown, and return the content. Blocks loopback, private, link-local, and metadata addresses.",
    input: WebFetchInput,
    readOnly: true,
    concurrency: "parallel",
    async execute(input: WebFetchInputType, ctx: ToolContext): Promise<ToolResult> {
      const allowHosts = options.allowHosts ?? [];
      const lookup: LookupFn =
        options.lookupImpl ??
        (async (hostname) => await dnsLookup(hostname, { all: true, verbatim: true }));
      let url: URL;
      try {
        url = validateUrl(input.url, allowHosts);
        await assertSafeUrl(url, allowHosts, lookup);
      } catch (error) {
        const keycode = error instanceof KeycodeError ? error : new KeycodeError("TOOL_INPUT_INVALID", String(error));
        return toolError(`${keycode.code}: ${keycode.userMessage}`, { code: keycode.code });
      }

      const fetchImpl = options.fetchImpl ?? fetch;
      const maxRedirects = options.maxRedirects ?? 5;
      let response: Response | null = null;
      try {
        for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
          response = await fetchImpl(url, {
            redirect: "manual",
            signal: ctx.signal,
            headers: { "user-agent": "keycode/0.1" },
          });
          const location = response.headers.get("location");
          if (
            location &&
            (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308)
          ) {
            url = validateUrl(new URL(location, url).toString(), allowHosts);
            await assertSafeUrl(url, allowHosts, lookup);
            continue;
          }
          break;
        }
      } catch (error) {
        const keycode = error instanceof KeycodeError ? error : new KeycodeError("PROVIDER_UNAVAILABLE", `Cannot fetch ${input.url}: ${(error as Error).message}`);
        return toolError(`${keycode.code}: ${keycode.userMessage}`, { code: keycode.code });
      }

      if (response === null) {
        return toolError("TOOL_TIMEOUT: too many redirects", { code: "TOOL_TIMEOUT" });
      }
      if (!response.ok) {
        return toolError(`Fetch failed with HTTP ${response.status}`, { code: "PROVIDER_UNAVAILABLE" });
      }
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      const markdown = contentType.includes("html") ? htmlToMarkdown(body) : body;
      const limited = markdown.slice(0, input.max_chars ?? 100_000);
      const prefix = input.prompt ? `Extraction prompt: ${input.prompt}\n\n` : "";
      const capped = capOutput(`${prefix}${limited}`, ctx, "webfetch");
      return toolOk(capped.text, { url: url.toString(), contentType, ...(capped.spilled === null ? {} : { spilled: capped.spilled }) });
    },
  };
}
