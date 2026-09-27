// @vitest-environment happy-dom
// Log player with real Apps (ADR 0018): App.dispose leaves nothing behind,
// a player App runs on the replay clock and echoes the recorded commands,
// PlayerHost applies VIEW records (also after a rebuilding seek), maps the
// markers and closes on ESC.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/app/app';
import { PlayerHost } from '../../src/app/player-host';
import { ReplayClock } from '../../src/player/clock';
import { PlayerSocket } from '../../src/player/socket';
import type { RunEvent } from '../../src/runs/events';
import { SettingsStore } from '../../src/settings';
import { BASE_US, FakeWall, makeLog, meta, twoRunChain } from './player-helpers';

type Key = string;
let balance: Map<Key, number>;
const originals: Array<() => void> = [];

/** Counts add/removeEventListener on window and document (listener identity × type × capture). */
function trackListeners(): void {
  balance = new Map();
  const ids = new WeakMap<object, number>();
  let next = 0;
  const id = (fn: unknown): number => {
    if (typeof fn !== 'function' && (typeof fn !== 'object' || fn === null)) return -1;
    let v = ids.get(fn as object);
    if (v === undefined) ids.set(fn as object, (v = ++next));
    return v;
  };
  for (const target of [window, document] as EventTarget[]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    const name = target === window ? 'w' : 'd';
    const key = (type: string, fn: unknown, o: unknown): Key => {
      const cap = typeof o === 'boolean' ? o : !!(o as { capture?: boolean } | undefined)?.capture;
      return `${name}:${type}:${id(fn)}:${cap}`;
    };
    target.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => {
      const k = key(type, fn, o);
      balance.set(k, (balance.get(k) ?? 0) + 1);
      add(type, fn, o as AddEventListenerOptions);
    }) as typeof target.addEventListener;
    target.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => {
      const k = key(type, fn, o);
      if (balance.has(k)) balance.set(k, Math.max(0, balance.get(k)! - 1));
      remove(type, fn, o as EventListenerOptions);
    }) as typeof target.removeEventListener;
    originals.push(() => {
      target.addEventListener = add;
      target.removeEventListener = remove;
    });
  }
}

function leaked(): string[] {
  return [...balance.entries()].filter(([, n]) => n > 0).map(([k]) => k);
}

beforeEach(() => {
  document.body.innerHTML = '';
  trackListeners();
});

afterEach(() => {
  for (const r of originals.splice(0)) r();
});

const frames: Array<() => void> = [];
const runFrames = (): void => {
  while (frames.length) frames.shift()!();
};

function playerApp(root: HTMLElement, clock: ReplayClock): App {
  return new App({
    root,
    player: true,
    offline: true,
    scheduler: clock,
    now: () => clock.now(),
    clockUs: () => clock.nowUs(),
    requestFrame: (cb) => frames.push(cb),
    paneRequestFrame: (cb) => frames.push(cb),
  });
}

const enc = new TextEncoder();

describe('App.dispose', () => {
  it('removes its DOM, bus handlers, timers and window/document listeners, repeatedly', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    for (let i = 0; i < 5; i++) {
      const clock = new ReplayClock(BASE_US);
      const app = playerApp(root, clock);
      const sock = new PlayerSocket();
      app.replayOn(sock, 'test');
      sock.data(enc.encode('Hello.\r\n'));
      clock.advanceTo(BASE_US + 5e6);
      runFrames();
      expect(root.querySelectorAll('.wc-app')).toHaveLength(1);
      app.dispose();
      runFrames();
      expect(root.children).toHaveLength(0);
      expect(app.bus.total()).toBe(0);
      expect(clock.size).toBe(0);
      expect(leaked()).toEqual([]);
    }
  });

  it('works for a live App too, and twice is harmless', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = new App({ root, recorder: { openStore: () => Promise.reject(new Error('none')), locks: null, win: null } });
    app.dispose();
    app.dispose();
    expect(root.children).toHaveLength(0);
    expect(leaked()).toEqual([]);
  });
});

