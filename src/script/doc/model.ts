// Lossless profile document model (ADR 0005, ADR 0015 "Document model
// contract").
//
// The document understands file structure only. It splits the text into
// nodes, each owning an exact slice of the input; `serialize` joins the
// slices, so `serialize(parseProfile(t)) === t` for every string `t`.
//
// Structure rules:
// - A node covers whole lines, including its final line break.
// - A line of spaces/tabs/CR only is a `blank` node, one per line.
// - A line whose first non-blank character is `#` starts a command. The
//   command runs to the end of the line on which its brace depth is back
//   to 0 (a backslash escapes the next character, except a line break), and
//   also takes the next line when that line starts with `{` after
//   spaces/tabs (tt++'s `#class write` layout: `#ALIAS {x}\n{\n    …\n}`).
// - Any other line is free `text` (passthrough); it too runs on while
//   braces are open.
// - A command is a typed `entry` when its word resolves to action, alias,
//   highlight, macro, substitute or variable and its arguments are all
//   braced: 2 (macro, variable) or 2–3 with a numeric priority (the others),
//   with nothing but whitespace after the last `}`. Anything else is kept
//   as passthrough (unbraced arguments too: `#var x 1`).
// - `#nop` (any accepted abbreviation) is a `comment`.

import { type CommandEntry, resolveCommand } from '../commands';

/** The typed entry kinds: the five lite kinds plus `#variable`. */
export type EntryKind = 'action' | 'alias' | 'highlight' | 'macro' | 'substitute' | 'variable';

export const ENTRY_KINDS: readonly EntryKind[] = ['action', 'alias', 'highlight', 'macro', 'substitute', 'variable'];

/** The five kinds the lite view edits (Inv §5.2), in its order. */
export const LITE_KINDS: readonly EntryKind[] = ['action', 'alias', 'highlight', 'macro', 'substitute'];

/** Half-open `[start, end)` offsets, in UTF-16 code units. */
export interface Span {
  start: number;
  end: number;
}

interface NodeBase {
  /** Unique within the document; kept across edits of the node. */
  readonly id: number;
  /** The node's exact text, line break(s) included. */
  readonly text: string;
  /**
   * Where `text` sat in the string the document was parsed from. Absent for
   * nodes created or rewritten since.
   */
  readonly source?: Span;
}

export interface BlankNode extends NodeBase {
  readonly type: 'blank';
}

export interface CommentNode extends NodeBase {
  readonly type: 'comment';
  /** The command word as written, without `#` (`nop`, `NOP`, `no`). */
  readonly word: string;
}

export type PassthroughReason =
  /** A line that is not a command. */
  | 'text'
  /** `#word` that resolves to no command (or is ambiguous). */
  | 'unknown'
  /** A tt++ command WebCockpit keeps but never runs (see `command.hint`). */
  | 'inert'
  /** A command the engine runs but the lite view does not edit (`#gag`, `#if` …). */
  | 'command'
  /** An entry kind whose shape the model does not type (bad arguments, trailing text). */
  | 'malformed';

export interface PassthroughNode extends NodeBase {
  readonly type: 'passthrough';
  readonly reason: PassthroughReason;
  /** The command word as written, without `#`; null for text. */
  readonly word: string | null;
  /** The resolved command, when there is one. */
  readonly command: CommandEntry | null;
}

export interface EntryNode extends NodeBase {
  readonly type: 'entry';
  readonly kind: EntryKind;
  /** The command word as written, without `#` (`ALIAS`, `act`, `sub`). */
  readonly word: string;
  /** First argument, raw (without its braces). For macros: the key as written. */
  readonly pattern: string;
  /** Second argument, raw. For variables: the value. */
  readonly body: string;
  /** Third argument, raw, or null. Never set for macros and variables. */
  readonly priority: string | null;
  /** Spaces/tabs before `#`. */
  readonly lead: string;
  /** The node's final line break: `\n`, `\r\n` or `` at the end of the text. */
  readonly eol: string;
  /** Inner spans of the braced arguments, relative to `text`. */
  readonly args: readonly Span[];
}

export type DocNode = BlankNode | CommentNode | PassthroughNode | EntryNode;

export interface ProfileDoc {
  readonly nodes: readonly DocNode[];
  /** The id the next new node gets. */
  readonly nextId: number;
  /** Line break for new text: `\r\n` when most lines use it, else `\n`. */
  readonly eol: '\n' | '\r\n';
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const NL = 0x0a;
const CR = 0x0d;
const SP = 0x20;
const TAB = 0x09;
const BSL = 0x5c;
const LBR = 0x7b;
const RBR = 0x7d;
const HASH = 0x23;

function isBlankLine(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c !== SP && c !== TAB && c !== CR && c !== NL) return false;
  }
  return true;
}

function lineEnd(text: string, pos: number): number {
  const nl = text.indexOf('\n', pos);
  return nl < 0 ? text.length : nl + 1;
}

/**
 * End of the node that starts at `pos`: the line break that closes the
 * line where brace depth is 0, plus `{`-led continuation lines for
 * commands.
 */
