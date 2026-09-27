// Colour codes and highlight colour names → style runs on the Line model
// (spec §3, Inv §6.3, Inv §5.6 "Highlight colour picker", Inv §10.2).
//
// Colour codes in #showme, #substitute and #highlight text:
//   <abc>        digits: a = attribute (0 reset, 1 bold, 2 dim (ignored),
//                3 italic, 4 underline, 5 blink, 7 reverse, 8 keep),
//                b = foreground, c = background (0–7 colour, 8 keep,
//                9 default). <099> resets to the default colours.
//   <aaa>–<fff>  256-colour foreground (6×6×6 cube); <AAA>–<FFF> background
//   <g00>–<g23>  grey ramp foreground; <G00>–<G23> background
//   <Frgb>, <Frrggbb>, <Brgb>, <Brrggbb>   24-bit foreground / background
// A code-shaped tag with invalid values (e.g. <900>) is removed without
// effect. Anything else in angle brackets is text.
//
// Highlight colour names: red green yellow blue magenta cyan white black,
// capitalised or `light <name>` = bright, `dark <name>` = normal,
// `b <name>` / `bg <name>` = background, and the styles underscore /
// underline, blink, reverse, bold, italic, reset. Words may be separated by
// spaces or commas. Colour codes are accepted too.

import { type Color, type StyleRun, TRUECOLOR } from '../../core/types';

/** A style without a range. */
export type Style = Omit<StyleRun, 'start' | 'end'>;

const STYLE_KEYS = ['fg', 'bg', 'bold', 'italic', 'underline', 'inverse', 'blink'] as const;

export function sameStyle(a: Style, b: Style): boolean {
  for (const k of STYLE_KEYS) if (a[k] !== b[k]) return false;
  return true;
}

export function isDefaultStyle(s: Style): boolean {
  for (const k of STYLE_KEYS) if (s[k] !== undefined && s[k] !== false) return false;
  return true;
}

function clean(s: Style): Style {
  const o: Style = {};
  if (s.fg !== undefined) o.fg = s.fg;
  if (s.bg !== undefined) o.bg = s.bg;
  if (s.bold) o.bold = true;
  if (s.italic) o.italic = true;
  if (s.underline) o.underline = true;
  if (s.inverse) o.inverse = true;
  if (s.blink) o.blink = true;
  return o;
}

function hex(s: string): number {
  return parseInt(s, 16);
}

/**
 * Applies the colour code `code` (without `<>`) to `cur`. Returns the new
 * style, `null` for a code-shaped tag with invalid values (removed, no
 * effect), or `undefined` when `code` is not a colour code at all.
 */
export function applyCode(cur: Style, code: string): Style | null | undefined {
  const n = code.length;
  const c0 = code[0];
  if ((c0 === 'F' || c0 === 'B') && (n === 4 || n === 7) && /^[FB][0-9a-fA-F]+$/.test(code)) {
    let r: number;
    let g: number;
    let b: number;
    if (n === 4) {
      r = hex(code[1]!) * 17;
      g = hex(code[2]!) * 17;
      b = hex(code[3]!) * 17;
    } else {
      r = hex(code.slice(1, 3));
      g = hex(code.slice(3, 5));
      b = hex(code.slice(5, 7));
    }
    const col = TRUECOLOR | (r << 16) | (g << 8) | b;
    return c0 === 'F' ? { ...cur, fg: col } : { ...cur, bg: col };
  }
  if (n !== 3) return undefined;
  if (/^[0-9]{3}$/.test(code)) {
    const a = code.charCodeAt(0) - 48;
    const f = code.charCodeAt(1) - 48;
    const b = code.charCodeAt(2) - 48;
    if (a === 6 || a === 9) return null;
    let s: Style = { ...cur };
    if (a === 0) s = {};
    else if (a === 1) s.bold = true;
    else if (a === 3) s.italic = true;
    else if (a === 4) s.underline = true;
    else if (a === 5) s.blink = true;
    else if (a === 7) s.inverse = true;
    if (f <= 7) s.fg = f;
    else if (f === 9) delete s.fg;
    if (b <= 7) s.bg = b;
    else if (b === 9) delete s.bg;
    return s;
  }
  if (/^[a-f]{3}$/.test(code) || /^[A-F]{3}$/.test(code)) {
    const lower = code === code.toLowerCase();
    const base = lower ? 97 : 65;
    const idx = 16 + 36 * (code.charCodeAt(0) - base) + 6 * (code.charCodeAt(1) - base) + (code.charCodeAt(2) - base);
    return lower ? { ...cur, fg: idx } : { ...cur, bg: idx };
  }
  if (/^[gG][0-9]{2}$/.test(code)) {
    const v = Number(code.slice(1));
    if (v > 23) return null;
    return code[0] === 'g' ? { ...cur, fg: 232 + v } : { ...cur, bg: 232 + v };
  }
  return undefined;
}

