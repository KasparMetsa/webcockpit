// Stub of the HTML replay builder (ADR 0019, P2 owns this file). The main
// session keeps P2's version at merge; P1 only needs the signature.

import type { ReplayPayload } from '../share/payload';

/** One self-contained HTML file that replays `payload` (P2). */
export async function buildReplayHtml(payload: ReplayPayload): Promise<Blob> {
  void payload;
  throw new Error('HTML replay not built yet');
}