describe('player App', () => {
  it('stamps lines with log time and echoes replayed commands, but not the width commands', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const clock = new ReplayClock(BASE_US);
    const app = playerApp(root, clock);
    const sock = new PlayerSocket();
    app.replayOn(sock, 'test');
    clock.advanceTo(BASE_US + 1e6);
    sock.data(enc.encode('oO>'));
    sock.data(Uint8Array.from([255, 249])); // IAC GA
    sock.sent('change width all 500');
    sock.sent('look');
    clock.advanceTo(BASE_US + 2e6);
    sock.data(enc.encode('A room.\r\n'));
    runFrames();
    const rows = [...app.output.el.querySelectorAll<HTMLElement>('.wc-rows .wc-row')];
    expect(rows.map((r) => r.textContent)).toEqual(['oO> look', 'A room.']);
    expect(rows.map((r) => r.dataset.ts)).toEqual([String(BASE_US + 1e6), String(BASE_US + 2e6)]);
    // No replay [SYSTEM] lines in a player App.
    expect(app.output.el.textContent).not.toContain('Replaying');
    app.dispose();
  });
});

describe('PlayerHost', () => {
  function chainWithViews() {
    const chain = twoRunChain();
    // A second VIEW in run 1 at 3 s: the Comm header off.
    const extra = makeLog(BASE_US, [{ at: 3.1, view: { comm: { filters: {}, showHeader: false } } }]);
    const lines = chain[0]!.text.split('\n');
    lines.splice(8, 0, extra.trimEnd());
    chain[0]!.text = lines.join('\n');
    return chain;
  }

  function open(events: RunEvent[] = []) {
    const root = document.createElement('div');
    root.style.cssText = 'width:1200px;height:800px';
    document.body.appendChild(root);
    const wall = new FakeWall();
    const viewer = new SettingsStore({ factory: null, storage: null, win: null });
    void viewer.load();
    let closed = 0;
    const host = new PlayerHost({ root, settings: viewer, wall, onClose: () => closed++ });
    host.openChain(chainWithViews(), events, { character: 'Rasta', level: 42 });
    return { root, wall, host, viewer, closed: () => closed };
  }

  it('applies VIEW records as they pass, and again after a backward seek', () => {
    const { wall, host } = open();
    const eng = host.engine!;
    eng.pause();
    eng.seek(1500);
    wall.flush();
    const settings = () => (host.app as unknown as { settings: SettingsStore }).settings.get();
    expect(settings().appearance.size).toBe(14);
    expect(settings().comm.showHeader).toBe(true);
    eng.seek(3500);
    wall.flush();
    expect(settings().comm.showHeader).toBe(false);
    eng.seek(1000); // back: a new App from the viewer's settings, VIEWs replayed
    wall.flush();
    expect(eng.buildCount).toBe(2);
    expect(settings().comm.showHeader).toBe(true);
    expect(settings().appearance.size).toBe(14);
    expect(host.el.querySelectorAll('.wc-app')).toHaveLength(1);
    host.dispose();
  });

  it('shows the header, the markers and closes on ESC', async () => {
    const events: RunEvent[] = [
      { type: 'pkill', us: BASE_US + 3.4e6, logUs: BASE_US + 3e6, name: 'Ibuki', race: 'the Half-Elf', xpDelta: 5 },
      { type: 'level_up', us: BASE_US + 3601e6, level: 43 },
    ];
    const { root, host, closed } = open(events);
    await new Promise((r) => setTimeout(r, 50));
    const chrome = root.querySelector('.wc-player-chrome')!;
    expect(chrome.querySelector('.wc-player-header')!.textContent).toContain('Rasta (L42) · Run 1 of 2 · ');
    const marks = [...chrome.querySelectorAll<HTMLElement>('.wc-player-mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['K►', 'L►']);
    expect(marks.map((m) => Number(m.dataset.offset))).toEqual([3000, 11100]); // the extra VIEW adds 0.1 s before the collapsed gap
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(closed()).toBe(1);
    expect(root.querySelector('.wc-player')).toBeNull();
    expect(leaked()).toEqual([]);
  });
});
