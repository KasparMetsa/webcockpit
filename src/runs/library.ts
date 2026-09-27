// The run library (ADR 0018 "RunLibrary"): what History, Statistics and the
// log player read, and the retention sweep and backups.
//
//   listSessions(now)   sealed runs stitched into sessions, newest first
//   characters()        characters with sealed runs, alphabetical
//   events(ids)         the runs' events in time order
//   chainLog(ids)       each run's meta and its capture text
//   chainOf(id, now)    the session holding a run, the unsealed one included
//   save / remove       per chain (every run); Delete is the only way out
//   sweep(now)          under the Web Lock `webcockpit-sweep` (one tab):
//                       seals orphans whose lock is free, then deletes every
//                       unsaved sealed run that started over 14 days ago
//   backup / restore    all sealed runs as one gzip JSON-lines file
//   estimate()          navigator.storage.estimate()
//
// Backup format (`webcockpit-runs-YYYY-MM-DD.jsonl.gz`, `zcat` reads it):
//
//   {"type":"webcockpit-runs","schema":1,"exportedUs":…}
//   {"type":"run","run":{…RunMeta}}
//   {"type":"event","runId":…,"seq":…,"event":{…}}      (that run's events)
//   {"type":"chunk","runId":…,"seq":…,"firstUs":…,"lastUs":…,"text":…}
//   … the next run …
//
// Restore reads the file twice: the first pass checks every line (a bad
// file is rejected before anything is written), the second adds each run
// whose `runId` is not stored yet, one transaction per run.

import type { RunChunk, RunMeta } from '../capture/store';
import { type LockManagerLike, acquire, runLockName } from '../capture/recorder';
import type { RunEvent } from './events';
import { type RunEventRecord, RunStore } from './store';
import { DAY_US, RETENTION_DAYS, type Session, stitchChains, stitchSessions, toSession } from './stitch';

/** Web Lock held by the tab that sweeps. */
export const SWEEP_LOCK = 'webcockpit-sweep';
export const BACKUP_TYPE = 'webcockpit-runs';
export const BACKUP_SCHEMA = 1;

/** `webcockpit-runs-2026-09-27.jsonl.gz` (local date). */
export function backupFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `webcockpit-runs-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.jsonl.gz`;
}

/** Thrown by `restore` for a file that is not a readable backup. */
export class BadBackupError extends Error {
  override name = 'BadBackupError';
}

export interface RunLibraryOptions {
  /** Web Locks; default `navigator.locks`. `null`: no sweep lock, no orphan sealing. */
  locks?: LockManagerLike | null;
  /** Storage estimate; default `navigator.storage`. */
  storage?: { estimate(): Promise<{ usage?: number; quota?: number }> } | null;
}

export class RunLibrary {
  private readonly locks: LockManagerLike | null;
  private readonly storage: RunLibraryOptions['storage'];

  constructor(
    readonly store: RunStore,
    opts: RunLibraryOptions = {},
  ) {
    const nav = globalThis.navigator as Navigator | undefined;
    this.locks = opts.locks !== undefined ? opts.locks : (nav?.locks ?? null);
    this.storage = opts.storage !== undefined ? opts.storage : (nav?.storage ?? null);
  }

  static async open(factory?: IDBFactory, opts?: RunLibraryOptions): Promise<RunLibrary> {
    return new RunLibrary(await RunStore.open(factory), opts);
  }

  // ------------------------------------------------------------------ read

  /** Sessions of sealed runs, newest first (the active run is never listed). */
  async listSessions(nowUs: number): Promise<Session[]> {
    const runs = (await this.store.listRuns()).filter((r) => r.sealed);
    return stitchSessions(runs, nowUs);
  }

  /** Characters with sealed runs, alphabetical. */
  async characters(): Promise<string[]> {
    const set = new Set<string>();
    for (const r of await this.store.listRuns()) if (r.sealed) set.add(r.character);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /** The events of `runIds`, in time order (stable: `seq` order within a run). */
  async events(runIds: readonly string[]): Promise<RunEvent[]> {
    const out: RunEvent[] = [];
    for (const id of runIds) for (const r of await this.store.getEvents(id)) out.push(r.event);
    return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.us - b.e.us || a.i - b.i).map((x) => x.e);
  }

  /** Each run's meta and capture text (chunks joined), in the given order. */
  async chainLog(runIds: readonly string[]): Promise<Array<{ meta: RunMeta; text: string }>> {
    const out: Array<{ meta: RunMeta; text: string }> = [];
    for (const id of runIds) {
      const meta = await this.store.getRun(id);
      if (!meta) continue;
      const chunks = await this.store.getChunks(id);
      out.push({ meta, text: chunks.map((c) => c.text).join('') });
    }
    return out;
  }

