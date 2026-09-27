import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { Bus } from '../../src/core/bus';
import type { Line } from '../../src/core/types';
import {
  formatInbound,
  formatOutbound,
  formatTs,
  localStamp,
  makeRunId,
  runFileName,
} from '../../src/capture/format';
import { buildRunBlob } from '../../src/capture/download';
import { type LockManagerLike, Recorder, STATUS, runLockName } from '../../src/capture/recorder';
import { CaptureStore } from '../../src/capture/store';

class FakeLocks implements LockManagerLike {
  held = new Set<string>();
  request(name: string, _o: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void> | void) {
    if (this.held.has(name)) return Promise.resolve(cb(null));
    this.held.add(name);
    return Promise.resolve(cb({ name })).finally(() => this.held.delete(name));
  }
}

function line(raw: string, ts: number, prompt = false): Line {
  return { text: raw, runs: [], tags: [], prompt, raw, ts };
}

describe('capture format', () => {
  it('matches the Cockpit line format exactly', () => {
    expect(formatTs(1790449245424814)).toBe('1790449245424814');
    expect(formatTs(42)).toBe('0000000000000042');
    expect(formatTs(1790449245424814.7)).toBe('1790449245424814');
    expect(formatOutbound(1790449245424814, 'who')).toBe('1790449245424814 > who\n');
    expect(formatOutbound(1790449245424814, '')).toBe('1790449245424814 > \n');
    expect(formatInbound(1790449247842113, '\x1b[35mA wall.\x1b[0m')).toBe(
      '1790449247842113 \x1b[35mA wall.\x1b[0m\n',
    );
    expect(formatInbound(1790449247842391, 'oO Mana:Hot>')).toBe('1790449247842391 oO Mana:Hot>\n');
    expect(formatInbound(1790449247842391, '')).toBe('1790449247842391 \n');
  });

  it('builds run ids and file names', () => {
    const d = new Date(2026, 8, 19, 21, 35, 58);
    expect(localStamp(d)).toBe('2026-09-19T21-35-58');
    expect(makeRunId('Rasta', d)).toBe('Rasta/2026-09-19T21-35-58');
    expect(runFileName('Rasta/2026-09-19T21-35-58')).toBe('Rasta-2026-09-19T21-35-58.log');
  });
});

function setup(opts: { factory?: IDBFactory; locks?: LockManagerLike | null; flushMs?: number } = {}) {
  const factory = opts.factory ?? new IDBFactory();
  const bus = new Bus();
  const statuses: string[] = [];
  let clock = 1790449245000000;
  const rec = new Recorder(bus, {
    openStore: () => CaptureStore.open(factory),
    locks: opts.locks === undefined ? new FakeLocks() : opts.locks,
    onStatus: (s) => statuses.push(s),
    flushMs: opts.flushMs ?? 60000,
    win: null,
    now: () => (clock += 1000),
  });
  const play = (name = 'Rasta') => {
    bus.emit('conn.state', { state: 'login', prev: 'connecting' });
    bus.emit('gmcp', { pkg: 'Char.Name', data: { name, fullname: name + ' X' } });
    bus.emit('conn.state', { state: 'playing', prev: 'login' });
  };
  return { factory, bus, rec, statuses, play };
}

