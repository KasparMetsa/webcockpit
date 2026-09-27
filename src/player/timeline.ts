// Log player timeline (ADR 0018 "Log player"): a session's runs, parsed
// once into one list of timed entries. Pure (no DOM, no App), so the stage 7
// HTML replay can reuse it with the engine.
//
// Every capture line (src/capture/format.ts) is an entry: inbound text,
// an outbound command, or a GMCP / VIEW / SIZE record (unknown records and
// malformed lines are dropped). Entries of all runs are in chain order and
// stored column-wise in typed arrays (a 5 h run is ~100 000 entries):
//
//   run[i]    index of the run (0-based) in `runs`
//   ts[i]     log time, µs since the epoch (the capture timestamp)
//   play[i]   playback time, ms from the chain start (see below)
//   kind[i]   ENTRY_*
//   body      the text after `<ts> ` (and after `> ` / the record type),
//             sliced lazily from the run's text with `start` / `end`
//
// Playback time follows the log time, except that a gap longer than 10 s
// between two entries (inside a run or between runs) takes no playback
// time (Inv §7.5): idle stretches and the pause between two runs of a
// session play instantly, while the log time still jumps by the real gap.
//
// Lead-in (owner feedback 2026-09-28): each run's entries up to and
// including its first visible one (an inbound line with some non-blank
// text, or a command the output echoes) take no playback time either. The
// recorder writes the GMCP of the login phase (Comm.Channel.List at
// connect, then Char.Name after the password) with its receive times, and
// the VIEW / SIZE / Char.Vitals records before the first text; played in
// real time that is seconds of a blank screen. So a run starts showing
// text at once: at 00:00 for the first run, and straight after the last
// entry of the previous run for the others. Nothing is dropped: the
// lead-in's entries are delivered at the same playback time, in order, on
// their own log times.
//
// Mappings (all by binary search):
//   countAt(p)        entries with play ≤ p (what has been shown at p)
//   logUsAt(p)        log time at playback time p (moves with p inside a
//                     kept gap, stands still over a collapsed one)
//   playAtLogUs(us)   playback time of log time us (markers, the cursor)
//   runAt(p)          the run playing at p

import type { RunMeta } from '../capture/store';
import { PLAYING_COMMANDS } from '../net/session';

/** Gaps longer than this (µs) take no playback time (Inv §7.5). */
export const GAP_COLLAPSE_US = 10_000_000;

export const ENTRY_IN = 0;
export const ENTRY_OUT = 1;
export const ENTRY_GMCP = 2;
export const ENTRY_VIEW = 3;
export const ENTRY_SIZE = 4;

/** One run of the chain as the player reads it. */
export interface ChainRun {
  meta: RunMeta;
  /** The run's capture text (RunLibrary.chainLog). */
  text: string;
}

export interface TimelineRun {
  meta: RunMeta;
  text: string;
  /** Index of the run's first entry, and one past its last. */
  first: number;
  end: number;
}

export interface Timeline {
  runs: TimelineRun[];
  /** Number of entries. */
  n: number;
  run: Uint16Array;
  kind: Uint8Array;
  ts: Float64Array;
  play: Float64Array;
  start: Uint32Array;
  end: Uint32Array;
  /** Playback length in ms (the last entry's `play`; 0 when empty). */
  durationMs: number;
}

const TS_DIGITS = 16;

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

/** True when `text[b, e)` has a character other than blanks and SGR sequences. */
export function hasInk(text: string, b: number, e: number): boolean {
  for (let i = b; i < e; i++) {
    const c = text.charCodeAt(i);
    if (c === 27 && text.charCodeAt(i + 1) === 91) {
      // ESC [ … final byte (0x40–0x7E).
      i += 2;
      while (i < e) {
        const f = text.charCodeAt(i);
        if (f >= 0x40 && f <= 0x7e) break;
        i++;
      }
      continue;
    }
    if (c !== 32 && c !== 9 && c !== 13 && c !== 160) return true;
  }
  return false;
}

