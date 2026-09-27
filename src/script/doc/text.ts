// Pure text helpers for the profile document and the lite view: brace
// balance, body normalisation (Inv §5.9) and the lite-view validation
// messages (Inv §5.6 "Validation").

import type { EntryKind } from './model';

// ---------------------------------------------------------------------------
// Braces
// ---------------------------------------------------------------------------

export type BraceCheck =
  | { ok: true }
  /**
   * `index` is the offending brace: the first `}` without an opener
   * ('unopened'), or the outermost `{` left open at the end ('unclosed').
   */
  | { ok: false; kind: 'unopened' | 'unclosed'; index: number };

/**
 * Checks that `{` and `}` pair up. A backslash escapes the next character,
 * so `\{` and `\}` are not braces (Inv §5.6).
 */
export function checkBraces(text: string): BraceCheck {
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x5c /* \ */) {
      i++;
    } else if (c === 0x7b /* { */) {
      open.push(i);
    } else if (c === 0x7d /* } */) {
      if (open.length === 0) return { ok: false, kind: 'unopened', index: i };
      open.pop();
    }
  }
  if (open.length > 0) return { ok: false, kind: 'unclosed', index: open[0]! };
  return { ok: true };
}

/** True when every brace pairs up (escaped braces ignored). */
export function isBraceBalanced(text: string): boolean {
  return checkBraces(text).ok;
}

/**
 * Net brace depth at the end of `text` (opens minus closes, escaped braces
 * ignored). Negative when there are more closes. For the editor's balance
 * indicator.
 */
export function braceDepth(text: string): number {
  let d = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x5c) i++;
    else if (c === 0x7b) d++;
    else if (c === 0x7d) d--;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Body normalisation (lite view only)
// ---------------------------------------------------------------------------

/** Kinds whose bodies tt++ re-indents; the others keep their whitespace. */
function reindents(kind: EntryKind): boolean {
  return kind === 'action' || kind === 'alias' || kind === 'macro';
}

const INDENT = '    ';

/**
 * The body as the lite view shows it (Inv §5.9 "Body normalisation"). For
 * actions, aliases and macros: CRLF becomes LF, leading and trailing blank
 * lines go, and up to 4 leading spaces go from each line. Highlights,
 * substitutes and variables are returned unchanged. Never used on text the
 * user has not edited.
 */
export function displayBody(kind: EntryKind, raw: string): string {
  if (!reindents(kind) || !/[\r\n]/.test(raw)) return raw;
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines.map((l) => l.replace(/^ {1,4}/, '')).join('\n');
}

/**
 * The raw body to store for a lite-view body. When `previousRaw` displays
 * as `display`, the previous text is returned byte for byte, so an entry
 * the user did not change stays untouched. A multi-line action, alias or
 * macro body is stored in tt++'s block layout (`{\n    a;\n    b\n}`), which
 * `displayBody` maps back to `display`. `eol` is the document's line ending.
 */
export function storeBody(kind: EntryKind, display: string, previousRaw?: string, eol = '\n'): string {
  if (previousRaw !== undefined && displayBody(kind, previousRaw) === display) return previousRaw;
  if (!reindents(kind) || !display.includes('\n')) return display;
  const lines = display.split('\n').map((l) => (l.trim() === '' ? '' : INDENT + l));
  return eol + lines.join(eol) + eol;
}

// ---------------------------------------------------------------------------
// Lite-view labels and validation
// ---------------------------------------------------------------------------

/** Field labels per kind (Inv §5.2). */
export const FIELD_LABELS: Readonly<Record<EntryKind, { pattern: string; body: string }>> = {
  action: { pattern: 'Pattern', body: 'Commands' },
  alias: { pattern: 'Pattern', body: 'Commands' },
  highlight: { pattern: 'Pattern', body: 'Color' },
  macro: { pattern: 'Key', body: 'Commands' },
  substitute: { pattern: 'Text', body: 'New text' },
  variable: { pattern: 'Name', body: 'Value' },
};

export interface ValidateOptions {
  /** False while the pattern field still has focus for the first time. Default true. */
  patternVisited?: boolean;
}

/**
 * The one inline message for a lite-view entry, or null (Inv §5.6):
 * `<Pattern> required` > `Unbalanced braces in <Pattern>` >
 * `Unbalanced braces in <Commands>`, with the kind's field labels.
 * Saving is never blocked by these.
 */
export function validateEntry(
  e: { kind: EntryKind; pattern: string; body: string },
  opts: ValidateOptions = {},
): string | null {
  const labels = FIELD_LABELS[e.kind];
  if (e.pattern.trim() === '' && opts.patternVisited !== false) return `${labels.pattern} required`;
  if (!isBraceBalanced(e.pattern)) return `Unbalanced braces in ${labels.pattern}`;
  if (!isBraceBalanced(e.body)) return `Unbalanced braces in ${labels.body}`;
  return null;
}
