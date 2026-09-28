// Map tools for the Options page and the HTML replay export (ADR 0020
// "Map files and storage", "Replays"). Pure apart from `fetch`; they run
// in a short-lived tools worker (src/map/worker/tools.worker.ts, started
// by src/map/tools-client.ts), never on the main thread of the app, since
// parsing the bundled arda.mm2 takes 100–200 ms.
//
// - `validate`: parses a `.mm2` file (import) and reports rooms and hash.
// - `subset`: the rooms an exported chain visited, plus a margin, as a
//   `.mm2` subset, and the tile / font files that subset needs.
//
// Visited rooms (`extractVisits` on the main thread, `resolveVisits` in
// the worker): every recorded `Room.Info` is looked up by its server id,
// else by name + description (unique, or the one next to the previous
// room; a few candidates are all kept), and every `Group.*` member's
// `mapid` by server id. This is a lookup, not the locator (src/map/locate):
// it only has to find the area to embed.

import { captureEntries } from '../share/capture';
import { DIR_COUNT, DIR, EXIT_FLAG, LOAD_FLAGS, MOB_FLAGS, type MapData, TERRAIN, TERRAIN_ROAD, roomsByNameDesc } from './model';
import { type Inflate, inflateZlib, mapHash, readMm2 } from './mm2';
import { type Deflate, deflateZlib, writeMm2 } from './mm2-write';
import type { MapSource } from './protocol';
import { neighbourhood, subsetMap } from './subset';

// ------------------------------------------------------------- visits

/** One recorded `Room.Info` (only the fields the lookup uses). */
export interface RoomVisit {
  id?: number;
  name?: string;
  desc?: string;
}

/** What an exported chain says about where it was. */
export interface MapVisits {
  /** `Room.Info` in order (consecutive repeats dropped). */
  rooms: RoomVisit[];
  /** Server ids from `Group.*` `mapid` (distinct). */
  mapIds: number[];
}

const posInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 0xffffffff ? v : undefined;

function collectMapIds(v: unknown, out: Set<number>, depth = 0): void {
  if (!v || typeof v !== 'object' || depth > 4) return;
  if (Array.isArray(v)) {
    for (const x of v) collectMapIds(x, out, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  const id = posInt(o.mapid);
  if (id !== undefined) out.add(id);
  for (const k of ['members', 'data']) if (k in o) collectMapIds(o[k], out, depth + 1);
}

/** The `Room.Info` and `Group.*` data of capture texts (oldest run first). */
export function extractVisits(texts: Iterable<string>): MapVisits {
  const rooms: RoomVisit[] = [];
  const mapIds = new Set<number>();
  let lastKey = '';
  for (const text of texts) {
    for (const e of captureEntries(text)) {
      if (e.kind !== 'gmcp' || !e.pkg) continue;
      const pkg = e.pkg.toLowerCase();
      const isRoom = pkg === 'room.info';
      if (!isRoom && !pkg.startsWith('group.')) continue;
      let data: unknown;
      try {
        data = JSON.parse(e.body.slice(e.pkg.length + 1));
      } catch {
        continue;
      }
      if (!isRoom) {
        collectMapIds(data, mapIds);
        continue;
      }
      if (!data || typeof data !== 'object') continue;
      const d = data as Record<string, unknown>;
      const v: RoomVisit = {};
      const id = posInt(d.id);
      if (id !== undefined) v.id = id;
      if (typeof d.name === 'string') v.name = d.name;
      if (typeof d.desc === 'string') v.desc = d.desc;
      if (v.id === undefined && v.name === undefined) continue;
      const key = `${v.id ?? ''}\u0000${v.name ?? ''}\u0000${v.desc ?? ''}`;
      if (key === lastKey) continue;
      lastKey = key;
      rooms.push(v);
    }
  }
  return { rooms, mapIds: [...mapIds] };
}

/** More name + description candidates than this, with none next to the previous room: skipped. */
export const AMBIGUOUS_MAX = 4;

function adjacent(map: MapData, a: number, b: number): boolean {
  const s = a * DIR_COUNT;
  for (let k = map.outStart[s]!; k < map.outStart[s + DIR_COUNT]!; k++) if (map.outTo[k] === b) return true;
  for (let k = map.inStart[s]!; k < map.inStart[s + DIR_COUNT]!; k++) if (map.inFrom[k] === b) return true;
  return false;
}

/** The room indices of `map` the visits point at. */
export function resolveVisits(map: MapData, visits: MapVisits): Set<number> {
  const out = new Set<number>();
  let last = -1;
  for (const v of visits.rooms) {
    let r = v.id !== undefined ? (map.byServerId.get(v.id) ?? -1) : -1;
    if (r < 0 && v.name !== undefined) {
      const c = roomsByNameDesc(map, v.name, v.desc ?? '');
      if (c.length === 1) r = c[0]!;
      else if (c.length > 1) {
        const near = last >= 0 ? c.filter((x) => adjacent(map, last, x)) : [];
        if (near.length === 1) r = near[0]!;
        else if (c.length <= AMBIGUOUS_MAX) for (const x of c) out.add(x);
      }
    }
    if (r >= 0) out.add(r);
    last = r;
  }
  for (const id of visits.mapIds) {
    const r = map.byServerId.get(id);
    if (r !== undefined) out.add(r);
  }
  return out;
}

// ------------------------------------------------------------- subset

/**
 * The margin around the visited rooms: every room within `MARGIN` rooms
 * (Chebyshev distance, same layer or one above / below) of a visited
 * room, plus `RING` exit steps around that (so the kept rooms' exits keep
 * their targets). Chosen so the map pane of a replay shows the area around
 * the player at the default zoom; see ADR 0020 "Package notes" P3 for the
 * measured sizes.
 */
export const SUBSET_MARGIN = 8;
export const SUBSET_RING = 1;

/** Rooms within `margin` of `rooms` (x/y Chebyshev distance, |Δz| ≤ 1). */
export function spatialMargin(map: MapData, rooms: Iterable<number>, margin: number): Set<number> {
  const cells = new Set<string>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  for (const r of rooms) {
    const x0 = map.x[r]!;
    const y0 = map.y[r]!;
    const z0 = map.z[r]!;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -margin; dx <= margin; dx++) {
        for (let dy = -margin; dy <= margin; dy++) cells.add(key(x0 + dx, y0 + dy, z0 + dz));
      }
    }
  }
  const out = new Set<number>(rooms);
  if (cells.size === 0) return out;
  for (let r = 0; r < map.roomCount; r++) if (cells.has(key(map.x[r]!, map.y[r]!, map.z[r]!))) out.add(r);
  return out;
}

