// The one system action behind every timers trigger (ADR 0017 "Rules",
// P1 notes). The trackers know ~130 fixed game lines; defining each as its
// own action would cost a regex test per rule per line. Instead the router
// installs a single catch-all action and dispatches the line itself:
//
//   watchers   called first for every line (the stat/info block collector);
//              each checks a flag and returns at once when idle
//   exact      Map lookup on the full text, only when a known line has
//              the same length and first character
//   prefix     `startsWith` on the prefixes sharing the line's first
//              character (`[cast …'`, `You flee `)
//   suffix     `endsWith` on the suffixes sharing its last character
//              (`… seems to be blinded!`)
//
// Handlers run in registration order within each table; a line can hit
// several (a shared line fans out, as ADR 0017 wants). Per line this is
// the engine's catch-all match (no regex: `%*` takes the whole line,
// pattern.ts `whole`) plus a few number lookups; a burst replays ~100 000
// lines, and each µs there costs several in drain time (ADR 0017 "Burst
// fix").

import type { SystemRules } from '../gmcp/state';

export type LineHandler = (text: string) => void;

/** Priority of the timers' actions (ADR 0016 (3), ADR 0017 "Rules"). */
export const TIMERS_RULE_PRIORITY = 3;

export class LineRouter {
  private readonly exact = new Map<string, LineHandler[]>();
  /** Length and first character of the exact lines: most lines skip the Map (and its string hash). */
  private readonly exactKeys = new Set<number>();
  /** Prefix and suffix entries bucketed by their first / last UTF-16 unit. */
  private readonly prefixes = new Buckets();
  private readonly suffixes = new Buckets();
  private readonly watchers: LineHandler[] = [];

  /** `fn` runs when a line is exactly `line`. */
  onLine(line: string, fn: LineHandler): void {
    const list = this.exact.get(line);
    if (list) list.push(fn);
    else this.exact.set(line, [fn]);
    this.exactKeys.add(exactKey(line));
  }

  /** `fn` runs when a line starts with `prefix` (not empty). */
  onPrefix(prefix: string, fn: LineHandler): void {
    this.prefixes.add(prefix.charCodeAt(0), { s: prefix, fn });
  }

  /** `fn` runs when a line ends with `suffix` (not empty). */
  onSuffix(suffix: string, fn: LineHandler): void {
    this.suffixes.add(suffix.charCodeAt(suffix.length - 1), { s: suffix, fn });
  }

  /** `fn` sees every line, before the tables (keep it O(1) when idle). */
  watch(fn: LineHandler): void {
    this.watchers.push(fn);
  }

  /** Number of exact lines known (tests, notes). */
  get size(): number {
    return this.exact.size;
  }

  /** Runs the handlers for one game line (clean text, no colour). */
  dispatch(text: string): void {
    const w = this.watchers;
    for (let i = 0; i < w.length; i++) w[i]!(text);
    if (this.exactKeys.has(exactKey(text))) {
      const hit = this.exact.get(text);
      if (hit) for (let i = 0; i < hit.length; i++) hit[i]!(text);
    }
    const p = this.prefixes.get(text.charCodeAt(0));
    if (p) for (let i = 0; i < p.length; i++) if (text.startsWith(p[i]!.s)) p[i]!.fn(text);
    const s = this.suffixes.get(text.charCodeAt(text.length - 1));
    if (s) for (let i = 0; i < s.length; i++) if (text.endsWith(s[i]!.s)) s[i]!.fn(text);
  }

  /** Installs the catch-all action into the system store. */
  install(system: SystemRules, priority = TIMERS_RULE_PRIORITY): void {
    system.define('action', '%*', '', {
      priority,
      fn: (m) => this.dispatch(m.line ? m.line.text : (m.args[0] ?? '')),
    });
  }
}

interface Entry {
  s: string;
  fn: LineHandler;
}

/** Entries by a UTF-16 unit: an array for ASCII, a Map for the rest. */
class Buckets {
  private readonly ascii: Array<Entry[] | undefined> = new Array<Entry[] | undefined>(128).fill(undefined);
  private readonly other = new Map<number, Entry[]>();

  add(code: number, e: Entry): void {
    const list = this.get(code);
    if (list) list.push(e);
    else if (code < 128) this.ascii[code] = [e];
    else this.other.set(code, [e]);
  }

  /** The entries for `code` (NaN for an empty line: none). */
  get(code: number): Entry[] | undefined {
    return code < 128 ? this.ascii[code] : this.other.get(code);
  }
}

/** A number that equal strings share (length and first UTF-16 unit). */
function exactKey(s: string): number {
  return s.length * 0x10000 + (s.length > 0 ? s.charCodeAt(0) : 0);
}
