// RunLibrary's stage 7 parts (ADR 0019): the `exports` store, export docs
// in remove / sweep / backup / restore, and chainLogRange.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { RunMeta } from '../../src/capture/store';
import { DB_VERSION } from '../../src/core/db';
import { RunLibrary } from '../../src/runs/library';
import { DAY_US } from '../../src/runs/stitch';
import type { RunStore } from '../../src/runs/store';
import { type ExportDoc, defaultExportDoc } from '../../src/share/edits';

const H = 3600e6;
const T = 1_790_000_000_000_000;

function meta(id: string, startedUs: number, over: Partial<RunMeta> = {}): RunMeta {
  return {
    runId: id,
    character: id.split('/')[0]!,
    startedUs,
    endedUs: startedUs + H,
    sealed: true,
    bytes: 6,
    lines: 1,
    summary: { startUs: startedUs, lastEventUs: startedUs + H, kills: 0, pkills: 0, deaths: 0 },
    ...over,
  };
}

async function lib(factory = new IDBFactory()) {
  const l = await RunLibrary.open(factory, { locks: null, storage: null });
  return { l, store: l.store };
}

async function seed(store: RunStore, m: RunMeta, chunks: Array<[firstUs: number, lastUs: number, text: string]> = []) {
  await store.putWholeRun(
    m,
    [],
    chunks.map(([firstUs, lastUs, text], seq) => ({ runId: m.runId, seq, firstUs, lastUs, text })),
  );
}

const doc = (sessionId: string, over: Partial<ExportDoc> = {}): ExportDoc => ({ ...defaultExportDoc(sessionId), ...over });

describe('RunLibrary export docs', () => {
  it('opens DB v6 with the exports store', async () => {
    const { store } = await lib();
    expect(DB_VERSION).toBe(6);
    expect([...store.db.objectStoreNames]).toContain('exports');
  });

  it('returns defaults, saves, and normalises what it reads', async () => {
    const { l, store } = await lib();
    expect(await l.exportDoc('Rasta/1')).toEqual(defaultExportDoc('Rasta/1'));
    const d = doc('Rasta/1', { title: 'Fight', format: 'text', excludes: [[5, 9]], comments: [{ beforeUs: 7, text: 'hi' }] });
    await l.saveExportDoc(d);
    expect(await l.exportDoc('Rasta/1')).toEqual(d);
    await store.putExport({ ...d, excludes: [[20, null], [5, 9], [9, 12]] });
    expect((await l.exportDoc('Rasta/1')).excludes).toEqual([
      [5, 12],
      [20, null],
    ]);
  });

  it('remove deletes the session doc; sweep deletes docs whose run is gone', async () => {
    const { l, store } = await lib();
    const now = T + 20 * DAY_US;
    await seed(store, meta('A/old', T));
    await seed(store, meta('A/recent', now - DAY_US));
    await seed(store, meta('B/1', now - DAY_US));
    for (const id of ['A/old', 'A/recent', 'B/1', 'Ghost/1']) await l.saveExportDoc(doc(id));
    const [b] = (await l.listSessions(now)).filter((s) => s.id === 'B/1');
    await l.remove(b!);
    expect((await store.listExports()).map((d) => d.sessionId).sort()).toEqual(['A/old', 'A/recent', 'Ghost/1']);
    expect(await l.sweep(now)).toBe(1);
    expect((await store.listExports()).map((d) => d.sessionId)).toEqual(['A/recent']);
  });

  it('backs up export docs after the runs and restores them when none exists', async () => {
    const { l, store } = await lib();
    await seed(store, meta('Rasta/1', T), [[T, T, '1790000000000000 hi\n']]);
    await seed(store, meta('Live/1', T + H, { sealed: false, endedUs: null }));
    await l.saveExportDoc(doc('Rasta/1', { title: 'Mine', excludes: [[T, null]] }));
    await l.saveExportDoc(doc('Live/1', { title: 'Not backed up' }));
    const blob = await l.backup(T + 5);
    const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const lines = text.trim().split('\n').map((x) => JSON.parse(x) as { type: string; doc?: ExportDoc });
    expect(lines[0]).toMatchObject({ type: 'webcockpit-runs', schema: 1 });
    expect(lines.map((x) => x.type)).toEqual(['webcockpit-runs', 'run', 'chunk', 'export']);
    expect(lines[3]!.doc!.title).toBe('Mine');

    const other = await lib();
    await other.l.saveExportDoc(doc('Other/1'));
    expect(await other.l.restore(blob)).toEqual({ added: 1, skipped: 0 });
    expect(await other.l.exportDoc('Rasta/1')).toMatchObject({ title: 'Mine', excludes: [[T, null]] });
    // An existing doc is kept.
    await other.l.saveExportDoc(doc('Rasta/1', { title: 'Edited' }));
    expect(await other.l.restore(blob)).toEqual({ added: 0, skipped: 1 });
    expect((await other.l.exportDoc('Rasta/1')).title).toBe('Edited');
  });

  it('rejects a bad export line', async () => {
    const { l } = await lib();
    const head = JSON.stringify({ type: 'webcockpit-runs', schema: 1, exportedUs: 1 }) + '\n';
    const gz = async (s: string) =>
      new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    await expect(l.restore(await gz(head + JSON.stringify({ type: 'export', doc: { title: 'x' } }) + '\n'))).rejects.toThrow(
      /bad export doc/,
    );
  });
});

describe('RunLibrary.chainLogRange', () => {
  it('reads only the chunks overlapping the range', async () => {
    const { l, store } = await lib();
    const chunks: Array<[number, number, string]> = [];
    for (let i = 0; i < 20; i++) chunks.push([T + i * 10, T + i * 10 + 9, `c${i}\n`]);
    await seed(store, meta('Rasta/1', T), chunks);
    expect((await l.chainLogRange('Rasta/1', T + 35, T + 52))!.text).toBe('c3\nc4\nc5\n');
    expect((await l.chainLogRange('Rasta/1', T + 30, T + 30))!.text).toBe('c3\n');
    expect((await l.chainLogRange('Rasta/1', 0, T + 5))!.text).toBe('c0\n');
    expect((await l.chainLogRange('Rasta/1', T + 1000, T + 2000))!.text).toBe('');
    expect((await l.chainLogRange('Rasta/1', T + 195, T + 5000))!.meta.runId).toBe('Rasta/1');
    expect(await l.chainLogRange('Nobody/1', 0, 1)).toBeNull();
    // A hole in the seqs falls back to reading every chunk.
    await store.putWholeRun(meta('Gap/1', T), [], [
      { runId: 'Gap/1', seq: 0, firstUs: T, lastUs: T + 9, text: 'a\n' },
      { runId: 'Gap/1', seq: 2, firstUs: T + 10, lastUs: T + 19, text: 'b\n' },
      { runId: 'Gap/1', seq: 3, firstUs: T + 20, lastUs: T + 29, text: 'c\n' },
    ]);
    expect((await l.chainLogRange('Gap/1', T + 12, T + 15))!.text).toBe('b\n');
  });
});