/** Parses the runs of a chain (oldest first) into one timeline. */
export function buildTimeline(chain: readonly ChainRun[]): Timeline {
  // Upper bound on entries: the newlines in every text (+1 each).
  let cap = 0;
  for (const r of chain) {
    let k = 1;
    for (let p = r.text.indexOf('\n'); p >= 0; p = r.text.indexOf('\n', p + 1)) k++;
    cap += k;
  }
  const run = new Uint16Array(cap);
  const kind = new Uint8Array(cap);
  const ts = new Float64Array(cap);
  const play = new Float64Array(cap);
  const start = new Uint32Array(cap);
  const end = new Uint32Array(cap);
  const runs: TimelineRun[] = [];
  let n = 0;
  let lastTs = -1;
  let clock = 0;

  for (let r = 0; r < chain.length; r++) {
    const { meta, text } = chain[r]!;
    const first = n;
    const len = text.length;
    /** Still in the run's lead-in (nothing visible yet). */
    let lead = true;
    let pos = 0;
    while (pos < len) {
      let nl = text.indexOf('\n', pos);
      if (nl < 0) nl = len;
      let e = nl;
      if (e > pos && text.charCodeAt(e - 1) === 13) e--;
      const s = pos;
      pos = nl + 1;
      if (e - s < TS_DIGITS + 1 || text.charCodeAt(s + TS_DIGITS) !== 32) continue;
      let ok = true;
      for (let k = s; k < s + TS_DIGITS; k++) {
        if (!isDigit(text.charCodeAt(k))) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      let b = s + TS_DIGITS + 1;
      let k: number = ENTRY_IN;
      const c0 = text.charCodeAt(b);
      if (c0 === 62 && text.charCodeAt(b + 1) === 32 && b + 1 < e) {
        // "> cmd" ("> " alone is an empty Enter); a bare ">" is a prompt.
        k = ENTRY_OUT;
        b += 2;
      } else if (c0 === 27) {
        const c1 = text.charCodeAt(b + 1);
        if (c1 >= 65 && c1 <= 90) {
          const sp = text.indexOf(' ', b);
          const type = text.slice(b + 1, sp < 0 || sp > e ? e : sp);
          if (type === 'GMCP') k = ENTRY_GMCP;
          else if (type === 'VIEW') k = ENTRY_VIEW;
          else if (type === 'SIZE') k = ENTRY_SIZE;
          else continue;
          if (sp < 0 || sp >= e) continue; // every known record has a payload
          b = sp + 1;
        }
      }
      const t = Number(text.slice(s, s + TS_DIGITS));
      if (lead) {
        // The lead-in and its first visible entry take no playback time.
        if (k === ENTRY_IN ? hasInk(text, b, e) : k === ENTRY_OUT && b < e && !PLAYING_COMMANDS.includes(text.slice(b, e))) {
          lead = false;
        }
      } else if (lastTs >= 0) {
        const d = t - lastTs;
        if (d > 0 && d <= GAP_COLLAPSE_US) clock += d / 1000;
      }
      lastTs = t;
      run[n] = r;
      kind[n] = k;
      ts[n] = t;
      play[n] = clock;
      start[n] = b;
      end[n] = e;
      n++;
    }
    runs.push({ meta, text, first, end: n });
  }
  return {
    runs,
    n,
    run: run.slice(0, n),
    kind: kind.slice(0, n),
    ts: ts.slice(0, n),
    play: play.slice(0, n),
    start: start.slice(0, n),
    end: end.slice(0, n),
    durationMs: n > 0 ? play[n - 1]! : 0,
  };
}

/** The body text of entry `i`. */
export function entryText(tl: Timeline, i: number): string {
  return tl.runs[tl.run[i]!]!.text.slice(tl.start[i]!, tl.end[i]!);
}

/** Number of entries with `play ≤ p`. */
export function countAt(tl: Timeline, p: number): number {
  let lo = 0;
  let hi = tl.n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tl.play[mid]! <= p) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Log time (µs) at playback time `p` (ms). */
export function logUsAt(tl: Timeline, p: number): number {
  if (tl.n === 0) return 0;
  const k = countAt(tl, p);
  if (k === 0) return tl.ts[0]!;
  const i = k - 1;
  const us = tl.ts[i]! + Math.max(0, p - tl.play[i]!) * 1000;
  return i + 1 < tl.n ? Math.min(us, tl.ts[i + 1]!) : us;
}

/**
 * Playback time (ms) of log time `us`: the entry at or before it, plus the
 * time since, unless the gap after that entry was collapsed.
 */
export function playAtLogUs(tl: Timeline, us: number): number {
  if (tl.n === 0) return 0;
  let lo = 0;
  let hi = tl.n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tl.ts[mid]! <= us) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  const i = lo - 1;
  if (i + 1 >= tl.n) return tl.play[i]!;
  const next = tl.play[i + 1]!;
  if (next === tl.play[i]!) return next;
  return Math.min(next, tl.play[i]! + (us - tl.ts[i]!) / 1000);
}

/** Index of the run playing at `p` (the run of the last entry shown; 0 before any). */
export function runAt(tl: Timeline, p: number): number {
  const k = countAt(tl, p);
  return k === 0 ? 0 : tl.run[k - 1]!;
}