  /**
   * The session that holds `runId`, stitched over the character's sealed
   * runs plus that run even when it is not sealed (the live run).
   */
  async chainOf(runId: string, nowUs: number): Promise<Session | null> {
    const meta = await this.store.getRun(runId);
    if (!meta) return null;
    const runs = (await this.store.runsOf(meta.character)).filter((r) => r.sealed || r.runId === runId);
    const chain = stitchChains(runs).find((c) => c.some((r) => r.runId === runId));
    return chain ? toSession(chain, nowUs) : null;
  }

  // ----------------------------------------------------------------- write

  /**
   * Saves every run of the session. With `rating` (0–5) every run gets it;
   * without, each run keeps its own.
   */
  async save(session: Session, rating?: number, nowUs: number = Date.now() * 1000): Promise<void> {
    const r = rating === undefined ? undefined : Math.max(0, Math.min(5, Math.round(rating)));
    await this.store.updateRuns(
      session.runs.map((m) => m.runId),
      (m) => {
        m.saved = true;
        m.savedUs = nowUs;
        if (r !== undefined) m.rating = r;
        else m.rating ??= 0;
      },
    );
  }

  /** Deletes every run of the session (meta, chunks, events). */
  async remove(session: Session): Promise<void> {
    for (const m of session.runs) await this.store.deleteRun(m.runId);
  }

  /**
   * Retention (Inv §7.8): seals orphans whose lock is free, then deletes
   * unsaved sealed runs that started more than 14 days before `nowUs`.
   * Only one tab sweeps (Web Lock, `ifAvailable`). Resolves with the number
   * of runs deleted; never rejects.
   */
  async sweep(nowUs: number): Promise<number> {
    try {
      if (!this.locks) return await this.sweepLocked(nowUs);
      let n = 0;
      await this.locks.request(SWEEP_LOCK, { ifAvailable: true }, async (lock) => {
        if (lock) n = await this.sweepLocked(nowUs);
      });
      return n;
    } catch (err) {
      console.error('[runs] sweep failed', err);
      return 0;
    }
  }

  private async sweepLocked(nowUs: number): Promise<number> {
    let deleted = 0;
    const cutoff = nowUs - RETENTION_DAYS * DAY_US;
    for (const r of await this.store.listRuns()) {
      if (r.sealed) {
        if (!r.saved && r.startedUs < cutoff) {
          await this.store.deleteRun(r.runId);
          deleted++;
        }
        continue;
      }
      if (!this.locks) continue;
      const release = await acquire(this.locks, runLockName(r.character));
      if (!release) continue;
      try {
        if ((await this.store.sealOrphan(r, nowUs)) === 'deleted') deleted++;
        else if (!r.saved && r.startedUs < cutoff) {
          await this.store.deleteRun(r.runId);
          deleted++;
        }
      } finally {
        release();
      }
    }
    return deleted;
  }

  /** Storage use of the origin, or null when the browser cannot tell. */
  async estimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      const e = await this.storage?.estimate();
      if (!e || typeof e.usage !== 'number' || typeof e.quota !== 'number') return null;
      return { usage: e.usage, quota: e.quota };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- backup

  /** Every sealed run as a gzip JSON-lines file (see the file header). */
  async backup(nowUs: number = Date.now() * 1000): Promise<Blob> {
    const parts: string[] = [JSON.stringify({ type: BACKUP_TYPE, schema: BACKUP_SCHEMA, exportedUs: nowUs }) + '\n'];
    for (const meta of await this.store.listRuns()) {
      if (!meta.sealed) continue;
      parts.push(JSON.stringify({ type: 'run', run: meta }) + '\n');
      for (const e of await this.store.getEvents(meta.runId)) parts.push(JSON.stringify({ type: 'event', ...e }) + '\n');
      for (const c of await this.store.getChunks(meta.runId)) parts.push(JSON.stringify({ type: 'chunk', ...c }) + '\n');
    }
    return gzip(new Blob(parts));
  }

