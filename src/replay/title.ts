// Replay names shared by the exporter and the page (pure, no DOM).

import type { ReplayPayload } from '../share/payload';

/** `YYYY-MM-DD`, local time. */
export function fmtDate(us: number): string {
  const d = new Date(us / 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The page title: the export title, else `<char> · YYYY-MM-DD`. */
export function replayTitle(p: ReplayPayload): string {
  return p.title || `${p.character || 'MUME'} · ${fmtDate(p.startUs)}`;
}
