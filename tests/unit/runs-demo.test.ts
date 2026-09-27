// The runs demo backup (tests/fixtures/runs-demo.jsonl.gz) restores into a
// library with what the stage 6 test guide promises, and its stored events
// are what the current deriver makes of its logs (regenerate with
// `node tests/fixtures/runs-demo.gen.ts` when the deriver changes).

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRecord } from '../../src/capture/format';
import { Bus } from '../../src/core/bus';
import { type RunEvent, RunEventDeriver } from '../../src/runs/events';
import { RunLibrary } from '../../src/runs/library';
import { buildStats } from '../../src/runs/stats';
import { FakeScheduler } from '../../src/script/engine/timers';

const FILE = new URL('../fixtures/runs-demo.jsonl.gz', import.meta.url);

async function restored() {
  const lib = await RunLibrary.open(new IDBFactory(), { locks: null, storage: null });
  const r = await lib.restore(new Blob([readFileSync(FILE)]));
  return { lib, r };
}

/** Replays a run's capture text through the deriver on the log's clock. */
function derive(text: string, startMs: number): RunEvent[] {
  const bus = new Bus();
  const sched = new FakeScheduler();
  let ms = startMs;
  const d = new RunEventDeriver({ now: () => ms, scheduler: sched }).attach(bus);
  const out: RunEvent[] = [];
  d.subscribe((e) => out.push(e));
  bus.emit('conn.state', { state: 'connecting', prev: 'idle' });
  bus.emit('conn.state', { state: 'login', prev: 'connecting' });
  for (const l of text.split('\n')) {
    if (!l) continue;
    const ts = Number(l.slice(0, 16));
    if (ts / 1000 > ms) {
      sched.advance(ts / 1000 - ms);
      ms = ts / 1000;
    }
    const body = l.slice(17);
    const rec = parseRecord(body);
    if (rec) {
      if (rec.type !== 'GMCP') continue;
      const sp = rec.payload.indexOf(' ');
      const pkg = sp < 0 ? rec.payload : rec.payload.slice(0, sp);
      const json = sp < 0 ? '' : rec.payload.slice(sp + 1);
      bus.emit('gmcp.raw', { pkg, json, ts });
      bus.emit('gmcp', { pkg, data: json ? JSON.parse(json) : undefined });
      if (pkg === 'Char.Name') bus.emit('conn.state', { state: 'playing', prev: 'login' });
    } else if (!body.startsWith('> ')) {
      d.onLine(body.replace(/\x1b\[[0-9;]*m/g, ''), ts);
    }
  }
  return out;
}

describe('runs demo backup', () => {
  it('restores four runs, two characters, one saved stitched session', async () => {
    const { lib, r } = await restored();
    expect(r).toEqual({ added: 4, skipped: 0 });
    expect(await lib.characters()).toEqual(['Gittan', 'Rasta']);
    const now = new Date(2026, 8, 28, 12, 0).getTime() * 1000;
    const sessions = await lib.listSessions(now);
    expect(sessions.map((s) => [s.character, s.runs.length, s.saved, s.rating])).toEqual([
      ['Gittan', 1, false, 0],
      ['Rasta', 2, true, 4],
      ['Gittan', 1, false, 0],
    ]);
    const rasta = sessions[1]!;
    expect(rasta.expiresDays).toBeNull();
    expect(rasta.hasLog).toBe(true);
    const m = buildStats(await lib.events(rasta.runs.map((x) => x.runId)));
    expect(m.character).toBe('Rasta');
    expect(m.runs).toBe(2);
    expect(m.allies).toEqual(['Kuzzim', 'Norsy']);
    expect(m.pvps).toMatchObject([{ name: 'Ibuki', race: 'the Half-Elf', xp: 60_000 }]);
    expect(m.deaths).toBe(1);
    expect(m.milestones.map((x) => x.text)).toEqual(['↑ Reached level 42', '★ That was a quick trip!']);
    expect(m.killTotal.n).toBe(8);
  });

  it('holds exactly what the deriver makes of its logs', async () => {
    const { lib } = await restored();
    for (const s of await lib.listSessions(0)) {
      for (const run of s.runs) {
        const text = (await lib.chainLog([run.runId]))[0]!.text;
        const stored = (await lib.events([run.runId])).map((e) => {
          const c = { ...e } as RunEvent & { previousRunId?: string };
          delete c.previousRunId;
          return c;
        });
        const derived = derive(text, run.startedUs / 1000);
        expect(derived).toEqual(stored.filter((e) => e.type !== 'run_end'));
      }
    }
  });
});
