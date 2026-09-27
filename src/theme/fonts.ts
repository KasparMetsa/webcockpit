// Bundled font families (public/fonts, @font-face in fonts.css).

import type { FontId } from '../settings/types';

export interface FontInfo {
  /** Label in the Appearance options. */
  label: string;
  /** The @font-face family name. */
  family: string;
  /** The CSS `font-family` value (with fallbacks). */
  stack: string;
  /** File names under public/fonts. */
  regular: string;
  bold: string;
  /**
   * Ink height of `█` in em, from the font file (fontTools glyph bounds /
   * unitsPerEm; see public/fonts/README.md). The cell height is this times
   * the font size, rounded down (src/theme/cells.ts).
   */
  blockEm: number;
  /** Advance width of every glyph in em (monospace), from the font file. */
  advanceEm: number;
}

export const FONTS: Readonly<Record<FontId, FontInfo>> = {
  dejavu: {
    label: 'DejaVu Sans Mono',
    family: 'DejaVu Sans Mono',
    stack: '"DejaVu Sans Mono", monospace',
    regular: 'DejaVuSansMono.woff2',
    bold: 'DejaVuSansMono-Bold.woff2',
    // █ spans -512..1921 of 2048 units.
    blockEm: 2433 / 2048,
    advanceEm: 1233 / 2048,
  },
  jetbrains: {
    label: 'JetBrains Mono',
    family: 'JetBrains Mono',
    // DejaVu covers the symbols JetBrains Mono lacks (✦✧⚔♦★✖).
    stack: '"JetBrains Mono", "DejaVu Sans Mono", monospace',
    regular: 'JetBrainsMonoNL-Regular.woff2',
    bold: 'JetBrainsMonoNL-Bold.woff2',
    // █ spans -300..1020 of 1000 units.
    blockEm: 1320 / 1000,
    advanceEm: 600 / 1000,
  },
};

/**
 * The CSS px font size actually used for a size setting: the setting
 * nudged so that the glyph advance is a whole number of px (ADR 0011).
 * With a fractional advance, runs of block glyphs show hairline seams
 * (Firefox positions glyphs at sub-pixel offsets; Chrome rounds hinted
 * advances past the glyph's ink). E.g. DejaVu 15 → 14.95 px (9 px cells),
 * 16 → 16.61 px (10 px cells). Neighbouring settings can map to the same
 * size; the change is at most half a pixel of cell width.
 */
export function fontPx(id: FontId, size: number): number {
  const adv = FONTS[id].advanceEm;
  const w = Math.max(1, Math.round(size * adv));
  // Four decimals: enough for the advance, and keeps float noise out of CSS.
  return Math.round((w / adv) * 1e4) / 1e4;
}

/** URL of a font file (respects Vite's `base`). */
export function fontUrl(file: string): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base.endsWith('/') ? base : base + '/'}fonts/${file}`;
}

/**
 * Adds `<link rel=preload>` for the family's regular and bold files, once
 * per file. Call before the first render; only the selected family.
 */
export function preloadFont(id: FontId, doc: Document = document): void {
  const f = FONTS[id];
  for (const file of [f.regular, f.bold]) {
    const href = fontUrl(file);
    if (doc.head.querySelector(`link[rel="preload"][href="${href}"]`)) continue;
    const link = doc.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.type = 'font/woff2';
    link.crossOrigin = 'anonymous';
    link.href = href;
    doc.head.appendChild(link);
  }
}

/**
 * Resolves when the family's regular and bold faces are loaded (or failed
 * to load; never rejects). Resolves at once where the Font Loading API is
 * missing.
 */
export async function loadFont(id: FontId, sizePx: number, doc: Document = document): Promise<void> {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.load) return;
  const fam = `"${FONTS[id].family}"`;
  try {
    await Promise.all([fonts.load(`${sizePx}px ${fam}`, '█'), fonts.load(`bold ${sizePx}px ${fam}`, '█')]);
  } catch {
    /* fall back to whatever the browser has */
  }
}
