import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../contracts/tool.js";
import { toolError, toolOk } from "../contracts/tool.js";

export interface BrowserDriver {
  navigate(url: string): Promise<{ title: string; html: string }>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  readDom(): Promise<string>;
  screenshot(): Promise<{ mime: string; data: string }>;
}

export interface BrowserToolOptions {
  driver: BrowserDriver;
  allowedDomains: string[];
}

export const BrowserInput = z.object({
  action: z.enum(["navigate", "click", "type", "read_dom", "screenshot"]),
  url: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
});

export type BrowserInputType = z.infer<typeof BrowserInput>;

function originAllowed(url: string, allowedDomains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowedDomains.some((domain) => {
      const normalized = domain.toLowerCase();
      return host === normalized || host.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

export function createBrowserTool(options: BrowserToolOptions): Tool<BrowserInputType> {
  return {
    name: "Browser",
    description:
      "Control a browser through a driver: navigate, click, type, read the DOM, and take screenshots. Origins must be on the allowlist.",
    input: BrowserInput,
    readOnly: false,
    concurrency: "exclusive",
    async execute(input: BrowserInputType, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.signal.aborted) return toolError("Browser action aborted.", { code: "ABORTED" });
      try {
        if (input.action === "navigate") {
          if (!input.url) return toolError("url is required for navigate.");
          if (!originAllowed(input.url, options.allowedDomains)) {
            return toolError(`SANDBOX_DENIED: origin is not allowed: ${input.url}`, {
              code: "SANDBOX_DENIED",
            });
          }
          const page = await options.driver.navigate(input.url);
          return toolOk(`Navigated to ${input.url}\nTitle: ${page.title}\n${page.html.slice(0, 4_000)}`, {
            url: input.url,
          });
        }
        if (input.action === "click") {
          if (!input.selector) return toolError("selector is required for click.");
          await options.driver.click(input.selector);
          return toolOk(`Clicked ${input.selector}`, { selector: input.selector });
        }
        if (input.action === "type") {
          if (!input.selector || input.text === undefined) {
            return toolError("selector and text are required for type.");
          }
          await options.driver.type(input.selector, input.text);
          return toolOk(`Typed into ${input.selector}`, { selector: input.selector });
        }
        if (input.action === "read_dom") {
          return toolOk(await options.driver.readDom(), {});
        }
        const screenshot = await options.driver.screenshot();
        return {
          ok: true,
          content: [
            { type: "text", text: `Screenshot (${screenshot.mime})` },
            { type: "image", mime: screenshot.mime, data: screenshot.data },
          ],
          metadata: { mime: screenshot.mime },
        };
      } catch (error) {
        return toolError(`Browser error: ${(error as Error).message}`, { code: "TOOL_UNSUPPORTED" });
      }
    },
  };
}
