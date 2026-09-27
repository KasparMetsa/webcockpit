// Log player: timeline parsing and mappings, the replay clock, the strip
// maths and the recorded-layout helpers (ADR 0018 "Log player").
import { describe, expect, it } from 'vitest';
import { CATCH_UP_US, ReplayClock } from '../../src/player/clock';
import { parseSize } from '../../src/player/engine';
import { fitFontSize, overlayView, parseView } from '../../src/player/fit';
import {
  fmtClock,
  markRows,
  markersOf,
  offsetToRow,
  stripCells,
  yToOffset,
} from '../../src/player/strip';
import {
  ENTRY_GMCP,
  ENTRY_IN,
  ENTRY_OUT,
  ENTRY_SIZE,
  ENTRY_VIEW,
  buildTimeline,
  countAt,
  entryText,
  logUsAt,
  playAtLogUs,
  runAt,
} from '../../src/player/timeline';
import { defaultSettings } from '../../src/settings';
import { nominalCell } from '../../src/theme/cells';
import type { RunEvent } from '../../src/runs/events';
import { BASE_US, makeLog, meta, twoRunChain } from './player-helpers';

describe('buildTimeline', () => {
  it('reads every entry kind with its body, in chain order', () => {
    const tl = buildTimeline(twoRunChain());
    expect(tl.n).toBe(13);
    expect(Array.from(tl.kind.slice(0, 8))).toEqual([
      ENTRY_GMCP,
      ENTRY_SIZE,
      ENTRY_VIEW,
      ENTRY_IN,
      ENTRY_IN,
      ENTRY_IN,
      ENTRY_OUT,
      ENTRY_IN,
    ]);
    expect(entryText(tl, 0)).toBe('Char.Name {"name":"Rasta","fullname":"Rasta the Ranger"}');
    expect(entryText(tl, 1)).toBe('{"cols":120,"rows":40}');
    expect(entryText(tl, 6)).toBe('look');
    expect(entryText(tl, 5)).toBe('oO>');
    expect(tl.runs.map((r) => [r.first, r.end])).toEqual([
      [0, 10],
      [10, 13],
    ]);
    expect(Array.from(tl.run)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
  });

  it('collapses gaps over 10 s inside a run and between runs; log time keeps them', () => {
    const tl = buildTimeline(twoRunChain());
    const play = Array.from(tl.play).map((p) => Math.round(p));
    // 0 … 3 s, a 60 s gap (0), 7 s kept, an hour between runs (0), 1 s, 4 s.
    expect(play).toEqual([0, 0, 0, 1000, 1000, 2000, 2500, 3000, 3000, 10000, 10000, 11000, 15000]);
    expect(tl.durationMs).toBeCloseTo(15000, 3);
    expect(tl.ts[8]! - tl.ts[7]!).toBe(60e6);
  });

  it('keeps an empty Enter, a bare prompt and skips unknown records and junk', () => {
    const text =
      makeLog(BASE_US, [{ at: 0, out: '' }, { at: 1, in: '>' }]) +
      `${String(BASE_US + 2e6)} \x1bNOTE something\n` +
      'not a log line\n' +
      `${String(BASE_US + 3e6)} \x1bVIEW\n`;
    const tl = buildTimeline([{ meta: meta('X/1', BASE_US), text }]);
    expect(tl.n).toBe(2);
    expect(tl.kind[0]).toBe(ENTRY_OUT);
    expect(entryText(tl, 0)).toBe('');
    expect(tl.kind[1]).toBe(ENTRY_IN);
    expect(entryText(tl, 1)).toBe('>');
  });

  it('maps playback time to entries, log time and runs', () => {
    const tl = buildTimeline(twoRunChain());
    expect(countAt(tl, -1)).toBe(0);
    expect(countAt(tl, 0)).toBe(1);
    expect(countAt(tl, 0.5)).toBe(3);
    expect(countAt(tl, 999)).toBe(3);
    expect(countAt(tl, 1000)).toBe(4);
    expect(countAt(tl, 1000.5)).toBe(5);
    expect(countAt(tl, 3000)).toBe(9); // the collapsed gap's far side shows at once
    expect(countAt(tl, 10000)).toBe(11);
    expect(countAt(tl, 15000)).toBe(13);
    // Log time moves with playback inside a kept gap …
    expect(logUsAt(tl, 1500)).toBeCloseTo(BASE_US + 1.5e6, -1); // 1.0002 s + 499.8 ms
    // … and jumps over a collapsed one.
    expect(logUsAt(tl, 3000)).toBe(BASE_US + 63e6);
    expect(logUsAt(tl, 6500)).toBe(BASE_US + 66.5e6);
    expect(runAt(tl, 9999)).toBe(0);
    expect(runAt(tl, 10000)).toBe(1);
    expect(runAt(tl, -5)).toBe(0);
  });

  it('maps log time back to playback time (markers, the cursor)', () => {
    const tl = buildTimeline(twoRunChain());
    expect(playAtLogUs(tl, BASE_US - 5)).toBe(0);
    expect(playAtLogUs(tl, BASE_US + 3e6)).toBe(3000);
    expect(playAtLogUs(tl, BASE_US + 30e6)).toBe(3000); // inside the collapsed gap
    expect(playAtLogUs(tl, BASE_US + 64e6)).toBe(4000);
    expect(playAtLogUs(tl, BASE_US + 3601e6)).toBe(11000);
    expect(playAtLogUs(tl, BASE_US + 9999e6)).toBe(15000);
    // Round trip at entry times.
    for (let i = 0; i < tl.n; i++) expect(countAt(tl, playAtLogUs(tl, tl.ts[i]!))).toBeGreaterThan(i);
  });
});

describe('ReplayClock', () => {
  it('fires timers in time order at their log time, never going back', () => {
    const c = new ReplayClock(1000e3);
    const seen: Array<[string, number]> = [];
    c.set(() => seen.push(['b', c.now()]), 200);
    c.set(() => seen.push(['a', c.now()]), 100);
    const h = c.set(() => seen.push(['x', c.now()]), 150);
    c.clear(h);
    c.advanceTo(1150e3);
    expect(seen).toEqual([['a', 1100]]);
    c.advanceTo(1000e3); // no going back
    expect(c.now()).toBe(1150);
    c.advanceTo(1300e3);
    expect(seen).toEqual([
      ['a', 1100],
      ['b', 1200],
    ]);
    expect(c.now()).toBe(1300);
  });

  it('runs a periodic timer through a stretch, and skips ahead over a long jump', () => {
    const c = new ReplayClock(0);
    let ticks = 0;
    const tick = (): void => {
      ticks++;
      c.set(tick, 1000);
    };
    c.set(tick, 1000);
    c.advanceTo(10e6);
    expect(ticks).toBe(10);
    ticks = 0;
    c.advanceTo(10e6 + 3600e6); // an hour: only the last CATCH_UP_US is ticked through
    expect(ticks).toBeLessThanOrEqual(CATCH_UP_US / 1e6 + 1);
    expect(ticks).toBeGreaterThan(0);
    expect(c.size).toBe(1);
    c.dispose();
    expect(c.size).toBe(0);
  });

  it('lets a timer set a timer due at once', () => {
    const c = new ReplayClock(0);
    const seen: number[] = [];
    c.set(() => {
      seen.push(1);
      c.set(() => seen.push(2), 0);
    }, 10);
    c.advanceTo(20e3);
    expect(seen).toEqual([1, 2]);
  });
});

describe('strip maths', () => {
  it('maps offsets to rows with half-row precision', () => {
    expect(offsetToRow(0, 100, 10)).toEqual({ row: 0, upper: true });
    expect(offsetToRow(100, 100, 10)).toEqual({ row: 9, upper: false });
    expect(offsetToRow(50, 100, 10)).toEqual({ row: 5, upper: true }); // half 9.5 → 10
    expect(offsetToRow(-5, 100, 10)).toEqual({ row: 0, upper: true });
    expect(offsetToRow(10, 0, 10)).toEqual({ row: 0, upper: true });
  });

  it('draws played above, remaining below and the gold half-block between', () => {
    const cells = stripCells(50, 100, 4); // half = round(0.5 × 7) = 4 → row 2, upper
    expect(cells.map((c) => c.ch).join('')).toBe('██▀█');
    expect(cells[0]!.fg).toBe('#9a9a9a');
    expect(cells[2]).toEqual({ ch: '▀', fg: '#ffaf00', bg: '#242424' });
    expect(cells[3]!.fg).toBe('#242424');
    const low = stripCells(40, 100, 4); // half = round(2.8) = 3 → row 1, lower
    expect(low.map((c) => c.ch).join('')).toBe('█▄██');
    expect(low[1]).toEqual({ ch: '▄', fg: '#ffaf00', bg: '#9a9a9a' });
  });

  it('turns a pointer position into an offset (top row centre = start, bottom = end)', () => {
    expect(yToOffset(5, 100, 10, 1000)).toBe(0);
    expect(yToOffset(95, 100, 10, 1000)).toBe(1000);
    expect(yToOffset(50, 100, 10, 1000)).toBe(500);
    expect(yToOffset(-40, 100, 10, 1000)).toBe(0);
  });

  it('maps the chain events to K/D/A/L markers at logUs ?? us', () => {
    const ev: RunEvent[] = [
      { type: 'run_start', us: 1, character: 'R', schema: 1 },
      { type: 'kill', us: 5, logUs: 4, mobName: 'orc', xpDelta: 1 },
      { type: 'pkill', us: 10, logUs: 9, name: 'Ibuki', race: 'the Half-Elf', xpDelta: 5 },
      { type: 'char_death', us: 20, logUs: 19 },
      { type: 'achievement', us: 30, name: 'x' },
      { type: 'level_up', us: 40, level: 42 },
      { type: 'run_end', us: 50 },
    ];
    expect(markersOf(ev)).toEqual([
      { letter: 'K', us: 9 },
      { letter: 'D', us: 19 },
      { letter: 'A', us: 30 },
      { letter: 'L', us: 40 },
    ]);
  });

  it('stacks markers on a row as A D K L + ►, seeking to the earliest', () => {
    const rows = markRows(
      [
        { letter: 'L', offset: 51 },
        { letter: 'A', offset: 50 },
        { letter: 'K', offset: 0 },
        { letter: 'D', offset: 52 },
        { letter: 'K', offset: 200 }, // past the end: dropped
      ],
      100,
      10,
    );
    expect(rows).toEqual([
      { row: 0, text: 'K►', offset: 0 },
      { row: 5, text: 'ADL►', offset: 50 },
    ]);
  });

  it('formats the clock with unbounded minutes', () => {
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(61_999)).toBe('01:01');
    expect(fmtClock(78 * 60_000 + 34_000)).toBe('78:34');
  });
});

