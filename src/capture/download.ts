// Download a run's raw capture as a Cockpit-style `.log` (`#runlog`).

import { runFileName } from './format';
import type { CaptureStore } from './store';

/** What `downloadRun` needs; the Recorder implements it. */
export interface RunSource {
  readonly runId: string | null;
  flush(): Promise<void>;
  getStore(): Promise<CaptureStore | null>;
}

/** A run's chunks as one Blob (chunks are not concatenated in memory). */
export async function buildRunBlob(store: CaptureStore, runId: string): Promise<Blob> {
  const chunks = await store.getChunks(runId);
  return new Blob(
    chunks.map((c) => c.text),
    { type: 'text/plain;charset=utf-8' },
  );
}

/**
 * Downloads `runId`, or the run being recorded, or the most recent run.
 * Flushes the recorder first when it is the current run. Resolves with the
 * file name, or null when there is no run (or no storage).
 */
export async function downloadRun(source: RunSource, runId?: string): Promise<string | null> {
  const store = await source.getStore();
  if (!store) return null;
  const id = runId ?? source.runId ?? (await store.latestRun())?.runId;
  if (!id) return null;
  if (id === source.runId) await source.flush();
  const blob = await buildRunBlob(store, id);
  const name = runFileName(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}
