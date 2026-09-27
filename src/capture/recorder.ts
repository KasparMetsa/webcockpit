// Raw run recorder (Inv §7.1, spec §1.4, §2.8, ADR 0006, ADR 0008).
//
// - A run starts when the connection reaches `playing` (after GMCP
//   Char.Name) and is sealed when it leaves `playing`.
// - Lines are formatted into strings as they arrive and kept in memory; a
//   chunk is written every `flushMs` (2 s) and on pagehide / hidden. There
//   is no IndexedDB work per line.
// - One writer per character: the Web Lock `webcockpit-run-<name>` is held
//   for the whole run. If another tab holds it, this tab does not record.
// - Unsealed runs whose lock is free are orphans (a crashed or closed tab)
//   and are sealed at their last chunk's `lastUs` on start-up, and for the
//   character whenever a new run for it starts.
// - Every store operation runs on one promise chain, so start, flushes and
//   seal are strictly ordered.
// - Replays are never captured: a `conn.state` with `replay` never starts a
//   run, even when recorded GMCP takes the replay to `playing`.
//
// Client records (format.ts, ADR 0016):
// - GMCP: every inbound message (`gmcp.raw`) except Core.Ping replies, at
//   its frame's receive time. Messages that arrive on the connection before
//   the run starts (Comm.Channel.List, the Char.Name that starts it …) are
//   kept, up to `PRE_RUN_GMCP_MAX`, and written first when the run starts.
// - VIEW / SIZE: the latest `view.settings` / `view.size` are written when
//   the run starts, and again `VIEW_DEBOUNCE_MS` after a change (the last
//   value wins), and at the end of the run if a change is still pending.

import type { Bus } from '../core/bus';
import { type ConnState, nowUs } from '../core/types';
import { RECORD, formatGmcpRecord, formatInbound, formatOutbound, formatRecord, makeRunId } from './format';
import { CaptureStore, type RunMeta } from './store';

export const FLUSH_MS = 2000;
/** GMCP lines kept from before the run starts on one connection. */
export const PRE_RUN_GMCP_MAX = 64;
/** Delay before a changed view (settings, size) is written. */
export const VIEW_DEBOUNCE_MS = 500;

/** Web Lock name for a character's run. */
export function runLockName(character: string): string {
  return 'webcockpit-run-' + character;
}

/** The subset of `LockManager` the recorder uses (injectable for tests). */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
}

export interface RecorderOptions {
  /** Opens the store; default `CaptureStore.open()`. */
  openStore?: () => Promise<CaptureStore>;
  /** Web Locks; default `navigator.locks`. `null` means unavailable. */
  locks?: LockManagerLike | null;
  /** Called with a short status text whenever it changes. */
  onStatus?: (text: string) => void;
  /** Chunk interval in ms (default 2000). */
  flushMs?: number;
  /** Window for pagehide/visibilitychange; default `globalThis.window`. */
  win?: Window | null;
  /** Clock in µs (default `nowUs`). */
  now?: () => number;
  /** Debounce of VIEW / SIZE records in ms (default 500). */
  viewDebounceMs?: number;
}

export const STATUS = {
  idle: 'capture: idle',
  recording: 'capture: recording',
  anotherTab: 'capture: another tab',
  noDb: 'capture: off (no IndexedDB)',
  noLocks: 'capture: off (no Web Locks)',
  error: 'capture: error',
} as const;

export class Recorder {
  private readonly opts: RecorderOptions;
  private readonly locks: LockManagerLike | null;
  private readonly now: () => number;
  private readonly storeP: Promise<CaptureStore | null>;
  private chain: Promise<void> = Promise.resolve();

  private state: ConnState = 'idle';
  private character: string | null = null;
  /** True from `playing` until the run stops (lines are being buffered). */
  private active = false;
  /** Set once a start was attempted for the current `playing` period. */
  private triedThisPlaying = false;
  private current: string | null = null;
  private release: (() => void) | null = null;
  private seq = 0;
  /** Bumped per start; a stale failed start must not touch a newer one. */
  private session = 0;

  private buf: string[] = [];
  private bufFirstUs = 0;
  private bufLastUs = 0;

  /** The current connection is a replay (never recorded). */
  private replay = false;
  /** GMCP lines of this connection from before the run started. */
  private preRun: { ts: number; line: string }[] = [];
  /** Latest view payloads seen, and the ones written in this run. */
  private viewJson = '';
  private sizeJson = '';
  private viewWritten = '';
  private sizeWritten = '';
  private viewTimer: ReturnType<typeof setTimeout> | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private statusText = '';
  private readonly unsubs: Array<() => void> = [];
  private readonly win: Window | null;
  private readonly encoder = new TextEncoder();

