// Replay socket (ADR 0007): feeds a Cockpit raw `.log` (Inv §7.1) through
// the normal telnet and line layers, without a server.
//
// Log format, one event per line (src/capture/format.ts):
//   <16-digit µs ts> <inbound line, ANSI SGR kept>
//   <16-digit µs ts> > <outbound command>
//   <16-digit µs ts> ESC <TYPE> <payload>          (client record, ADR 0016)
// Inbound lines become UTF-8 bytes + CR LF. Outbound lines are skipped by
// `logToFrames` unless `sends` is set; ReplaySocket sets it and hands each
// recorded command (`''` = empty Enter) to `onSent` at its time, between
// the inbound bytes around it, and Session emits it as `cmd.sent` with
// `replay: true` (trackers see it; nothing re-sends, echoes or captures it).
// At speed 0 the commands ride inside the 16 KB frames (byte offsets), so a
// burst keeps its frame count; splitting a frame at every command made the
// burst ~25 % slower (ADR 0017 "Burst fix").
// `ESC GMCP <pkg> [json]` records become `IAC SB GMCP <pkg> [json] IAC SE`
// at their timestamps; the first one is preceded by `IAC WILL GMCP` so the
// telnet layer accepts them (a recorded Char.Name then takes the session to
// `playing`). Other record types (VIEW, SIZE …) are skipped. Cockpit logs
// have no records and replay as before.
// Lines that look like prompts (visible text, trimmed, ends in `>`, and
// shorter than 80 chars) are sent without a newline and followed by
// IAC GA, the way MUME sends prompts.
//
// The log is parsed lazily (a generator over the string), so a 5 MB log
// does not stall the page. The socket declares `forceUtf8`, and Session
// switches the telnet decoder to UTF-8 without CHARSET negotiation.

import type { Socketish } from '../core/types';
import { GA, IAC, OPT_GMCP, SB, SE, WILL } from './telnet';
import type { IsReplay } from './session';

/** `ESC GMCP ` at the start of a line body (format.ts `RECORD.gmcp`). */
const GMCP_RECORD = '\x1bGMCP';

export interface LogFrameOptions {
  /**
   * Playback speed. 1 = real time (from the log timestamps), 2 = twice as
   * fast, 0 = as fast as possible (frames of `chunkBytes`, no timing).
   */
  speed?: number;
  /** Longest idle gap kept, in log ms (before `speed` scaling). Default 2000. */
  maxGapMs?: number;
  /** Target frame size in bytes. Default 16 KB. */
  chunkBytes?: number;
  /**
   * Lines closer together than this (µs) are sent in one frame when
   * `speed > 0`, like one server write. Default 1000.
   */
  groupUs?: number;
  /**
   * Yield the recorded outbound commands. At `speed > 0` each is a frame
   * of its own at its time (`sent`, empty `bytes`); at speed 0 they ride
   * in the byte frame around them (`sends`, with byte offsets), so a
   * burst keeps its 16 KB frames. Default false: they are skipped.
   */
  sends?: boolean;
}

export interface ReplayFrame {
  /** Delivery time in ms after the replay starts. */
  atMs: number;
  bytes: Uint8Array;
  /** A recorded outbound command (`sends`, speed > 0); `bytes` is then empty. */
  sent?: string;
  /**
   * Recorded outbound commands inside this frame (`sends`, speed 0): each
   * comes before `bytes[at]` (`at === bytes.length`: after all of them).
   */
  sends?: ReplaySend[];
}

export interface ReplaySend {
  /** Byte offset in the frame the command comes before. */
  at: number;
  /** The command (`''` = empty Enter). */
  text: string;
}

const NO_BYTES = new Uint8Array(0);

