import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 4173);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".webp", "image/webp"],
]);

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const requested = decodeURIComponent(url.pathname);
  const path = resolve(root, `.${requested === "/" ? "/index.html" : requested}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }
  try {
    const info = await stat(path);
    const file = info.isDirectory() ? resolve(path, "index.html") : path;
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": types.get(extname(file)) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`prototype: http://127.0.0.1:${port}\n`);
});
