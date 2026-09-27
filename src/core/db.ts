// The one IndexedDB database of the app (ADR 0006, ADR 0008, ADR 0010).
//
// Database `webcockpit`:
//
//   version 1 (stage 1, capture — see src/capture/store.ts)
//     runs       keyPath 'runId'   indexes 'character', 'startedUs'
//     runChunks  keyPath ['runId', 'seq']
//   version 2 (stage 2)
//     settings   out-of-line keys; one record under key 'main' (src/settings)
//     profiles   keyPath 'name'; { name, text, created, modified } (ADR 0010)
//   version 3 (stage 4)
//     comm       keyPath 'seq' (autoIncrement); one record per Comm message
//                indexes 'character_ts' ['character', 'ts'], 'ts'
//                (src/gmcp/comm-archive.ts, ADR 0016)
//   version 4 (stage 5)
//     timers     keyPath 'character'; one record per character
//                { character, savedAt, state } (src/timers/archive.ts, ADR 0017)
//
// The upgrade handler is a chain of `if (oldVersion < N)` steps, so every
// older database upgrades in order. Add a step (and bump DB_VERSION) for
// every new store; never edit an old step.
//
// Every connection closes itself on `versionchange`, so a tab running newer
// code can upgrade the database while this tab stays open. The module that
// owns a connection must be ready for its transactions to fail afterwards.

export const DB_NAME = 'webcockpit';
export const DB_VERSION = 4;

/** Object store names, for callers outside this module. */
export const STORE = {
  runs: 'runs',
  runChunks: 'runChunks',
  settings: 'settings',
  profiles: 'profiles',
  comm: 'comm',
  timers: 'timers',
} as const;

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
        const runs = db.createObjectStore(STORE.runs, { keyPath: 'runId' });
        runs.createIndex('character', 'character');
        runs.createIndex('startedUs', 'startedUs');
        db.createObjectStore(STORE.runChunks, { keyPath: ['runId', 'seq'] });
      }
      if (ev.oldVersion < 2) {
        db.createObjectStore(STORE.settings);
        db.createObjectStore(STORE.profiles, { keyPath: 'name' });
      }
      if (ev.oldVersion < 3) {
        const comm = db.createObjectStore(STORE.comm, { keyPath: 'seq', autoIncrement: true });
        comm.createIndex('character_ts', ['character', 'ts']);
        comm.createIndex('ts', 'ts');
      }
      if (ev.oldVersion < 4) {
        db.createObjectStore(STORE.timers, { keyPath: 'character' });
      }
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('database upgrade blocked by another tab'));
  });
}

/** Resolves with a request's result. */
export function idbRequest<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Resolves when a transaction commits. */
export function idbDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}