describe('recorded layout', () => {
  it('fits the recorded grid with the largest font size', () => {
    const a = defaultSettings().appearance;
    const size = fitFontSize(a, 120, 40, 1400, 820);
    const c = nominalCell({ ...a, size });
    expect(120 * c.w).toBeLessThanOrEqual(1400);
    expect(40 * c.h).toBeLessThanOrEqual(820);
    const up = nominalCell({ ...a, size: size + 1 });
    expect(120 * up.w > 1400 || 40 * up.h > 820).toBe(true);
    expect(fitFontSize(a, 500, 300, 100, 100)).toBe(6);
  });

  it('parses a VIEW and replaces its parts whole', () => {
    expect(parseView('nope')).toBeNull();
    expect(parseView('[1]')).toBeNull();
    expect(parseView('{"other":1}')).toBeNull();
    const v = parseView(JSON.stringify({ appearance: { ...defaultSettings().appearance, size: 20 }, comm: { filters: {}, showHeader: false } }))!;
    const d = defaultSettings();
    d.comm.filters = { tales: false } as never;
    overlayView(d, v);
    expect(d.appearance.size).toBe(20);
    expect(d.comm).toEqual({ filters: {}, showHeader: false });
    expect(d.profile).toBe('default');
  });

  it('accepts only sane SIZE records', () => {
    expect(parseSize('{"cols":120,"rows":40}')).toEqual({ cols: 120, rows: 40 });
    expect(parseSize('{"cols":1,"rows":40}')).toBeNull();
    expect(parseSize('{"cols":"a","rows":40}')).toBeNull();
    expect(parseSize('x')).toBeNull();
  });
});
