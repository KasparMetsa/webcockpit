// Pane frame glyph art (Inv §2.1 "Pane frame", §10.4; ADR 0010).
//
//   ▛▀▀ Character ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜
//   ▌                             ▐
//   ▙▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▟
//
// The frame is drawn inside the pane as plain text on the cell grid, one
// line per row, exactly like the game output, so it tiles the same way
// (ADR 0011: whole-pixel cells, line height = cell height). The glyphs are
// foreground only: the pane background shows through the unlit halves and
// the spaces. The content element sits on top of the inner area.

import type { CornerStyle } from '../settings/types';

/** Resolved corner glyph set. */
export type CornerGlyphs = 'quadrant' | 'block';

const CORNERS: Record<CornerGlyphs, { tl: string; tr: string; bl: string; br: string }> = {
  quadrant: { tl: '▛', tr: '▜', bl: '▙', br: '▟' },
  block: { tl: '█', tr: '█', bl: '█', br: '█' },
};

/**
 * The corner glyphs for a setting. `auto` is quadrant: both bundled fonts
 * have the quadrant glyphs (ADR 0010, checked by tests/unit/font-glyphs).
 */
export function resolveCorners(style: CornerStyle): CornerGlyphs {
  return style === 'block' ? 'block' : 'quadrant';
}

/** The top row, `w` cells: `▛▀▀ Label ▀…▀▜`, the label chopped when narrow. */
export function frameTop(w: number, label: string, corners: CornerGlyphs): string {
  if (w <= 0) return '';
  const c = CORNERS[corners];
  if (w === 1) return c.tl;
  const inner = w - 2;
  const head = label ? `▀▀ ${label} ` : '';
  const mid = head.length >= inner ? head.slice(0, inner) : head + '▀'.repeat(inner - head.length);
  return c.tl + mid + c.tr;
}

/** The bottom row, `w` cells: `▙▄…▄▟`. */
export function frameBottom(w: number, corners: CornerGlyphs): string {
  if (w <= 0) return '';
  const c = CORNERS[corners];
  if (w === 1) return c.bl;
  return c.bl + '▄'.repeat(w - 2) + c.br;
}

/** A middle row, `w` cells: `▌`, spaces, `▐`. */
export function frameEdge(w: number): string {
  if (w <= 0) return '';
  if (w === 1) return '▌';
  return '▌' + ' '.repeat(w - 2) + '▐';
}

/** The whole frame for a `w` × `h` pane, rows joined by `\n`. */
export function frameText(w: number, h: number, label: string, corners: CornerGlyphs): string {
  if (w <= 0 || h <= 0) return '';
  const rows = [frameTop(w, label, corners)];
  if (h > 1) {
    const edge = frameEdge(w);
    for (let i = 0; i < h - 2; i++) rows.push(edge);
    rows.push(frameBottom(w, corners));
  }
  return rows.join('\n');
}
