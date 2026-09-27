// Colour palette for the output pane (Inv §1.1, spec §2.3).
//
// - 0–15: Cockpit's "DOS palette". These are also exposed as CSS custom
//   properties (`--wc-c0` … `--wc-c15`, see ui.css) and rendered with
//   classes (`wc-f<n>` / `wc-b<n>`), so a theme can change them without
//   touching the renderer.
// - 16–255: the standard xterm 6×6×6 cube and 24-step grey ramp. Rendered
//   as inline style (rare in MUME output).
// - Truecolor (`TRUECOLOR | 0xRRGGBB`): inline style.

import { type Color, isTrueColor } from '../core/types';

/**
 * Whether SGR bold turns colours 0–7 into their bright variant (8–15).
 * Cockpit's terminal does not brighten: bold is rendered as a bold font
 * weight only. Flip this single constant to change that.
 */
export const BOLD_BRIGHTENS = false;

/** Default foreground and background (Inv §1.1). */
export const DEFAULT_FG = '#C0C0C0';
export const DEFAULT_BG = '#000000';

/** The DOS palette, indices 0–15 (normal 0–7, bright 8–15). */
export const DOS_PALETTE: readonly string[] = [
  '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#C0C0C0',
  '#808080', '#FF0000', '#00FF00', '#FFFF00', '#0000FF', '#FF00FF', '#00FFFF', '#FFFFFF',
];

const CUBE_STEPS = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function buildXterm256(): string[] {
  const out = DOS_PALETTE.slice();
  for (let i = 16; i < 232; i++) {
    const n = i - 16;
    const r = CUBE_STEPS[Math.floor(n / 36)]!;
    const g = CUBE_STEPS[Math.floor(n / 6) % 6]!;
    const b = CUBE_STEPS[n % 6]!;
    out.push('#' + hex2(r) + hex2(g) + hex2(b));
  }
  for (let i = 232; i < 256; i++) {
    const v = 8 + (i - 232) * 10;
    out.push('#' + hex2(v) + hex2(v) + hex2(v));
  }
  return out;
}

/** Hex colour for every palette index 0–255. */
export const PALETTE_256: readonly string[] = buildXterm256();

/** CSS colour string for any `Color` (palette index or truecolor). */
export function colorToCss(c: Color): string {
  if (isTrueColor(c)) return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  return PALETTE_256[c & 0xff]!;
}

/** Applies BOLD_BRIGHTENS to a foreground colour. */
export function effectiveFg(fg: Color | undefined, bold: boolean | undefined): Color | undefined {
  if (BOLD_BRIGHTENS && bold && fg !== undefined && fg < 8) return fg + 8;
  return fg;
}
