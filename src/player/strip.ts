// Player chrome maths (Inv §7.5, ADR 0018): the right-edge strip with its
// half-block playhead, the K/D/A/L markers, the clock and the header. Pure,
// so the stage 7 HTML replay can draw the same strip.
//
// Row mapping (the same for the playhead and the markers, so a marker and
// the playhead meet on one row): `half = round(f × (rows × 2 − 1))`,
// `row = half >> 1`, upper half when `half` is even; `f` = offset /
// duration clamped to 0–1. A pointer at `y` px seeks to
// `f = (y − cellH / 2) / (height − cellH)`, so the top row's centre is the
// start and the bottom row's centre the end.

import type { RunEvent } from '../runs/events';

export const STRIP_COLS = 2;
export const MARK_COLS = 5;
export const COLOR = {
  played: '#9a9a9a',
  remaining: '#242424',
  playhead: '#ffaf00',
  mark: '#4d4d4d',
} as const;

/** Marker letters in their stacking order (Inv §7.5). */
export const MARK_ORDER = ['A', 'D', 'K', 'L'] as const;
export type MarkLetter = (typeof MARK_ORDER)[number];

export interface Marker {
  letter: MarkLetter;
  /** Log time of the event (`logUs ?? us`), µs. */
  us: number;
}

/** Markers of a chain's events: pkill → K, char_death → D, achievement → A, level_up → L. */
export function markersOf(events: readonly RunEvent[]): Marker[] {
  const out: Marker[] = [];
  for (const e of events) {
    let letter: MarkLetter | null = null;
    if (e.type === 'pkill') letter = 'K';
    else if (e.type === 'char_death') letter = 'D';
    else if (e.type === 'achievement') letter = 'A';
    else if (e.type === 'level_up') letter = 'L';
    if (letter) out.push({ letter, us: 'logUs' in e && typeof e.logUs === 'number' ? e.logUs : e.us });
  }
  return out;
}

function fraction(offset: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(1, offset / duration));
}

/** Row and half of `offset` on a strip of `rows` rows. */
export function offsetToRow(offset: number, duration: number, rows: number): { row: number; upper: boolean } {
  const half = Math.round(fraction(offset, duration) * (rows * 2 - 1));
  return { row: half >> 1, upper: (half & 1) === 0 };
}

export interface StripCell {
  ch: string;
  fg: string;
  bg: string;
}

/** One cell per row: played above the playhead, remaining below, the gold half-block on its row. */
export function stripCells(offset: number, duration: number, rows: number): StripCell[] {
  const { row, upper } = offsetToRow(offset, duration, rows);
  const out: StripCell[] = [];
  for (let r = 0; r < rows; r++) {
    if (r < row) out.push({ ch: '█', fg: COLOR.played, bg: COLOR.played });
    else if (r > row) out.push({ ch: '█', fg: COLOR.remaining, bg: COLOR.remaining });
    else if (upper) out.push({ ch: '▀', fg: COLOR.playhead, bg: COLOR.remaining });
    else out.push({ ch: '▄', fg: COLOR.playhead, bg: COLOR.played });
  }
  return out;
}

/** Playback offset for a pointer `y` px down a strip `height` px high. */
export function yToOffset(y: number, height: number, cellH: number, duration: number): number {
  const span = height - cellH;
  const f = span > 0 ? (y - cellH / 2) / span : 0;
  return Math.max(0, Math.min(1, f)) * duration;
}

export interface MarkRow {
  row: number;
  /** Stacked letters plus `►`, e.g. `K►`, `ADKL►`. */
  text: string;
  /** The earliest marker offset on the row (a click seeks there). */
  offset: number;
}

/** Markers (as playback offsets) grouped by strip row, top to bottom. */
export function markRows(
  marks: ReadonlyArray<{ letter: MarkLetter; offset: number }>,
  duration: number,
  rows: number,
): MarkRow[] {
  const byRow = new Map<number, { letters: Set<MarkLetter>; offset: number }>();
  for (const m of marks) {
    if (m.offset < 0 || m.offset > duration) continue;
    const { row } = offsetToRow(m.offset, duration, rows);
    const cur = byRow.get(row);
    if (cur) {
      cur.letters.add(m.letter);
      cur.offset = Math.min(cur.offset, m.offset);
    } else byRow.set(row, { letters: new Set([m.letter]), offset: m.offset });
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, v]) => ({ row, offset: v.offset, text: MARK_ORDER.filter((l) => v.letters.has(l)).join('') + '►' }));
}

/** One key hint on the header's right (stage 7: any player mode brings its own list). */
export interface HeaderHint {
  text: string;
  /** Order of giving way when narrow (1 first); Infinity = always shown. */
  drop: number;
  /** Clickable (e.g. `ESC Back`). */
  onClick?: () => void;
  /** Class of its span (a clickable hint without one gets `wc-player-click`). */
  cls?: string;
}

/**
 * Key hints on the header's right, in display order; `drop` is the order
 * they give way in when the header is narrow (1 first). `ESC Back` stays.
 */
export const HINTS: ReadonlyArray<HeaderHint> = [
  { text: 'Space Play/Pause', drop: 3 },
  { text: '1–6 Speed', drop: 2 },
  { text: '↑↓ Cursor', drop: 1 },
  { text: 'ESC Back', drop: Infinity },
];
export const HINT_SEP = ' · ';

/** Cells the hints take joined by ` · `. */
export function hintsWidth(tokens: readonly string[]): number {
  return tokens.reduce((n, t) => n + t.length, 0) + HINT_SEP.length * Math.max(0, tokens.length - 1);
}

/**
 * The hints that fit in `cols` cells, dropping the lowest priority first;
 * the last one left always stays unless its `drop` is finite (`ESC Back`
 * in the log player).
 */
export function fitHints(cols: number, hints: ReadonlyArray<HeaderHint> = HINTS): string[] {
  const keep = [...hints];
  while (keep.length > 0 && hintsWidth(keep.map((h) => h.text)) > cols) {
    let low = 0;
    for (let i = 1; i < keep.length; i++) if (keep[i]!.drop < keep[low]!.drop) low = i;
    if (keep.length === 1 && keep[low]!.drop === Infinity) break;
    keep.splice(low, 1);
  }
  return keep.map((h) => h.text);
}

/** `MM:SS` with unbounded minutes (`78:34`). */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** `YYYY-MM-DD HH:MM`, local time. */
export function fmtDateTime(us: number): string {
  const d = new Date(us / 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Speed label for the control box (`0.25x` … `8x`). */
export function fmtSpeed(s: number): string {
  return `${s}x`;
}
