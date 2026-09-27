import { describe, expect, it } from 'vitest';
import { Bus } from '../../src/core/bus';
import type { BusEvents } from '../../src/core/types';
import { KeepAlive, type Timers } from '../../src/net/keepalive';

/** Deterministic fake clock with timers. */
class FakeTimers implements Timers {
  t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers.delete(h as number);
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}

function make() {
  const bus = new Bus();
  const timers = new FakeTimers();
  const rtts: BusEvents['link.rtt'][] = [];
  bus.on('link.rtt', (p) => rtts.push(p));
  let pings = 0;
  let enabled = true;
  const ka = new KeepAlive({
    bus,
    timers,
    sendPing: () => {
      if (!enabled) return false;
      pings++;
      ka.noteOutbound(); // the ping itself is outbound traffic
      return true;
    },
  });
  return { ka, timers, rtts, pings: () => pings, setEnabled: (v: boolean) => (enabled = v) };
}

describe('KeepAlive', () => {
  it('pings after 30 s of outbound silence and measures RTT', () => {
    const k = make();
    k.ka.start();
    expect(k.rtts).toEqual([{ ms: null, suspect: false }]);
    k.timers.advance(29_999);
    expect(k.pings()).toBe(0);
    k.timers.advance(1);
    expect(k.pings()).toBe(1);
    k.timers.advance(42);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 42, suspect: false });
  });

  it('resets the idle timer on any outbound bytes', () => {
    const k = make();
    k.ka.start();
    k.timers.advance(20_000);
    k.ka.noteOutbound();
    k.timers.advance(20_000);
    expect(k.pings()).toBe(0);
    k.timers.advance(10_000);
    expect(k.pings()).toBe(1);
  });

  it('marks the link suspect after 10 s without a pong, and recovers', () => {
    const k = make();
    k.ka.start();
    k.timers.advance(30_000);
    k.timers.advance(9_999);
    expect(k.rtts.at(-1)!.suspect).toBe(false);
    k.timers.advance(1);
    expect(k.rtts.at(-1)).toEqual({ ms: null, suspect: true });
    k.timers.advance(5_000);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 15_000, suspect: false });
  });

  it('ignores unsolicited pongs and does nothing when stopped', () => {
    const k = make();
    k.ka.start();
    k.ka.notePong();
    expect(k.rtts.length).toBe(1);
    k.ka.stop();
    k.timers.advance(120_000);
    expect(k.pings()).toBe(0);
  });

  it('keeps trying when GMCP is not enabled yet', () => {
    const k = make();
    k.setEnabled(false);
    k.ka.start();
    k.timers.advance(60_000);
    expect(k.pings()).toBe(0);
    k.setEnabled(true);
    k.timers.advance(30_000);
    expect(k.pings()).toBe(1);
  });

  it('matches replies to pings in order', () => {
    const k = make();
    k.ka.start();
    k.timers.advance(30_000); // ping 1 at 30 000
    k.timers.advance(30_000); // ping 2 at 60 000 (ping 1 overdue → suspect)
    expect(k.pings()).toBe(2);
    expect(k.rtts.at(-1)!.suspect).toBe(true);
    k.ka.notePong(); // answers ping 1
    expect(k.rtts.at(-1)).toEqual({ ms: 30_000, suspect: false });
    k.timers.advance(100);
    k.ka.notePong(); // answers ping 2
    expect(k.rtts.at(-1)).toEqual({ ms: 100, suspect: false });
  });
});
