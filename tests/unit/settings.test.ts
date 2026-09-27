import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureStore } from '../../src/capture/store';
import { DB_NAME, DB_VERSION, openWebcockpitDb } from '../../src/core/db';
import { PANE_IDS } from '../../src/layout/types';
import {
  DEFAULT_SETTINGS,
  MIRROR_KEY,
  SettingsStore,
  defaultSettings,
  migrateSettings,
  readAppearanceMirror,
} from '../../src/settings';

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

class FakeWin extends EventTarget {}

const stores: SettingsStore[] = [];
function make(opts: { factory: IDBFactory; storage?: Storage; safe?: boolean; win?: FakeWin }) {
  const s = new SettingsStore({
    factory: opts.factory,
    storage: opts.storage ?? new MemStorage(),
    win: (opts.win ?? null) as unknown as Window | null,
    safe: opts.safe ?? false,
    debounceMs: 20,
  });
  stores.push(s);
  return s;
}

afterEach(async () => {
  for (const s of stores.splice(0)) await s.dispose();
  vi.useRealTimers();
});

async function stored(factory: IDBFactory): Promise<unknown> {
  const db = await openWebcockpitDb(factory);
  const r = db.transaction('settings').objectStore('settings').get('main');
  const v = await new Promise((res) => (r.onsuccess = () => res(r.result)));
  db.close();
  return v;
}

describe('migrateSettings', () => {
  it('returns the defaults for garbage', () => {
    for (const raw of [undefined, null, 42, 'x', [], {}]) {
      expect(migrateSettings(raw)).toEqual(defaultSettings());
    }
  });

  it('default layout: right dock 33 wide with Cockpit order and heights', () => {
    const r = DEFAULT_SETTINGS.layout.docks.right;
    expect(r.size).toBe(33);
    expect(r.panes).toEqual([
      { id: 'character', desired: 9 },
      { id: 'timers', desired: 8 },
      { id: 'group', desired: 6 },
      { id: 'comm', desired: 10 },
      { id: 'ui', desired: 5 },
    ]);
    expect(DEFAULT_SETTINGS.layout.docks.left.panes).toEqual([]);
    expect(DEFAULT_SETTINGS.panes.timers).toEqual({ on: true, color: 'red', border: true });
    expect(Object.isFrozen(DEFAULT_SETTINGS.appearance.ansi)).toBe(true);
  });

  it('fills missing keys and clamps values', () => {
    const s = migrateSettings({
      appearance: { size: 99, padding: 13, fg: '#ABC', bg: 'nope', ansi: ['#123456'], cursorStyle: 'x' },
      panes: { ui: { on: false, color: 'pink' } },
      corners: 'block',
      profile: '',
    });
    expect(s.appearance.size).toBe(32);
    expect(s.appearance.padding).toBe(12);
    expect(s.appearance.fg).toBe('#aabbcc');
    expect(s.appearance.bg).toBe('#000000');
    expect(s.appearance.ansi[0]).toBe('#123456');
    expect(s.appearance.ansi[15]).toBe('#ffffff');
    expect(s.appearance.ansi).toHaveLength(16);
    expect(s.appearance.cursorStyle).toBe('beam');
    expect(s.appearance.font).toBe('dejavu');
    expect(s.panes.ui).toEqual({ on: false, color: 'black', border: true });
    // The removed corner style setting is dropped silently.
    expect('corners' in s).toBe(false);
    expect(s.profile).toBe('default');
    expect(migrateSettings({ appearance: { size: 1, padding: -4 } }).appearance).toMatchObject({
      size: 6,
      padding: 0,
    });
  });

  it('repairs a damaged layout: duplicates, unknown ids, missing panes', () => {
    const s = migrateSettings({
      layout: {
        docks: {
          left: { size: 20, panes: [{ id: 'comm', desired: 12 }, { id: 'bogus', desired: 3 }] },
          right: { size: -5, panes: [{ id: 'comm', desired: 4 }, { id: 'ui' }] },
        },
      },
    });
    expect(s.layout.docks.left).toEqual({ size: 20, panes: [{ id: 'comm', desired: 12 }] });
    expect(s.layout.docks.right.size).toBe(1);
    expect(s.layout.docks.right.panes.map((p) => p.id)).toEqual(['ui', 'character', 'timers', 'group']);
    expect(s.layout.docks.right.panes[0]).toEqual({ id: 'ui', desired: 5 });
    expect(s.layout.docks.bottom).toEqual({ size: 10, panes: [] });
    // Layouts stored before the top dock existed get an empty one.
    expect(s.layout.docks.top).toEqual({ size: 10, panes: [] });
    const all = Object.values(s.layout.docks).flatMap((d) => d.panes.map((p) => p.id));
    expect(all.sort()).toEqual([...PANE_IDS].sort());
  });
});

