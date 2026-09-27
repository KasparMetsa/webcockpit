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
      return true;
    },
  });
  return { ka, timers, rtts, pings: () => pings, setEnabled: (v: boolean) => (enabled = v) };
}

describe('KeepAlive', () => {
  it('pings every 10 s and measures RTT', () => {
    const k = make();
    k.ka.start();
    expect(k.rtts).toEqual([{ ms: null, last: null, suspect: false }]);
    k.timers.advance(9_999);
    expect(k.pings()).toBe(0);
    k.timers.advance(1);
    expect(k.pings()).toBe(1);
    k.timers.advance(42);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 42, last: 42, suspect: false });
    k.timers.advance(10_000 - 42);
    expect(k.pings()).toBe(2);
    k.timers.advance(7);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 7, last: 7, suspect: false });
  });

  it('keeps one ping outstanding at a time', () => {
    const k = make();
    k.ka.start();
    k.timers.advance(10_000);
    expect(k.pings()).toBe(1);
    k.timers.advance(30_000); // no reply: ticks at 20, 30, 40 s send nothing
    expect(k.pings()).toBe(1);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 30_000, last: 30_000, suspect: false });
    k.timers.advance(10_000);
    expect(k.pings()).toBe(2);
  });

  it('marks the link suspect after 10 s without a pong, and recovers', () => {
    const k = make();
    k.ka.start();
    k.timers.advance(10_000);
    k.timers.advance(9_999);
    expect(k.rtts.at(-1)!.suspect).toBe(false);
    k.timers.advance(1);
    expect(k.rtts.at(-1)).toEqual({ ms: null, last: null, suspect: true });
    k.timers.advance(5_000);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 15_000, last: 15_000, suspect: false });
  });

  it('gives up a ping unanswered for 60 s and sends a new one', () => {
    const k = make();
    k.ka.start();
    k.timers.advance(10_000); // ping 1
    k.timers.advance(59_999);
    expect(k.pings()).toBe(1);
    k.timers.advance(1); // tick at 70 s: ping 1 is 60 s old
    expect(k.pings()).toBe(2);
    expect(k.rtts.at(-1)!.suspect).toBe(true);
    k.timers.advance(80);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 80, last: 80, suspect: false });
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

  it('reports the minimum RTT over the last 60 s and the raw last sample', () => {
    const k = make();
    k.ka.start();
    // Ping at 10 s, pong after 200 ms (received at 10.2 s).
    k.timers.advance(10_000);
    k.timers.advance(200);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 200, last: 200, suspect: false });
    // Ping at 20 s, pong after 50 ms: new minimum.
    k.timers.advance(9_800);
    k.timers.advance(50);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 50, last: 50, suspect: false });
    // Ping at 30 s, pong after 240 ms: minimum holds, last is raw.
    k.timers.advance(9_950);
    k.timers.advance(240);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 50, last: 240, suspect: false });
    // Pongs at 40.1 .. 70.1 s, 100 ms each. The 50 ms sample (received
    // at 20.05 s) is still in the window at 70.1 s but not at 80.1 s.
    for (let i = 0; i < 4; i++) {
      k.timers.advance(10_000 - (i === 0 ? 240 : 100));
      k.timers.advance(100);
      k.ka.notePong();
    }
    expect(k.timers.now()).toBe(70_100);
    expect(k.rtts.at(-1)).toEqual({ ms: 50, last: 100, suspect: false });
    k.timers.advance(9_900);
    k.timers.advance(100);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 100, last: 100, suspect: false });
  });

  it('resets the window on start', () => {
    const k = make();
    k.ka.start();
    k.timers.advance(10_010);
    k.ka.notePong();
    expect(k.ka.rtt).toBe(10);
    k.ka.start();
    expect(k.rtts.at(-1)).toEqual({ ms: null, last: null, suspect: false });
    k.timers.advance(10_300);
    k.ka.notePong();
    expect(k.rtts.at(-1)).toEqual({ ms: 300, last: 300, suspect: false });
  });

  it('keeps trying when GMCP is not enabled yet', () => {
    const k = make();
    k.setEnabled(false);
    k.ka.start();
    k.timers.advance(60_000);
    expect(k.pings()).toBe(0);
    expect(k.rtts.at(-1)!.suspect).toBe(false);
    k.setEnabled(true);
    k.timers.advance(10_000);
    expect(k.pings()).toBe(1);
  });
});
