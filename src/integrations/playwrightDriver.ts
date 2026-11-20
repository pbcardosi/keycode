import type { BrowserDriver } from "./browser.js";
import { KeycodeError } from "../util/errors.js";

export interface PlaywrightDriverOptions {
  channel?: string | undefined;
  executablePath?: string | undefined;
  headless?: boolean | undefined;
  timeoutMs?: number | undefined;
}

interface PlaywrightPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  content(): Promise<string>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, text: string, options?: { timeout?: number }): Promise<void>;
  screenshot(options: { type: string }): Promise<Buffer>;
}

interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightChromium {
  launch(options: Record<string, unknown>): Promise<PlaywrightBrowser>;
}

export async function createPlaywrightDriver(
  options: PlaywrightDriverOptions = {},
): Promise<BrowserDriver> {
  let browser: PlaywrightBrowser | null = null;
  let page: PlaywrightPage | null = null;
  let chromium: PlaywrightChromium;

  try {
    const module = (await import("playwright-core")) as { chromium?: PlaywrightChromium };
    if (!module.chromium) {
      throw new Error("playwright-core did not export chromium");
    }
    chromium = module.chromium;
  } catch (error) {
    throw new KeycodeError(
      "TOOL_UNSUPPORTED",
      `Browser automation requires playwright-core: ${(error as Error).message}`,
    );
  }

  const ensurePage = async (): Promise<PlaywrightPage> => {
    if (page) return page;
    try {
      browser = await chromium.launch({
        headless: options.headless ?? true,
        ...(options.executablePath === undefined
          ? { channel: options.channel ?? "chrome" }
          : { executablePath: options.executablePath }),
        args: ["--disable-gpu"],
      });
      page = await browser.newPage();
      return page;
    } catch (error) {
      await browser?.close().catch(() => undefined);
      browser = null;
      page = null;
      throw new KeycodeError(
        "TOOL_UNSUPPORTED",
        `Could not start Chrome: ${(error as Error).message}. Set browser.channel or browser.executablePath.`,
      );
    }
  };

  const activePage = async (): Promise<PlaywrightPage> => {
    if (!page) {
      throw new KeycodeError("TOOL_INPUT_INVALID", "Navigate before using this browser action.");
    }
    return page;
  };

  const timeout = options.timeoutMs ?? 20_000;

  return {
    async navigate(url) {
      const target = await ensurePage();
      await target.goto(url, { waitUntil: "domcontentloaded", timeout });
      return { title: await target.title(), html: await target.content() };
    },
    async click(selector) {
      await (await activePage()).click(selector, { timeout });
    },
    async type(selector, text) {
      await (await activePage()).fill(selector, text, { timeout });
    },
    async readDom() {
      return await (await activePage()).content();
    },
    async screenshot() {
      const buffer = await (await activePage()).screenshot({ type: "png" });
      return { mime: "image/png", data: buffer.toString("base64") };
    },
    async close() {
      await browser?.close().catch(() => undefined);
      browser = null;
      page = null;
    },
  };
}
