// Timers state per character (ADR 0017 "Persistence"): one IndexedDB record
// per character, replaced whole on every save.
//
//   database `webcockpit`, store `timers` (src/core/db.ts, version 4)
//     keyPath 'character'   { character, savedAt, state }
//
// `state` belongs to the hub and its trackers (src/timers/hub.ts, versioned
// `v: 1`); the archive stores it as given (structured clone). Usage (the
// hub):
//
//   const archive = await TimersArchive.open(ctx.openDb);  // rejects without IndexedDB
//   const rec = await archive.load('Rasta');               // null when none
//   await archive.save('Rasta', state);                    // savedAt = now()
//
// Every call is its own transaction; transactions on the one connection run
// in the order they were created, so a save followed by a load sees the
// save. The database may close under us (another tab upgrading it); calls
// then reject and the caller carries on in memory.

import { STORE, idbDone, idbRequest } from '../core/db';

/** One stored record. */
export interface TimersRecord {
  /** Character name from `Char.Name`, verbatim. */
  character: string;
  /** Save time, ms since the epoch. */
  savedAt: number;
  /** The hub's state (`{ v: 1, … }`). */
  state: unknown;
}

export interface TimersArchiveOptions {
  /** Clock in ms (default `Date.now`). */
  now?: () => number;
}

export class TimersArchive {
  readonly db: IDBDatabase;
  private readonly now: () => number;

  constructor(db: IDBDatabase, opts: TimersArchiveOptions = {}) {
    this.db = db;
    this.now = opts.now ?? Date.now;
  }

  /** Opens the archive with the context's lazy database opener. */
  static async open(openDb: () => Promise<IDBDatabase>, opts: TimersArchiveOptions = {}): Promise<TimersArchive> {
    return new TimersArchive(await openDb(), opts);
  }

  /** The record of `character`, or null. */
  async load(character: string): Promise<TimersRecord | null> {
    const tx = this.db.transaction(STORE.timers, 'readonly');
    const done = idbDone(tx);
    const rec = await idbRequest(tx.objectStore(STORE.timers).get(character));
    await done;
    const r = rec as Partial<TimersRecord> | undefined;
    if (!r || typeof r !== 'object' || r.character !== character) return null;
    return { character, savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0, state: r.state ?? null };
  }

  /** Replaces the record of `character`; resolves once committed. */
  async save(character: string, state: unknown): Promise<void> {
    const tx = this.db.transaction(STORE.timers, 'readwrite');
    const done = idbDone(tx);
    const rec: TimersRecord = { character, savedAt: this.now(), state };
    tx.objectStore(STORE.timers).put(rec);
    await done;
  }
}
