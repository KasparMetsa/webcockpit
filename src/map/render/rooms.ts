// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 The WebCockpit Authors
// Derived from MMapper 26.06.0 (https://github.com/MUME/MMapper),
// Copyright (C) 2019-2026 The MMapper Authors. Modified for WebCockpit
// (2026-09-28): rewritten in TypeScript and WebGL2; see
// THIRD_PARTY_NOTICES.md "MMapper-derived code".
//
// Static room meshes (research §3): one instanced-quad list per z-layer,
// built once per map. Ported from MMapper 26.06.0
// display/MapCanvasRoomDrawer.cpp (visitRoom, LayerBatchBuilder;
// GPL-2.0-or-later). Pure; no GL.
//
// An instance is four Int32s: x, y, z, and `texLayer | colorId << 8`
// (MMapper's `ivec4 aVertTexCol`). Each category is a contiguous range
// of one layer's instance array, drawn in the order of LayerMeshes::render.

import { DIR_COUNT, EXIT_FLAG, LIGHT, type MapData, RIDABLE, SUNDEATH, TERRAIN_ROAD } from '../model';
import { NC } from './palette';
import { ARRAY_FILES, L128, L256, TEX, type TexArray } from './textures';

export interface Range {
  first: number;
  count: number;
}

export const CATEGORIES = [
  'terrain', 'tintDark', 'tintNoSundeath', 'streamIns', 'streamOuts', 'trails', 'overlays',
  'upDown', 'doors', 'walls', 'dotted',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * The texture array each category is drawn with (webgl.ts drawLayer).
 * The tints are drawn white (the bound texture is not sampled).
 */
export const CATEGORY_TEX: Readonly<Record<Category, TexArray>> = {
  terrain: TEX.A128,
  tintDark: TEX.A128,
  tintNoSundeath: TEX.A128,
  streamIns: TEX.A128,
  streamOuts: TEX.A128,
  trails: TEX.A64,
  overlays: TEX.A128,
  upDown: TEX.A128,
  doors: TEX.A256,
  walls: TEX.A128,
  dotted: TEX.DOTTED,
};
const UNTEXTURED: ReadonlySet<Category> = new Set(['tintDark', 'tintNoSundeath']);
const FILE_ARRAYS: Partial<Record<TexArray, keyof typeof ARRAY_FILES>> = { [TEX.A128]: 'A128', [TEX.A64]: 'A64', [TEX.A256]: 'A256' };

export interface RoomLayerMesh {
  z: number;
  /** 4 Int32 per instance: x, y, z, texLayer | colorId << 8. */
  inst: Int32Array;
  ranges: Record<Category, Range>;
}

/** Road index of a room: bit 1 << dir for every N/S/E/W exit with the ROAD flag. */
export function roadIndex(map: MapData, room: number): number {
  let m = 0;
  for (let d = 0; d < 4; d++) if (map.exitFlags[room * DIR_COUNT + d]! & EXIT_FLAG.ROAD) m |= 1 << d;
  return m;
}

/** Dotted wall colour for an exit's flags (getWallNamedColorCommon); -1 = none. */
export function wallColor(flags: number, vertical: boolean): number {
  if (vertical && flags & EXIT_FLAG.CLIMB) return NC.VERTICAL_CLIMB;
  if (flags & EXIT_FLAG.NO_FLEE) return NC.WALL_NO_FLEE;
  if (flags & EXIT_FLAG.RANDOM) return NC.WALL_RANDOM;
  if (flags & (EXIT_FLAG.FALL | EXIT_FLAG.DAMAGE)) return NC.WALL_FALL_DAMAGE;
  if (flags & EXIT_FLAG.SPECIAL) return NC.WALL_SPECIAL;
  if (flags & EXIT_FLAG.CLIMB) return NC.WALL_CLIMB;
  if (flags & EXIT_FLAG.GUARDED) return NC.WALL_GUARDED;
  if (flags & EXIT_FLAG.NO_MATCH) return NC.WALL_NO_MATCH;
  return -1;
}

type Lists = Record<Category, number[]>;

/** The visitor, one room: appends [x, y, z, packed] to the category lists. */
export function visitRoom(map: MapData, r: number, out: Lists, drawNotMappedExits = true): void {
  const x = map.x[r]!;
  const y = map.y[r]!;
  const z = map.z[r]!;
  const add = (cat: Category, tex: number, color: number = NC.DEFAULT) => {
    out[cat].push(x, y, z, tex | (color << 8));
  };
  const terrain = map.terrain[r]!;
  const road = roadIndex(map, r);

  add('terrain', terrain === TERRAIN_ROAD ? L128.road(road) : L128.terrain(terrain));
  if (road !== 0 && terrain !== TERRAIN_ROAD) add('trails', road);

  if (map.light[r] === LIGHT.DARK) add('tintDark', 0, NC.ROOM_DARK);
  else if (map.sundeath[r] === SUNDEATH.NO_SUNDEATH) add('tintNoSundeath', 0, NC.ROOM_NO_SUNDEATH);

  const mob = map.mobFlags[r]!;
  for (let b = 0; b < 19; b++) if (mob & (1 << b)) add('overlays', L128.mob(b));
  const load = map.loadFlags[r]!;
  for (let b = 0; b < 25; b++) if (load & (1 << b)) add('overlays', L128.load(b));
  if (map.ridable[r] === RIDABLE.NOT_RIDABLE) add('overlays', L128.noRide);

  // Incoming flow: any source exit with FLOW that leads here.
  const inFlow = (dir: number): boolean => {
    const slot = r * DIR_COUNT + dir;
    for (let k = map.inStart[slot]!; k < map.inStart[slot + 1]!; k++) {
      const src = map.inFrom[k]!;
      for (let td = 0; td < 6; td++) {
        const ts = src * DIR_COUNT + td;
        if (!(map.exitFlags[ts]! & EXIT_FLAG.FLOW)) continue;
        for (let j = map.outStart[ts]!; j < map.outStart[ts + 1]!; j++) if (map.outTo[j] === r) return true;
      }
    }
    return false;
  };
  const hasIn = (dir: number) => map.inStart[r * DIR_COUNT + dir + 1]! > map.inStart[r * DIR_COUNT + dir]!;

  for (let dir = 0; dir < 4; dir++) {
    const slot = r * DIR_COUNT + dir;
    const flags = map.exitFlags[slot]!;
    const isExit = (flags & EXIT_FLAG.EXIT) !== 0;
    const isDoor = (flags & EXIT_FLAG.DOOR) !== 0;
    if (drawNotMappedExits && flags & EXIT_FLAG.UNMAPPED) {
      add('dotted', dir, NC.WALL_NOT_MAPPED);
    } else {
      const c = wallColor(flags, false);
      if (c >= 0) add('dotted', dir, c);
      if (flags & EXIT_FLAG.FLOW) add('streamOuts', L128.streamOut(dir));
    }
    if (!isExit || isDoor) {
      const hasOut = map.outStart[slot + 1]! > map.outStart[slot]!;
      if (!isDoor && hasOut) add('dotted', dir, NC.WALL_BUG_WALL_DOOR);
      else add('walls', L128.wall(dir), NC.WALL_REGULAR_EXIT);
    }
    if (isDoor) add('doors', L256.door(dir), NC.WALL_REGULAR_EXIT);
    if (hasIn(dir) && inFlow(dir)) add('streamIns', L128.streamIn(dir));
  }

  for (let dir = 4; dir < 6; dir++) {
    const flags = map.exitFlags[r * DIR_COUNT + dir]!;
    const climb = (flags & EXIT_FLAG.CLIMB) !== 0;
    const up = dir === 4;
    const icon = climb ? (up ? L128.exitClimbUp : L128.exitClimbDown) : up ? L128.exitUp : L128.exitDown;
    if (drawNotMappedExits && flags & EXIT_FLAG.UNMAPPED) {
      add('upDown', icon, NC.WALL_NOT_MAPPED);
      continue;
    }
    if (!(flags & EXIT_FLAG.EXIT)) continue;
    const c = wallColor(flags, true);
    add('upDown', icon, c >= 0 ? c : NC.VERTICAL_REGULAR_EXIT);
    if (flags & EXIT_FLAG.DOOR) add('doors', L256.door(dir), NC.WALL_REGULAR_EXIT);
    if (flags & EXIT_FLAG.FLOW) add('streamOuts', L128.streamOut(dir));
    if (hasIn(dir) && inFlow(dir)) add('streamIns', L128.streamIn(dir));
  }
}

const emptyLists = (): Lists => {
  const l = {} as Lists;
  for (const c of CATEGORIES) l[c] = [];
  return l;
};

/** Rooms grouped by z, ascending z (MMapper draws layers in ascending order). */
export function roomsByLayer(map: MapData): Map<number, number[]> {
  const by = new Map<number, number[]>();
  for (let r = 0; r < map.roomCount; r++) {
    const z = map.z[r]!;
    const l = by.get(z);
    if (l) l.push(r);
    else by.set(z, [r]);
  }
  return new Map([...by.entries()].sort((a, b) => a[0] - b[0]));
}

/** Builds every layer's instance list (ascending z). */
export function buildRoomMeshes(map: MapData, layers = roomsByLayer(map)): RoomLayerMesh[] {
  const out: RoomLayerMesh[] = [];
  for (const [z, rooms] of layers) {
    const lists = emptyLists();
    for (const r of rooms) visitRoom(map, r, lists);
    let total = 0;
    for (const c of CATEGORIES) total += lists[c].length;
    const inst = new Int32Array(total);
    const ranges = {} as Record<Category, Range>;
    let at = 0;
    for (const c of CATEGORIES) {
      const l = lists[c];
      inst.set(l, at);
      ranges[c] = { first: at / 4, count: l.length / 4 };
      at += l.length;
    }
    out.push({ z, inst, ranges });
  }
  return out;
}

/**
 * The pixmaps (paths relative to the asset root) these room meshes sample:
 * each textured instance's layer mapped back through ARRAY_FILES. The HTML
 * replay embeds exactly these, so the list cannot drift from the renderer.
 */
export function roomMeshPixmaps(meshes: readonly RoomLayerMesh[]): Set<string> {
  const out = new Set<string>();
  for (const m of meshes) {
    for (const cat of CATEGORIES) {
      const arr = FILE_ARRAYS[CATEGORY_TEX[cat]];
      if (!arr || UNTEXTURED.has(cat)) continue;
      const files = ARRAY_FILES[arr].files;
      const { first, count } = m.ranges[cat];
      for (let i = first; i < first + count; i++) out.add(`pixmaps/${files[m.inst[i * 4 + 3]! & 0xff]!}`);
    }
  }
  return out;
}
