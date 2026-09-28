// Shared helpers for the map tracking tests: the bundled arda.mm2 (parsed
// once per file) and a capture log turned into MapEvents the way the main
// thread's MapEventForwarder would forward them.

import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { MapEventForwarder } from '../../src/map/client';
import { readMm2 } from '../../src/map/mm2';
import type { MapData } from '../../src/map/model';
import type { MapEvent } from '../../src/map/protocol';

export const ARDA = new URL('../../public/map/arda.mm2', import.meta.url);
export const HAS_ARDA = existsSync(ARDA);

let arda: Promise<MapData> | null = null;
/** The bundled map (Node zlib inflate). */
export function loadArda(): Promise<MapData> {
  arda ??= readMm2(new Uint8Array(readFileSync(ARDA)), async (z) => new Uint8Array(inflateSync(z)));
  return arda;
}

const SGR = /\x1b\[[0-9;]*m/g;

/** A capture log's GMCP records, commands and lines as forwarded MapEvents (in order). */
export function logEvents(text: string): MapEvent[] {
  const out: MapEvent[] = [];
  const fwd = new MapEventForwarder((evs) => void out.push(...evs), (cb) => cb());
  for (const raw of text.split('\n')) {
    if (raw.length < 17) continue;
    const body = raw.slice(17);
    if (body.startsWith('> ')) fwd.onCmd({ text: body.slice(2), ts: 0 });
    else if (body.startsWith('\x1bGMCP ')) {
      const rest = body.slice(6);
      const sp = rest.indexOf(' ');
      const pkg = sp < 0 ? rest : rest.slice(0, sp);
      const data = sp < 0 ? undefined : (JSON.parse(rest.slice(sp + 1)) as unknown);
      fwd.onGmcp({ pkg, data });
    } else if (!body.startsWith('\x1b') || body.startsWith('\x1b[')) {
      const t = body.replace(SGR, '');
      fwd.onLine({ text: t, raw: body, runs: [], tags: [], prompt: false, ts: 0 });
    }
  }
  return out;
}