describe('Recorder', () => {
  it('records lines and commands in order, skipping secrets and partials', async () => {
    const t = setup();
    t.play();
    t.bus.emit('text.line', line('oO>', 1790449245424000, true));
    t.bus.emit('cmd.sent', { text: 'who', ts: 1790449245424814 });
    t.bus.emit('cmd.sent', { text: '', ts: 1790449245424815, secret: true });
    t.bus.emit('cmd.sent', { text: 'change width all 500', ts: 1790449245424816, echo: false } as never);
    t.bus.emit('text.partial', line('partial', 1790449245424817));
    t.bus.emit('text.line', line('\x1b[33mAllies\x1b[0m', 1790449245596613));
    t.bus.emit('cmd.sent', { text: '', ts: 1790449245596700 });
    await t.rec.idle();
    const runId = t.rec.runId!;
    expect(runId).toMatch(/^Rasta\/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d$/);
    expect(t.statuses).toContain(STATUS.recording);
    await t.rec.flush();
    const store = (await t.rec.getStore())!;
    const text = await (await buildRunBlob(store, runId)).text();
    expect(text).toBe(
      '1790449245424000 oO>\n' +
        '1790449245424814 > who\n' +
        '1790449245424816 > change width all 500\n' +
        '1790449245596613 \x1b[33mAllies\x1b[0m\n' +
        '1790449245596700 > \n',
    );
    const meta = (await store.getRun(runId))!;
    expect(meta.lines).toBe(5);
    expect(meta.bytes).toBe(new TextEncoder().encode(text).byteLength);
    expect(meta.sealed).toBe(false);
  });

  it('does not record before playing', async () => {
    const t = setup();
    t.bus.emit('conn.state', { state: 'login', prev: 'connecting' });
    t.bus.emit('text.line', line('By what name?', 1));
    await t.rec.flush();
    expect(t.rec.runId).toBeNull();
    const store = (await t.rec.getStore())!;
    expect(await store.listRuns()).toEqual([]);
  });

  it('writes chunks with increasing seq on each flush', async () => {
    const t = setup();
    t.play();
    t.bus.emit('text.line', line('a', 10));
    await t.rec.flush();
    t.bus.emit('text.line', line('b', 20));
    t.bus.emit('text.line', line('c', 30));
    await t.rec.flush();
    await t.rec.flush(); // empty buffer: no chunk
    const store = (await t.rec.getStore())!;
    const chunks = await store.getChunks(t.rec.runId!);
    expect(chunks.map((c) => [c.seq, c.firstUs, c.lastUs])).toEqual([
      [0, 10, 10],
      [1, 20, 30],
    ]);
  });

  it('flushes on the timer', async () => {
    const t = setup({ flushMs: 20 });
    t.play();
    t.bus.emit('text.line', line('tick', 10));
    await t.rec.idle();
    const runId = t.rec.runId!;
    await new Promise((r) => setTimeout(r, 80));
    await t.rec.idle();
    const store = (await t.rec.getStore())!;
    expect((await store.getChunks(runId)).length).toBe(1);
    t.rec.dispose();
  });

  it('seals the run on leaving playing and releases the lock', async () => {
    const locks = new FakeLocks();
    const t = setup({ locks });
    t.play();
    t.bus.emit('text.line', line('bye', 10));
    await t.rec.idle();
    const runId = t.rec.runId!;
    expect(locks.held.has(runLockName('Rasta'))).toBe(true);
    t.bus.emit('conn.state', { state: 'disconnected', prev: 'playing', reason: 'x' });
    await t.rec.idle();
    const store = (await t.rec.getStore())!;
    const meta = (await store.getRun(runId))!;
    expect(meta.sealed).toBe(true);
    expect(meta.endedUs).toBeGreaterThan(meta.startedUs);
    expect((await store.getChunks(runId)).map((c) => c.text)).toEqual(['0000000000000010 bye\n']);
    expect(t.rec.runId).toBeNull();
    expect(locks.held.size).toBe(0);
    t.bus.emit('text.line', line('after', 20));
    await t.rec.flush();
    expect((await store.getChunks(runId)).length).toBe(1);
  });

  it('starts a new run on the next playing', async () => {
    const t = setup();
    t.play();
    await t.rec.idle();
    t.bus.emit('conn.state', { state: 'disconnected', prev: 'playing' });
    await t.rec.idle();
    const first = (await (await t.rec.getStore())!.listRuns())[0]!.runId;
    t.play();
    await t.rec.idle();
    // Same character within the same second gets a distinct id.
    expect(t.rec.runId).toBe(first + '-2');
    t.bus.emit('conn.state', { state: 'disconnected', prev: 'playing' });
    t.play('Other');
    await t.rec.idle();
    expect(t.rec.runId).toMatch(/^Other\//);
  });

  it('does not record when another tab holds the character lock', async () => {
    const locks = new FakeLocks();
    locks.held.add(runLockName('Rasta'));
    const t = setup({ locks });
    t.play();
    t.bus.emit('text.line', line('x', 1));
    await t.rec.flush();
    expect(t.rec.runId).toBeNull();
    expect(t.rec.status).toBe(STATUS.anotherTab);
    const store = (await t.rec.getStore())!;
    expect(await store.listRuns()).toEqual([]);
  });

  it('reports missing Web Locks and IndexedDB', async () => {
    const t = setup({ locks: null });
    t.play();
    await t.rec.idle();
    expect(t.rec.runId).toBeNull();
    expect(t.rec.status).toBe(STATUS.noLocks);

    const bus = new Bus();
    const rec = new Recorder(bus, {
      openStore: () => Promise.reject(new Error('no idb')),
      locks: new FakeLocks(),
      win: null,
    });
    await rec.idle();
    expect(rec.status).toBe(STATUS.noDb);
  });

  it('seals orphaned runs at their last chunk on start, but not locked ones', async () => {
    const factory = new IDBFactory();
    const store = await CaptureStore.open(factory);
    const base = { endedUs: null, sealed: false, bytes: 0, lines: 0 };
    await store.putRun({ runId: 'A/1', character: 'A', startedUs: 100, ...base });
    await store.appendChunk({ runId: 'A/1', seq: 0, firstUs: 150, lastUs: 180, text: 'x\n' }, 2, 1);
    await store.appendChunk({ runId: 'A/1', seq: 1, firstUs: 190, lastUs: 250, text: 'y\n' }, 2, 1);
    await store.putRun({ runId: 'B/1', character: 'B', startedUs: 300, ...base });
    await store.putRun({ runId: 'C/1', character: 'C', startedUs: 400, ...base });
    const locks = new FakeLocks();
    locks.held.add(runLockName('C'));
    const t = setup({ factory, locks });
    await t.rec.idle();
    const a = (await store.getRun('A/1'))!;
    expect([a.sealed, a.endedUs, a.lines, a.bytes]).toEqual([true, 250, 2, 4]);
    const b = (await store.getRun('B/1'))!;
    expect([b.sealed, b.endedUs]).toEqual([true, 300]);
    expect((await store.getRun('C/1'))!.sealed).toBe(false);
    expect((await store.latestRun())!.runId).toBe('C/1');
  });
});