/** The subset of `map` a replay with these visits embeds (empty when nothing resolves). */
export function replaySubset(
  map: MapData,
  visits: MapVisits,
  o: { margin?: number; ring?: number } = {},
): { map: MapData; visited: number } | null {
  const visited = resolveVisits(map, visits);
  if (visited.size === 0) return null;
  const area = neighbourhood(map, spatialMargin(map, visited, o.margin ?? SUBSET_MARGIN), o.ring ?? SUBSET_RING);
  const sub = subsetMap(map, area);
  // Open on the first visited room (the worker centres on `selected`).
  const first = [...visited][0]!;
  sub.selected = { x: map.x[first]!, y: map.y[first]!, z: map.z[first]! };
  return { map: sub, visited: visited.size };
}

// ------------------------------------------------------------- assets

/** Road / trail tile suffix of the NESW exits with the ROAD flag (research §3, `display/RoadIndex.cpp`). */
export function roadSuffix(map: MapData, room: number): string {
  const has = (d: number): boolean => (map.exitFlags[room * DIR_COUNT + d]! & EXIT_FLAG.ROAD) !== 0;
  const s = (has(DIR.N) ? 'n' : '') + (has(DIR.E) ? 'e' : '') + (has(DIR.S) ? 's' : '') + (has(DIR.W) ? 'w' : '');
  return s === '' ? 'none' : s === 'nesw' ? 'all' : s;
}

/** Tile file names of the mob flags (bit order of MOB_FLAGS; research §3.5). */
const MOB_FILES: Readonly<Record<string, string>> = {
  rent: 'rent',
  shop: 'shop',
  weapon_shop: 'weaponshop',
  armour_shop: 'armourshop',
  food_shop: 'foodshop',
  pet_shop: 'petshop',
  guild: 'guild',
  scout_guild: 'scoutguild',
  mage_guild: 'mageguild',
  cleric_guild: 'clericguild',
  warrior_guild: 'warriorguild',
  ranger_guild: 'rangerguild',
  aggressive_mob: 'aggmob',
  quest_mob: 'questmob',
  passive_mob: 'passivemob',
  elite_mob: 'elitemob',
  super_mob: 'smob',
  milkable: 'milkable',
  rattlesnake: 'rattlesnake',
};

/** Tile file names of the load flags (bit order of LOAD_FLAGS; research §3.5). */
const LOAD_FILES: Readonly<Record<string, string>> = {
  treasure: 'treasure',
  armour: 'armour',
  weapon: 'weapon',
  water: 'water',
  food: 'food',
  herb: 'herb',
  key: 'key',
  mule: 'mule',
  horse: 'horse',
  pack_horse: 'pack',
  trained_horse: 'trained',
  rohirrim: 'rohirrim',
  warg: 'warg',
  boat: 'boat',
  attention: 'attention',
  tower: 'watch',
  clock: 'clock',
  mail: 'mail',
  stable: 'stable',
  white_word: 'whiteword',
  dark_word: 'darkword',
  equipment: 'equipment',
  coach: 'coach',
  ferry: 'ferry',
  deathtrap: 'deathtrap',
};

const DIR_WORDS = ['north', 'south', 'east', 'west', 'up', 'down'] as const;

