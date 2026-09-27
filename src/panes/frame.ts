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

/** Frame corners: always the quadrant glyphs (owner feedback, stage 2). */
const TL = '▛';
const TR = '▜';
const BL = '▙';
const BR = '▟';

/** The top row, `w` cells: `▛▀▀ Label ▀…▀▜`, the label chopped when narrow. */
export function frameTop(w: number, label: string): string {
  if (w <= 0) return '';
  if (w === 1) return TL;
  const inner = w - 2;
  const head = label ? `▀▀ ${label} ` : '';
  const mid = head.length >= inner ? head.slice(0, inner) : head + '▀'.repeat(inner - head.length);
  return TL + mid + TR;
}

/** The bottom row, `w` cells: `▙▄…▄▟`. */
export function frameBottom(w: number): string {
  if (w <= 0) return '';
  if (w === 1) return BL;
  return BL + '▄'.repeat(w - 2) + BR;
}

/** A middle row, `w` cells: `▌`, spaces, `▐`. */
export function frameEdge(w: number): string {
  if (w <= 0) return '';
  if (w === 1) return '▌';
  return '▌' + ' '.repeat(w - 2) + '▐';
}

/** The whole frame for a `w` × `h` pane, rows joined by `\n`. */
export function frameText(w: number, h: number, label: string): string {
  if (w <= 0 || h <= 0) return '';
  const rows = [frameTop(w, label)];
  if (h > 1) {
    const edge = frameEdge(w);
    for (let i = 0; i < h - 2; i++) rows.push(edge);
    rows.push(frameBottom(w));
  }
  return rows.join('\n');
}
