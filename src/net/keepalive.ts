// Keep-alive and link RTT (ADR 0002, ADR 0007 as amended, Inv §9.4).
//
// - Every `intervalMs` (10 s) a GMCP `Core.Ping` goes out, whatever other
//   traffic there is, so the `Link:` readout stays fresh during active
//   play. The same pings keep an idle connection alive.
// - One ping is outstanding at a time: a tick with a ping still
//   unanswered sends nothing. A ping unanswered for `staleMs` (60 s) is
//   given up and the next tick sends a new one, so a lost reply cannot
//   stop the keep-alive for good.
// - MUME answers with `Core.Ping`; the reply gives the round trip in ms.
// - When the outstanding ping has had no reply for `timeoutMs` (10 s),
//   `link.rtt` is emitted with `suspect: true`. The link is not closed.
//   The next reply clears it.
// - `sendPing` returns false while GMCP is not enabled; the tick then
//   just waits for the next one.
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
  /** Ping interval in ms (default 10 000). */
  intervalMs?: number;
  /** No reply after this long marks the link suspect (default 10 000). */
  timeoutMs?: number;
  /** An unanswered ping is given up after this long (default 60 000). */
  staleMs?: number;
}

export class KeepAlive {
  private readonly o: KeepAliveOptions;
  private readonly t: Timers;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly staleMs: number;

  private running = false;
  private tickTimer: unknown = null;
  private suspectTimer: unknown = null;
  /** Send time of the outstanding ping, or null. */
  private outstanding: number | null = null;
  private lastRtt: number | null = null;
  private isSuspect = false;

  constructor(opts: KeepAliveOptions) {
    this.o = opts;
    this.t = opts.timers ?? realTimers;
    this.intervalMs = opts.intervalMs ?? 10_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.staleMs = opts.staleMs ?? 60_000;
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

  /** Starts the ping interval. Resets RTT state and emits `link.rtt`. */
  start(): void {
    this.stop();
    this.running = true;
    this.lastRtt = null;
    this.isSuspect = false;
    this.emit();
    this.armTick();
  }

  /** Stops all timers and forgets the outstanding ping. */
  stop(): void {
    this.running = false;
    this.clearTick();
    this.clearSuspect();
    this.outstanding = null;
  }

  /** Call when the server's `Core.Ping` arrives. */
  notePong(): void {
    if (!this.running) return;
    const sent = this.outstanding;
    if (sent === null) return; // unsolicited
    this.outstanding = null;
    this.lastRtt = Math.max(0, Math.round(this.t.now() - sent));
    this.isSuspect = false;
    this.clearSuspect();
    this.emit();
  }

  private emit(): void {
    this.o.bus.emit('link.rtt', { ms: this.lastRtt, suspect: this.isSuspect });
  }

  private armTick(): void {
    this.clearTick();
    this.tickTimer = this.t.setTimeout(this.onTick, this.intervalMs);
  }

  private clearTick(): void {
    if (this.tickTimer !== null) this.t.clearTimeout(this.tickTimer);
    this.tickTimer = null;
  }

  private clearSuspect(): void {
    if (this.suspectTimer !== null) this.t.clearTimeout(this.suspectTimer);
    this.suspectTimer = null;
  }

  private readonly onTick = (): void => {
    this.tickTimer = null;
    if (!this.running) return;
    this.armTick();
    const now = this.t.now();
    if (this.outstanding !== null && now - this.outstanding < this.staleMs) return;
    if (!this.o.sendPing()) return;
    this.outstanding = now;
    // A given-up ping leaves the link suspect until a reply arrives.
    if (!this.isSuspect) {
      this.clearSuspect();
      this.suspectTimer = this.t.setTimeout(this.onSuspect, this.timeoutMs);
    }
  };

  private readonly onSuspect = (): void => {
    this.suspectTimer = null;
    if (!this.running || this.isSuspect) return;
    this.isSuspect = true;
    this.emit();
  };
}
