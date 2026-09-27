// Per-run summary (ADR 0018 "Storage"): what History lists from without
// reading events or chunks. Pure TS (the demo generator runs it in Node);
// the recorder folds each event in with `summarize` as it writes it.

import type { RunEvent } from './events';

/** Per-run summary for History (ADR 0018). */
export interface RunSummary {
  /** `run_start.us`. */
  startUs: number;
  /** The latest event's `us` (an orphan: at least its last chunk's time). */
  lastEventUs: number;
  /** Latest known level, XP and TP (baseline plus the events' deltas). */
  level?: number;
  xp?: number;
  tp?: number;
  kills: number;
  pkills: number;
  deaths: number;
  previousRunId?: string;
}

/**
 * The summary after `e` (a new object; `s` is not changed). Events before
 * `run_start` leave it null; `orphan_close` does not move `lastEventUs`.
 */
export function summarize(s: RunSummary | null | undefined, e: RunEvent): RunSummary | null {
  if (e.type === 'run_start') {
    const out: RunSummary = { startUs: e.us, lastEventUs: e.us, kills: 0, pkills: 0, deaths: 0 };
    if (e.level !== undefined) out.level = e.level;
    if (e.xp !== undefined) out.xp = e.xp;
    if (e.tp !== undefined) out.tp = e.tp;
    if (e.previousRunId !== undefined) out.previousRunId = e.previousRunId;
    return out;
  }
  if (!s) return null;
  const out: RunSummary = { ...s };
  if (e.type !== 'orphan_close' && e.us > out.lastEventUs) out.lastEventUs = e.us;
  switch (e.type) {
    case 'kill':
      out.kills++;
      if (out.xp !== undefined) out.xp += e.xpDelta;
      break;
    case 'pkill':
      out.pkills++;
      if (out.xp !== undefined) out.xp += e.xpDelta;
      break;
    case 'xp_loss':
      if (out.xp !== undefined) out.xp += e.xpDelta;
      break;
    case 'tp_gained':
    case 'tp_loss':
      if (out.tp !== undefined) out.tp += e.tpDelta;
      break;
    case 'level_up':
      out.level = e.level;
      break;
    case 'char_death':
      out.deaths++;
      if (e.level !== undefined) out.level = e.level;
      break;
  }
  return out;
}

/** The summary of a whole event list (restore, tests). */
export function summarizeAll(events: readonly RunEvent[]): RunSummary | null {
  let s: RunSummary | null = null;
  for (const e of events) s = summarize(s, e);
  return s;
}
