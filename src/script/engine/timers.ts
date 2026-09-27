// Injectable clock for #ticker and #delay (ADR 0015 "Timers use an
// injectable clock"). The engine only ever uses one-shot timers; tickers
// re-arm themselves against their planned time so they do not drift.

export interface Scheduler {
  /** Milliseconds, monotonic. */
  now(): number;
  /** Calls `fn` once after `ms`; returns a handle. */
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  now: () => performance.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** A manual clock for tests: `advance(ms)` runs due timers in time order. */
export class FakeScheduler implements Scheduler {
  private t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void; seq: number }>();

  now(): number {
    return this.t;
  }

  set(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn, seq: id });
    return id;
  }

  clear(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Number of pending timers. */
  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let best: [number, { at: number; fn: () => void; seq: number }] | null = null;
      for (const e of this.timers) {
        if (e[1].at > end) continue;
        if (!best || e[1].at < best[1].at || (e[1].at === best[1].at && e[1].seq < best[1].seq)) best = e;
      }
      if (!best) break;
      this.timers.delete(best[0]);
      this.t = Math.max(this.t, best[1].at);
      best[1].fn();
    }
    this.t = end;
  }
}