  constructor(bus: Bus, opts: RecorderOptions = {}) {
    this.opts = opts;
    this.now = opts.now ?? nowUs;
    this.locks =
      opts.locks !== undefined
        ? opts.locks
        : ((globalThis.navigator as Navigator | undefined)?.locks ?? null);
    this.win = opts.win !== undefined ? opts.win : (globalThis.window ?? null);

    const open = opts.openStore ?? (() => CaptureStore.open());
    this.storeP = open().then(
      (s) => s,
      () => null,
    );
    this.enqueue(async () => {
      const store = await this.storeP;
      if (!store) return this.setStatus(STATUS.noDb);
      if (!this.locks) return this.setStatus(STATUS.noLocks);
      if (!this.statusText) this.setStatus(STATUS.idle);
      await this.sealOrphans(store, null);
    });

    this.unsubs.push(
      bus.on('gmcp', (m) => {
        if (m.pkg.toLowerCase() !== 'char.name') return;
        const n = (m.data as { name?: unknown } | undefined)?.name;
        if (typeof n === 'string' && n) {
          this.character = n;
          this.maybeStart();
        }
      }),
      bus.on('conn.state', (s) => {
        const was = this.state;
        this.state = s.state;
        this.replay = s.replay === true;
        if (s.state === 'connecting') this.preRun = [];
        if (s.state === 'playing') this.maybeStart();
        else if (was === 'playing') this.stop();
      }),
      bus.on('gmcp.raw', (m) => {
        if (m.pkg === 'Core.Ping' || this.replay) return;
        const ts = m.ts ?? this.now();
        const line = formatGmcpRecord(ts, m.pkg, m.json);
        if (this.active) this.capture(ts, line);
        else if (this.state === 'login' || this.state === 'connecting') {
          this.preRun.push({ ts, line });
          if (this.preRun.length > PRE_RUN_GMCP_MAX) this.preRun.shift();
        }
      }),
      bus.on('view.settings', (v) => {
        this.viewJson = v.json;
        this.viewChanged();
      }),
      bus.on('view.size', (v) => {
        this.sizeJson = JSON.stringify({ cols: v.cols, rows: v.rows });
        this.viewChanged();
      }),
      bus.on('text.line', (line) => {
        if (this.active) this.capture(line.ts, formatInbound(line.ts, line.raw));
      }),
      bus.on('cmd.sent', (c) => {
        // echo:false commands were still sent, so they are captured; a
        // replayed log's commands were not sent now.
        if (this.active && !c.secret && !c.replay) this.capture(c.ts, formatOutbound(c.ts, c.text));
      }),
    );

    this.win?.addEventListener('pagehide', this.onHide);
    this.win?.document?.addEventListener('visibilitychange', this.onVisibility);
  }

  /** The run being recorded, or null. */
  get runId(): string | null {
    return this.current;
  }

  get status(): string {
    return this.statusText;
  }

  /** The store, or null when IndexedDB is unavailable. */
  getStore(): Promise<CaptureStore | null> {
    return this.storeP;
  }

  /** Writes buffered lines now; resolves when all queued work is done. */
  flush(): Promise<void> {
    this.enqueue(() => this.writeChunk());
    return this.chain;
  }

  /** Resolves when all queued store work is done (for tests). */
  idle(): Promise<void> {
    return this.chain;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.win?.removeEventListener('pagehide', this.onHide);
    this.win?.document?.removeEventListener('visibilitychange', this.onVisibility);
    if (this.active) this.stop();
  }

  // --------------------------------------------------------------- capture

  private capture(ts: number, s: string): void {
    if (this.buf.length === 0) this.bufFirstUs = ts;
    this.bufLastUs = ts;
    this.buf.push(s);
  }

  private readonly onHide = (): void => {
    if (this.active) void this.flush();
  };

  private readonly onVisibility = (): void => {
    if (this.win?.document?.visibilityState === 'hidden') this.onHide();
  };

  // ------------------------------------------------------------- lifecycle

  private maybeStart(): void {
    if (this.state !== 'playing' || this.replay || !this.character || this.active || this.triedThisPlaying) return;
    this.triedThisPlaying = true;
    this.active = true;
    this.buf = [];
    // GMCP from before the start (it includes the Char.Name that started
    // the run), then the view, at the start frame's time.
    let ts = 0;
    for (const p of this.preRun) {
      this.capture(p.ts, p.line);
      ts = p.ts;
    }
    this.preRun = [];
    this.viewWritten = '';
    this.sizeWritten = '';
    this.writeView(ts || this.now());
    const character = this.character;
    const startedUs = this.now();
    const runId = makeRunId(character, new Date(startedUs / 1000));
    const session = ++this.session;
    this.enqueue(() => this.startRun(session, character, runId, startedUs));
    const ms = this.opts.flushMs ?? FLUSH_MS;
    this.timer = setInterval(() => {
      if (this.buf.length) this.enqueue(() => this.writeChunk());
    }, ms);
  }

