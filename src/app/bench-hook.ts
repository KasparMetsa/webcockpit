// Benchmark probe (`?bench`), loaded with a dynamic import only when the
// URL asks for it, so it is a separate chunk that normal pages never fetch.
// It exposes `window.__wcBench` for bench/browser-bench.ts (spec §1.3).
//
// - `requestFrame` wraps the output pane's frame scheduler: every flush is
//   timed (script time), and a MessageChannel message posted from inside the
//   frame callback runs after that frame's style/layout/paint, which gives a
//   "painted" timestamp.
// - A fake socket (`connectFake`) stands in for MUME: `inject` feeds bytes
//   exactly like a WebSocket frame would, and `send` records its call time
//   for the key → send measurement.

import { Bus } from '../core/bus';
import type { Line, Socketish } from '../core/types';
import { logToFrames } from '../net/replay-socket';
import { ScriptEngine } from '../script/engine';
import { LineAssembler } from '../text/assembler';
import type { App } from './app';

export interface FlushRecord {
  /** performance.now() when the frame callback started. */
  start: number;
  /** Script time of the flush, ms. */
  script: number;
  /** Time from frame callback start until after the frame was rendered, ms. */
  frame: number;
}

class BenchSocket implements Socketish {
  onOpen: (() => void) | null = null;
  onData: ((bytes: Uint8Array) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  readonly forceUtf8 = true as const;
  lastSendAt = 0;
  sends = 0;
  connect(): void {}
  send(_bytes: Uint8Array): void {
    if (this.lastSendAt === 0) this.lastSendAt = performance.now();
    this.sends++;
  }
  close(): void {
    this.onClose?.('closed by client');
  }
}

export class BenchProbe {
  app: App | null = null;
  flushes: FlushRecord[] = [];
  private sock: BenchSocket | null = null;
  private waiters: Array<(r: FlushRecord) => void> = [];
  private readonly channel = new MessageChannel();
  private postQueue: Array<() => void> = [];
  private frames: Uint8Array[] = [];

  constructor() {
    this.channel.port1.onmessage = () => {
      const q = this.postQueue;
      this.postQueue = [];
      for (const f of q) f();
    };
  }

  /** Frame scheduler for the output pane. */
  readonly requestFrame = (cb: () => void): void => {
    requestAnimationFrame(() => {
      const start = performance.now();
      cb();
      const script = performance.now() - start;
      const rec: FlushRecord = { start, script, frame: script };
      this.flushes.push(rec);
      const waiters = this.waiters;
      this.waiters = [];
      this.afterPaint(() => {
        rec.frame = performance.now() - start;
        for (const w of waiters) w(rec);
      });
    });
  };

  private afterPaint(fn: () => void): void {
    this.postQueue.push(fn);
    if (this.postQueue.length === 1) this.channel.port2.postMessage(null);
  }

  attach(app: App): void {
    this.app = app;
  }

  /** Connects the session to a fake socket that is open at once. */
  connectFake(): void {
    const app = this.app!;
    const sock = new BenchSocket();
    this.sock = sock;
    app.session.connect(sock);
    sock.onOpen?.();
  }

  /** Splits a log into telnet frames (as ReplaySocket would at `speed`). */
  loadFrames(logText: string, speed = 1, max = Infinity): number {
    this.frames = [];
    for (const f of logToFrames(logText, { speed })) {
      this.frames.push(f.bytes);
      if (this.frames.length >= max) break;
    }
    return this.frames.length;
  }

  /**
   * Delivers frame `i` (or raw bytes/text) through the fake socket. Resolves
   * with the latency from delivery to the end of the flush that rendered it
   * and to after that frame was painted.
   */
  inject(what: number | string): Promise<{ toFlush: number; toPaint: number; script: number }> {
    const bytes =
      typeof what === 'number' ? this.frames[what]! : new TextEncoder().encode(what);
    return new Promise((resolve) => {
      let t0 = 0;
      this.waiters.push((rec) => {
        resolve({
          toFlush: rec.start + rec.script - t0,
          toPaint: rec.start + rec.frame - t0,
          script: rec.script,
        });
      });
      t0 = performance.now();
      this.sock!.onData?.(bytes);
    });
  }

