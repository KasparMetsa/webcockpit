// World-space coloured geometry helpers (MMapper opengl/LineRendering.cpp,
// GPL-2.0-or-later). Vertices are 7 floats: x, y, z, r, g, b, a; every
// primitive is emitted as triangles.

import type { RGBA } from './palette';

export const COLOR_STRIDE = 7;

export type Vec3 = readonly [number, number, number];

/** A growable float list of coloured triangle vertices. */
export class ColorTris {
  data: number[] = [];

  vert(p: Vec3, c: RGBA): void {
    this.data.push(p[0], p[1], p[2], c[0], c[1], c[2], c[3]);
  }

  tri(a: Vec3, b: Vec3, c: Vec3, col: RGBA): void {
    this.vert(a, col);
    this.vert(b, col);
    this.vert(c, col);
  }

  /** Quad v1 v2 v3 v4 (in order around) as two triangles. */
  quad(v1: Vec3, v2: Vec3, v3: Vec3, v4: Vec3, col: RGBA): void {
    this.tri(v1, v2, v3, col);
    this.tri(v1, v3, v4, col);
  }

  get count(): number {
    return this.data.length / COLOR_STRIDE;
  }
}

const EPS = 1e-5;
const len2 = (v: Vec3) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.sqrt(len2(a)));

export const vec = { sub, add, scale, normalize, len: (v: Vec3) => Math.sqrt(len2(v)) };

export function isNearZero(v: Vec3): boolean {
  return len2(v) < EPS * EPS;
}

function isDegenerate(v: Vec3): boolean {
  return len2(v) < EPS * 10;
}

export function perpendicularNormal(dir: Vec3): Vec3 {
  const c: Vec3 = [-dir[1], dir[0], 0];
  return isDegenerate(c) ? [1, 0, 0] : normalize(c);
}

export function orthogonalNormal(dir: Vec3, n1: Vec3): Vec3 {
  const c: Vec3 = [dir[1] * n1[2] - dir[2] * n1[1], dir[2] * n1[0] - dir[0] * n1[2], dir[0] * n1[1] - dir[1] * n1[0]];
  return isDegenerate(c) ? [0, 1, 0] : normalize(c);
}

export function lineQuad(out: ColorTris, p1: Vec3, p2: Vec3, width: number, col: RGBA, n: Vec3): void {
  const o = scale(n, width / 2);
  out.quad(add(p1, o), sub(p1, o), sub(p2, o), add(p2, o), col);
}

export function zeroLengthSquare(out: ColorTris, c: Vec3, width: number, col: RGBA): void {
  const h = width / 2;
  out.quad([c[0] - h, c[1] - h, c[2]], [c[0] + h, c[1] - h, c[2]], [c[0] + h, c[1] + h, c[2]], [c[0] - h, c[1] + h, c[2]], col);
}

/** True when a segment changes layer (Connections.cpp isCrossingZAxis). */
export function isCrossingZ(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[2] - b[2]) > EPS;
}

/** generateLineQuadsSafe. */
export function lineQuadSafe(out: ColorTris, p1: Vec3, p2: Vec3, width: number, col: RGBA): void {
  const seg = sub(p2, p1);
  if (isNearZero(seg)) {
    zeroLengthSquare(out, p1, width, col);
    return;
  }
  lineQuad(out, p1, p2, width, col, perpendicularNormal(normalize(seg)));
}
