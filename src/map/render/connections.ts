// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 The WebCockpit Authors
// Derived from MMapper 26.06.0 (https://github.com/MUME/MMapper),
// Copyright (C) 2019-2026 The MMapper Authors. Modified for WebCockpit
// (2026-09-28): rewritten in TypeScript and WebGL2; see
// THIRD_PARTY_NOTICES.md "MMapper-derived code".
//
// Connections and door names (research §4), built once per map and layer.
// Ported from MMapper 26.06.0 display/Connections.cpp and
// display/ConnectionLineBuilder.cpp (GPL-2.0-or-later). Pure.
//
// Per layer the output is one coloured-triangle list in MMapper's draw
// order: normal triangles, red triangles, normal quads, red quads.

import { DIR, DIR_COUNT, DOOR_FLAG, EXIT_FLAG, type MapData, OPPOSITE } from '../model';
import { ColorTris, isCrossingZ, lineQuad, orthogonalNormal, perpendicularNormal, type Vec3, vec, zeroLengthSquare } from './geometry';
import { BLACK, RED, type RGBA, WHITE, withAlpha } from './palette';

export const CONNECTION_LINE_WIDTH = 0.045;
const FAINT_CONNECTION_ALPHA = 0.1;
const LONG_LINE_HALFLEN = 1.5;
const LONG_LINE_LEN = 2 * LONG_LINE_HALFLEN;

/** A text label anchored in world space (MMapper GLText). */
export interface MapText {
  x: number;
  y: number;
  z: number;
  text: string;
  fg: RGBA;
  bg: RGBA | null;
  center?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Degrees, CCW. */
  angle?: number;
}

export interface ConnectionLayer {
  z: number;
  /** Coloured triangles (7 floats per vertex). */
  tris: Float32Array;
  doorNames: MapText[];
}

/** One connection's primitives, before they are merged into a layer. */
class Buffers {
  normalTris = new ColorTris();
  redTris = new ColorTris();
  normalQuads = new ColorTris();
  redQuads = new ColorTris();

