import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DB_VERSION, STORE, type StoredMap, type StoredMapId, idbDone, idbRequest, openWebcockpitDb } from '../../src/core/db';

describe('DB v7 map stores', () => {
  it('stores the imported map and learned server ids', async () => {
    const db = await openWebcockpitDb(new IDBFactory());
    expect(db.version).toBe(DB_VERSION);
    expect(DB_VERSION).toBeGreaterThanOrEqual(7);
    const rec: StoredMap = { key: 'current', name: 'x.mm2', size: 3, date: 1, bytes: new Uint8Array([1, 2, 3]).buffer, hash: 'ab' };
    const id: StoredMapId = { mapHash: 'ab', serverId: 42, room: 7 };
    const tx = db.transaction([STORE.maps, STORE.mapIds], 'readwrite');
    tx.objectStore(STORE.maps).put(rec);
    tx.objectStore(STORE.mapIds).put(id);
    tx.objectStore(STORE.mapIds).put({ mapHash: 'cd', serverId: 42, room: 9 });
    await idbDone(tx);
    const r = db.transaction([STORE.maps, STORE.mapIds], 'readonly');
    const got = await idbRequest<StoredMap>(r.objectStore(STORE.maps).get('current'));
    expect(new Uint8Array(got.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    const ids = await idbRequest<StoredMapId[]>(r.objectStore(STORE.mapIds).getAll(IDBKeyRange.bound(['ab', 0], ['ab', Infinity])));
    expect(ids).toEqual([id]);
    db.close();
  });
});
