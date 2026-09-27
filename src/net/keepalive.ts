// Keep-alive and link RTT (ADR 0002, ADR 0007, Inv §9.4).
//
// - After `idleMs` (30 s) without outbound bytes, a GMCP `Core.Ping` goes
//   out. Any outbound traffic (commands, GMCP, NAWS, the ping itself)
//   restarts the idle timer.
// - MUME answers with `Core.Ping`. Each reply is matched to the oldest
//   outstanding ping (FIFO) and gives the round trip in ms.
// - When the oldest outstanding ping has had no reply for `timeoutMs`
//   (10 s), `link.rtt` is emitted with `suspect: true`. The link is not
//   closed. The next reply clears it.
// - Runs only between `start()` and `stop()`; Session calls those on the
//   login/playing edges.

import type { Bus } from '../core/bus';

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Monotonic milliseconds. */
  now(): number;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};

export interface KeepAliveOptions {
  bus: Bus;
  /** Sends GMCP `Core.Ping`. Returns false when it could not be sent. */
  sendPing: () => boolean;
  timers?: Timers;
  idleMs?: number;
  timeoutMs?: number;
}

const MAX_OUTSTANDING = 8;

export class KeepAlive {
  private readonly o: KeepAliveOptions;
  private readonly t: Timers;
  private readonly idleMs: number;
  private readonly timeoutMs: number;

  private running = false;
  private idleTimer: unknown = null;
  private suspectTimer: unknown = null;
  private readonly outstanding: number[] = [];
  private lastRtt: number | null = null;
  private isSuspect = false;
  private sendingPing = false;

  constructor(opts: KeepAliveOptions) {
    this.o = opts;
    this.t = opts.timers ?? realTimers;
    this.idleMs = opts.idleMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Last round trip in ms, or null before the first reply. */
  get rtt(): number | null {
    return this.lastRtt;
  }

  get suspect(): boolean {
    return this.isSuspect;
  }

  get active(): boolean {
    return this.running;
  }

  /** Starts the idle timer. Resets RTT state and emits `link.rtt`. */
  start(): void {
    this.stop();
    this.running = true;
    this.lastRtt = null;
    this.isSuspect = false;
    this.emit();
    this.armIdle();
  }

  /** Stops all timers and forgets outstanding pings. */
  stop(): void {
    this.running = false;
    this.clearIdle();
    this.clearSuspect();
    this.outstanding.length = 0;
  }

  /** Call on every outbound write. Restarts the idle timer. */
  noteOutbound(): void {
    if (!this.running || this.sendingPing) return;
    this.armIdle();
  }

  /** Call when the server's `Core.Ping` arrives. */
  notePong(): void {
    if (!this.running) return;
    const sent = this.outstanding.shift();
    if (sent === undefined) return; // unsolicited
    this.lastRtt = Math.max(0, Math.round(this.t.now() - sent));
    this.isSuspect = false;
    this.clearSuspect();
    if (this.outstanding.length) this.armSuspect(this.outstanding[0]!);
    this.emit();
  }

  private emit(): void {
    this.o.bus.emit('link.rtt', { ms: this.lastRtt, suspect: this.isSuspect });
  }

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = this.t.setTimeout(this.onIdle, this.idleMs);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) this.t.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private armSuspect(sentAt: number): void {
    this.clearSuspect();
    const due = Math.max(0, sentAt + this.timeoutMs - this.t.now());
    this.suspectTimer = this.t.setTimeout(this.onSuspect, due);
  }

  private clearSuspect(): void {
    if (this.suspectTimer !== null) this.t.clearTimeout(this.suspectTimer);
    this.suspectTimer = null;
  }

  private readonly onIdle = (): void => {
    this.idleTimer = null;
    if (!this.running) return;
    this.sendingPing = true;
    let ok = false;
    try {
      ok = this.o.sendPing();
    } finally {
      this.sendingPing = false;
    }
    if (ok) {
      const now = this.t.now();
      if (this.outstanding.length >= MAX_OUTSTANDING) this.outstanding.shift();
      this.outstanding.push(now);
      if (this.suspectTimer === null && !this.isSuspect) this.armSuspect(this.outstanding[0]!);
    }
    this.armIdle();
  };

  private readonly onSuspect = (): void => {
    this.suspectTimer = null;
    if (!this.running || this.isSuspect) return;
    this.isSuspect = true;
    this.emit();
  };
}