  merged(): Float32Array {
    const parts = [this.normalTris.data, this.redTris.data, this.normalQuads.data, this.redQuads.data];
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

// ---------------------------------------------------------- line builder

/** ConnectionLineBuilder: the polyline of a connection, relative to the source room. */
export function connectionLine(
  startDir: number,
  endDir: number,
  oneway: boolean,
  neighbours: boolean,
  dX: number,
  dY: number,
  srcZ: number,
  dstZ: number,
): Vec3[] {
  const p: Vec3[] = [];
  const v = (x: number, y: number, z: number) => p.push([x, y, z]);
  switch (startDir) {
    case DIR.N: v(0.75, 0.9, srcZ); v(0.75, 1.1, srcZ); break;
    case DIR.S: v(0.25, 0.1, srcZ); v(0.25, -0.1, srcZ); break;
    case DIR.E: v(0.9, 0.75, srcZ); v(1.1, 0.75, srcZ); break;
    case DIR.W: v(0.1, 0.25, srcZ); v(-0.1, 0.25, srcZ); break;
    case DIR.U:
      if (!neighbours) { v(0.63, 0.75, srcZ); v(0.55, 0.75, srcZ); } else v(0.75, 0.75, srcZ);
      break;
    case DIR.D:
      if (!neighbours) { v(0.37, 0.25, srcZ); v(0.45, 0.25, srcZ); } else v(0.25, 0.25, srcZ);
      break;
    default: v(0.5, 0.5, srcZ); v(0.75, 0.25, srcZ); break;
  }
  if (oneway) {
    switch (endDir) {
      case DIR.N: v(dX + 0.25, dY + 1.1, dstZ); v(dX + 0.25, dY + 0.9, dstZ); break;
      case DIR.S: v(dX + 0.75, dY - 0.1, dstZ); v(dX + 0.75, dY + 0.1, dstZ); break;
      case DIR.E: v(dX + 1.1, dY + 0.25, dstZ); v(dX + 0.9, dY + 0.25, dstZ); break;
      case DIR.W: v(dX - 0.1, dY + 0.75, dstZ); v(dX + 0.1, dY + 0.75, dstZ); break;
      case DIR.U:
      case DIR.D: v(dX + 0.75, dY + 0.25, dstZ); v(dX + 0.55, dY + 0.45, dstZ); break;
      default: v(dX + 0.75, dY + 0.25, dstZ); v(dX + 0.5, dY + 0.5, dstZ); break;
    }
  } else {
    switch (endDir) {
      case DIR.N: v(dX + 0.75, dY + 1.1, dstZ); v(dX + 0.75, dY + 0.9, dstZ); break;
      case DIR.S: v(dX + 0.25, dY - 0.1, dstZ); v(dX + 0.25, dY + 0.1, dstZ); break;
      case DIR.E: v(dX + 1.1, dY + 0.75, dstZ); v(dX + 0.9, dY + 0.75, dstZ); break;
      case DIR.W: v(dX - 0.1, dY + 0.25, dstZ); v(dX + 0.1, dY + 0.25, dstZ); break;
      case DIR.U:
        if (!neighbours) { v(dX + 0.55, dY + 0.75, dstZ); v(dX + 0.63, dY + 0.75, dstZ); } else v(dX + 0.75, dY + 0.75, dstZ);
        break;
      case DIR.D:
        if (!neighbours) { v(dX + 0.45, dY + 0.25, dstZ); v(dX + 0.37, dY + 0.25, dstZ); } else v(dX + 0.25, dY + 0.25, dstZ);
        break;
      default: v(dX + 0.75, dY + 0.25, dstZ); v(dX + 0.5, dY + 0.5, dstZ); break;
    }
  }
  return p;
}

type Tri = [Vec3, Vec3, Vec3];

const upDownUnknownTri = (dX: number, dY: number, z: number): Tri => [
  [dX + 0.5, dY + 0.5, z],
  [dX + 0.55, dY + 0.3, z],
  [dX + 0.7, dY + 0.45, z],
];

/** Two-way end triangle at (dX, dY) (drawConnEndTri; the start triangle is the same at 0, 0). */
function endTri2(dir: number, dX: number, dY: number, z: number): Tri | null {
  switch (dir) {
    case DIR.N: return [[dX + 0.82, dY + 0.9, z], [dX + 0.68, dY + 0.9, z], [dX + 0.75, dY + 0.7, z]];
    case DIR.S: return [[dX + 0.18, dY + 0.1, z], [dX + 0.32, dY + 0.1, z], [dX + 0.25, dY + 0.3, z]];
    case DIR.E: return [[dX + 0.9, dY + 0.68, z], [dX + 0.9, dY + 0.82, z], [dX + 0.7, dY + 0.75, z]];
    case DIR.W: return [[dX + 0.1, dY + 0.32, z], [dX + 0.1, dY + 0.18, z], [dX + 0.3, dY + 0.25, z]];
    case DIR.U:
    case DIR.D: return null;
    default: return upDownUnknownTri(dX, dY, z);
  }
}

function endTri1(dir: number, dX: number, dY: number, z: number): Tri {
  switch (dir) {
    case DIR.N: return [[dX + 0.32, dY + 0.9, z], [dX + 0.18, dY + 0.9, z], [dX + 0.25, dY + 0.7, z]];
    case DIR.S: return [[dX + 0.68, dY + 0.1, z], [dX + 0.82, dY + 0.1, z], [dX + 0.75, dY + 0.3, z]];
    case DIR.E: return [[dX + 0.9, dY + 0.18, z], [dX + 0.9, dY + 0.32, z], [dX + 0.7, dY + 0.25, z]];
    case DIR.W: return [[dX + 0.1, dY + 0.82, z], [dX + 0.1, dY + 0.68, z], [dX + 0.3, dY + 0.75, z]];
    default: return upDownUnknownTri(dX, dY, z);
  }
}

/** The triangles of a connection, relative to the source room (drawConnectionTriangles). */
export function connectionTriangles(
  startDir: number,
  endDir: number,
  oneway: boolean,
  dX: number,
  dY: number,
  srcZ: number,
  dstZ: number,
): Tri[] {
  if (oneway) return [endTri1(endDir, dX, dY, dstZ)];
  const out: Tri[] = [];
  const s = endTri2(startDir, 0, 0, srcZ);
  if (s) out.push(s);
  const e = endTri2(endDir, dX, dY, dstZ);
  if (e) out.push(e);
  return out;
}

/** ConnectionFakeGL::drawLineStrip: quads with extended ends, faint cross-layer and long middles. */
export function lineStrip(out: ColorTris, points: readonly Vec3[], base: RGBA): void {
  const ext = CONNECTION_LINE_WIDTH * 0.5;
  const quad = (p1: Vec3, p2: Vec3, c: RGBA) => {
    const seg = vec.sub(p2, p1);
    if (vec.len(seg) < 1e-5) {
      zeroLengthSquare(out, p1, CONNECTION_LINE_WIDTH, c);
      return;
    }
    const dir = vec.normalize(seg);
    const n1 = perpendicularNormal(dir);
    lineQuad(out, p1, p2, CONNECTION_LINE_WIDTH, c, n1);
    if (isCrossingZ(p1, p2)) lineQuad(out, p1, p2, CONNECTION_LINE_WIDTH, c, orthogonalNormal(dir, n1));
  };
  const n = points.length;
  for (let i = 1; i < n; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    let color = base;
    const seg = vec.sub(b, a);
    if (vec.len(seg) < 1e-5) {
      quad(a, b, color);
      continue;
    }
    if (isCrossingZ(a, b)) color = withAlpha(color, FAINT_CONNECTION_ALPHA);
    const d = vec.normalize(seg);
    const qa = i === 1 ? vec.sub(a, vec.scale(d, ext)) : a;
    const qb = i === n - 1 ? vec.add(b, vec.scale(d, ext)) : b;
    const len = vec.len(vec.sub(qb, qa));
    if (len < LONG_LINE_LEN) {
      quad(qa, qb, color);
      continue;
    }
    const f = len > 1e-6 ? LONG_LINE_HALFLEN / len : 0.5;
    const mix = (t: number): Vec3 => [qa[0] + (qb[0] - qa[0]) * t, qa[1] + (qb[1] - qa[1]) * t, qa[2] + (qb[2] - qa[2]) * t];
    const m1 = mix(f);
    const m2 = mix(1 - f);
    quad(qa, m1, color);
    quad(m1, m2, withAlpha(color, FAINT_CONNECTION_ALPHA));
    quad(m2, qb, color);
  }
}

// -------------------------------------------------------------- drawer

const hasOut = (map: MapData, room: number, dir: number, target: number): boolean => {
  const s = room * DIR_COUNT + dir;
  for (let k = map.outStart[s]!; k < map.outStart[s + 1]!; k++) if (map.outTo[k] === target) return true;
  return false;
};

function doorPostfix(flags: number): string {
  if (!(flags & (DOOR_FLAG.NEED_KEY | DOOR_FLAG.NO_PICK | DOOR_FLAG.DELAYED))) return '';
  return ` [${flags & DOOR_FLAG.NEED_KEY ? 'L' : ''}${flags & DOOR_FLAG.NO_PICK ? '/NP' : ''}${flags & DOOR_FLAG.DELAYED ? 'd' : ''}]`;
}

const DOOR_Y_OFFSET = [0.85, 0.35, 0.55, 0.7, 1.05, 0.2];
const DOOR_NAME_BG = withAlpha(BLACK, 0.4);

class ConnectionDrawer {
  readonly buf = new Buffers();
  readonly names: MapText[] = [];

  constructor(
    private readonly map: MapData,
    private readonly layer: number,
  ) {}

  private doorName(room: number, dir: number): string {
    const slot = room * DIR_COUNT + dir;
    return (this.map.doorNames.get(slot) ?? '') + doorPostfix(this.map.doorFlags[slot]!);
  }

  private isHiddenNamedDoor(room: number, dir: number): boolean {
    const slot = room * DIR_COUNT + dir;
    return (this.map.exitFlags[slot]! & EXIT_FLAG.DOOR) !== 0 && (this.map.doorFlags[slot]! & DOOR_FLAG.HIDDEN) !== 0 && !!this.map.doorNames.get(slot);
  }

  private drawRoomDoorName(src: number, srcDir: number, dst: number, dstDir: number): void {
    const m = this.map;
    const sx = m.x[src]!;
    const sy = m.y[src]!;
    const sz = m.z[src]!;
    const tx = m.x[dst]!;
    const ty = m.y[dst]!;
    const tz = m.z[dst]!;
    if (sz !== this.layer && tz !== this.layer) return;
    let name: string;
    let together = false;
    if (this.isHiddenNamedDoor(dst, dstDir) && Math.abs(tx - sx) <= 1 && Math.abs(ty - sy) <= 1) {
      if (src > dst && sz === tz) return;
      together = true;
      const a = this.doorName(src, srcDir);
      const b = this.doorName(dst, dstDir);
      name = a !== b ? `${a}/${b}` : a;
    } else {
      name = this.doorName(src, srcDir);
    }
    const [x, y] = together ? [(sx + tx) * 0.5 + 0.6, (sy + ty) * 0.5 + 0.7] : [sx + 0.6, sy + (DOOR_Y_OFFSET[srcDir] ?? 0)];
    this.names.push({ x, y, z: this.layer, text: name, fg: WHITE, bg: DOOR_NAME_BG, center: true });
  }

  drawRoom(room: number): void {
    const m = this.map;
    const rz = m.z[room]!;
    for (let dir = 0; dir < DIR_COUNT; dir++) {
      const slot = room * DIR_COUNT + dir;
      const flags = m.exitFlags[slot]!;
      for (let k = m.outStart[slot]!; k < m.outStart[slot + 1]!; k++) {
        const target = m.outTo[k]!;
        const targetDir = OPPOSITE[dir]!;
        const targetFlags = m.exitFlags[target * DIR_COUNT + targetDir]!;
        const twoway = hasOut(m, target, targetDir, room);
        const bothZ = rz !== m.z[target]!;
        if (!twoway) {
          this.drawConnection(room, target, dir, targetDir, true, (flags & EXIT_FLAG.EXIT) !== 0);
        } else if (room <= target || bothZ) {
          this.drawConnection(room, target, dir, targetDir, false, (flags & EXIT_FLAG.EXIT) !== 0 && (targetFlags & EXIT_FLAG.EXIT) !== 0);
        }
        if (this.isHiddenNamedDoor(room, dir)) this.drawRoomDoorName(room, dir, target, targetDir);
      }
      // Incoming connections from other layers that are one-way.
      for (let k = m.inStart[slot]!; k < m.inStart[slot + 1]!; k++) {
        const other = m.inFrom[k]!;
        if (m.z[other] === rz) continue;
        let oneway = true;
        for (let d = 0; d < DIR_COUNT && oneway; d++) if (hasOut(m, room, d, other)) oneway = false;
        if (!oneway) continue;
        for (let td = 0; td < DIR_COUNT; td++) {
          if (hasOut(m, other, td, room)) {
            this.drawConnection(other, room, td, dir, true, (m.exitFlags[other * DIR_COUNT + td]! & EXIT_FLAG.EXIT) !== 0);
          }
        }
      }
    }
  }

  private drawConnection(left: number, right: number, startDir: number, endDir: number, oneway: boolean, normal: boolean): void {
    const m = this.map;
    const lx = m.x[left]!;
    const ly = m.y[left]!;
    const lz = m.z[left]!;
    const rz = m.z[right]!;
    const dX = m.x[right]! - lx;
    const dY = m.y[right]! - ly;
    const dZ = rz - lz;
    if (rz !== this.layer && lz !== this.layer) return;
    let neighbours = false;
    if (dZ === 0) {
      if (dX === 0 && dY === 1) {
        if (startDir === DIR.N && endDir === DIR.S && !oneway) return;
        neighbours = true;
      } else if (dX === 0 && dY === -1) {
        if (startDir === DIR.S && endDir === DIR.N && !oneway) return;
        neighbours = true;
      } else if (dX === 1 && dY === 0) {
        if (startDir === DIR.E && endDir === DIR.W && !oneway) return;
        neighbours = true;
      } else if (dX === -1 && dY === 0) {
        if (startDir === DIR.W && endDir === DIR.E && !oneway) return;
        neighbours = true;
      }
    }
    const color = normal ? WHITE : RED;
    const off = (p: Vec3): Vec3 => [p[0] + lx, p[1] + ly, p[2]];
    const pts = connectionLine(startDir, endDir, oneway, neighbours, dX, dY, lz, rz).map(off);
    lineStrip(normal ? this.buf.normalQuads : this.buf.redQuads, pts, color);
    const tris = normal ? this.buf.normalTris : this.buf.redTris;
    for (const t of connectionTriangles(startDir, endDir, oneway, dX, dY, lz, rz)) tris.tri(off(t[0]), off(t[1]), off(t[2]), color);
  }
}

/** Connections and door names of every layer (`layers`: rooms by ascending z). */
export function buildConnections(map: MapData, layers: Map<number, number[]>): ConnectionLayer[] {
  const out: ConnectionLayer[] = [];
  for (const [z, rooms] of layers) {
    const d = new ConnectionDrawer(map, z);
    for (const r of rooms) d.drawRoom(r);
    out.push({ z, tris: d.buf.merged(), doorNames: d.names });
  }
  return out;
}
