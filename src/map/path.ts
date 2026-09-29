// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 The WebCockpit Authors
// Derived from MMapper 26.06.0 (https://github.com/MUME/MMapper),
// Copyright (C) 2019-2026 The MMapper Authors. Modified for WebCockpit
// (2026-09-28): rewritten in TypeScript and WebGL2; see
// THIRD_PARTY_NOTICES.md "MMapper-derived code".
//
// Prespam queue and path walk (ADR 0020 "Modules", research
// notes/research/mmapper-rendering.md §6.2). Pure; runs in the map worker.
//
// Ported from MMapper 26.06.0 (GPL-2.0-or-later):
// - command recognition: parser/AbstractParser-Commands.cpp `isCommand`,
//   `parseSimpleCommand`, parser/Abbrev.cpp `isAbbrev`;
// - queue rules: parser/abstractparser.cpp `doMove` (enqueue on send),
//   parser/mumexmlparser.cpp `move` (dequeue per room arrival, clear on
//   mismatch), parser/AbstractParser-Actions.cpp (pop on a failure line,
//   clear on "You are dead!");
// - path walk: mapdata/mapdata.cpp `walk_path`.

import { DIR, type Dir, EXIT_FLAG, DIR_COUNT, type MapData, exitTargets } from './model';

/** A queued command: a direction N…D (0…5) or LOOK. */
export const LOOK = 7;
/** Event.Moved `dir: "none"` (never queued; MMapper CommandEnum::NONE). */
export const MOVE_NONE = 8;
/** Event.Moved with a direction MMapper does not know (CommandEnum::UNKNOWN). */
export const MOVE_UNKNOWN = DIR.UNKNOWN;
export type PathCmd = Dir | typeof LOOK;
/** What a room arrival was: a direction, LOOK (no Event.Moved), NONE or UNKNOWN. */
export type Move = PathCmd | typeof MOVE_NONE;

/** MMapper `isAbbrev`: `word` is a prefix of `command`, case-insensitive, at least `min` letters. */
function isAbbrev(word: string, command: string, min: number): boolean {
  if (word.length < min || word.length > command.length) return false;
  for (let i = 0; i < word.length; i++) {
    let c = word.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== command.charCodeAt(i)) return false;
  }
  return true;
}

const DIR_WORDS = ['north', 'south', 'east', 'west', 'up', 'down'] as const;

/**
 * The prespam command a sent line stands for, or null (MMapper
 * `parseSimpleCommand`). Only the first word counts; a direction may carry
 * arguments (`north foo`), LOOK only when it is the only word (`look`,
 * `l`, `exa`… — `look at x` is not a look).
 */
export function parseMoveCommand(text: string): PathCmd | null {
  let a = 0;
  let b = text.length;
  while (a < b && text.charCodeAt(a) <= 32) a++;
  while (b > a && text.charCodeAt(b - 1) <= 32) b--;
  if (a === b) return null;
  let e = a;
  while (e < b && text.charCodeAt(e) > 32) e++;
  const word = text.slice(a, e);
  for (let d = 0; d < DIR_WORDS.length; d++) {
    if (isAbbrev(word, DIR_WORDS[d]!, 1)) return d as Dir;
  }
  if (isAbbrev(word, 'look', 1) || isAbbrev(word, 'examine', 3)) return e === b ? LOOK : null;
  return null;
}

/** Event.Moved `dir` → Move (MMapper parser/mumexmlparser-gmcp.cpp `getMove`). */
export function parseMovedDir(data: unknown): Move {
  const dir = typeof data === 'object' && data !== null ? (data as { dir?: unknown }).dir : undefined;
  if (typeof dir !== 'string') return MOVE_UNKNOWN;
  switch (dir) {
    case 'north':
      return DIR.N;
    case 'south':
      return DIR.S;
    case 'east':
      return DIR.E;
    case 'west':
      return DIR.W;
    case 'up':
      return DIR.U;
    case 'down':
      return DIR.D;
    case 'none':
      return MOVE_NONE;
    default:
      return MOVE_UNKNOWN;
  }
}

/** True for N, S, E, W, U, D. */
export const isDirection = (m: number): m is Dir => m >= 0 && m < 6;

/** The prespam queue (MMapper CommandQueue). Every mutator returns true when the queue changed. */
export class PrespamQueue {
  private q: PathCmd[] = [];

  get items(): readonly PathCmd[] {
    return this.q;
  }

  get length(): number {
    return this.q.length;
  }

  /** A move or look was sent. */
  push(c: PathCmd): boolean {
    this.q.push(c);
    return true;
  }

  /** A room arrival by `actual`: dequeue one; a mismatch clears the queue. */
  arrive(actual: Move): boolean {
    if (this.q.length === 0) return false;
    const c = this.q.shift()!;
    if (c !== actual) this.q.length = 0;
    return true;
  }

  /** A move-failure line: pop the head. */
  fail(): boolean {
    if (this.q.length === 0) return false;
    this.q.shift();
    return true;
  }

  /** Death, disconnect, resync. */
  clear(): boolean {
    if (this.q.length === 0) return false;
    this.q.length = 0;
    return true;
  }
}

/**
 * The rooms the queue leads through from `start` (MMapper `walk_path`):
 * LOOK is skipped; anything else that is not a direction stops the walk; an
 * exit without the EXIT flag is skipped; an exit whose target count is not
 * exactly one stops the walk.
 */
export function walkPath(map: MapData, start: number | null, queue: readonly PathCmd[]): number[] {
  const out: number[] = [];
  if (start === null || start < 0 || start >= map.roomCount) return out;
  let room = start;
  for (const c of queue) {
    if (c === LOOK) continue;
    if (!isDirection(c)) break;
    if ((map.exitFlags[room * DIR_COUNT + c]! & EXIT_FLAG.EXIT) === 0) continue;
    const t = exitTargets(map, room, c);
    if (t.length !== 1) break;
    room = t[0]!;
    out.push(room);
  }
  return out;
}