/** Text with colour codes parsed out. */
export interface Colored {
  text: string;
  /** Runs relative to `text`; default-style stretches are gaps. */
  runs: StyleRun[];
}

/**
 * Parses colour codes out of `input`. `base` is the style the text starts
 * with (default: none). Adjacent equal runs are merged.
 */
export function parseColored(input: string, base: Style = {}): Colored {
  if (input.indexOf('<') < 0) {
    return { text: input, runs: isDefaultStyle(base) || input === '' ? [] : [{ start: 0, end: input.length, ...clean(base) }] };
  }
  let text = '';
  const runs: StyleRun[] = [];
  let cur: Style = base;
  let segStart = 0;
  const flush = (): void => {
    if (text.length > segStart && !isDefaultStyle(cur)) pushRun(runs, { start: segStart, end: text.length, ...clean(cur) });
    segStart = text.length;
  };
  let i = 0;
  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt < 0) {
      text += input.slice(i);
      break;
    }
    text += input.slice(i, lt);
    const gt = input.indexOf('>', lt + 1);
    if (gt < 0 || gt - lt - 1 > 7) {
      text += '<';
      i = lt + 1;
      continue;
    }
    const code = input.slice(lt + 1, gt);
    const next = applyCode(cur, code);
    if (next === undefined) {
      text += '<';
      i = lt + 1;
      continue;
    }
    if (next !== null) {
      flush();
      cur = next;
    }
    i = gt + 1;
  }
  flush();
  return { text, runs };
}

/** Appends `r`, merging it into the last run when adjacent with the same style. */
export function pushRun(runs: StyleRun[], r: StyleRun): void {
  const last = runs[runs.length - 1];
  if (last && last.end === r.start && sameStyle(last, r)) last.end = r.end;
  else runs.push(r);
}

// ---------------------------------------------------------------------------
// Highlight colour names
// ---------------------------------------------------------------------------

const NAMES: Record<string, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
};

/** A highlight: the style fields it sets (others keep the line's style). */
export type HighlightStyle = Style;

/**
 * Parses a #highlight colour argument: names (see the file header) or
 * colour codes. Returns null when nothing in it is understood.
 */
export function parseHighlight(arg: string): HighlightStyle | null {
  const t = arg.trim();
  if (t === '') return null;
  if (t.startsWith('<')) {
    let s: Style = {};
    let ok = false;
    for (const m of t.matchAll(/<([^<>]{1,7})>/g)) {
      const next = applyCode(s, m[1]!);
      if (next) {
        s = next;
        ok = true;
      }
    }
    return ok ? clean(s) : null;
  }
  const words = t.split(/[\s,]+/).filter(Boolean);
  const s: Style = {};
  let bright = false;
  let dark = false;
  let bg = false;
  let understood = false;
  for (const w of words) {
    const lw = w.toLowerCase();
    if (lw === 'light' || lw === 'bright') {
      bright = true;
      understood = true;
      continue;
    }
    if (lw === 'dark') {
      dark = true;
      understood = true;
      continue;
    }
    if (lw === 'b' || lw === 'bg' || lw === 'background') {
      bg = true;
      understood = true;
      continue;
    }
    if (lw === 'underscore' || lw === 'underline') s.underline = true;
    else if (lw === 'blink') s.blink = true;
    else if (lw === 'reverse') s.inverse = true;
    else if (lw === 'bold') s.bold = true;
    else if (lw === 'italic') s.italic = true;
    else if (lw === 'reset') {
      /* the default colours */
    } else if (lw in NAMES) {
      const cap = w[0] !== w[0]!.toLowerCase();
      let col: Color = NAMES[lw]!;
      if ((cap || bright) && !dark) col += 8;
      if (bg) s.bg = col;
      else s.fg = col;
      bright = false;
      dark = false;
      bg = false;
    } else {
      continue;
    }
    understood = true;
  }
  return understood ? s : null;
}
