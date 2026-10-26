// Minimal static file server for trying the editor locally:  npm run serve  ->  http://localhost:8080/web/
// (ES modules need http://, so opening index.html straight from disk will not work.)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".gdlvl": "text/plain", ".md": "text/plain" };

export const server = createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (path.endsWith("/")) path += "index.html";
    const file = join(root, path);
    if (!file.startsWith(root)) { res.writeHead(403).end("Forbidden"); return; }
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end("Not found"); }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(port, () => console.log(`Editor: http://localhost:${port}/web/`));
}