  private async startRun(
    session: number,
    character: string,
    runId: string,
    startedUs: number,
  ): Promise<void> {
    const store = await this.storeP;
    const fail = (status: string) => {
      if (session === this.session) this.abandon();
      this.setStatus(status);
    };
    if (!store) return fail(STATUS.noDb);
    if (!this.locks) return fail(STATUS.noLocks);
    const release = await acquire(this.locks, runLockName(character));
    if (!release) return fail(STATUS.anotherTab);
    this.release = release;
    // We hold the character's lock: any unsealed run of theirs is an orphan.
    await this.sealOrphans(store, character);
    // Two runs of one character within the same second: keep both.
    let id = runId;
    for (let n = 2; await store.getRun(id); n++) id = runId + '-' + n;
    const meta: RunMeta = {
      runId: id,
      character,
      startedUs,
      endedUs: null,
      sealed: false,
      bytes: 0,
      lines: 0,
    };
    await store.putRun(meta);
    this.current = id;
    this.seq = 0;
    this.setStatus(STATUS.recording);
  }

  /** Gives up recording for this playing period (no lock / no store). */
  private abandon(): void {
    this.active = false;
    this.buf = [];
    this.clearTimer();
    this.release?.();
    this.release = null;
  }

  private stop(): void {
    this.triedThisPlaying = false;
    if (!this.active) return;
    this.writeView(this.now());
    this.active = false;
    this.clearTimer();
    const endedUs = this.now();
    this.enqueue(async () => {
      await this.writeChunk();
      const runId = this.current;
      if (runId) {
        const store = await this.storeP;
        await store?.sealRun(runId, endedUs);
      }
      this.current = null;
      this.release?.();
      this.release = null;
      if (this.statusText === STATUS.recording) this.setStatus(STATUS.idle);
    });
  }

  private clearTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.viewTimer !== null) clearTimeout(this.viewTimer);
    this.viewTimer = null;
  }

  // ------------------------------------------------------------------ view

  private viewChanged(): void {
    if (!this.active || this.viewTimer !== null) return;
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      if (this.active) this.writeView(this.now());
    }, this.opts.viewDebounceMs ?? VIEW_DEBOUNCE_MS);
  }

  /** Writes the VIEW / SIZE records whose value differs from the last written. */
  private writeView(ts: number): void {
    if (this.viewJson && this.viewJson !== this.viewWritten) {
      this.viewWritten = this.viewJson;
      this.capture(ts, formatRecord(ts, RECORD.view, this.viewJson));
    }
    if (this.sizeJson && this.sizeJson !== this.sizeWritten) {
      this.sizeWritten = this.sizeJson;
      this.capture(ts, formatRecord(ts, RECORD.size, this.sizeJson));
    }
  }

  private async writeChunk(): Promise<void> {
    const runId = this.current;
    if (!runId || this.buf.length === 0) return;
    const store = await this.storeP;
    if (!store) return;
    const lines = this.buf.length;
    const text = this.buf.join('');
    const firstUs = this.bufFirstUs;
    const lastUs = this.bufLastUs;
    this.buf = [];
    const bytes = this.encoder.encode(text).byteLength;
    await store.appendChunk({ runId, seq: this.seq++, firstUs, lastUs, text }, bytes, lines);
  }

  /**
   * Seals unsealed runs whose character lock is free. With `heldFor` set,
   * this tab holds that character's lock, so their runs are sealed directly.
   */
  private async sealOrphans(store: CaptureStore, heldFor: string | null): Promise<void> {
    const runs = await store.listRuns();
    for (const r of runs) {
      if (r.sealed || r.runId === this.current) continue;
      if (heldFor !== null) {
        if (r.character === heldFor) await sealAtLastChunk(store, r);
        continue;
      }
      if (!this.locks) return;
      const release = await acquire(this.locks, runLockName(r.character));
      if (!release) continue;
      try {
        await sealAtLastChunk(store, r);
      } finally {
        release();
      }
    }
  }

  // ----------------------------------------------------------------- misc

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch((err: unknown) => {
      console.error('[capture]', err);
      this.setStatus(STATUS.error);
    });
  }

  private setStatus(text: string): void {
    if (text === this.statusText) return;
    this.statusText = text;
    this.opts.onStatus?.(text);
  }
}

async function sealAtLastChunk(store: CaptureStore, r: RunMeta): Promise<void> {
  const last = await store.lastChunk(r.runId);
  await store.sealRun(r.runId, last ? last.lastUs : r.startedUs);
}

/**
 * Tries to take a Web Lock without waiting. Resolves with a release
 * function, or null when another holder has it.
 */
function acquire(locks: LockManagerLike, name: string): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch(reject);
  });
}
