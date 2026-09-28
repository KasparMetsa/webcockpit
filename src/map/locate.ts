// Locator (ADR 0020 "Locating the player"): which map room a GMCP
// `Room.Info` is, given the last known room and the direction of the
// `Event.Moved` that came before it. Pure; runs in the map worker.
//
// Order:
//   1. `Room.Info.id` is a room's server id (the map's own, or one learned
//      earlier whose room still has that name) → that room.
//   2. From the last known room, the moved direction's exit has exactly one
//      target and its name equals `Room.Info.name` → that room.
//   3. Rooms whose name and description equal Room.Info's (normalised
//      whitespace, `roomsByNameDesc`). Several: prefer the one reached from
//      the last room by the moved direction, then the one whose exit set
//      matches Room.Info's exits; unique only.
//   4. Otherwise unknown (the caller keeps the last room, located = false).
//
// Rooms whose own server id differs from a given `Room.Info.id` are never
// matched by 2 or 3. A match by 2 or 3 teaches `id → room` (`learnIds`),
// and so does each exit id Room.Info lists for a neighbour the map reaches
// by exactly one exit and that has no server id of its own (MMapper's path
// machine learns neighbour ids the same way).

import { DIR_COUNT, DOOR_FLAG, EXIT_FLAG, type MapData, exitTargets, normalizeText, roomsByNameDesc } from './model';
import { isDirection, type Move } from './path';

/** The fields of GMCP `Room.Info` the locator reads. */
export interface RoomInfo {
  /** MUME's room id, or null ("not all rooms have numbers"; ids < 1 are none). */
  id: number | null;
  name: string;
  desc: string;
  /** Bit d set when Room.Info lists exit d (N S E W U D = bits 0…5); null when it has no `exits`. */
  exits: number | null;
  /** Exit ids by direction (0 = none), length 6. */
  exitIds: number[];
}

const EXIT_KEYS = ['n', 's', 'e', 'w', 'u', 'd'] as const;

const validId = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null);

/** Reads a Room.Info payload (null when it is not an object). */
export function parseRoomInfo(data: unknown): RoomInfo | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const info: RoomInfo = {
    id: validId(o.id),
    name: typeof o.name === 'string' ? o.name : '',
    desc: typeof o.desc === 'string' ? o.desc : '',
    exits: null,
    exitIds: [0, 0, 0, 0, 0, 0],
  };
  const ex = o.exits;
  if (typeof ex === 'object' && ex !== null && !Array.isArray(ex)) {
    let bits = 0;
    for (let d = 0; d < 6; d++) {
      const e = (ex as Record<string, unknown>)[EXIT_KEYS[d]!];
      if (typeof e !== 'object' || e === null) continue;
      bits |= 1 << d;
      info.exitIds[d] = validId((e as Record<string, unknown>).id) ?? 0;
    }
    info.exits = bits;
  }
  return info;
}

export type LocateHow = 'id' | 'learned' | 'dir' | 'text' | 'none';

export interface LocateResult {
  room: number | null;
  how: LocateHow;
}

/** Server ids the locator learned for this map: server id → room index. */
export type LearnedIds = Map<number, number>;

/** The exits a player sees in `room` (EXIT set, hidden doors left out), as Room.Info bits. */
export function visibleExits(map: MapData, room: number): number {
  let bits = 0;
  for (let d = 0; d < 6; d++) {
    const s = room * DIR_COUNT + d;
    if ((map.exitFlags[s]! & EXIT_FLAG.EXIT) === 0) continue;
    if ((map.exitFlags[s]! & EXIT_FLAG.DOOR) !== 0 && (map.doorFlags[s]! & DOOR_FLAG.HIDDEN) !== 0) continue;
    bits |= 1 << d;
  }
  return bits;
}

/** False when `room` has a server id and it is not `id`. */
const idCompatible = (map: MapData, room: number, id: number | null): boolean =>
  id === null || map.serverId[room] === 0 || map.serverId[room] === id;

/** Locates `info`; `last` is the last known room, `move` the Event.Moved direction (LOOK etc. when none). */
export function locate(map: MapData, learned: LearnedIds, info: RoomInfo, last: number | null, move: Move): LocateResult {
  const name = normalizeText(info.name);

  // 1. Server id: the map's, then a learned one (checked by name).
  if (info.id !== null) {
    const r = map.byServerId.get(info.id);
    if (r !== undefined) return { room: r, how: 'id' };
    const l = learned.get(info.id);
    if (l !== undefined) {
      if (l < map.roomCount && normalizeText(map.names[l]!) === name) return { room: l, how: 'learned' };
      learned.delete(info.id);
    }
  }

  const hasLast = last !== null && last >= 0 && last < map.roomCount;
  const dirTarget = hasLast && isDirection(move) ? singleTarget(map, last, move) : null;

  // 2. The moved direction from the last room, by name.
  if (dirTarget !== null && normalizeText(map.names[dirTarget]!) === name && idCompatible(map, dirTarget, info.id)) {
    return { room: dirTarget, how: 'dir' };
  }

  // 3. Name and description.
  let cands = roomsByNameDesc(map, info.name, info.desc);
  if (info.id !== null && cands.length > 1) cands = cands.filter((r) => idCompatible(map, r, info.id));
  else if (cands.length === 1 && !idCompatible(map, cands[0]!, info.id)) cands = [];
  if (cands.length === 1) return { room: cands[0]!, how: 'text' };
  if (cands.length > 1) {
    if (hasLast && isDirection(move)) {
      const t = exitTargets(map, last, move);
      const adj = cands.filter((r) => t.includes(r));
      if (adj.length === 1) return { room: adj[0]!, how: 'text' };
    }
    if (info.exits !== null) {
      const ex = info.exits;
      const same = cands.filter((r) => visibleExits(map, r) === ex);
      if (same.length === 1) return { room: same[0]!, how: 'text' };
    }
  }
  return { room: null, how: 'none' };
}

/** The one target of `room`'s exit `dir` (EXIT flag set), else null. */
function singleTarget(map: MapData, room: number, dir: number): number | null {
  if ((map.exitFlags[room * DIR_COUNT + dir]! & EXIT_FLAG.EXIT) === 0) return null;
  const t = exitTargets(map, room, dir as 0);
  return t.length === 1 ? t[0]! : null;
}

/**
 * Server ids to learn after `info` was located in `room` by `how`: Room.Info's
 * own id (when found by direction or text) and the exit ids of neighbours
 * without a server id. Adds them to `learned` and returns the new pairs.
 */
export function learnIds(map: MapData, learned: LearnedIds, info: RoomInfo, room: number, how: LocateHow): [number, number][] {
  const out: [number, number][] = [];
  const teach = (id: number, r: number): void => {
    if (map.byServerId.has(id) || map.serverId[r] !== 0 || learned.get(id) === r) return;
    learned.set(id, r);
    out.push([id, r]);
  };
  if (info.id !== null && (how === 'dir' || how === 'text')) teach(info.id, room);
  if (how !== 'none') {
    for (let d = 0; d < 6; d++) {
      const id = info.exitIds[d]!;
      if (id === 0) continue;
      const t = singleTarget(map, room, d);
      if (t !== null) teach(id, t);
    }
  }
  return out;
}
