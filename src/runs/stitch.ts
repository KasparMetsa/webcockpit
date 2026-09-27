// Sessions: runs stitched into chains (Inv §7.2 "Linking", §7.4, ADR 0018
// "Sessions"). Pure TS over run metas; History lists from this alone.
//
// - A run joins its predecessor's chain when its `summary.previousRunId`
//   names that run (same character, with a summary) and it started less
//   than an hour after the predecessor's last event. Runs without a summary
//   (captured before stage 6) are chains of their own.
// - A session is saved when any run is saved; its rating is the highest
//   rating among the saved runs. It expires 14 days after its oldest run
//   started, unless saved.

import type { RunMeta } from '../capture/store';

/** Largest gap between a run's start and its predecessor's last event, µs. */
export const STITCH_GAP_US = 3600 * 1e6;
/** Unsaved runs are kept this many days (Inv §7.8). */
export const RETENTION_DAYS = 14;
export const DAY_US = 86_400 * 1e6;

/** One History row: a chain of runs (ADR 0018). */
export interface Session {
  /** The first run's id. */
  id: string;
  character: string;
  /** Oldest first. */
  runs: RunMeta[];
  /** First run's `run_start` (its meta start for older runs), µs. */
  startUs: number;
  /** Last run's end (seal time; the last event while it is recording), µs. */
  endUs: number;
  saved: boolean;
  /** 0–5: the highest rating of the saved runs. */
  rating: number;
  /** Some run has captured text. */
  hasLog: boolean;
  /** Days until retention removes it (floor 0); null when saved. */
  expiresDays: number | null;
  /** The last known level. */
  level?: number;
}

/** A run's start for stitching and display: `run_start`, else the meta's. */
export function runStartUs(m: RunMeta): number {
  return m.summary?.startUs ?? m.startedUs;
}

/** A run's end: the seal time, else its last event, else its start. */
export function runEndUs(m: RunMeta): number {
  return m.endedUs ?? m.summary?.lastEventUs ?? m.startedUs;
}

/** Days left of retention for a chain whose oldest run started at `startedUs`. */
export function expiresDays(startedUs: number, nowUs: number): number {
  return Math.max(0, Math.ceil((startedUs + RETENTION_DAYS * DAY_US - nowUs) / DAY_US));
}

/** Groups runs into chains (each oldest first), in order of their first run. */
export function stitchChains(metas: readonly RunMeta[]): RunMeta[][] {
  const sorted = [...metas].sort((a, b) => a.startedUs - b.startedUs);
  const byId = new Map<string, RunMeta>();
  for (const m of sorted) byId.set(m.runId, m);
  const chainOf = new Map<string, RunMeta[]>();
  const chains: RunMeta[][] = [];
  for (const m of sorted) {
    const prevId = m.summary?.previousRunId;
    const pred = prevId !== undefined ? byId.get(prevId) : undefined;
    const chain =
      pred && m.summary && pred.summary && pred.character === m.character && runStartUs(m) - pred.summary.lastEventUs < STITCH_GAP_US
        ? chainOf.get(pred.runId)
        : undefined;
    if (chain) chain.push(m);
    else chains.push([m]);
    chainOf.set(m.runId, chain ?? chains[chains.length - 1]!);
  }
  return chains;
}

/** A chain as a session. */
export function toSession(runs: RunMeta[], nowUs: number): Session {
  const first = runs[0]!;
  const last = runs[runs.length - 1]!;
  let saved = false;
  let rating = 0;
  let hasLog = false;
  let oldest = first.startedUs;
  let level: number | undefined;
  for (const r of runs) {
    if (r.saved) {
      saved = true;
      rating = Math.max(rating, r.rating ?? 0);
    }
    if (r.bytes > 0) hasLog = true;
    if (r.startedUs < oldest) oldest = r.startedUs;
    if (r.summary?.level !== undefined) level = r.summary.level;
  }
  const s: Session = {
    id: first.runId,
    character: first.character,
    runs,
    startUs: runStartUs(first),
    endUs: runEndUs(last),
    saved,
    rating,
    hasLog,
    expiresDays: saved ? null : expiresDays(oldest, nowUs),
  };
  if (level !== undefined) s.level = level;
  return s;
}

/** Sessions of `metas`, newest first. */
export function stitchSessions(metas: readonly RunMeta[], nowUs: number): Session[] {
  return stitchChains(metas)
    .map((c) => toSession(c, nowUs))
    .sort((a, b) => b.startUs - a.startUs);
}