  /**
   * Adds the runs of a backup file that are not stored yet. Rejects with
   * `BadBackupError` (nothing written) when the file is not a valid backup.
   */
  async restore(file: Blob): Promise<{ added: number; skipped: number }> {
    // Pass 1: check everything.
    let header = false;
    let cur: string | null = null;
    let n = 0;
    try {
      for await (const text of readLines(file)) {
        n++;
        if (!text) continue;
        const o = parseLine(text, n);
        if (!header) {
          if (o.type !== BACKUP_TYPE || o.schema !== BACKUP_SCHEMA) throw new BadBackupError('Not a WebCockpit runs backup.');
          header = true;
          continue;
        }
        cur = checkRecord(o, cur, n);
      }
    } catch (err) {
      if (err instanceof BadBackupError) throw err;
      throw new BadBackupError('The file could not be read as a gzip backup.');
    }
    if (!header) throw new BadBackupError('Not a WebCockpit runs backup.');

    // Pass 2: write the new runs.
    const have = new Set((await this.store.listRuns()).map((r) => r.runId));
    let added = 0;
    let skipped = 0;
    let run: { meta: RunMeta; events: RunEventRecord[]; chunks: RunChunk[] } | null = null;
    const flush = async (): Promise<void> => {
      if (!run) return;
      const r = run;
      run = null;
      if (have.has(r.meta.runId)) {
        skipped++;
        return;
      }
      have.add(r.meta.runId);
      await this.store.putWholeRun(r.meta, r.events, r.chunks);
      added++;
    };
    let first = true;
    for await (const text of readLines(file)) {
      if (!text) continue;
      if (first) {
        first = false;
        continue;
      }
      const o = JSON.parse(text) as Record<string, unknown>;
      if (o.type === 'run') {
        await flush();
        const meta = { ...(o.run as RunMeta) };
        if (!meta.sealed) {
          meta.sealed = true;
          meta.endedUs ??= meta.startedUs;
        }
        run = { meta, events: [], chunks: [] };
      } else if (o.type === 'event') {
        run!.events.push({ runId: o.runId as string, seq: o.seq as number, event: o.event as RunEvent });
      } else if (o.type === 'chunk') {
        run!.chunks.push({
          runId: o.runId as string,
          seq: o.seq as number,
          firstUs: o.firstUs as number,
          lastUs: o.lastUs as number,
          text: o.text as string,
        });
      }
    }
    await flush();
    return { added, skipped };
  }
}

// ------------------------------------------------------------ file helpers

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function parseLine(text: string, n: number): Rec {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new BadBackupError(`Line ${n} is not JSON.`);
  }
  if (!isRec(o)) throw new BadBackupError(`Line ${n} is not a record.`);
  return o;
}

/** Checks one record line; returns the run the following lines belong to. */
function checkRecord(o: Rec, cur: string | null, n: number): string | null {
  const bad = (what: string): never => {
    throw new BadBackupError(`Line ${n}: ${what}.`);
  };
  switch (o.type) {
    case 'run': {
      const m = o.run;
      if (!isRec(m)) return bad('run without meta');
      if (!isStr(m.runId) || !m.runId || !isStr(m.character) || !isNum(m.startedUs)) return bad('bad run meta');
      if (!(m.endedUs === null || isNum(m.endedUs)) || typeof m.sealed !== 'boolean') return bad('bad run meta');
      if (!isNum(m.bytes) || !isNum(m.lines)) return bad('bad run meta');
      if (m.summary !== undefined && m.summary !== null && !(isRec(m.summary) && isNum(m.summary.startUs) && isNum(m.summary.lastEventUs)))
        return bad('bad run summary');
      return m.runId;
    }
    case 'event':
      if (o.runId !== cur || cur === null) return bad('event outside its run');
      if (!isNum(o.seq) || !isRec(o.event) || !isStr(o.event.type) || !isNum(o.event.us)) return bad('bad event');
      return cur;
    case 'chunk':
      if (o.runId !== cur || cur === null) return bad('chunk outside its run');
      if (!isNum(o.seq) || !isNum(o.firstUs) || !isNum(o.lastUs) || !isStr(o.text)) return bad('bad chunk');
      return cur;
    default:
      return bad('unknown record');
  }
}

async function gzip(blob: Blob): Promise<Blob> {
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  const out = await new Response(stream).blob();
  return new Blob([out], { type: 'application/gzip' });
}

/** The lines of a gzip text file, without their `\n`. */
async function* readLines(file: Blob): AsyncGenerator<string> {
  const reader = file
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let rest = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += value;
      let start = 0;
      for (let i = rest.indexOf('\n'); i >= 0; i = rest.indexOf('\n', start)) {
        yield rest.slice(start, i);
        start = i + 1;
      }
      rest = rest.slice(start);
    }
    if (rest) yield rest;
  } finally {
    reader.cancel().catch(() => {});
  }
}
