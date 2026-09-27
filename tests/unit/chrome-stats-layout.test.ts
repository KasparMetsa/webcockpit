import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KILL_SORT,
  allyPairs,
  fitNum,
  fmtClock,
  fmtK,
  fmtRunDur,
  killCells,
  killCols,
  nextStatSort,
  pvpCells,
  pvpCols,
  pvpLabel,
  rulerRows,
  segText,
  sortKills,
  sortPvps,
  sparkBuckets,
  sparkLabels,
  sparkRows,
  statsWidths,
  titleSegs,
} from '../../src/chrome/frames/stats-layout';
import { xpForLevel } from '../../src/gmcp/levels';
import { xpRuler } from '../../src/runs/stats';

describe('statistics formatting', () => {
  it('k-formats numbers', () => {
    expect(fmtK(950)).toBe('950');
    expect(fmtK(9100)).toBe('9.1k');
    expect(fmtK(48_200)).toBe('48.2k');
    expect(fmtK(482_000)).toBe('482k');
    expect(fmtK(1_234_000)).toBe('1.2M');
    expect(fmtK(12_300_000)).toBe('12M');
    expect(fmtK(-28_000)).toBe('-28.0k');
    expect(fmtK(0)).toBe('0');
  });

  it('formats durations and clocks', () => {
    expect(fmtRunDur(134 * 60e6)).toBe('2h 14m');
    expect(fmtRunDur(14 * 60e6 + 59e6)).toBe('14m');
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(34 * 60e6 + 12e6)).toBe('34:12');
    expect(fmtClock(8040e6)).toBe('2:14:00');
  });

  it('fits numbers and PvP labels', () => {
    expect(fitNum(5424, 7)).toBe('   5424');
    expect(fitNum(12_345_678, 7)).toBe('    12M');
    expect(pvpLabel('*Ibuki the Half-Elf*', 30)).toBe('*Ibuki the Half-Elf*');
    expect(pvpLabel('*Melker the black numenorean*', 22)).toBe('*Melker the black nu…*');
  });

  it('sizes the two sides to the grid (max 84 wide)', () => {
    expect(statsWidths(128)).toEqual({ T: 38, total: 84 });
    expect(statsWidths(80)).toEqual({ T: 36, total: 80 });
    expect(statsWidths(61)).toEqual({ T: 26, total: 60 });
  });
});

describe('statistics tables', () => {
  const kills = [
    { name: 'A bat', n: 4, xpPer: 56, xpTotal: 224 },
    { name: 'Thrakghash of the Mountains', n: 1, xpPer: 5424, xpTotal: 5424 },
    { name: 'An orc', n: 2, xpPer: 100, xpTotal: 200 },
  ];

  it('sorts kills by any column, text ▲ and numbers ▼ first', () => {
    expect(sortKills(kills, DEFAULT_KILL_SORT).map((k) => k.name)).toEqual([
      'Thrakghash of the Mountains',
      'A bat',
      'An orc',
    ]);
    let s = nextStatSort(DEFAULT_KILL_SORT, 'n');
    expect(s).toEqual({ key: 'n', dir: -1 });
    expect(sortKills(kills, s)[0]!.name).toBe('A bat');
    s = nextStatSort(s, 'n');
    expect(s.dir).toBe(1);
    s = nextStatSort(s, 'name');
    expect(s).toEqual({ key: 'name', dir: 1 });
    expect(sortKills(kills, s).map((k) => k.name)).toEqual(['A bat', 'An orc', 'Thrakghash of the Mountains']);
    const pv = [
      { name: 'B', race: '', label: '*B*', n: 1, xp: 10 },
      { name: 'A', race: 'the Orc', label: '*A the Orc*', n: 2, xp: 5 },
    ];
    expect(sortPvps(pv, { key: 'xp', dir: -1 }).map((p) => p.name)).toEqual(['B', 'A']);
    expect(sortPvps(pv, { key: 'name', dir: 1 }).map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('lays out title rows with the sort arrow and data rows to the table width', () => {
    const cols = killCols(38);
    const title = segText(titleSegs(cols, DEFAULT_KILL_SORT));
    expect(title).toBe('KILLS' + ' '.repeat(18 - 5) + '   N' + '   XP/N' + ' XP tot ▼');
    expect(title).toHaveLength(38);
    expect(
      titleSegs(cols, DEFAULT_KILL_SORT)
        .filter((s) => s.key)
        .map((s) => s.key),
    ).toEqual(['name', 'n', 'xpPer', 'xpTotal']);
    const row = killCells(kills[1]!, cols).join('');
    expect(row).toBe('Thrakghash of th… ' + '   1' + '   5424' + '     5424');
    expect(row).toHaveLength(38);
    const pc = pvpCols(38);
    const pv = pvpCells({ name: 'Ibuki', race: 'the Half-Elf', label: '*Ibuki the Half-Elf*', n: 1, xp: 775 }, pc);
    expect(('⚔ ' + pv.join('')).length).toBe(38);
    expect(segText(titleSegs(pc, { key: 'xp', dir: -1 }))).toMatch(/^PvPs {2,}N {2,}XP ▼$/);
  });

  it('packs allies two per row', () => {
    expect(allyPairs(['A', 'B', 'C'])).toEqual([
      ['A', 'B'],
      ['C', undefined],
    ]);
  });
});

describe('sparklines', () => {
  it('scales values to 3 rows × 8 levels, top row first', () => {
    expect(sparkRows([0, 24, 12, 1])).toEqual([' █  ', ' █▄ ', ' ██▁']);
    expect(sparkRows([0, 0])).toEqual(['  ', '  ', '  ']);
    expect(sparkLabels(9200)).toEqual([' 9.2k', ' 4.6k', '    0']);
    expect(sparkBuckets(38)).toBe(31);
  });
});

describe('XP ruler', () => {
  it('draws the gained band, the arrow label and the level marks', () => {
    const start = xpForLevel(73) + 1_000_000;
    const r = rulerRows(xpRuler(start, start + 48_200), 84);
    expect(segText(r.bar)).toHaveLength(84);
    expect(segText(r.label)).toHaveLength(84);
    expect(segText(r.marks)).toHaveLength(84);
    const band = r.bar.find((s) => s.cls === 'wc-st-gained')!;
    expect(band.text.length).toBeGreaterThan(0);
    expect(segText(r.marks)).toMatch(/^▌73 +74▐$/);
    // Wide band: bracketed label; narrow: plain `N XP`.
    const wide = rulerRows(xpRuler(xpForLevel(73), xpForLevel(73) + 2_000_000), 84);
    expect(segText(wide.label).trim()).toMatch(/^▌◄▬+ 2\.0M XP ▬+►▐$/);
    expect(segText(r.label).trim()).toBe('48.2k XP');
  });

  it('shows a net loss in red with a minus', () => {
    const start = xpForLevel(42) + 50_000;
    const r = rulerRows(xpRuler(start, start - 100_000), 84);
    expect(r.bar.some((s) => s.cls === 'wc-st-loss')).toBe(true);
    expect(segText(r.label)).toContain('-100k XP');
    expect(segText(r.marks)).toMatch(/^▌41 +▌42 +43▐$/);
  });
});
