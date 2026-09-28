// Map text with MMapper's Cantarell BMFont (research §5): parse the
// `.fnt` file and lay strings out as textured quads. Ported from MMapper
// 26.06.0 opengl/Font.cpp (FontMetrics, FontBatchBuilder;
// GPL-2.0-or-later). Pure.
//
// A font vertex is 11 floats: the anchor (x, y, z: world, or physical px
// for screen-space text), colour (r, g, b, a), texture coordinate (u, v;
// v = 0 at the bottom of the page, the page is uploaded flipped) and the
// offset from the anchor in physical px (y up). u < -1 marks a solid
// texel (background, underline); u in [-4, -3] is a round point.

import type { MapText } from './connections';
import type { RGBA } from './palette';

export const FONT_STRIDE = 11;

export interface Glyph {
  id: number;
  /** Page position with a lower-left origin (MMapper flips y). */
  x: number;
  y: number;
  w: number;
  h: number;
  xoff: number;
  /** Bottom of the glyph relative to the baseline, y up. */
  yoff: number;
  adv: number;
}

export interface FontMetrics {
  lineHeight: number;
  base: number;
  scaleW: number;
  scaleH: number;
  /** The page file name. */
  page: string;
  glyphs: Map<number, Glyph>;
  /** first << 16 | second → amount. */
  kernings: Map<number, number>;
}

/** Background box margin around the glyph bounds (x, y), px. */
const MARGIN_X = 2;
const MARGIN_Y = 1;

/** The Cantarell size MMapper picks for a device pixel ratio (GLFont::getFontFilename). */
export function fontSizeForDpr(dpr: number): 18 | 27 | 36 {
  return dpr > 1.75 ? 36 : dpr > 1.25 ? 27 : 18;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]!] = m[2]!;
  return out;
}

/** Parses an AngelCode BMFont XML file (no DOM; runs in the worker). */
export function parseFnt(xml: string): FontMetrics {
  const common = attrs(/<common\b[^>]*>/.exec(xml)?.[0] ?? '');
  const page = attrs(/<page\b[^>]*>/.exec(xml)?.[0] ?? '');
  const n = (s: string | undefined) => Number(s ?? 0);
  const fm: FontMetrics = {
    lineHeight: n(common.lineHeight),
    base: n(common.base),
    scaleW: n(common.scaleW),
    scaleH: n(common.scaleH),
    page: page.file ?? '',
    glyphs: new Map(),
    kernings: new Map(),
  };
  if (!fm.scaleW || !fm.scaleH) throw new Error('font: no <common> element');
  for (const m of xml.matchAll(/<char\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const h = n(a.height);
    const id = n(a.id);
    fm.glyphs.set(id, {
      id,
      x: n(a.x),
      y: fm.scaleH - (n(a.y) + h),
      w: n(a.width),
      h,
      xoff: n(a.xoffset),
      yoff: fm.base - (n(a.yoffset) + h),
      adv: n(a.xadvance),
    });
  }
  for (const m of xml.matchAll(/<kerning\b[^>]*>/g)) {
    const a = attrs(m[0]);
    fm.kernings.set((n(a.first) << 16) | n(a.second), n(a.amount));
  }
  return fm;
}

/** Glyphs of `text` as MMapper would draw them (Latin-1; unknown → '?'). */
function glyphsOf(fm: FontMetrics, text: string): Glyph[] {
  const out: Glyph[] = [];
  const q = fm.glyphs.get(63);
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const g = (c <= 255 ? fm.glyphs.get(c) : undefined) ?? q;
    if (g) out.push(g);
  }
  return out;
}

const isSpace = (id: number) => id === 32 || (id >= 9 && id <= 13);

/** Width of `text` in px (FontMetrics::measureWidth). */
export function measureText(fm: FontMetrics, text: string): number {
  let w = 0;
  let prev: Glyph | null = null;
  for (const g of glyphsOf(fm, text)) {
    if (prev) w += fm.kernings.get((prev.id << 16) | g.id) ?? 0;
    w += g.adv;
    prev = g;
  }
  return w;
}

/** A growable font vertex list. */
export class FontVerts {
  data: number[] = [];
  get count(): number {
    return this.data.length / FONT_STRIDE;
  }
  /** One corner. */
  vert(ax: number, ay: number, az: number, c: RGBA, u: number, v: number, ox: number, oy: number): void {
    this.data.push(ax, ay, az, c[0], c[1], c[2], c[3], u, v, ox, oy);
  }
  /** A quad given its four corners as [u, v, ox, oy] in order around (0-1-2-3). */
  quad(ax: number, ay: number, az: number, c: RGBA, q: readonly (readonly [number, number, number, number])[]): void {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = q[i]!;
      this.vert(ax, ay, az, c, p[0], p[1], p[2], p[3]);
    }
  }
}

/** Solid-texel texture coordinate (background boxes, underlines, lines). */
export const SOLID = -10;

/** Lays out one string at its anchor (FontBatchBuilder::addString). */
export function layoutText(fm: FontMetrics, t: MapText, out: FontVerts): void {
  const glyphs = glyphsOf(fm, t.text);
  const rad = t.angle ? (t.angle * Math.PI) / 180 : 0;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const tf = (x: number, y: number): [number, number] => {
    if (t.italic) x += y / 6;
    return rad ? [x * cos - y * sin, x * sin + y * cos] : [x, y];
  };

  // Pass 1: bounds (the origin is always included) and the advance.
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let xline = 0;
  const walk = (emit: ((g: Glyph, x: number) => void) | null) => {
    let prev: Glyph | null = null;
    for (const g of glyphs) {
      if (prev) xline += fm.kernings.get((prev.id << 16) | g.id) ?? 0;
      const vx = xline + g.xoff;
      xline += g.adv;
      prev = g;
      if (emit) emit(g, vx);
      else if (!isSpace(g.id)) {
        minX = Math.min(minX, vx);
        minY = Math.min(minY, g.yoff);
        maxX = Math.max(maxX, vx + g.w);
        maxY = Math.max(maxY, g.yoff + g.h);
      }
    }
  };
  walk(null);

  let wordOffset = 0;
  if (t.center) {
    const half = Math.trunc(xline / 2);
    wordOffset -= half;
    minX -= half;
    maxX -= half;
  }
  const { x: ax, y: ay, z: az } = t;
  const corner = (x: number, y: number, u = SOLID, v = SOLID): [number, number, number, number] => {
    const [ox, oy] = tf(x, y);
    return [u, v, ox, oy];
  };
  if (t.bg) {
    const lx = minX - MARGIN_X;
    const ly = minY - MARGIN_Y;
    const hx = maxX + MARGIN_X;
    const hy = maxY + MARGIN_Y;
    out.quad(ax, ay, az, t.bg, [corner(lx, ly), corner(hx, ly), corner(hx, hy), corner(lx, hy)]);
  }
  if (t.underline) {
    const x0 = wordOffset;
    out.quad(ax, ay, az, t.fg, [corner(x0, -1), corner(x0 + xline, -1), corner(x0 + xline, 0), corner(x0, 0)]);
  }
  xline = wordOffset;
  const sw = fm.scaleW;
  const sh = fm.scaleH;
  walk((g, vx) => {
    const c = (dx: number, dy: number) => corner(vx + dx, g.yoff + dy, (g.x + dx) / sw, (g.y + dy) / sh);
    out.quad(ax, ay, az, t.fg, [c(0, 0), c(g.w, 0), c(g.w, g.h), c(0, g.h)]);
  });
}
