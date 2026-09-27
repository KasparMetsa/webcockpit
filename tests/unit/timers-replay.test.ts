// Replays the owner's real Cockpit session logs (Inv §7.1 raw format) through
// the text pipeline (LineAssembler → ScriptEngine with the timers' system
// rules) and the trackers, on the log's own clock. Skips when the logs are
// absent ($WEBCOCKPIT_FIXTURES, default /home/ole/MUME/data/runs); nothing
// from them is copied into the repository.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Bus } from '../../src/core/bus';
import type { Line } from '../../src/core/types';
import { AFFECTS } from '../../src/timers/data/affects';
import { LineAssembler } from '../../src/text/assembler';
import { listFixtures } from '../e2e/fixtures';
import { bench } from './timers-helpers';

const logs = listFixtures().filter((f) => f.size >= 100_000);

function replay(path: string) {
  const b = bench();
  const bus = new Bus();
  const lines: Line[] = [];
  bus.on('text.line', (l) => lines.push(l));
  const asm = new LineAssembler(bus);
  let first = true;
  let count = 0;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const sp = raw.indexOf(' ');
    if (sp < 0) continue;
    const ts = Math.floor(Number(raw.slice(0, sp)) / 1000);
    const rest = raw.slice(sp + 1);
    if (!Number.isFinite(ts) || /^\x1b[A-Z]+ /.test(rest)) continue; // records (GMCP, VIEW, SIZE)
    if (first) {
      b.setNow(ts);
      first = false;
    } else if (ts > b.now()) b.advance((ts - b.now()) / 1000);
    if (rest.startsWith('> ') || rest === '>') {
      b.send(rest.slice(2));
      continue;
    }
    asm.text(rest + '\r\n', ts * 1000);
    for (const l of lines.splice(0)) {
      b.engine.processLine(l);
      count++;
    }
  }
  return { b, count };
}

describe.skipIf(logs.length === 0)('replaying real Cockpit logs', () => {
  for (const f of logs) {
    it(`${f.rel}: no errors, plausible timers`, () => {
      const { b, count } = replay(f.path);
      expect(count).toBeGreaterThan(1000);
      expect(b.errors).toEqual([]);
      const msgs = b.msgs;
      const byTag = new Map<string, number>();
      for (const m of msgs) {
        const tag = /^. (\w+)/.exec(m)?.[1] ?? '?';
        byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
      }
      // Every learned sample of a timed affect is within reach of its table duration.
      const learned: Record<string, number[]> = {};
      for (const name of Object.keys(AFFECTS)) {
        const s = b.tr.affects.samples(name);
        if (s.length > 0) learned[name] = s;
        for (const secs of s) {
          expect(secs, name).toBeGreaterThan(AFFECTS[name]!.duration! * 0.3);
          expect(secs, name).toBeLessThan(AFFECTS[name]!.duration! * 2.5);
        }
      }
      const stored = b.tr.stored.samples('earthquake');
      for (const secs of stored) expect(secs).toBeGreaterThan(600);
      console.log(
        `[timers replay] ${f.rel}: ${count} lines, ${msgs.length} UI lines ${JSON.stringify(Object.fromEntries(byTag))}, ` +
          `learned ${JSON.stringify(learned)}, earthquake ${JSON.stringify(stored)}, ` +
          `at end ${b.cells().length} cells`,
      );
    }, 120_000);
  }
});