describe('migrateLayout: floating panes', () => {
  it('keeps valid floating panes, repairs bad ones and keeps every pane once', () => {
    const s = migrateSettings({
      layout: {
        docks: { right: { size: 33, panes: [{ id: 'character', desired: 9 }, { id: 'timers', desired: 8 }] } },
        floating: [
          { id: 'comm', x: 4, y: 2, w: 30, h: 12 },
          { id: 'character', x: 1, y: 1, w: 10, h: 10 }, // already docked: dropped
          { id: 'group', x: -3, y: 'x', w: 0 }, // repaired
          { id: 'comm', x: 9, y: 9, w: 9, h: 9 }, // duplicate
          { id: 'nope', x: 1, y: 1, w: 1, h: 1 },
          'garbage',
        ],
      },
    });
    expect(s.layout.floating).toEqual([
      { id: 'comm', x: 4, y: 2, w: 30, h: 12 },
      { id: 'group', x: 0, y: 0, w: 1, h: 8 },
    ]);
    expect(s.layout.docks.right.panes.map((p) => p.id)).toEqual(['character', 'timers', 'ui']);
    expect(s.layout.docks.top).toEqual({ size: 10, panes: [] });
  });

  it('gives an older layout an empty floating list and a top dock', () => {
    const s = migrateSettings({ layout: { docks: { right: { size: 40, panes: [] } } } });
    expect(s.layout.floating).toEqual([]);
    expect(s.layout.docks.top.panes).toEqual([]);
    expect(s.layout.docks.right.size).toBe(40);
  });
});

