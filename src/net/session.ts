// Session controller (spec §2.1, Inv §9.1–9.2): owns one socket at a time,
// the telnet parser, GMCP and the keep-alive, and implements `Sender`.
//
// State machine (types.ts `ConnState`):
//   idle/disconnected --connect()--> connecting --socket open--> login
//   login --GMCP Char.Name--> playing
//   connecting/login/playing --Core.Goodbye | socket close | disconnect()-->
//     disconnected
// Transitions are idempotent: one `conn.state` per actual change, so a
// Core.Goodbye followed by the socket close gives one disconnect.
//
// Commands end in CR LF: RFC 854's NVT end of line, and what tt++ (the
// owner's reference client) sends. MUME accepts LF alone too.
//
// Sending is synchronous: `sendCommand` encodes and calls `socket.send`
// in the same call stack, then emits `cmd.sent`.

import type { Bus } from '../core/bus';
import type { ConnState, Sender, Socketish } from '../core/types';
import { nowUs } from '../core/types';
import { Gmcp, GmcpRegistry } from './gmcp';
import { KeepAlive, type Timers } from './keepalive';
import { Telnet } from './telnet';
import type { TextSink } from './textsink';
import { WebSocketTransport } from './ws-transport';

/** Reason given when the user disconnects. */
export const REASON_USER_DISCONNECT = 'disconnected by user';
/** Reason given for the close half of a user reconnect. */
export const REASON_USER_RECONNECT = 'reconnect by user';

/** Commands sent once on entering `playing` (Inv §9, spec §2.1). */
export const PLAYING_COMMANDS: readonly string[] = ['change width all 500', 'change width table terminal'];

/**
 * A socket that carries UTF-8 without CHARSET negotiation (the replay
 * socket). Session switches the telnet decoder to UTF-8 on connect.
 */
export interface ForcesUtf8 {
  readonly forceUtf8: true;
}

function forcesUtf8(s: Socketish): boolean {
  return (s as Partial<ForcesUtf8>).forceUtf8 === true;
}

export interface SessionOptions {
  bus: Bus;
  /** Receives decoded text and GA marks (the line assembler). */
  sink: TextSink;
  /** Creates the socket for each connect. Default: `WebSocketTransport`. */
  socketFactory?: () => Socketish;
  registry?: GmcpRegistry;
  /** Timers for the keep-alive (tests). */
  timers?: Timers;
  /** TTYPE answer. Default `WebCockpit`. */
  ttype?: string;
}

export class Session implements Sender {
  readonly telnet: Telnet;
  readonly gmcp: Gmcp;
  readonly keepalive: KeepAlive;

  private readonly bus: Bus;
  private socketFactory: () => Socketish;
  private socket: Socketish | null = null;
  private open = false;
  private st: ConnState = 'idle';