  /** Enter in the input with `text`; returns ms from keydown dispatch to socket send. */
  keyToSend(text: string): number {
    const app = this.app!;
    const sock = this.sock!;
    const field = app.input.input;
    field.focus();
    field.value = text;
    field.setSelectionRange(text.length, text.length);
    sock.lastSendAt = 0;
    const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    const t0 = performance.now();
    field.dispatchEvent(ev);
    const sentAt = sock.lastSendAt;
    return sentAt === 0 ? -1 : sentAt - t0;
  }

  /** Loads a profile into the app's script engine (App.applyProfile). */
  applyProfile(text: string): boolean {
    return this.app!.applyProfile(text).ok;
  }

  /** Keydown `code` on the input (a macro key); returns ms from dispatch to socket send. */
  macroToSend(code: string, key: string): number {
    const app = this.app!;
    const sock = this.sock!;
    const field = app.input.input;
    field.focus();
    sock.lastSendAt = 0;
    const ev = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
    const t0 = performance.now();
    field.dispatchEvent(ev);
    const sentAt = sock.lastSendAt;
    return sentAt === 0 ? -1 : sentAt - t0;
  }

  /**
   * The 500-rule budget (spec §1.3): the log's lines (assembled once) go
   * through a separate ScriptEngine's display pipeline with no rules and
   * with `profile`. Returns µs per line (median of 5 runs after a warm-up).
   */
  ruleBench(logText: string, profile: string): { lines: number; baseUs: number; rulesUs: number; shown: number } {
    const lines: Line[] = [];
    const bus = new Bus();
    bus.on('text.line', (l) => lines.push(l));
    const asm = new LineAssembler(bus);
    for (const raw of logText.split('\n')) {
      const sp = raw.indexOf(' ');
      if (sp < 0) continue;
      const rest = raw.slice(sp + 1);
      if (rest.startsWith('> ') || rest === '>') continue;
      asm.text(rest + '\r\n', 0);
    }
    const run = (text: string | null): { us: number; shown: number } => {
      const b = new Bus();
      let shown = 0;
      b.on('text.display', () => shown++);
      const e = new ScriptEngine({ send: () => {}, message: () => {} });
      e.attach(b);
      if (text !== null && !e.loadProfile(text).ok) throw new Error('bench profile did not load');
      const once = (): number => {
        const t0 = performance.now();
        for (let i = 0; i < lines.length; i++) e.processLine(lines[i]!);
        return performance.now() - t0;
      };
      once();
      const times: number[] = [];
      for (let i = 0; i < 5; i++) times.push(once());
      times.sort((a, x) => a - x);
      e.dispose();
      return { us: (times[2]! / lines.length) * 1000, shown: shown / 6 };
    };
    const base = run(null);
    const rules = run(profile);
    return { lines: lines.length, baseUs: base.us, rulesUs: rules.us, shown: rules.shown };
  }

  /** Starts a replay at `speed`; resolves when it finished and the output drained. */
  replay(logText: string, speed: number): Promise<{ ms: number; lines: number }> {
    const app = this.app!;
    let lines = 0;
    const offLine = app.bus.on('text.line', () => lines++);
    return new Promise((resolve) => {
      const t0 = performance.now();
      const off = app.bus.on('conn.state', (s) => {
        if (s.state !== 'disconnected') return;
        off();
        offLine();
        void this.drained().then(() => resolve({ ms: performance.now() - t0, lines }));
      });
      app.startReplay(logText, 'bench', speed);
    });
  }

  /** Resolves after two animation frames pass without a flush. */
  drained(): Promise<void> {
    return new Promise((resolve) => {
      let quiet = 0;
      let seen = this.flushes.length;
      const tick = (): void => {
        if (this.flushes.length === seen) quiet++;
        else {
          quiet = 0;
          seen = this.flushes.length;
        }
        if (quiet >= 2) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** Number of rows in the output scrollback. */
  get rows(): number {
    return this.app!.output.rows;
  }
}

declare global {
  interface Window {
    __wcBench?: BenchProbe;
  }
}

export function installBenchProbe(): BenchProbe {
  const p = new BenchProbe();
  window.__wcBench = p;
  return p;
}
