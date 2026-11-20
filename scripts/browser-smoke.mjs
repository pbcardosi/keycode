import { createServer } from "node:http";
import { createBrowserTool } from "../dist/integrations/browser.js";
import { createPlaywrightDriver } from "../dist/integrations/playwrightDriver.js";

const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(
    `<!doctype html><html><head><title>KeyCode browser smoke</title></head>
     <body><button id="go" onclick="document.getElementById('status').textContent='clicked'">Go</button>
     <p id="status">idle</p></body></html>`,
  );
});
await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const port = server.address().port;

const driver = await createPlaywrightDriver({ headless: true, channel: "chrome" });
const tool = createBrowserTool({ driver, allowedDomains: ["127.0.0.1"] });
const context = { signal: new AbortController().signal };

try {
  const navigated = await tool.execute({ action: "navigate", url: `http://127.0.0.1:${port}/` }, context);
  if (!navigated.ok || !JSON.stringify(navigated.content).includes("KeyCode browser smoke")) {
    throw new Error(`navigate failed: ${JSON.stringify(navigated.content)}`);
  }
  await tool.execute({ action: "click", selector: "#go" }, context);
  const dom = await tool.execute({ action: "read_dom" }, context);
  if (!JSON.stringify(dom.content).includes("clicked")) throw new Error("click did not update the DOM");
  const shot = await tool.execute({ action: "screenshot" }, context);
  if (!shot.content.some((block) => block.type === "image")) throw new Error("screenshot missing");
  process.stdout.write("browser smoke ok: navigate, click, read_dom, screenshot\n");
} finally {
  await tool.stop();
  await new Promise((resolvePromise) => server.close(() => resolvePromise()));
}
