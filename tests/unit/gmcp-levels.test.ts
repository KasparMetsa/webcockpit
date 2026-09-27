import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, levelFromXp, tpBar, tpForLevel, tpScale, xpBar, xpForLevel } from '../../src/gmcp/levels';
import { BANDS, VITAL_KINDS, bandMidpoint, bandOf, inBand } from '../../src/gmcp/bands';

describe('level table', () => {
  it('derives the level from XP at the thresholds', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(999)).toBe(1);
    expect(levelFromXp(1000)).toBe(2);
    expect(levelFromXp(5_089_999)).toBe(24);
    expect(levelFromXp(5_090_000)).toBe(25);
    expect(levelFromXp(5_770_000)).toBe(25);
    expect(levelFromXp(5_795_500)).toBe(26);
    expect(levelFromXp(158_000_000)).toBe(100);
    expect(levelFromXp(1e12)).toBe(100);
    expect(levelFromXp(Number.NaN)).toBe(1);
  });

  it('is strictly increasing and every threshold maps to its level', () => {
    for (let l = 2; l <= MAX_LEVEL; l++) {
      expect(xpForLevel(l)).toBeGreaterThan(xpForLevel(l - 1));
      expect(levelFromXp(xpForLevel(l))).toBe(l);
      expect(levelFromXp(xpForLevel(l) - 1)).toBe(l - 1);
      expect(tpForLevel(l)).toBeGreaterThan(tpForLevel(l - 1));
    }
  });

  it('scales TP thresholds for trolls only', () => {
    expect(tpScale('troll')).toBe(0.1);
    expect(tpScale('Troll ')).toBe(0.1);
    expect(tpScale('Man')).toBe(1);
    expect(tpScale(null)).toBe(1);
    expect(tpForLevel(5)).toBe(1000);
    expect(tpForLevel(5, 'troll')).toBe(100);
  });
});

describe('session bars', () => {
  it('without an anchor is all baseline', () => {
    const b = xpBar(5_440_000, null); // level 25: 5.09M → 5.79M, half way
    expect(b.progress).toBeCloseTo(0.5);
    expect(b.baseline).toBeCloseTo(0.5);
  });

  it('splits at the session start within a level', () => {
    const b = xpBar(5_440_000, 5_230_000);
    expect(b.progress).toBeCloseTo(0.5);
    expect(b.baseline).toBeCloseTo(0.2);
  });

  it('re-anchors to 0 after a level-up: the whole fill is gain', () => {
    const b = xpBar(5_865_000, 5_770_000); // level 26 now, started in 25
    expect(b.progress).toBeCloseTo(0.1);
    expect(b.baseline).toBe(0);
  });

  it('shows no gain after losing XP, also after a death level-drop', () => {
    const lost = xpBar(5_300_000, 5_440_000);
    expect(lost.baseline).toBe(lost.progress);
    const drop = xpBar(5_000_000, 5_440_000); // level 24 now
    expect(levelFromXp(5_000_000)).toBe(24);
    expect(drop.baseline).toBe(drop.progress);
    expect(drop.progress).toBeCloseTo((5_000_000 - 4_440_000) / (5_090_000 - 4_440_000));
  });

  it('level 100 is full', () => {
    expect(xpBar(200_000_000, 150_000_000)).toEqual({ progress: 1, baseline: 1 });
  });

  it('TP uses the XP level and troll scaling', () => {
    // Level 5 by XP (15 000 – 30 000): TP 1000 → 1500 (troll 100 → 150).
    expect(tpBar(20_000, 1250, null).progress).toBeCloseTo(0.5);
    expect(tpBar(20_000, 125, null, 'troll').progress).toBeCloseTo(0.5);
    expect(tpBar(20_000, 150, null, 'troll').progress).toBe(1);
    expect(tpBar(20_000, 100, null).progress).toBe(0);
    const t = tpBar(20_000, 1400, 1100);
    expect(t.baseline).toBeCloseTo(0.2);
    expect(t.progress).toBeCloseTo(0.8);
  });
});

describe('bands', () => {
  it('knows the words case-insensitively', () => {
    expect(bandOf('hp', 'Wounded')).toEqual({ lo: 26, hi: 45 });
    expect(bandOf('mana', 'burning')).toEqual({ lo: 76, hi: 99 });
    expect(bandOf('mp', 'steadfast')).toEqual({ lo: 70, hi: 99 });
    expect(bandOf('hp', 'glowing')).toBeNull();
    expect(bandOf('hp', null)).toBeNull();
  });

  it('checks percent membership, null for an unknown word', () => {
    expect(inBand('hp', 45.4, 'wounded')).toBe(true);
    expect(inBand('hp', 46, 'wounded')).toBe(false);
    expect(inBand('hp', 100, 'healthy')).toBe(true);
    expect(inBand('hp', 50, 'weird')).toBeNull();
  });

  it('gives band midpoints as fractions', () => {
    expect(bandMidpoint('hp', 'dying')).toBe(0);
    expect(bandMidpoint('hp', 'healthy')).toBe(1);
    expect(bandMidpoint('hp', 'wounded')).toBeCloseTo(0.355);
    expect(bandMidpoint('mana', 'hot')).toBeCloseTo(0.605);
    expect(bandMidpoint('mp', 'x')).toBeNull();
  });

  it('covers 0–100 without gaps or overlaps', () => {
    for (const k of VITAL_KINDS) {
      const bands = Object.values(BANDS[k]).sort((a, b) => a.lo - b.lo);
      expect(bands[0]!.lo).toBe(0);
      expect(bands.at(-1)!.hi).toBe(100);
      for (let i = 1; i < bands.length; i++) expect(bands[i]!.lo).toBe(bands[i - 1]!.hi + 1);
    }
  });
});
