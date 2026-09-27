import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join, relative, resolve, sep } from 'node:path';
import { type Plugin, defineConfig } from 'vite';

// Cross-origin isolation (spec §1.5) stays possible from day one.
// COEP does not apply to WebSocket connections, so the direct
// wss://mume.org/ws-play/ socket (ADR 0002) is unaffected.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Default location of the owner's Cockpit raw logs (ADR 0007). */
export const DEFAULT_FIXTURES = '/home/ole/MUME/data/runs';

/** Every `.log` under `root`, as `/`-separated paths relative to it. */
function listLogs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && name.endsWith('.log')) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Dev-only, read-only access to replay fixtures (ADR 0007):
 *   GET /__fixtures/list        JSON array of relative `.log` paths
 *   GET /__fixtures/<rel path>  the log text
 * Paths are resolved (symlinks included) and must stay inside the root.
 * `apply: 'serve'` keeps this out of `vite build` and `vite preview`.
 */
function fixturesPlugin(): Plugin {
  return {
    name: 'webcockpit-fixtures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fixtures', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const root = resolve(process.env.WEBCOCKPIT_FIXTURES ?? DEFAULT_FIXTURES);
        const send = (code: number, type: string, body: string | Buffer): void => {
          const r = res as ServerResponse;
          r.statusCode = code;
          r.setHeader('Content-Type', type);
          r.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
          r.setHeader('Cache-Control', 'no-store');
          r.end(req.method === 'HEAD' ? undefined : body);
        };
        const url = new URL(req.url ?? '/', 'http://x');
        let rel: string;
        try {
          rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        } catch {
          return send(400, 'text/plain', 'bad path');
        }
        if (rel === 'list') {
          return send(200, 'application/json', JSON.stringify(listLogs(root)));
        }
        if (!rel.endsWith('.log') || rel.includes('\0')) return send(404, 'text/plain', 'not found');
        let file: string;
        let realRoot: string;
        try {
          realRoot = realpathSync(root);
          file = realpathSync(resolve(realRoot, rel));
        } catch {
          return send(404, 'text/plain', 'not found');
        }
        if (!file.startsWith(realRoot + sep) || !statSync(file).isFile()) {
          return send(404, 'text/plain', 'not found');
        }
        return send(200, 'text/plain; charset=utf-8', readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  define: { __WC_VERSION__: JSON.stringify(pkg.version) },
  plugins: [fixturesPlugin()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: { target: 'es2022' },
});
