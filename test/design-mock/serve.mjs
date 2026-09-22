// Zero-dependency static server that exposes the repository root so the design mock
// can load the real clock page (src/clock/popup.html) inside a same-origin iframe.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PORT = Number(process.env.DESIGN_MOCK_PORT) || 8766;
const HOST = "127.0.0.1";
const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
};

function resolveRequestPath(urlPath) {
    let pathname = decodeURIComponent(urlPath.split("?")[0]);
    if (pathname === "/") pathname = "/test/design-mock/index.html";
    if (pathname.endsWith("/")) pathname += "index.html";
    const filePath = normalize(join(REPO_ROOT, pathname));
    if (!filePath.startsWith(REPO_ROOT + sep) && filePath !== REPO_ROOT) return null;
    return filePath;
}

const server = createServer((request, response) => {
    const filePath = resolveRequestPath(request.url || "/");
    let stats = null;
    try {
        stats = filePath ? statSync(filePath) : null;
    } catch (_error) {
        stats = null;
    }
    if (!stats || !stats.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(`Not found: ${request.url}`);
        return;
    }

    response.writeHead(200, {
        "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": stats.size,
        "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
});

server.listen(PORT, HOST, () => {
    console.log(`Calendar Clock design mock: http://${HOST}:${PORT}/test/design-mock/`);
    console.log(`Serving ${REPO_ROOT}`);
});