/** Tiles every map may draw (walls, doors, exits, streams, markers): always embedded. */
export const ALWAYS_PIXMAPS: readonly string[] = [
  'no-ride.png',
  'char-room-sel.png',
  'char-arrows.png',
  'room-highlight.png',
  ...DIR_WORDS.slice(0, 4).map((d) => `wall-${d}.png`),
  ...DIR_WORDS.map((d) => `door-${d}.png`),
  'exit-up.png',
  'exit-down.png',
  'exit-climb-up.png',
  'exit-climb-down.png',
  ...DIR_WORDS.flatMap((d) => [`stream-in-${d}.png`, `stream-out-${d}.png`]),
];

/** The Cantarell BMFont files (18 / 27 / 36 px, picked by the viewer's DPR). */
export const FONT_FILES: readonly string[] = [18, 27, 36].flatMap((s) => [`fonts/Cantarell${s}.fnt`, `fonts/Cantarell${s}_0.png`]);

/**
 * The asset paths (relative to the asset root) a map draws: the terrain,
 * road and trail tiles of its rooms, the overlays of the flags it uses,
 * `ALWAYS_PIXMAPS` and the fonts. Any other tile is left out of an HTML
 * replay; the replay's asset source answers it with a transparent 1×1 PNG.
 */
export function neededAssets(map: MapData): string[] {
  const px = new Set<string>(ALWAYS_PIXMAPS);
  let mob = 0;
  let load = 0;
  for (let r = 0; r < map.roomCount; r++) {
    const t = map.terrain[r]!;
    if (t === TERRAIN_ROAD) px.add(`road-${roadSuffix(map, r)}.png`);
    else {
      px.add(`terrain-${TERRAIN[t] ?? 'undefined'}.png`);
      const s = roadSuffix(map, r);
      if (s !== 'none') px.add(`trail-${s}.png`);
    }
    mob |= map.mobFlags[r]!;
    load |= map.loadFlags[r]!;
  }
  MOB_FLAGS.forEach((f, i) => {
    if (mob & (1 << i)) px.add(`mob-${MOB_FILES[f]}.png`);
  });
  LOAD_FLAGS.forEach((f, i) => {
    if (load & (1 << i)) px.add(`load-${LOAD_FILES[f]}.png`);
  });
  return [...[...px].sort().map((p) => `pixmaps/${p}`), ...FONT_FILES];
}

// --------------------------------------------------------- tool calls

/** A request to the tools worker. */
export type MapToolRequest =
  | { t: 'validate'; bytes: ArrayBuffer }
  | { t: 'subset'; source: MapSource; visits: MapVisits; margin?: number; ring?: number };

export interface MapValidated {
  rooms: number;
  infomarks: number;
  serverIds: number;
  hash: string;
}

export interface MapSubsetResult {
  /** The subset as a `.mm2` file; null when no visited room was found. */
  mm2: Uint8Array | null;
  /** Rooms in the subset, and visited rooms found. */
  rooms: number;
  visited: number;
  /** Asset paths the subset needs (`neededAssets`). */
  assets: string[];
  /** Name of the source map. */
  name: string;
}

export type MapToolResponse =
  | { ok: true; t: 'validate'; info: MapValidated }
  | { ok: true; t: 'subset'; result: MapSubsetResult }
  | { ok: false; message: string };

export interface MapToolEnv {
  fetch: typeof fetch;
  inflate?: Inflate;
  deflate?: Deflate;
}

async function loadSource(source: MapSource, env: MapToolEnv): Promise<{ map: MapData; name: string }> {
  if (source.kind === 'data') return { map: source.map, name: source.name };
  let bytes: Uint8Array;
  let name: string;
  if (source.kind === 'url') {
    const res = await env.fetch(source.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${source.url}`);
    bytes = new Uint8Array(await res.arrayBuffer());
    name = source.name ?? decodeURIComponent(source.url.split('/').pop() ?? source.url);
  } else {
    bytes = new Uint8Array(source.bytes);
    name = source.name;
  }
  return { map: await readMm2(bytes, env.inflate ?? inflateZlib), name };
}

/** Runs one tool request (the tools worker, or inline where there are no workers). */
export async function runMapToolRequest(req: MapToolRequest, env: MapToolEnv): Promise<MapToolResponse> {
  try {
    if (req.t === 'validate') {
      const bytes = new Uint8Array(req.bytes);
      const map = await readMm2(bytes, env.inflate ?? inflateZlib);
      if (map.roomCount === 0) throw new Error('The map has no rooms');
      return {
        ok: true,
        t: 'validate',
        info: { rooms: map.roomCount, infomarks: map.infomarks.count, serverIds: map.byServerId.size, hash: await mapHash(bytes) },
      };
    }
    const { map, name } = await loadSource(req.source, env);
    const o: { margin?: number; ring?: number } = {};
    if (req.margin !== undefined) o.margin = req.margin;
    if (req.ring !== undefined) o.ring = req.ring;
    const sub = replaySubset(map, req.visits, o);
    if (!sub) return { ok: true, t: 'subset', result: { mm2: null, rooms: 0, visited: 0, assets: [], name } };
    return {
      ok: true,
      t: 'subset',
      result: {
        mm2: await writeMm2(sub.map, env.deflate ?? deflateZlib),
        rooms: sub.map.roomCount,
        visited: sub.visited,
        assets: neededAssets(sub.map),
        name,
      },
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