const TS_DIGITS = 16;
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** True for a line that looks like a MUME prompt (see file header). */
export function isPromptLike(line: string): boolean {
  const visible = line.indexOf('\x1b') < 0 ? line : line.replace(ANSI_RE, '');
  const t = visible.trim();
  return t.length > 0 && t.length < 80 && t.charCodeAt(t.length - 1) === 62 /* > */ && !t.startsWith('> ');
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

/**
 * Turns a Cockpit raw log into telnet frames with delivery times. Pure and
 * lazy: frames are produced as the caller iterates.
 */
export function* logToFrames(logText: string, opts: LogFrameOptions = {}): Generator<ReplayFrame> {
  const speed = opts.speed ?? 1;
  const maxGapMs = opts.maxGapMs ?? 2000;
  const chunk = Math.max(256, opts.chunkBytes ?? 16384);
  const groupUs = opts.groupUs ?? 1000;
  const sends = opts.sends ?? false;
  const enc = new TextEncoder();

  let buf = new Uint8Array(chunk * 2);
  let len = 0;
  // Speed 0: the commands inside the frame being built.
  let inFrame: ReplaySend[] | null = null;
  const frame = (): ReplayFrame => {
    const f: ReplayFrame = { atMs: frameAt, bytes: buf.slice(0, len) };
    if (inFrame) {
      f.sends = inFrame;
      inFrame = null;
    }
    len = 0;
    return f;
  };
  let clock = 0;
  let frameAt = 0;
  let lastTs = -1;
  let gmcpAnnounced = false;
  let pos = 0;
  const n = logText.length;

  while (pos < n) {
    let nl = logText.indexOf('\n', pos);
    if (nl < 0) nl = n;
    let end = nl;
    if (end > pos && logText.charCodeAt(end - 1) === 13) end--;
    const start = pos;
    pos = nl + 1;

    // "<16 digits> <rest>"
    if (end - start < TS_DIGITS + 1 || logText.charCodeAt(start + TS_DIGITS) !== 32) continue;
    let ok = true;
    for (let k = start; k < start + TS_DIGITS; k++) {
      if (!isDigit(logText.charCodeAt(k))) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const bodyStart = start + TS_DIGITS + 1;
    // Outbound: "> cmd" ("> " alone is an empty Enter). A bare ">" is an
    // inbound prompt.
    if (logText.charCodeAt(bodyStart) === 62 && logText.charCodeAt(bodyStart + 1) === 32 && bodyStart + 1 < end) {
      if (!sends) continue;
      if (speed <= 0) {
        // No clock at speed 0: the command rides in the current frame.
        (inFrame ??= []).push({ at: len, text: logText.slice(bodyStart + 2, end) });
        continue;
      }
      // Its own frame, after what came before it. The clock does not move:
      // the next inbound line's gap is measured as without sends.
      const ts = Number(logText.slice(start, start + TS_DIGITS));
      const deltaUs = lastTs >= 0 ? Math.max(0, ts - lastTs) : 0;
      const at = clock + (speed > 0 ? Math.min(deltaUs / 1000, maxGapMs) / speed : 0);
      if (len > 0) yield frame();
      yield { atMs: at, bytes: NO_BYTES, sent: logText.slice(bodyStart + 2, end) };
      continue;
    }
    // Client record: ESC + upper-case letter. Only GMCP is replayed.
    let gmcp = false;
    if (logText.charCodeAt(bodyStart) === 27) {
      const c = logText.charCodeAt(bodyStart + 1);
      if (c >= 65 && c <= 90) {
        if (!logText.startsWith(GMCP_RECORD, bodyStart)) continue;
        const after = logText.charCodeAt(bodyStart + GMCP_RECORD.length);
        if (after !== 32) continue; // needs a package name
        gmcp = true;
      }
    }
    const ts = Number(logText.slice(start, start + TS_DIGITS));
    const line = gmcp ? logText.slice(bodyStart + GMCP_RECORD.length + 1, end) : logText.slice(bodyStart, end);

    let gapMs = 0;
    const deltaUs = lastTs >= 0 ? Math.max(0, ts - lastTs) : 0;
    if (speed > 0) gapMs = Math.min(deltaUs / 1000, maxGapMs) / speed;
    if (len > 0 && (len >= chunk || (speed > 0 && deltaUs >= groupUs))) yield frame();
    clock += gapMs;
    if (len === 0) frameAt = clock;
    lastTs = ts;

    const need = len + line.length * 3 + 8;
    if (need > buf.length) {
      const nb = new Uint8Array(Math.max(need, buf.length * 2));
      nb.set(buf.subarray(0, len));
      buf = nb;
    }
    if (gmcp) {
      // UTF-8 never contains 0xFF, so the payload needs no IAC escaping.
      if (!gmcpAnnounced) {
        gmcpAnnounced = true;
        buf[len++] = IAC;
        buf[len++] = WILL;
        buf[len++] = OPT_GMCP;
      }
      buf[len++] = IAC;
      buf[len++] = SB;
      buf[len++] = OPT_GMCP;
      len += enc.encodeInto(line, buf.subarray(len)).written;
      buf[len++] = IAC;
      buf[len++] = SE;
      continue;
    }
    len += enc.encodeInto(line, buf.subarray(len)).written;
    if (isPromptLike(line)) {
      buf[len++] = IAC;
      buf[len++] = GA;
    } else {
      buf[len++] = 13;
      buf[len++] = 10;
    }
  }
  if (len > 0 || inFrame) yield frame();
}

/** Telnet bytes announcing GMCP and sending `Char.Name`, so replay reaches `playing`. */
export function charNamePreamble(name: string): Uint8Array {
  const json = JSON.stringify({ name, fullname: name });
  const body = new TextEncoder().encode(`Char.Name ${json}`);
  const out = new Uint8Array(3 + 3 + body.length + 2);
  out.set([IAC, WILL, OPT_GMCP, IAC, SB, OPT_GMCP]);
  out.set(body, 6);
  out[out.length - 2] = IAC;
  out[out.length - 1] = SE;
  return out;
}

export interface ReplayOptions extends Omit<LogFrameOptions, 'sends'> {
  /**
   * When set, the replay starts by announcing GMCP and sending
   * `Char.Name` with this name, so the session reaches `playing`.
   */
  charName?: string;
}

/**
 * Longest a delivery run may take before yielding to rendering, in ms.
 * At speed 0 (or when behind real time) frames would otherwise arrive as an
 * unbroken chain of tasks and the browser decides when to render. After a
 * slice the replay waits for the next animation frame, so every frame
 * renders what was delivered. In the 4.7 MB burst benchmark this cut
 * Firefox's longest frame from ~35 ms to ~20 ms (Chromium: ~19 ms either
 * way) for ~10 % less throughput.
 */
const SLICE_MS = 8;
/** Fallback when no animation frame comes (hidden tab, no DOM). */
const YIELD_FALLBACK_MS = 50;

export class ReplaySocket implements Socketish, IsReplay {
  onOpen: (() => void) | null = null;
  onData: ((bytes: Uint8Array) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  /** A recorded outbound command at its time (`''` = empty Enter); session.ts `IsReplay`. */
  onSent: ((text: string) => void) | null = null;

  /** Replay text is UTF-8; Session skips CHARSET negotiation. */
  readonly forceUtf8 = true as const;
  /** Marks the connection as a replay (never captured; session.ts `IsReplay`). */
  readonly replay = true as const;

  private readonly text: string;
  private readonly opts: ReplayOptions;
  private frames: Generator<ReplayFrame> | null = null;
  private running = false;
  private startMs = 0;
  private pending: ReplayFrame | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private channel: MessageChannel | null = null;
  private raf: number | null = null;
  private delivered = 0;

  constructor(logText: string, opts: ReplayOptions = {}) {
    this.text = logText;
    this.opts = opts;
  }

  /** Inbound bytes delivered so far. */
  get bytesDelivered(): number {
    return this.delivered;
  }

  connect(): void {
    if (this.running || this.frames) return;
    this.running = true;
    this.frames = logToFrames(this.text, { ...this.opts, sends: true });
    this.schedule(() => {
      if (!this.running) return;
      this.onOpen?.();
      if (!this.running) return;
      if (this.opts.charName) this.deliver(charNamePreamble(this.opts.charName));
      this.startMs = performance.now();
      this.step();
    }, 0);
  }

  send(_bytes: Uint8Array): void {
    // Replay has no server.
  }

  close(): void {
    if (!this.running) return;
    this.finish('closed by client');
  }

  private deliver(bytes: Uint8Array): void {
    this.delivered += bytes.length;
    this.onData?.(bytes);
  }

  /** A speed-0 frame: its bytes in pieces, each command between them. */
  private deliverWithSends(bytes: Uint8Array, sends: readonly ReplaySend[]): void {
    let pos = 0;
    for (const s of sends) {
      if (s.at > pos) {
        this.deliver(bytes.subarray(pos, s.at));
        pos = s.at;
      }
      if (!this.running) return;
      this.onSent?.(s.text);
      if (!this.running) return;
    }
    if (pos < bytes.length) this.deliver(bytes.subarray(pos));
  }

  private finish(reason: string): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.channel) {
      this.channel.port1.onmessage = null;
      this.channel.port1.close();
      this.channel.port2.close();
      this.channel = null;
    }
    this.frames?.return(undefined);
    this.pending = null;
    this.onClose?.(reason);
  }

  private readonly step = (): void => {
    this.timer = null;
    if (!this.running || !this.frames) return;
    const speed = this.opts.speed ?? 1;
    const sliceStart = performance.now();
    for (;;) {
      let f = this.pending;
      this.pending = null;
      if (!f) {
        const r = this.frames.next();
        if (r.done) {
          this.finish('replay finished');
          return;
        }
        f = r.value;
      }
      if (speed > 0) {
        const wait = this.startMs + f.atMs - performance.now();
        if (wait > 0) {
          this.pending = f;
          this.schedule(this.step, wait);
          return;
        }
      }
      if (f.sends) this.deliverWithSends(f.bytes, f.sends);
      else if (f.sent !== undefined) this.onSent?.(f.sent);
      else this.deliver(f.bytes);
      if (!this.running) return;
      if (performance.now() - sliceStart >= SLICE_MS) {
        this.yieldToFrame();
        return;
      }
    }
  };

  /** Continues after the next animation frame has rendered. */
  private yieldToFrame(): void {
    if (typeof requestAnimationFrame !== 'function') {
      this.schedule(this.step, 0);
      return;
    }
    let done = false;
    const go = (): void => {
      if (done || !this.running) return;
      done = true;
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      // A task posted from the frame callback runs after that frame renders.
      this.schedule(this.step, 0);
    };
    this.raf = requestAnimationFrame(go);
    this.timer = setTimeout(go, YIELD_FALLBACK_MS);
  }

  /** Runs `fn` in a later task: MessageChannel for 0 ms (no 4 ms clamp). */
  private schedule(fn: () => void, ms: number): void {
    if (ms <= 0 && typeof MessageChannel !== 'undefined') {
      if (!this.channel) this.channel = new MessageChannel();
      this.channel.port1.onmessage = () => fn();
      this.channel.port2.postMessage(null);
      return;
    }
    this.timer = setTimeout(fn, Math.max(0, ms));
  }
}
