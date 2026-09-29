// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 The WebCockpit Authors
// Derived from MMapper 26.06.0 (https://github.com/MUME/MMapper),
// Copyright (C) 2019-2026 The MMapper Authors. Modified for WebCockpit
// (2026-09-28): rewritten in TypeScript and WebGL2; see
// THIRD_PARTY_NOTICES.md "MMapper-derived code".
//
// The map view (research §2): scroll centre, zoom and layer, and the
// pan / zoom-at-cursor / layer operations. Pure; owned by the worker.
//
// World: a room (x, y, z) covers [x, x+1] × [y, y+1]; +y is north (up on
// screen). MMapper's 2D projection gives `s(z) = 2640·zoom / (60 − 7z)`
// CSS px per room on layer z (44 px on layer 0 at zoom 1); the camera
// ignores the current layer.

/** Zoom limits and wheel step (MMapper ScaleFactor). */
export const ZOOM_MIN = 0.04;
export const ZOOM_MAX = 5;
export const ZOOM_STEP = 1.175;

export interface View {
  /** World point at the canvas centre. */
  x: number;
  y: number;
  zoom: number;
  /** The current layer (z). */
  layer: number;
}

export const defaultView = (): View => ({ x: 0, y: 0, zoom: 1, layer: 0 });

/** CSS px per room on layer `z`. */
export function pxPerRoom(zoom: number, z: number): number {
  return (2640 * zoom) / (60 - 7 * z);
}

/** Centres on room (x, y, z) and makes z the current layer (MMapper's move behaviour). */
export function centreOn(v: View, x: number, y: number, z: number): View {
  return { ...v, x: x + 0.5, y: y + 0.5, layer: z };
}

/** Drag by (dx, dy) CSS px: the grabbed world point follows the pointer. */
export function pan(v: View, dx: number, dy: number): View {
  const s = pxPerRoom(v.zoom, v.layer);
  return { ...v, x: v.x - dx / s, y: v.y + dy / s };
}

/**
 * Zooms by `steps` wheel notches around (px, py) CSS px in a `w` × `h`
 * canvas, keeping the world point under the cursor fixed on the current
 * layer.
 */
export function zoomAt(v: View, steps: number, px: number, py: number, w: number, h: number): View {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * ZOOM_STEP ** steps));
  if (zoom === v.zoom) return v;
  const s0 = pxPerRoom(v.zoom, v.layer);
  const s1 = pxPerRoom(zoom, v.layer);
  const ox = px - w / 2;
  const oy = py - h / 2;
  const wx = v.x + ox / s0;
  const wy = v.y - oy / s0;
  return { ...v, zoom, x: wx - ox / s1, y: wy + oy / s1 };
}

/** Changes the current layer by `dz`. */
export function changeLayer(v: View, dz: number): View {
  return dz === 0 ? v : { ...v, layer: v.layer + Math.trunc(dz) };
}