describe('database', () => {
  it('upgrades a version-1 capture database without losing runs', async () => {
    const factory = new IDBFactory();
    // Create a v1 database as stage 1 did.
    await new Promise<void>((resolve, reject) => {
      const r = factory.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const runs = r.result.createObjectStore('runs', { keyPath: 'runId' });
        runs.createIndex('character', 'character');
        runs.createIndex('startedUs', 'startedUs');
        r.result.createObjectStore('runChunks', { keyPath: ['runId', 'seq'] });
        runs.put({ runId: 'A/1', character: 'A', startedUs: 1, endedUs: null, sealed: false, bytes: 0, lines: 0 });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    const cap = await CaptureStore.open(factory);
    expect(cap.db.version).toBe(DB_VERSION);
    expect([...cap.db.objectStoreNames].sort()).toEqual(['profiles', 'runChunks', 'runs', 'settings']);
    expect((await cap.listRuns()).map((r) => r.runId)).toEqual(['A/1']);
    cap.close();
  });
});

describe('SettingsStore', () => {
  it('starts with defaults, updates by patch and by draft, notifies', async () => {
    const s = make({ factory: new IDBFactory() });
    await s.load();
    expect(s.get()).toEqual(defaultSettings());
    expect(s.persistent).toBe(true);
    const seen: Array<[number, number]> = [];
    const off = s.subscribe((n, p) => seen.push([n.appearance.size, p.appearance.size]));
    s.update({ appearance: { size: 18 } });
    s.update((d) => {
      d.panes.ui.on = false;
    });
    s.update((d) => ({ appearance: { size: d.appearance.size + 1 } }));
    expect(s.get().appearance.size).toBe(19);
    expect(s.get().panes.ui.on).toBe(false);
    expect(s.get().appearance.fg).toBe('#c0c0c0');
    expect(seen).toEqual([
      [18, 15],
      [18, 18],
      [19, 18],
    ]);
    // No-op updates do not notify; values are clamped.
    s.update({ appearance: { size: 19 } });
    expect(seen).toHaveLength(3);
    s.update({ appearance: { size: 100 } });
    expect(s.get().appearance.size).toBe(32);
    off();
    s.update({ appearance: { size: 10 } });
    expect(seen).toHaveLength(4);
    expect(Object.isFrozen(s.get().panes.ui)).toBe(true);
  });

  it('arrays in a patch replace the whole array', async () => {
    const s = make({ factory: new IDBFactory() });
    await s.load();
    s.update({ layout: { docks: { right: { panes: [{ id: 'ui', desired: 7 }] } } } });
    const right = s.get().layout.docks.right;
    expect(right.size).toBe(33);
    // The migration re-adds the panes the patch left out.
    expect(right.panes[0]).toEqual({ id: 'ui', desired: 7 });
    expect(right.panes).toHaveLength(5);
  });

  it('persists debounced, reloads, and mirrors appearance', async () => {
    const factory = new IDBFactory();
    const storage = new MemStorage();
    const a = make({ factory, storage });
    await a.load();
    a.update({ appearance: { bg: '#f4ecd8', font: 'jetbrains' }, profile: 'pvp' });
    expect(readAppearanceMirror(storage)?.bg).toBe('#f4ecd8');
    expect(await stored(factory)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 60));
    expect((await stored(factory)) as { profile: string }).toMatchObject({ profile: 'pvp' });

    const b = make({ factory, storage: new MemStorage() });
    // Before load: nothing from IndexedDB yet, no mirror → defaults.
    expect(b.get().appearance.bg).toBe('#000000');
    let calls = 0;
    b.subscribe(() => calls++);
    await b.load();
    expect(b.get().appearance.bg).toBe('#f4ecd8');
    expect(b.get().profile).toBe('pvp');
    expect(calls).toBe(1);
  });

  it('uses the localStorage mirror for the first paint', () => {
    const storage = new MemStorage();
    storage.setItem(MIRROR_KEY, JSON.stringify({ size: 22, bg: '#0e141c' }));
    const s = make({ factory: new IDBFactory(), storage });
    expect(s.get().appearance.size).toBe(22);
    expect(s.get().appearance.bg).toBe('#0e141c');
    expect(s.get().appearance.fg).toBe('#c0c0c0');
    storage.setItem(MIRROR_KEY, '{not json');
    expect(readAppearanceMirror(storage)).toBeNull();
  });

  it('flushes on pagehide', async () => {
    const factory = new IDBFactory();
    const win = new FakeWin();
    const s = new SettingsStore({ factory, storage: null, win: win as unknown as Window, debounceMs: 250 });
    stores.push(s);
    await s.load();
    s.update({ profile: 'hidden' });
    win.dispatchEvent(new Event('pagehide'));
    await s.flush();
    expect(await stored(factory)).toMatchObject({ profile: 'hidden' });
  });

  it('safe mode: default appearance, nothing saved until a change', async () => {
    const factory = new IDBFactory();
    const storage = new MemStorage();
    const a = make({ factory, storage });
    await a.load();
    a.update({ appearance: { size: 32 }, panes: { comm: { color: 'grey' } } });
    await a.flush();

    const safeStorage = new MemStorage();
    safeStorage.setItem(MIRROR_KEY, JSON.stringify({ size: 32 }));
    const b = make({ factory, storage: safeStorage, safe: true });
    expect(b.get().appearance.size).toBe(15);
    await b.load();
    expect(b.isSafe).toBe(true);
    expect(b.get().appearance.size).toBe(15);
    expect(b.get().panes.comm.color).toBe('grey');
    await b.flush();
    expect(await stored(factory)).toMatchObject({ appearance: { size: 32 } });
    expect(readAppearanceMirror(safeStorage)?.size).toBe(32);

    b.update({ appearance: { padding: 4 } });
    await b.flush();
    expect(await stored(factory)).toMatchObject({ appearance: { size: 15, padding: 4 } });
    expect(readAppearanceMirror(safeStorage)).toMatchObject({ size: 15, padding: 4 });
  });

  it('replays changes made while loading on top of the stored data', async () => {
    const factory = new IDBFactory();
    const a = make({ factory });
    await a.load();
    a.update({ profile: 'stored' });
    await a.flush();

    const b = make({ factory });
    const p = b.load();
    b.update({ appearance: { size: 20 } });
    await p;
    expect(b.get().appearance.size).toBe(20);
    expect(b.get().profile).toBe('stored');
    await b.flush();
    expect(await stored(factory)).toMatchObject({ appearance: { size: 20 }, profile: 'stored' });
  });

  it('works in memory without IndexedDB', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = make({ factory: null as unknown as IDBFactory });
    await s.load();
    expect(s.persistent).toBe(false);
    s.update({ appearance: { size: 20 } });
    await s.flush();
    expect(s.get().appearance.size).toBe(20);
    warn.mockRestore();
  });
});
