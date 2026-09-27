// The one system action behind every timers trigger (ADR 0017 "Rules",
// P1 notes). The trackers know ~130 fixed game lines; defining each as its
// own action would cost a regex test per rule per line. Instead the router
// installs a single catch-all action and dispatches the line itself:
//
//   watchers   called first for every line (the stat/info block collector);
//              each checks a flag and returns at once when idle
//   exact      Map lookup on the full text (almost every game line)
//   prefix     a short list of `startsWith` tests (`[cast …'`, `You flee `)
//   suffix     a short list of `endsWith` tests (`… seems to be blinded!`)
//
// Handlers run in registration order within each table; a line can hit
// several (a shared line fans out, as ADR 0017 wants). Per line this is one
// regex test by the engine plus one Map lookup and about a dozen
// `startsWith`/`endsWith` calls.

import type { SystemRules } from '../gmcp/state';

export type LineHandler = (text: string) => void;

/** Priority of the timers' actions (ADR 0016 (3), ADR 0017 "Rules"). */
export const TIMERS_RULE_PRIORITY = 3;

export class LineRouter {
  private readonly exact = new Map<string, LineHandler[]>();
  private readonly prefixes: Array<{ s: string; fn: LineHandler }> = [];
  private readonly suffixes: Array<{ s: string; fn: LineHandler }> = [];
  private readonly watchers: LineHandler[] = [];

  /** `fn` runs when a line is exactly `line`. */
  onLine(line: string, fn: LineHandler): void {
    const list = this.exact.get(line);
    if (list) list.push(fn);
    else this.exact.set(line, [fn]);
  }

  /** `fn` runs when a line starts with `prefix`. */
  onPrefix(prefix: string, fn: LineHandler): void {
    this.prefixes.push({ s: prefix, fn });
  }

  /** `fn` runs when a line ends with `suffix`. */
  onSuffix(suffix: string, fn: LineHandler): void {
    this.suffixes.push({ s: suffix, fn });
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
    const hit = this.exact.get(text);
    if (hit) for (let i = 0; i < hit.length; i++) hit[i]!(text);
    const p = this.prefixes;
    for (let i = 0; i < p.length; i++) if (text.startsWith(p[i]!.s)) p[i]!.fn(text);
    const s = this.suffixes;
    for (let i = 0; i < s.length; i++) if (text.endsWith(s[i]!.s)) s[i]!.fn(text);
  }

  /** Installs the catch-all action into the system store. */
  install(system: SystemRules, priority = TIMERS_RULE_PRIORITY): void {
    system.define('action', '%*', '', {
      priority,
      fn: (m) => this.dispatch(m.line ? m.line.text : (m.args[0] ?? '')),
    });
  }
}
