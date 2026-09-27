import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
/** Fixtures kept in the repository (the GMCP demo, ADR 0016); searched first. */
export const REPO_FIXTURES = fileURLToPath(new URL('./tests/fixtures', import.meta.url));

/** Fixture roots in lookup order: the repository, then $WEBCOCKPIT_FIXTURES. */
function fixtureRoots(): string[] {
  return [REPO_FIXTURES, resolve(process.env.WEBCOCKPIT_FIXTURES ?? DEFAULT_FIXTURES)];
}

/** Resolves `rel` inside `root` (symlinks included), or null if outside or missing. */
function fixtureFile(root: string, rel: string): string | null {
  try {
    const realRoot = realpathSync(root);
    const file = realpathSync(resolve(realRoot, rel));
    return file.startsWith(realRoot + sep) && statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

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
 * Dev-only, read-only access to replay fixtures (ADR 0007, ADR 0016):
 *   GET /__fixtures/list        JSON array of relative `.log` paths (all roots)
 *   GET /__fixtures/<rel path>  the log text, from the first root that has it
 *                               (also `.jsonl.gz` run backups, as bytes)
 * Roots: `tests/fixtures` in the repository, then $WEBCOCKPIT_FIXTURES
 * (default the owner's Cockpit runs). Paths are resolved (symlinks
 * included) and must stay inside their root. `apply: 'serve'` keeps this
 * out of `vite build` and `vite preview`.
 */
function fixturesPlugin(): Plugin {
  return {
    name: 'webcockpit-fixtures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fixtures', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const roots = fixtureRoots();
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
          const all = [...new Set(roots.flatMap((r) => listLogs(r)))].sort();
          return send(200, 'application/json', JSON.stringify(all));
        }
        const gz = rel.endsWith('.jsonl.gz');
        if (!(rel.endsWith('.log') || gz) || rel.includes('\0')) return send(404, 'text/plain', 'not found');
        for (const root of roots) {
          const file = fixtureFile(root, rel);
          if (file) return send(200, gz ? 'application/gzip' : 'text/plain; charset=utf-8', readFileSync(file));
        }
        return send(404, 'text/plain', 'not found');
      });
    },
  };
}

export default defineConfig({
  define: { __WC_VERSION__: JSON.stringify(pkg.version) },
  // Preact JSX for the chrome (src/chrome, ADR 0013).
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  plugins: [fixturesPlugin()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: { target: 'es2022' },
});
