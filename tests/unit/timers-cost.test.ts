// The timers' system rules must stay cheap per line (spec §1.3: 500 user
// rules < 0.2 ms per line; the system rules come on top). `npm run bench`
// measures it on a real log (bench/script-bench.ts); this is a coarse guard.

import { describe, expect, it } from 'vitest';
import { GameState } from '../../src/gmcp/state';
import { ScriptEngine } from '../../src/script/engine';
import { AFFECTS } from '../../src/timers/data/affects';
import { mkLine } from './timers-helpers';

describe('timers rules cost', () => {
  it('a handful of system actions, well under 10 µs per line', () => {
    const e = new ScriptEngine({ send: () => {}, message: () => {} });
    const game = new GameState();
    game.installRules(e.system);
    game.timers.installRules(e.system);
    // One catch-all router plus the charm follow line, not one action per game line.
    expect(e.system.count('action')).toBeLessThanOrEqual(6);

    const gameLines = Object.values(AFFECTS).flatMap((a) => [...(a.start ?? []), ...(a.drop ?? [])]).filter((l) => typeof l === 'string');
    const filler = [
      'The ancient stone bridge spans the Hoarwell here. The road continues east and west.',
      'An orc scout is here, fighting nobody.',
      'Exits: east, west.',
      '',
      '*=>',
      "Gibur narrates 'orcs gathering at the ford'",
      'You slash an orc scout hard.',
    ];
    const lines = [...filler, ...filler, ...filler, ...(gameLines as string[]).slice(0, 10)].map(mkLine);
    const run = (n: number): number => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) e.processLine(lines[i % lines.length]!);
      return ((performance.now() - t0) * 1000) / n;
    };
    run(5000);
    const us = Math.min(run(20000), run(20000), run(20000));
    expect(us).toBeLessThan(10);
    game.dispose();
    e.dispose();
  });
});
