// Run storage for stage 6 (DB version 5, ADR 0018 "Storage"). Extends the
// capture store (src/capture/store.ts) with the run events and the fields
// History reads:
//
//   runs       + saved?: boolean, rating?: 0–5, savedUs?: µs | null,
//                summary?: RunSummary | null   (absent = the default)
//   runEvents  keyPath ['runId', 'seq']; { runId, seq, event: RunEvent }
//
// `summary` is what History lists from without reading events or chunks.
// The recorder keeps it current (`summarize`) in the same transaction as
// the events it summarises. A stage 6 run is created with `summary: null`
// and gets one at its `run_start`; a run captured before stage 6 has no
// `summary` field at all and is never deleted as too short.
//
// Orphans (a tab that closed mid-run) are sealed by `sealOrphan`: a run
// with a summary gets an `orphan_close` event (its `us` is the seal time)
// and is sealed at its last chunk's `lastUs`; one with `summary: null` had
// nothing but a login and is deleted.

import { idbDone as done, idbRequest as req, openWebcockpitDb } from '../core/db';
import { CaptureStore, type RunChunk, type RunMeta } from '../capture/store';
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

export interface RunEventRecord {
  runId: string;
  seq: number;
  event: RunEvent;
}

/** What one `append` writes. */
export interface RunAppend {
  chunk?: RunChunk;
  /** UTF-8 bytes and lines of `chunk`. */
  bytes?: number;
  lines?: number;
  events?: RunEventRecord[];
  /** The run's summary after `events` (undefined: unchanged). */
  summary?: RunSummary | null;
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

const runRange = (runId: string): IDBKeyRange => IDBKeyRange.bound([runId, 0], [runId, Infinity]);

export class RunStore extends CaptureStore {
  static override async open(factory?: IDBFactory): Promise<RunStore> {
    return new RunStore(await openWebcockpitDb(factory));
  }

  /**
   * Writes a chunk and/or events and the run's new totals and summary in
   * one transaction, so a run's meta always matches what is stored.
   */
  async append(runId: string, a: RunAppend): Promise<void> {
    const tx = this.db.transaction(['runs', 'runChunks', 'runEvents'], 'readwrite');
    const runs = tx.objectStore('runs');
    if (a.chunk) tx.objectStore('runChunks').put(a.chunk);
    if (a.events?.length) {
      const evs = tx.objectStore('runEvents');
      for (const e of a.events) evs.put(e);
    }
    const r = runs.get(runId);
    r.onsuccess = () => {
      const meta = r.result as RunMeta | undefined;
      if (!meta) return;
      meta.bytes += a.bytes ?? 0;
      meta.lines += a.lines ?? 0;
      if (a.summary !== undefined) meta.summary = a.summary;
      runs.put(meta);
    };
    await done(tx);
  }

  /** A run's events in `seq` order. */
  getEvents(runId: string): Promise<RunEventRecord[]> {
    const tx = this.db.transaction('runEvents', 'readonly');
    return req(tx.objectStore('runEvents').getAll(runRange(runId)) as IDBRequest<RunEventRecord[]>);
  }

  /** The highest event `seq` of a run, or -1. */
  async lastEventSeq(runId: string): Promise<number> {
    const tx = this.db.transaction('runEvents', 'readonly');
    const cursor = await req(tx.objectStore('runEvents').openCursor(runRange(runId), 'prev'));
    return (cursor?.value as RunEventRecord | undefined)?.seq ?? -1;
  }

  /** Deletes a run: its meta, chunks and events. */
  async deleteRun(runId: string): Promise<void> {
    const tx = this.db.transaction(['runs', 'runChunks', 'runEvents'], 'readwrite');
    tx.objectStore('runs').delete(runId);
    tx.objectStore('runChunks').delete(runRange(runId));
    tx.objectStore('runEvents').delete(runRange(runId));
    await done(tx);
  }

  /** A character's runs, oldest first. */
  runsOf(character: string): Promise<RunMeta[]> {
    const tx = this.db.transaction('runs', 'readonly');
    return req(tx.objectStore('runs').index('character').getAll(character) as IDBRequest<RunMeta[]>).then((rs) =>
      rs.sort((a, b) => a.startedUs - b.startedUs),
    );
  }

  /** The character's most recently started sealed run other than `exclude`. */
  async latestSealedRun(character: string, exclude?: string): Promise<RunMeta | undefined> {
    const runs = await this.runsOf(character);
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i]!;
      if (r.sealed && r.runId !== exclude) return r;
    }
    return undefined;
  }

  /** Applies `fn` to each run's meta in one transaction (save, rate). */
  async updateRuns(runIds: readonly string[], fn: (meta: RunMeta) => void): Promise<void> {
    const tx = this.db.transaction('runs', 'readwrite');
    const runs = tx.objectStore('runs');
    for (const id of runIds) {
      const r = runs.get(id);
      r.onsuccess = () => {
        const meta = r.result as RunMeta | undefined;
        if (!meta) return;
        fn(meta);
        runs.put(meta);
      };
    }
    await done(tx);
  }

  /**
   * Seals an orphan (the caller holds its character's lock): deleted when it
   * never started (`summary: null`), else sealed at its last chunk, with an
   * `orphan_close` event when it has a summary.
   */
  async sealOrphan(meta: RunMeta, nowUs: number): Promise<'sealed' | 'deleted'> {
    if (meta.summary === null) {
      await this.deleteRun(meta.runId);
      return 'deleted';
    }
    const last = await this.lastChunk(meta.runId);
    const endedUs = last ? last.lastUs : meta.startedUs;
    if (meta.summary === undefined) {
      await this.sealRun(meta.runId, endedUs);
      return 'sealed';
    }
    const seq = (await this.lastEventSeq(meta.runId)) + 1;
    const tx = this.db.transaction(['runs', 'runEvents'], 'readwrite');
    const runs = tx.objectStore('runs');
    tx.objectStore('runEvents').put({ runId: meta.runId, seq, event: { type: 'orphan_close', us: nowUs } });
    const r = runs.get(meta.runId);
    r.onsuccess = () => {
      const m = r.result as RunMeta | undefined;
      if (!m || m.sealed) return;
      m.sealed = true;
      m.endedUs = endedUs;
      if (m.summary && endedUs > m.summary.lastEventUs) m.summary = { ...m.summary, lastEventUs: endedUs };
      runs.put(m);
    };
    await done(tx);
    return 'sealed';
  }

  /** Adds a whole run (restore): meta, events and chunks in one transaction. */
  async putWholeRun(meta: RunMeta, events: RunEventRecord[], chunks: RunChunk[]): Promise<void> {
    const tx = this.db.transaction(['runs', 'runChunks', 'runEvents'], 'readwrite');
    tx.objectStore('runs').put(meta);
    const evs = tx.objectStore('runEvents');
    for (const e of events) evs.put(e);
    const cs = tx.objectStore('runChunks');
    for (const c of chunks) cs.put(c);
    await done(tx);
  }
}
