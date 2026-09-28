// A plain static file server that stands in for the production Caddy
// site (ADR 0022): files from one directory at the site root, the same
// headers, MIME types by extension, no fallback, no dev middleware.
//
//   node scripts/static-server.ts [dir] [--port n]      (default dist, 4180)
//
// Used by the site-root smoke test (playwright.prod.config.ts) and by
// `npm run publish` to check a staged release before it goes live.
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

/** The headers every response carries (ADR 0022 "Headers"). */
export const SITE_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'X-Content-Type-Options': 'nosniff',
};

/** Hashed build output: safe to cache forever. Everything else revalidates. */
export function cacheControl(path: string): string {
  return path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.mm2': 'application/octet-stream',
};

export function mimeType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export function serve(dir: string, port: number): ReturnType<typeof createServer> {
  const root = realpathSync(dir);
  const server = createServer((req, res) => {
    const notFound = (code = 404): void => {
      res.writeHead(code, { ...SITE_HEADERS, 'Content-Type': 'text/plain' });
      res.end(code === 404 ? 'not found' : 'bad request');
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(400);
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      return notFound(400);
    }
    if (path.includes('\0')) return notFound(400);
    if (path.endsWith('/')) path += 'index.html';
    let file: string;
    try {
      file = realpathSync(resolve(root, `.${path}`));
      if (!file.startsWith(root + sep) || !statSync(file).isFile()) return notFound();
    } catch {
      return notFound();
    }
    res.writeHead(200, {
      ...SITE_HEADERS,
      'Content-Type': mimeType(file),
      'Content-Length': statSync(file).size,
      'Cache-Control': cacheControl(path),
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--port');
  const port = pi >= 0 ? Number(args.splice(pi, 2)[1]) : 4180;
  const dir = resolve(args[0] ?? 'dist');
  serve(dir, port).on('listening', () => console.log(`static: ${dir} at http://127.0.0.1:${port}/`));
}
