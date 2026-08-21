// Minimal static file server for the built Starlight site.
// Serves `dist/` over HTTP on $PORT (Railway injects PORT; defaults to 4321).
// Astro's `output: "static"` build is a plain MPA — no SPA fallback needed.
// Unknown paths resolve to dist/404.html, matching Starlight's 404 page.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT) || 4321;
const HOST = '0.0.0.0';
const ROOT = new URL('./dist/', import.meta.url).pathname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  let safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  if (safePath.endsWith('/')) safePath += 'index.html';

  let filePath = join(ROOT, safePath);

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath) && !extname(filePath)) {
    // Starlight emits directory-style routes (e.g. /install/index.html).
    const withIndex = join(ROOT, safePath, 'index.html');
    if (existsSync(withIndex)) return withIndex;
  }

  return filePath;
}

const server = createServer((req, res) => {
  let filePath = resolvePath(req.url ?? '/');

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(ROOT, '404.html');
    res.statusCode = 404;
  }

  const type = MIME[extname(filePath)] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  createReadStream(filePath)
    .on('error', () => {
      res.statusCode = 500;
      res.end('Internal server error');
    })
    .pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Emito docs serving dist/ on http://${HOST}:${PORT}`);
});
