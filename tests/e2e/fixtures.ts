// Replay fixtures for the browser tests: the owner's Cockpit raw logs under
// $WEBCOCKPIT_FIXTURES (default /home/ole/MUME/data/runs), served by the dev
// server at /__fixtures/ (vite.config.ts). Tests skip when there are none.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const FIXTURES_ROOT = process.env.WEBCOCKPIT_FIXTURES ?? '/home/ole/MUME/data/runs';

export interface Fixture {
  rel: string;
  path: string;
  size: number;
}

export function listFixtures(root = FIXTURES_ROOT): Fixture[] {
  const out: Fixture[] = [];
  if (!existsSync(root)) return out;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.log') && st.size > 0) {
        out.push({ rel: relative(root, p).split(sep).join('/'), path: p, size: st.size });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.size - b.size);
}

/**
 * The smallest fixture of at least `minSize` bytes. The floor keeps tests
 * that need a scrollable pane from picking a near-empty run log.
 */
export const smallestFixture = (minSize = 1500): Fixture | undefined =>
  listFixtures().find((f) => f.size >= minSize);
export const biggestFixture = (): Fixture | undefined => listFixtures().at(-1);
