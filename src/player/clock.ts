// The replay clock (ADR 0018 "Replay clock", ADR 0017 "Time"): log time for
// a player App. It is the App's `now` (ms since the epoch), its `clockUs`
// (line and command timestamps) and its `Scheduler` (#ticker/#delay, the
// timers hub tick and saves, the run events' kill fold). The engine moves
// it forward as the replay goes (`advanceTo`), at any speed and through a
// fast-forward, so every timer fires at its log time relative to the lines
// around it. It never goes back: a backward seek builds a new App with a
// new clock.
//
// A long jump (a collapsed gap) does not run a periodic timer once per
// period across it: the clock first moves to `CATCH_UP_US` before the
// target, and timers due before that fire at that time.

import type { Scheduler } from '../script/engine/timers';

/** Longest stretch timers are replayed through period by period, µs. */
export const CATCH_UP_US = 60_000_000;

interface Pending {
  id: number;
  /** Due time, µs. */
  at: number;
  fn: () => void;
}

export class ReplayClock implements Scheduler {
  private us: number;
  private seq = 0;
  private pending: Pending[] = [];

  constructor(startUs = 0) {
    this.us = startUs;
  }

  /** Log time in ms. */
  now(): number {
    return this.us / 1000;
  }

  /** Log time in µs. */
  nowUs(): number {
    return this.us;
  }

  set(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.pending.push({ id, at: this.us + Math.max(0, ms) * 1000, fn });
    return id;
  }

  clear(handle: unknown): void {
    const i = this.pending.findIndex((p) => p.id === handle);
    if (i >= 0) this.pending.splice(i, 1);
  }

  /** Timers waiting (tests, dispose checks). */
  get size(): number {
    return this.pending.length;
  }

  /** Moves to `us` (never back), firing due timers in time order at their time. */
  advanceTo(us: number): void {
    if (us <= this.us) {
      this.runDue(this.us);
      return;
    }
    if (us - this.us > CATCH_UP_US) {
      this.runDue(this.us);
      this.us = us - CATCH_UP_US;
    }
    this.runDue(us);
    this.us = us;
  }

  /**
   * Moves the clock to `us`, backwards too, shifting every pending timer by
   * the same amount (a spotlight reel's next run is older than the last).
   */
  rebase(us: number): void {
    const d = us - this.us;
    if (d === 0) return;
    for (const p of this.pending) p.at += d;
    this.us = us;
  }

  private runDue(limit: number): void {
    for (;;) {
      let best: Pending | null = null;
      for (const p of this.pending) {
        if (p.at <= limit && (!best || p.at < best.at || (p.at === best.at && p.id < best.id))) best = p;
      }
      if (!best) return;
      this.pending.splice(this.pending.indexOf(best), 1);
      if (best.at > this.us) this.us = best.at;
      try {
        best.fn();
      } catch (err) {
        console.error('[player] timer failed', err);
      }
    }
  }

  /** Drops every timer (the App is gone). */
  dispose(): void {
    this.pending.length = 0;
  }
}
