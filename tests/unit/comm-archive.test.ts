import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DB_NAME, openWebcockpitDb } from '../../src/core/db';
import { COMM_RETENTION_MS, CommArchive, type NewCommRecord } from '../../src/gmcp/comm-archive';
import { lazyDb } from '../../src/panes/context';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_790_000_000_000;

function msg(character: string, ts: number, text: string, extra: Partial<NewCommRecord> = {}): NewCommRecord {
  return { character, ts, channel: 'tells', talker: 'Gibur', talkerType: 'player', destination: null, text, ...extra };
}

async function open(now = () => NOW) {
  const factory = new IDBFactory();
  const db = await openWebcockpitDb(factory);
  return { factory, db, archive: new CommArchive(db, { now }) };
}

describe('CommArchive', () => {
  it('appends with increasing seq and loads a character oldest first', async () => {
    const { archive, db } = await open();
    const a = await archive.append(msg('Rasta', NOW - 3000, 'one'));
    const b = await archive.append(msg('Rasta', NOW - 2000, 'two', { talker: 'you', destination: 'Dori' }));
    await archive.append(msg('Gittan', NOW - 1500, 'other char'));
    await archive.append(msg('Rasta', NOW - 1000, 'three'));
    expect(b).toBeGreaterThan(a);
    const got = await archive.loadRecent('Rasta');
    expect(got.map((r) => r.text)).toEqual(['one', 'two', 'three']);
    expect(got[1]).toMatchObject({ talker: 'you', destination: 'Dori', seq: b, character: 'Rasta' });
    expect((await archive.loadRecent('Gittan')).map((r) => r.text)).toEqual(['other char']);
    expect(await archive.loadRecent('Nobody')).toEqual([]);
    db.close();
  });

  it('loads only the newest N within 7 days; equal times keep insertion order', async () => {
    const { archive, db } = await open();
    await archive.append(msg('Rasta', NOW - 8 * DAY, 'too old'));
    for (let i = 0; i < 5; i++) await archive.append(msg('Rasta', NOW - 10, `m${i}`));
    expect((await archive.loadRecent('Rasta', 3)).map((r) => r.text)).toEqual(['m2', 'm3', 'm4']);
    expect((await archive.loadRecent('Rasta')).map((r) => r.text)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    expect(await archive.loadRecent('Rasta', 0)).toEqual([]);
    db.close();
  });

  it('prunes everything older than 7 days, for every character', async () => {
    let now = NOW;
    const { archive, db } = await open(() => now);
    await archive.append(msg('Rasta', NOW - COMM_RETENTION_MS - 1, 'old R'));
    await archive.append(msg('Gittan', NOW - 9 * DAY, 'old G'));
    await archive.append(msg('Rasta', NOW - COMM_RETENTION_MS, 'edge'));
    await archive.append(msg('Rasta', NOW, 'new'));
    expect(await archive.prune()).toBe(2);
    expect((await archive.loadRecent('Rasta')).map((r) => r.text)).toEqual(['edge', 'new']);
    now = NOW + DAY;
    expect(await archive.prune()).toBe(1);
    expect(await archive.prune()).toBe(0);
    db.close();
  });

  it('opens through a lazy opener and upgrades a version-2 database', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const r = factory.open(DB_NAME, 2);
      r.onupgradeneeded = () => {
        const runs = r.result.createObjectStore('runs', { keyPath: 'runId' });
        runs.createIndex('character', 'character');
        runs.createIndex('startedUs', 'startedUs');
        r.result.createObjectStore('runChunks', { keyPath: ['runId', 'seq'] });
        r.result.createObjectStore('settings');
        const p = r.result.createObjectStore('profiles', { keyPath: 'name' });
        p.put({ name: 'default', text: 'x', created: 1, modified: 1 });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    const archive = await CommArchive.open(() => openWebcockpitDb(factory), { now: () => NOW });
    expect(archive.db.version).toBe(3);
    await archive.append(msg('Rasta', NOW, 'hi'));
    expect((await archive.loadRecent('Rasta')).map((r) => r.text)).toEqual(['hi']);
    const tx = archive.db.transaction('profiles', 'readonly');
    const p = await new Promise((res) => {
      const r = tx.objectStore('profiles').get('default');
      r.onsuccess = () => res(r.result);
    });
    expect(p).toMatchObject({ text: 'x' });
    archive.db.close();
  });

  it('lazyDb opens once and reopens after the connection was closed for an upgrade', async () => {
    const factory = new IDBFactory();
    const openDb = lazyDb(factory);
    const a = await openDb();
    expect(await openDb()).toBe(a);
    a.onversionchange!(new Event('versionchange') as IDBVersionChangeEvent);
    const b = await openDb();
    expect(b).not.toBe(a);
    b.close();
  });
});
