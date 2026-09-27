import { describe, expect, it } from 'vitest';
import type { RunMeta } from '../../src/capture/store';
import { xpForLevel } from '../../src/gmcp/levels';
import type { RunEvent } from '../../src/runs/events';
import { buildStats, rateSeries, xpRuler } from '../../src/runs/stats';
import { DAY_US, expiresDays, stitchChains, stitchSessions } from '../../src/runs/stitch';
import { summarizeAll } from '../../src/runs/store';

const H = 3600e6;
const T = 1_790_000_000_000_000;

function run(id: string, startUs: number, over: Partial<RunMeta> = {}, summary: Partial<NonNullable<RunMeta['summary']>> | null = {}): RunMeta {
  const [character] = id.split('/');
  return {
    runId: id,
    character: character!,
    startedUs: startUs,
    endedUs: startUs + H,
    sealed: true,
    bytes: 100,
    lines: 3,
    summary: summary === null ? null : { startUs: startUs + 1e6, lastEventUs: startUs + H - 1e6, kills: 0, pkills: 0, deaths: 0, ...summary },
    ...over,
  };
}

describe('stitching', () => {
  it('chains a run to its predecessor when the gap is under an hour', () => {
    const a = run('Rasta/1', T);
    const b = run('Rasta/2', T + H + 10 * 60e6, {}, { previousRunId: 'Rasta/1' }); // 10 min gap
    const c = run('Rasta/3', T + 5 * H, {}, { previousRunId: 'Rasta/2' }); // gap > 1 h
    const g = run('Gittan/1', T + 30 * 60e6);
    const chains = stitchChains([c, g, b, a]);
    expect(chains.map((ch) => ch.map((r) => r.runId))).toEqual([['Rasta/1', 'Rasta/2'], ['Gittan/1'], ['Rasta/3']]);
  });

  it('keeps runs without a summary as chains of their own', () => {
    const old = run('Rasta/1', T, { summary: undefined });
    delete old.summary;
    const b = run('Rasta/2', T + H + 1e6, {}, { previousRunId: 'Rasta/1' });
    expect(stitchChains([old, b])).toHaveLength(2);
  });

  it('builds sessions: saved, rating, expiry, log, level, newest first', () => {
    const now = T + 3 * DAY_US;
    const a = run('Rasta/1', T, { saved: true, rating: 2 }, { level: 40 });
    const b = run('Rasta/2', T + H + 60e6, { saved: true, rating: 4, bytes: 0 }, { previousRunId: 'Rasta/1', level: 41 });
    const g = run('Gittan/1', T + 2 * H, { bytes: 0 });
    const [s1, s2] = stitchSessions([a, b, g], now);
    expect(s1).toMatchObject({ id: 'Gittan/1', saved: false, rating: 0, hasLog: false, expiresDays: 12 });
    expect(s2).toMatchObject({ id: 'Rasta/1', character: 'Rasta', saved: true, rating: 4, hasLog: true, expiresDays: null, level: 41 });
    expect(s2!.startUs).toBe(T + 1e6);
    expect(s2!.endUs).toBe(b.endedUs);
    expect(expiresDays(T, T + 14 * DAY_US + 1)).toBe(0);
    expect(expiresDays(T, T + 13.5 * DAY_US)).toBe(1);
  });
});

describe('summaries', () => {
  it('fold events into the per-run summary', () => {
    const evs: RunEvent[] = [
      { type: 'run_start', us: 10, character: 'R', level: 30, xp: 1000, tp: 5, previousRunId: 'R/0', schema: 1 },
      { type: 'kill', us: 20, logUs: 19, mobName: 'a', xpDelta: 100 },
      { type: 'pkill', us: 30, logUs: 29, name: 'B', race: '', xpDelta: 50 },
      { type: 'tp_gained', us: 40, tpDelta: 3 },
      { type: 'char_death', us: 50, logUs: 50, level: 30 },
      { type: 'xp_loss', us: 60, xpDelta: -70 },
      { type: 'level_up', us: 70, level: 31 },
      { type: 'orphan_close', us: 999 },
    ];
    expect(summarizeAll(evs)).toEqual({
      startUs: 10,
      lastEventUs: 70,
      level: 31,
      xp: 1080,
      tp: 8,
      kills: 1,
      pkills: 1,
      deaths: 1,
      previousRunId: 'R/0',
    });
    expect(summarizeAll(evs.slice(1))).toBeNull();
  });
});

