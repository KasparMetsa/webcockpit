// @vitest-environment happy-dom
// Integration: the real App (session, telnet, GMCP, line layer, panes,
// recorder) against a fake socket fed MUME's real opening bytes.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/app';
import { formatStatus } from '../../src/app/status';
import type { LockManagerLike } from '../../src/capture/recorder';
import { CaptureStore } from '../../src/capture/store';
import { DEFAULT_GMCP_MODULES } from '../../src/net/gmcp';
import { BANNER_NEG, BANNER_TEXT, FakeSocket, IAC, concat, gmcpOut, sb, utf8 } from './net-helpers';

class FakeLocks implements LockManagerLike {
  held = new Set<string>();
  request(name: string, _o: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void> | void) {
    if (this.held.has(name)) return Promise.resolve(cb(null));
    this.held.add(name);
    return Promise.resolve(cb({ name })).finally(() => this.held.delete(name));
  }
}

const WILL = 251;
const DO = 253;
const GMCP = 201;
const ECHO = 1;

function setup() {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sockets: FakeSocket[] = [];
  const frames: Array<() => void> = [];
  const factory = new IDBFactory();
  const app = new App({
    root,
    socketFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    recorder: {
      openStore: () => CaptureStore.open(factory),
      locks: new FakeLocks(),
      win: null,
      flushMs: 60000,
    },
    requestFrame: (cb) => frames.push(cb),
  });
  const runFrames = () => {
    while (frames.length) frames.shift()!();
  };
  const outputText = () => {
    runFrames();
    return Array.from(app.output.el.querySelectorAll('.wc-rows .wc-row')).map((r) => r.textContent ?? '');
  };
  const sentText = (s: FakeSocket) => new TextDecoder('latin1').decode(Uint8Array.from(s.sentBytes()));
  return { app, root, sockets, runFrames, outputText, sentText };
}

function enter(app: App, text: string) {
  app.input.input.value = text;
  app.input.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('App wiring against MUME opening bytes', () => {
  it('does the handshake, login commands, capture and password masking', async () => {
    const t = setup();
    const { app } = t;
    app.connectLive();
    expect(t.sockets).toHaveLength(1);
    const sock = t.sockets[0]!;
    sock.open();
    expect(app.session.state).toBe('login');
    sock.data(BANNER_NEG);
    sock.data(BANNER_TEXT);

    // DO GMCP, then the handshake.
    const bytes = sock.sentBytes();
    const doGmcp = bytes.findIndex((b, i) => b === IAC && bytes[i + 1] === DO && bytes[i + 2] === GMCP);
    expect(doGmcp).toBeGreaterThanOrEqual(0);
    const gm = gmcpOut(bytes);
    expect(gm[0]).toMatch(/^Core\.Hello \{"client":"WebCockpit","version":"[^"]+"\}$/);
    const supports = gm.filter((m) => m.startsWith('Core.Supports.Set '));
    expect(supports).toHaveLength(1);
    const list = JSON.parse(supports[0]!.slice('Core.Supports.Set '.length)) as string[];
    expect(list).toHaveLength(8);
    expect(list).toEqual(DEFAULT_GMCP_MODULES.map(([n, v]) => `${n} ${v}`));
    expect(gm).toContain('MUME.Client.XML {"enable":true,"silent":true}');
    expect(t.outputText().join('\n')).toContain('***  MUME IX  ***');

    // Char.Name → playing → width commands (after, not before).
    const before = t.sentText(sock);
    expect(before).not.toContain('change width');
    sock.data(sb(GMCP, utf8('Char.Name {"name":"Rasta","fullname":"Rasta the Tester"}')));
    expect(app.session.state).toBe('playing');
    const after = t.sentText(sock).slice(before.length);
    expect(after).toContain('change width all 500\r\n');
    expect(after).toContain('change width table terminal\r\n');
    expect(formatStatus(app.status.get())).toContain('playing · Rasta');
    expect(app.el.dataset.status).toContain('playing · Rasta');
    expect(t.outputText()).toContain('[SYSTEM] Rasta logged in.');
    // Housekeeping commands are not echoed.
    expect(t.outputText().join('\n')).not.toContain('change width');

    await app.recorder.idle();
    expect(app.recorder.runId).toMatch(/^Rasta\//);
    expect(app.status.get().capture).toBe('capture: recording');

    // A normal command is echoed, kept in history and captured.
    enter(app, 'look');
    expect(t.sentText(sock).endsWith('look\r\n')).toBe(true);
    expect(app.input.getHistory()).toEqual(['look']);

    // Password mode: WILL ECHO masks; the secret is sent but never echoed,
    // stored in history or captured.
    sock.data([IAC, WILL, ECHO]);
    expect(app.input.isPasswordMode()).toBe(true);
    enter(app, 'hunter2');
    expect(t.sentText(sock).endsWith('hunter2\r\n')).toBe(true);
    expect(app.input.value).toBe('');
    expect(app.input.getHistory()).toEqual(['look']);
    sock.data(concat(utf8('Welcome back.\r\n')));
    const out = t.outputText().join('\n');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('look');

    await app.recorder.flush();
    const store = (await app.recorder.getStore())!;
    const log = (await store.getChunks(app.recorder.runId!)).map((c) => c.text).join('');
    expect(log).toContain(' > look\n');
    expect(log).toContain(' Welcome back.\n');
    expect(log).not.toContain('hunter2');
  });

  it('handles built-ins locally and reconnects on Enter after a drop', () => {
    const t = setup();
    const { app } = t;
    app.connectLive();
    const sock = t.sockets[0]!;
    sock.open();
    const sent0 = sock.sent.length;

    enter(app, '#blah');
    enter(app, '#HELP');
    expect(sock.sent.length).toBe(sent0);
    const out = t.outputText();
    expect(out).toContain('[SYSTEM] Unknown command: #blah');
    expect(out).toContain('[SYSTEM] Built-in commands:');

    sock.drop('closed by server (code 1006)');
    expect(app.session.state).toBe('disconnected');
    expect(t.outputText().slice(-2)).toEqual([
      '[SYSTEM] Connection closed: closed by server (code 1006)',
      '[SYSTEM] Press Enter to reconnect.',
    ]);
    enter(app, '');
    expect(t.sockets).toHaveLength(2);
    expect(app.session.state).toBe('connecting');
    expect(app.input.getHistory()).toEqual(['#blah', '#HELP']);
  });

  it('reports replay in the status and does not capture a replay', async () => {
    const t = setup();
    const { app } = t;
    app.startReplay('1790366274272195 \x1b[32mMain Passageway\x1b[0m\n1790366274272700 ![ S>\n', 'x.log', 0);
    expect(formatStatus(app.status.get()).startsWith('replay')).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(app.session.state).toBe('disconnected');
    const out = t.outputText();
    expect(out).toContain('Main Passageway');
    expect(out).toContain('[SYSTEM] Replay finished.');
    await app.recorder.idle();
    expect(app.recorder.runId).toBeNull();
    // Offline after a replay: Enter does not connect live.
    enter(app, 'look');
    expect(t.sockets).toHaveLength(0);
  });
});
