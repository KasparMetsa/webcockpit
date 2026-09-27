// Style-run edits for the display pipeline: overlay a highlight on a range
// and replace a range of text (substitute). Runs follow the Line contract:
// sorted, non-overlapping, default-style gaps, adjacent equal runs merged.

import type { StyleRun } from '../../core/types';
import { type Style, isDefaultStyle, pushRun } from './color';

/** The style at `pos` (a copy without range), or {} in a gap. */
export function styleAt(runs: readonly StyleRun[], pos: number): Style {
  for (const r of runs) {
    if (r.start > pos) break;
    if (pos < r.end) {
      const { start: _s, end: _e, ...s } = r;
      return s;
    }
  }
  return {};
}

function withRange(s: Style, start: number, end: number): StyleRun {
  return { start, end, ...s };
}

/**
 * Sets the fields of `patch` on `[start, end)`; other fields keep the
 * line's style. Returns new runs (the input is not changed).
 */
export function overlay(runs: readonly StyleRun[], len: number, start: number, end: number, patch: Style): StyleRun[] {
  if (start >= end) return runs.slice();
  const out: StyleRun[] = [];
  const add = (s: Style, a: number, b: number): void => {
    if (a >= b || isDefaultStyle(s)) return;
    pushRun(out, withRange(s, a, b));
  };
  // Walk every boundary in [0, len), splitting runs at start/end.
  let pos = 0;
  let i = 0;
  const cut = [start, end];
  while (pos < len) {
    while (runs[i] && runs[i]!.end <= pos) i++;
    const r = runs[i];
    let segEnd: number;
    let base: Style;
    if (r && r.start <= pos) {
      segEnd = r.end;
      const { start: _s, end: _e, ...s } = r;
      base = s;
    } else {
      segEnd = r ? r.start : len;
      base = {};
    }
    for (const c of cut) if (c > pos && c < segEnd) segEnd = c;
    const inside = pos >= start && pos < end;
    add(inside ? { ...base, ...patch } : base, pos, segEnd);
    pos = segEnd;
    if (r && pos >= r.end) i++;
  }
  return out;
}

/**
 * Replaces `[start, end)` of `text` with `ins` (runs relative to `ins`).
 * Runs after the range move by the length difference.
 */
export function splice(
  text: string,
  runs: readonly StyleRun[],
  start: number,
  end: number,
  ins: string,
  insRuns: readonly StyleRun[],
): { text: string; runs: StyleRun[] } {
  const delta = ins.length - (end - start);
  const out: StyleRun[] = [];
  for (const r of runs) {
    if (r.end <= start) pushRun(out, { ...r });
    else if (r.start < start) pushRun(out, { ...r, end: start });
  }
  for (const r of insRuns) pushRun(out, { ...r, start: r.start + start, end: r.end + start });
  for (const r of runs) {
    if (r.start >= end) pushRun(out, { ...r, start: r.start + delta, end: r.end + delta });
    else if (r.end > end) pushRun(out, { ...r, start: end + delta, end: r.end + delta });
  }
  return { text: text.slice(0, start) + ins + text.slice(end), runs: out };
}