describe('buildStats', () => {
  const evs: RunEvent[] = [
    { type: 'run_start', us: T, character: 'Rasta', level: 73, xp: xpForLevel(73) + 1000, tp: 400, schema: 1 },
    { type: 'group_changed', us: T + 1, members: ['Norsy', 'Rasta'] },
    { type: 'kill', us: T + 10e6, logUs: T + 9e6, mobName: 'A bat', xpDelta: 50 },
    { type: 'kill', us: T + 20e6, logUs: T + 19e6, mobName: 'A bat', xpDelta: 61 },
    { type: 'kill', us: T + 30e6, logUs: T + 29e6, mobName: 'Thrakghash', xpDelta: 5424 },
    { type: 'pkill', us: T + 40e6, logUs: T + 39e6, name: 'Ibuki', race: 'the Half-Elf', xpDelta: 775 },
    { type: 'tp_gained', us: T + 41e6, tpDelta: 12 },
    { type: 'tp_loss', us: T + 42e6, tpDelta: -2 },
    { type: 'achievement', us: T + 50e6, name: 'That was a quick trip!' },
    { type: 'group_changed', us: T + 60e6, members: ['Kuzzim', 'Norsy'] },
    { type: 'char_death', us: T + 70e6, logUs: T + 70e6, level: 73 },
    { type: 'xp_loss', us: T + 71e6, xpDelta: -300 },
    { type: 'run_end', us: T + H },
    // A second run in the chain.
    { type: 'run_start', us: T + H + 60e6, character: 'Rasta', level: 73, xp: xpForLevel(73) + 6000, tp: 410, schema: 1 },
    { type: 'level_up', us: T + H + 70e6, level: 74 },
    { type: 'kill', us: T + H + 80e6, logUs: T + H + 79e6, mobName: 'A bat', xpDelta: xpForLevel(74) - xpForLevel(73) },
  ];

  it('aggregates allies, milestones, kill and pvp tables, XP and TP', () => {
    const m = buildStats(evs);
    expect(m.character).toBe('Rasta');
    expect(m.runs).toBe(2);
    expect(m.allies).toEqual(['Kuzzim', 'Norsy']);
    expect(m.milestones.map((x) => x.text)).toEqual(['★ That was a quick trip!', '↑ Reached level 74']);
    expect(m.kills).toEqual([
      { name: 'A bat', n: 3, xpPer: Math.round((111 + xpForLevel(74) - xpForLevel(73)) / 3), xpTotal: 111 + xpForLevel(74) - xpForLevel(73) },
      { name: 'Thrakghash', n: 1, xpPer: 5424, xpTotal: 5424 },
    ]);
    expect(m.pvps).toEqual([{ name: 'Ibuki', race: 'the Half-Elf', label: '*Ibuki the Half-Elf*', n: 1, xp: 775 }]);
    expect(m.pvpTotal).toEqual({ n: 1, xp: 775 });
    expect(m.deaths).toBe(1);
    expect(m.xp.start).toBe(xpForLevel(73) + 1000);
    expect(m.xp.now).toBe(xpForLevel(74) + 6000);
    expect(m.level).toBe(74);
    expect(m.tp).toEqual({ start: 400, now: 410 });
    expect(m.xpGains).toHaveLength(5);
    expect(m.tpGains).toEqual([{ us: T + 41e6, delta: 12 }]);
    expect(m.durationUs).toBe(H + 80e6);
    expect(m.ruler).toMatchObject({ fromLevel: 73, toLevel: 75, delta: m.xp.now! - m.xp.start! });
    expect(buildStats(evs, { nowUs: T + 2 * H }).durationUs).toBe(2 * H);
  });

  it('is empty without events', () => {
    const m = buildStats([]);
    expect(m).toMatchObject({ character: null, level: null, durationUs: 0, kills: [], allies: [], ruler: null, runs: 0 });
  });

  it('ruler spans the lower level to one above the higher on a net loss too', () => {
    const r = xpRuler(xpForLevel(20) + 10, xpForLevel(19) + 10);
    expect(r).toMatchObject({ fromLevel: 19, toLevel: 21, fromXp: xpForLevel(19), toXp: xpForLevel(21) });
    expect(r.delta).toBeLessThan(0);
  });

  it('rates gains per hour over a trailing window of one slice', () => {
    const gains = [
      { us: 0, delta: 100 },
      { us: 0.9 * H, delta: 50 },
      { us: 2 * H, delta: 10 },
    ];
    expect(rateSeries(gains, 0, 2 * H, 2)).toEqual([150, 10]);
    expect(rateSeries(gains, 0, 2 * H, 4)).toEqual([200, 100, 0, 20]);
    expect(rateSeries([{ us: 5, delta: 7 }], 5, 5, 3)).toEqual([42, 42, 42]);
  });

  it('never rates over less than 10 minutes', () => {
    // A 90k kill 10 s into a 20-minute run: 90k over 10 min = 540k/h, not
    // hundreds of millions, and it fades once it leaves the window.
    const s = 1e6;
    const r = rateSeries([{ us: 10 * s, delta: 90_000 }], 0, 1200 * s, 20);
    expect(Math.max(...r)).toBe(540_000);
    expect(r[0]).toBe(540_000);
    expect(r[9]).toBe(540_000);
    expect(r[10]).toBe(0);
    expect(r[19]).toBe(0);
  });
});
