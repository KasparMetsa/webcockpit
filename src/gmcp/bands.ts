// Vital band strings (Inv §2.3 "Data"; Cockpit ADR 0052): MUME reports a
// member's hp/mana/moves as a number with a maximum and/or as a band word
// (`hp-string: "wounded"`). The bands are inclusive integer percent ranges.
// They decide whether a cached number still agrees with a newer word, and
// give a bar length (the band midpoint) when only the word is known.

export type VitalKind = 'hp' | 'mana' | 'mp';

export const VITAL_KINDS: readonly VitalKind[] = ['hp', 'mana', 'mp'];

/** One band: inclusive percent range. */
export interface Band {
  lo: number;
  hi: number;
}

const b = (lo: number, hi: number): Band => ({ lo, hi });

/** Band tables by kind, keyed by the lower-case word. */
export const BANDS: Readonly<Record<VitalKind, Readonly<Record<string, Band>>>> = {
  hp: {
    dying: b(0, 0),
    awful: b(1, 10),
    bad: b(11, 25),
    wounded: b(26, 45),
    hurt: b(46, 70),
    fine: b(71, 99),
    healthy: b(100, 100),
  },
  mana: {
    frozen: b(0, 0),
    icy: b(1, 10),
    cold: b(11, 25),
    warm: b(26, 45),
    hot: b(46, 75),
    burning: b(76, 99),
    full: b(100, 100),
  },
  // Placeholder calibration (Cockpit ADR 0052): a wrong edge only makes
  // the model drop a cached number sooner than needed.
  mp: {
    exhausted: b(0, 0),
    fainting: b(1, 4),
    weak: b(5, 14),
    slow: b(15, 29),
    tired: b(30, 49),
    rested: b(50, 69),
    steadfast: b(70, 99),
    unwearied: b(100, 100),
  },
};

/** The band for `word` (case-insensitive), or null for an unknown word. */
export function bandOf(kind: VitalKind, word: string | null | undefined): Band | null {
  if (typeof word !== 'string') return null;
  return BANDS[kind][word.trim().toLowerCase()] ?? null;
}

/**
 * Whether percent `pct` (0–100, rounded to an integer) lies in `word`'s
 * band: true / false, or null when the word is unknown.
 */
export function inBand(kind: VitalKind, pct: number, word: string | null | undefined): boolean | null {
  const band = bandOf(kind, word);
  if (!band) return null;
  const p = Math.round(pct);
  return p >= band.lo && p <= band.hi;
}

/** The band's midpoint as a fraction 0–1, or null for an unknown word. */
export function bandMidpoint(kind: VitalKind, word: string | null | undefined): number | null {
  const band = bandOf(kind, word);
  return band ? (band.lo + band.hi) / 200 : null;
}
