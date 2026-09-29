// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 The WebCockpit Authors
// Derived from MMapper 26.06.0 (https://github.com/MUME/MMapper),
// Copyright (C) 2019-2026 The MMapper Authors. Modified for WebCockpit
// (2026-09-28): rewritten in TypeScript and WebGL2; see
// THIRD_PARTY_NOTICES.md "MMapper-derived code".
//
// Infomarks (research §5), per layer. Ported from MMapper 26.06.0
// display/Infomarks.cpp (drawInfomark; GPL-2.0-or-later). Pure.

import { INFOMARK_SCALE, INFOMARK_TYPE, type MapData } from '../model';
import type { MapText } from './connections';
import { ColorTris, lineQuadSafe } from './geometry';
import { BLACK, INFOMARK_CLASS_COLORS, type RGBA, WHITE, textColor, withAlpha } from './palette';

const INFOMARK_ARROW_LINE_WIDTH = 0.045;

export interface InfomarkLayer {
  z: number;
  /** Arrow heads, then line quads (MMapper: tris, then quads). */
  tris: Float32Array;
  texts: MapText[];
}

export function infomarkColor(type: number, cls: number): RGBA {
  return INFOMARK_CLASS_COLORS[cls] ?? (type === INFOMARK_TYPE.TEXT ? BLACK : WHITE);
}

export function buildInfomarks(map: MapData): InfomarkLayer[] {
  const im = map.infomarks;
  const by = new Map<number, { tris: ColorTris; quads: ColorTris; texts: MapText[] }>();
  for (let i = 0; i < im.count; i++) {
    const z = im.z1[i]!;
    let l = by.get(z);
    if (!l) by.set(z, (l = { tris: new ColorTris(), quads: new ColorTris(), texts: [] }));
    const x1 = im.x1[i]! / INFOMARK_SCALE;
    const y1 = im.y1[i]! / INFOMARK_SCALE;
    const dx = im.x2[i]! / INFOMARK_SCALE - x1;
    const dy = im.y2[i]! / INFOMARK_SCALE - y1;
    const type = im.type[i]!;
    const cls = im.cls[i]!;
    const color = withAlpha(infomarkColor(type, cls), 0.55);
    if (type === INFOMARK_TYPE.TEXT) {
      l.texts.push({
        x: x1,
        y: y1,
        z,
        text: im.text[i]!,
        fg: textColor(color),
        bg: color,
        italic: cls === 8,
        underline: cls === 9,
        angle: im.angle[i]!,
      });
    } else if (type === INFOMARK_TYPE.LINE) {
      lineQuadSafe(l.quads, [x1, y1, z], [x1 + dx, y1 + dy, z], INFOMARK_ARROW_LINE_WIDTH, color);
    } else {
      lineQuadSafe(l.quads, [x1, y1, z], [x1 + dx - 0.2, y1 + dy, z], INFOMARK_ARROW_LINE_WIDTH, color);
      l.tris.tri([x1 + dx - 0.2, y1 + dy + 0.07, z], [x1 + dx - 0.2, y1 + dy - 0.07, z], [x1 + dx, y1 + dy, z], color);
    }
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([z, l]) => ({ z, tris: new Float32Array([...l.tris.data, ...l.quads.data]), texts: l.texts }));
}