  constructor(opts: SessionOptions) {
    this.bus = opts.bus;
    this.socketFactory = opts.socketFactory ?? (() => new WebSocketTransport());
    this.telnet = new Telnet({
      sink: opts.sink,
      write: this.writeRaw,
      onGmcp: (payload) => this.gmcp.handle(payload),
      onGmcpEnabled: () => this.gmcp.onEnabled(),
      onEcho: (serverEchoes) => this.bus.emit('telnet.echo', { serverEchoes }),
      ...(opts.ttype !== undefined ? { ttype: opts.ttype } : {}),
    });
    this.gmcp = new Gmcp({
      bus: opts.bus,
      send: (payload) => this.telnet.sendGmcp(payload),
      ...(opts.registry ? { registry: opts.registry } : {}),
      onMessage: this.onGmcpMessage,
    });
    this.keepalive = new KeepAlive({
      bus: opts.bus,
      sendPing: () => this.gmcp.send('Core.Ping'),
      ...(opts.timers ? { timers: opts.timers } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  get state(): ConnState {
    return this.st;
  }

  /** True while the server echoes (ECHO on): mask input, no history. */
  get passwordMode(): boolean {
    return this.open && this.telnet.serverEchoes;
  }

  /** True when the socket is open (state login or playing). */
  get isOpen(): boolean {
    return this.open;
  }

  /** Replaces the socket factory used by the next `connect()`. */
  setSocketFactory(factory: () => Socketish): void {
    this.socketFactory = factory;
  }

  private setState(next: ConnState, reason?: string): void {
    const prev = this.st;
    if (prev === next) return;
    this.st = next;
    if (next === 'login') this.keepalive.start();
    if (next === 'disconnected') this.keepalive.stop();
    this.bus.emit('conn.state', reason === undefined ? { state: next, prev } : { state: next, prev, reason });
    if (next === 'playing') {
      for (const c of PLAYING_COMMANDS) this.sendCommand(c, { echo: false });
    }
  }

  // -------------------------------------------------------------------------
  // Connect / disconnect
  // -------------------------------------------------------------------------

  /**
   * Opens a new connection. Ignored while connecting or connected. `socket`
   * overrides the factory for this one connection (e.g. a replay socket).
   */
  connect(socket?: Socketish): void {
    if (this.st === 'connecting' || this.st === 'login' || this.st === 'playing') return;
    this.detach();
    const sock = socket ?? this.socketFactory();
    this.socket = sock;
    this.open = false;
    this.telnet.reset();
    if (forcesUtf8(sock)) this.telnet.forceUtf8();
    sock.onOpen = () => {
      if (this.socket !== sock) return;
      this.open = true;
      this.setState('login');
    };
    sock.onData = (bytes) => {
      if (this.socket !== sock) return;
      this.bus.emit('net.bytesIn', bytes);
      this.telnet.receive(bytes, nowUs());
    };
    sock.onClose = (reason) => {
      if (this.socket !== sock) return;
      this.socket = null;
      this.open = false;
      this.dropped(reason);
    };
    this.setState('connecting');
    sock.connect();
  }

  /** Closes the connection; state becomes `disconnected` right away. */
  disconnect(reason: string = REASON_USER_DISCONNECT): void {
    const had = this.socket !== null;
    this.detach();
    if (had || this.st === 'connecting' || this.st === 'login' || this.st === 'playing') {
      this.dropped(reason);
    }
  }

  /**
   * Drops the current connection (reason `REASON_USER_RECONNECT`, so the
   * UI can tell it from a real drop) and connects again.
   */
  reconnect(socket?: Socketish): void {
    this.disconnect(REASON_USER_RECONNECT);
    this.connect(socket);
  }

  /** Detaches and closes the current socket without firing its callbacks. */
  private detach(): void {
    const sock = this.socket;
    if (!sock) return;
    this.socket = null;
    this.open = false;
    sock.onOpen = null;
    sock.onData = null;
    sock.onClose = null;
    try {
      sock.close();
    } catch {
      // Closing a dead socket must not break the state machine.
    }
  }

  private dropped(reason: string): void {
    // Already down (e.g. Core.Goodbye, then the socket close): nothing new.
    if (this.st === 'disconnected' || this.st === 'idle') return;
    if (this.telnet.serverEchoes) this.bus.emit('telnet.echo', { serverEchoes: false });
    this.setState('disconnected', reason);
  }

  private readonly onGmcpMessage = (pkg: string, data: unknown): void => {
    if (pkg === 'char.name') {
      if (this.st === 'login') this.setState('playing');
    } else if (pkg === 'core.goodbye') {
      const why = typeof data === 'string' && data ? `Core.Goodbye: ${data}` : 'Core.Goodbye';
      this.dropped(why);
    } else if (pkg === 'core.ping') {
      this.keepalive.notePong();
    }
  };

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /** Writes bytes to the socket, emits `net.bytesOut`. False when not open. */
  private readonly writeRaw = (bytes: Uint8Array): boolean => {
    const sock = this.socket;
    if (!sock || !this.open) return false;
    sock.send(bytes);
    this.bus.emit('net.bytesOut', bytes);
    this.keepalive.noteOutbound();
    return true;
  };

  /**
   * Sends one command line followed by CR LF. Dropped when not connected.
   * While the server echoes (password mode) the command is always treated
   * as secret, whatever the caller says.
   */
  sendCommand(text: string, opts?: { secret?: boolean; echo?: boolean }): void {
    const secret = opts?.secret === true || this.passwordMode;
    if (!this.writeRaw(this.telnet.encodeText(text + '\r\n'))) return;
    const ts = nowUs();
    const ev: { text: string; ts: number; secret?: boolean; echo?: boolean } = {
      text: secret ? '' : text,
      ts,
    };
    if (secret) ev.secret = true;
    if (opts?.echo === false) ev.echo = false;
    this.bus.emit('cmd.sent', ev);
  }

  /** Sends a GMCP message (dropped when GMCP is not enabled). */
  sendGmcp(pkg: string, data?: unknown): void {
    this.gmcp.send(pkg, data);
  }

  /** Window size in cells, sent via NAWS when enabled and changed. */
  setWindowSize(cols: number, rows: number): void {
    this.telnet.setWindowSize(cols, rows);
  }
}