function extent(text: string, pos: number, command: boolean): number {
  let depth = 0;
  const n = text.length;
  for (let i = pos; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === BSL) {
      const d = text.charCodeAt(i + 1);
      if (d !== NL && d !== CR) i++;
    } else if (c === LBR) {
      depth++;
    } else if (c === RBR) {
      if (depth > 0) depth--;
    } else if (c === NL && depth === 0) {
      if (!command) return i + 1;
      let j = i + 1;
      while (j < n && (text.charCodeAt(j) === SP || text.charCodeAt(j) === TAB)) j++;
      if (text.charCodeAt(j) !== LBR) return i + 1;
    }
  }
  return n;
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === BSL) i++;
    else if (c === LBR) depth++;
    else if (c === RBR && --depth === 0) return i;
  }
  return -1;
}

function isWs(c: number): boolean {
  return c === SP || c === TAB || c === CR || c === NL;
}

/** Braced arguments after `from`, or null when the rest is not `{…}` groups plus whitespace. */
function bracedArgs(text: string, from: number): Span[] | null {
  const args: Span[] = [];
  let i = from;
  for (;;) {
    let j = i;
    while (j < text.length && isWs(text.charCodeAt(j))) j++;
    if (text.charCodeAt(j) !== LBR) {
      i = j;
      break;
    }
    const close = matchBrace(text, j);
    if (close < 0) return null;
    args.push({ start: j + 1, end: close });
    i = close + 1;
  }
  return i === text.length ? args : null;
}

const PRIORITY = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/;

function eolOf(text: string): string {
  if (text.endsWith('\r\n')) return '\r\n';
  if (text.endsWith('\n')) return '\n';
  return '';
}

/** Word characters end at whitespace, braces or `;`. */
function wordEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (isWs(c) || c === LBR || c === RBR || c === 0x3b /* ; */) break;
    i++;
  }
  return i;
}

type Unplaced<T> = T extends DocNode ? Omit<T, 'id' | 'source'> : never;

/** Classifies one node's text. `id` and `source` are filled in by the caller. */
function classify(text: string, command: boolean): Unplaced<DocNode> {
  if (!command) return { type: 'passthrough', text, reason: 'text', word: null, command: null };
  let p = 0;
  while (text.charCodeAt(p) === SP || text.charCodeAt(p) === TAB) p++;
  const lead = text.slice(0, p);
  const we = wordEnd(text, p + 1);
  const word = text.slice(p + 1, we);
  const res = word === '' ? null : resolveCommand(word);
  if (res === null || res === 'ambiguous') {
    return { type: 'passthrough', text, reason: 'unknown', word, command: null };
  }
  if (res.name === 'nop') return { type: 'comment', text, word };
  const rule = res.rule;
  if (res.kind === 'define' && rule && (ENTRY_KINDS as readonly string[]).includes(rule)) {
    const kind = rule as EntryKind;
    const args = bracedArgs(text, we);
    const fixed = kind === 'macro' || kind === 'variable';
    const ok =
      args !== null &&
      (fixed ? args.length === 2 : args.length === 2 || args.length === 3) &&
      (args.length < 3 || PRIORITY.test(text.slice(args[2]!.start, args[2]!.end)));
    if (ok) {
      const a = args!;
      return {
        type: 'entry',
        text,
        kind,
        word,
        pattern: text.slice(a[0]!.start, a[0]!.end),
        body: text.slice(a[1]!.start, a[1]!.end),
        priority: a[2] ? text.slice(a[2].start, a[2].end) : null,
        lead,
        eol: eolOf(text),
        args: a,
      };
    }
    return { type: 'passthrough', text, reason: 'malformed', word, command: res };
  }
  return { type: 'passthrough', text, reason: res.inert ? 'inert' : 'command', word, command: res };
}

/** Parses one node's text as a fresh node (used after edits). */
export function parseNodeText(text: string, id: number): DocNode {
  let p = 0;
  while (text.charCodeAt(p) === SP || text.charCodeAt(p) === TAB) p++;
  if (isBlankLine(text, 0, text.length)) return { type: 'blank', id, text };
  return { ...classify(text, text.charCodeAt(p) === HASH), id } as DocNode;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parses any text into a document. Never throws. */
export function parseProfile(text: string): ProfileDoc {
  const nodes: DocNode[] = [];
  let id = 1;
  let pos = 0;
  let crlf = 0;
  let lf = 0;
  const n = text.length;
  while (pos < n) {
    const le = lineEnd(text, pos);
    if (isBlankLine(text, pos, le)) {
      nodes.push({ type: 'blank', id: id++, text: text.slice(pos, le), source: { start: pos, end: le } });
      pos = le;
      continue;
    }
    let p = pos;
    while (text.charCodeAt(p) === SP || text.charCodeAt(p) === TAB) p++;
    const command = text.charCodeAt(p) === HASH;
    const end = extent(text, pos, command);
    const slice = text.slice(pos, end);
    nodes.push({ ...classify(slice, command), id: id++, source: { start: pos, end } } as DocNode);
    pos = end;
  }
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === CR) crlf++;
    else lf++;
  }
  return { nodes, nextId: id, eol: crlf > lf ? '\r\n' : '\n' };
}

/** The document's text: every node's text, in order. */
export function serialize(doc: ProfileDoc): string {
  let s = '';
  for (const node of doc.nodes) s += node.text;
  return s;
}
