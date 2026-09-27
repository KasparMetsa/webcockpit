// IndexedDB storage for raw run capture (ADR 0006, ADR 0008).
//
// Database `webcockpit`, version 1:
//
//   runs       keyPath 'runId'
//              { runId, character, startedUs, endedUs: number|null,
//                sealed: boolean, bytes, lines }
//              indexes: 'character' → character, 'startedUs' → startedUs
//   runChunks  keyPath ['runId', 'seq']
//              { runId, seq, firstUs, lastUs, text }
//
// `bytes` is the UTF-8 size of all chunk texts, `lines` the number of
// captured lines. Later stores (profiles, settings, run events, map) are
// added by bumping the version; the upgrade handler must stay a chain of
// `if (oldVersion < N)` steps so every older database upgrades in order.
// When a second module needs the database, move `openWebcockpitDb` to a
// shared core module.

export const DB_NAME = 'webcockpit';
export const DB_VERSION = 1;

export interface RunMeta {
  runId: string;
  character: string;
  startedUs: number;
  endedUs: number | null;
  sealed: boolean;
  bytes: number;
  lines: number;
}

export interface RunChunk {
  runId: string;
  seq: number;
  firstUs: number;
  lastUs: number;
  text: string;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

let persistAsked = false;

/** Asks once per page for persistent storage (ADR 0006). Never throws. */
export function requestPersistence(): void {
  if (persistAsked) return;
  persistAsked = true;
  try {
    const p = globalThis.navigator?.storage?.persist?.();
    p?.catch(() => {});
  } catch {
    /* not available */
  }
}

/** Opens (and creates or upgrades) the `webcockpit` database. */
export function openWebcockpitDb(factory: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new Error('IndexedDB unavailable'));
  requestPersistence();
  return new Promise((resolve, reject) => {
    const r = factory.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (ev) => {
      const db = r.result;
      if (ev.oldVersion < 1) {
        const runs = db.createObjectStore('runs', { keyPath: 'runId' });
        runs.createIndex('character', 'character');
        runs.createIndex('startedUs', 'startedUs');
        db.createObjectStore('runChunks', { keyPath: ['runId', 'seq'] });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('database upgrade blocked by another tab'));
  });
}

export class CaptureStore {
  constructor(readonly db: IDBDatabase) {}

  static async open(factory?: IDBFactory): Promise<CaptureStore> {
    return new CaptureStore(await openWebcockpitDb(factory));
  }

  async putRun(meta: RunMeta): Promise<void> {
    const tx = this.db.transaction('runs', 'readwrite');
    tx.objectStore('runs').put(meta);
    await done(tx);
  }

  getRun(runId: string): Promise<RunMeta | undefined> {
    const tx = this.db.transaction('runs', 'readonly');
    return req(tx.objectStore('runs').get(runId) as IDBRequest<RunMeta | undefined>);
  }

  /** All runs, oldest first by start time. */
  listRuns(): Promise<RunMeta[]> {
    const tx = this.db.transaction('runs', 'readonly');
    return req(tx.objectStore('runs').index('startedUs').getAll() as IDBRequest<RunMeta[]>);
  }

  /** The most recently started run, if any. */
  async latestRun(): Promise<RunMeta | undefined> {
    const tx = this.db.transaction('runs', 'readonly');
    const cursor = await req(tx.objectStore('runs').index('startedUs').openCursor(null, 'prev'));
    return (cursor?.value as RunMeta | undefined) ?? undefined;
  }

  /**
   * Writes one chunk and bumps the run's `bytes`/`lines` in the same
   * transaction, so a run's totals always match its chunks.
   */
  async appendChunk(chunk: RunChunk, bytes: number, lines: number): Promise<void> {
    const tx = this.db.transaction(['runs', 'runChunks'], 'readwrite');
    const runs = tx.objectStore('runs');
    tx.objectStore('runChunks').put(chunk);
    const r = runs.get(chunk.runId);
    r.onsuccess = () => {
      const meta = r.result as RunMeta | undefined;
      if (!meta) return;
      meta.bytes += bytes;
      meta.lines += lines;
      runs.put(meta);
    };
    await done(tx);
  }

  /** Marks a run sealed with `endedUs`. */
  async sealRun(runId: string, endedUs: number): Promise<void> {
    const tx = this.db.transaction('runs', 'readwrite');
    const runs = tx.objectStore('runs');
    const r = runs.get(runId);
    r.onsuccess = () => {
      const meta = r.result as RunMeta | undefined;
      if (!meta || meta.sealed) return;
      meta.sealed = true;
      meta.endedUs = endedUs;
      runs.put(meta);
    };
    await done(tx);
  }

  /** A run's chunks in sequence order. */
  getChunks(runId: string): Promise<RunChunk[]> {
    const tx = this.db.transaction('runChunks', 'readonly');
    const range = IDBKeyRange.bound([runId, 0], [runId, Infinity]);
    return req(tx.objectStore('runChunks').getAll(range) as IDBRequest<RunChunk[]>);
  }

  /** The last chunk of a run, if any. */
  async lastChunk(runId: string): Promise<RunChunk | undefined> {
    const tx = this.db.transaction('runChunks', 'readonly');
    const range = IDBKeyRange.bound([runId, 0], [runId, Infinity]);
    const cursor = await req(tx.objectStore('runChunks').openCursor(range, 'prev'));
    return (cursor?.value as RunChunk | undefined) ?? undefined;
  }

  close(): void {
    this.db.close();
  }
}
