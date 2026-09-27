// Rule stores (ADR 0015 "Engine contract"): one for the profile (user),
// one for built-in code (system). A store holds rules, variables, timers
// and the open #class.
//
// - Lists are kept sorted by priority (lower first, default 5), ties in
//   definition order. Defining a rule whose pattern (key) already exists
//   replaces it; the replacement counts as a new definition.
// - Lists are copy-on-write: a list being iterated (a line running its
//   actions) never changes under the loop; a rule defined meanwhile takes
//   effect from the next line.
// - A rule has either a script `body` or, for system code, a native `fn`.

import type { Line } from '../../core/types';
import { keyBindability, normalizeKey } from '../keys';
import { type HighlightStyle, parseHighlight } from './color';
import { type CompiledPattern, compilePattern } from './pattern';
import type { Scheduler } from './timers';
import { globToRegExp } from './text';

export type ListKind = 'action' | 'alias' | 'highlight' | 'substitute' | 'gag' | 'macro' | 'event';
export type TimerKind = 'ticker' | 'delay';

export const LIST_KINDS: readonly ListKind[] = ['action', 'alias', 'highlight', 'substitute', 'gag', 'macro', 'event'];

export const DEFAULT_PRIORITY = 5;

/** What a native (system) rule handler receives. */
export interface MatchContext {
  /** `args[0]` is the whole match, `args[n]` the n-th argument. */
  args: string[];
  /** The line that matched (actions), or null. */
  line: Line | null;
}

export interface Rule {
  readonly kind: ListKind;
  /** The pattern / key / event name as written. */
  readonly pattern: string;
  /** Script body, substitute text or highlight colour, as written. */
  readonly body: string;
  readonly priority: number;
  readonly seq: number;
  readonly cls: string | null;
  readonly store: RuleStore;
  /** Compiled pattern; null for macros, events, and patterns with `$var`. */
  readonly compiled: CompiledPattern | null;
  /** The pattern contains `$var`/`&var`: compiled at match time. */
  readonly dynamic: boolean;
  /** Highlights: the parsed style. */
  readonly style?: HighlightStyle;
  /** Native handler (system rules). */
  readonly fn?: (ctx: MatchContext) => void;
}

export interface Timer {
  readonly kind: TimerKind;
  readonly name: string;
  readonly body: string;
  readonly seconds: number;
  readonly cls: string | null;
  readonly fn?: () => void;
  handle: unknown;
  /** Planned time of the next fire (scheduler ms). */
  at: number;
}

export class DefineError extends Error {
  override name = 'DefineError';
}

let seqCounter = 0;

const HAS_VAR = /[$&](\{|[A-Za-z_])/;

export interface DefineOptions {
  priority?: number;
  fn?: (ctx: MatchContext) => void;
}

export class RuleStore {
  private lists: Record<ListKind, Rule[]> = {
    action: [],
    alias: [],
    highlight: [],
    substitute: [],
    gag: [],
    macro: [],
    event: [],
  };
  /** Plain one-word aliases by name (fast path for input). */
  private plainAliases = new Map<string, Rule>();
  /** Other aliases, sorted. */
  private otherAliases: Rule[] = [];
  private macros = new Map<string, Rule>();
  private events = new Map<string, Rule>();
  readonly vars = new Map<string, string>();
  /** Class of each variable that was defined while a class was open. */
  private varClass = new Map<string, string>();
  private timers = new Map<string, Timer>();
  private delaySeq = 0;
  /** The class new rules join (`#class {x} {open}`), or null. */
  openClass: string | null = null;
  private disposed = false;
  /** Bumped on every rule list change (for callers' caches). */
  version = 0;

  constructor(
    readonly name: 'user' | 'system',
    private readonly scheduler: Scheduler,
    private readonly onTimer: (t: Timer, store: RuleStore) => void,
  ) {}

  // ----------------------------------------------------------------- rules

  /** Sorted rules of a kind. The array is never mutated; treat it as read-only. */
  rules(kind: ListKind): readonly Rule[] {
    return this.lists[kind];
  }

  count(kind: ListKind): number {
    return this.lists[kind].length;
  }

  /**
   * Defines (or replaces) a rule. Throws DefineError for a bad pattern,
   * an unknown macro key or an unreadable highlight colour.
   */
  define(kind: ListKind, pattern: string, body: string, opts: DefineOptions = {}): Rule {
    let key = pattern;
    let compiled: CompiledPattern | null = null;
    let dynamic = false;
    let style: HighlightStyle | undefined;
    if (kind === 'macro') {
      const k = normalizeKey(pattern);
      if (!k) throw new DefineError(`Unknown macro key {${pattern}}.`);
      const b = keyBindability(k);
      if (!b.ok) throw new DefineError(`Macro key {${pattern}} cannot be bound: ${b.reason}`);
      key = k;
    } else if (kind === 'event') {
      key = pattern.trim().toUpperCase().replace(/\s+/g, ' ');
    } else {
      if (pattern === '') throw new DefineError(`Empty ${kind} pattern.`);
      dynamic = HAS_VAR.test(pattern);
      if (!dynamic) {
        try {
          compiled = compilePattern(pattern);
        } catch (err) {
          throw new DefineError(err instanceof Error ? err.message : String(err));
        }
      }
      if (kind === 'highlight') {
        const s = parseHighlight(body);
        if (!s) throw new DefineError(`Unknown highlight colour {${body}}.`);
        style = s;
      }
    }
    const rule: Rule = {
      kind,
      pattern: key,
      body,
      priority: opts.priority ?? DEFAULT_PRIORITY,
      seq: ++seqCounter,
      cls: this.openClass,
      store: this,
      compiled,
      dynamic,
      ...(style ? { style } : {}),
      ...(opts.fn ? { fn: opts.fn } : {}),
    };
    this.removeKey(kind, key);
    this.lists[kind] = insertSorted(this.lists[kind], rule);
    if (kind === 'alias') this.indexAlias(rule);
    else if (kind === 'macro') this.macros.set(key, rule);
    else if (kind === 'event') this.events.set(key, rule);
    this.version++;
    return rule;
  }

  private indexAlias(rule: Rule): void {
    if (rule.compiled?.plain && !/\s/.test(rule.pattern)) this.plainAliases.set(rule.pattern, rule);
    else this.otherAliases = insertSorted(this.otherAliases, rule);
  }

  private removeKey(kind: ListKind, key: string): boolean {
    const list = this.lists[kind];
    const i = list.findIndex((r) => r.pattern === key);
    if (i < 0) return false;
    const r = list[i]!;
    this.lists[kind] = list.slice(0, i).concat(list.slice(i + 1));
    if (kind === 'alias') {
      if (this.plainAliases.get(key) === r) this.plainAliases.delete(key);
      else this.otherAliases = this.otherAliases.filter((x) => x !== r);
    } else if (kind === 'macro') this.macros.delete(key);
    else if (kind === 'event') this.events.delete(key);
    return true;
  }

  /**
   * Removes rules of `kind` by key: the exact key, else (when it contains
   * `*`) every key the glob matches. Returns the number removed.
   */
  remove(kind: ListKind, pattern: string): number {
    let key = pattern;
    if (kind === 'macro') key = normalizeKey(pattern) ?? pattern;
    else if (kind === 'event') key = pattern.trim().toUpperCase().replace(/\s+/g, ' ');
    if (this.removeKey(kind, key)) {
      this.version++;
      return 1;
    }
    if (!pattern.includes('*')) return 0;
    const re = globToRegExp(pattern);
    let n = 0;
    for (const r of this.lists[kind].slice()) {
      if (re.test(r.pattern) && this.removeKey(kind, r.pattern)) n++;
    }
    if (n) this.version++;
    return n;
  }

  /** The alias for a command's first word (plain aliases only). */
  plainAlias(word: string): Rule | undefined {
    return this.plainAliases.get(word);
  }

  /** Aliases that are not plain one-word names, sorted. */
  patternAliases(): readonly Rule[] {
    return this.otherAliases;
  }

  macro(canonicalKey: string): Rule | undefined {
    return this.macros.get(canonicalKey);
  }

  event(name: string): Rule | undefined {
    return this.events.get(name);
  }

  get hasEvents(): boolean {
    return this.events.size > 0;
  }

  // ------------------------------------------------------------- variables

  getVar(name: string): string | undefined {
    return this.vars.get(name);
  }

  setVar(name: string, value: string): void {
    this.vars.set(name, value);
    if (this.openClass) this.varClass.set(name, this.openClass);
  }

  /** Removes variables by name or glob. Returns the number removed. */
  deleteVar(pattern: string): number {
    if (this.vars.delete(pattern)) {
      this.varClass.delete(pattern);
      return 1;
    }
    if (!pattern.includes('*')) return 0;
    const re = globToRegExp(pattern);
    let n = 0;
    for (const k of [...this.vars.keys()]) {
      if (re.test(k)) {
        this.vars.delete(k);
        this.varClass.delete(k);
        n++;
      }
    }
    return n;
  }

  // ---------------------------------------------------------------- timers

  /**
   * Starts a ticker (every `seconds`) or a delay (once after `seconds`).
   * A delay without a name gets a unique one. Same name replaces.
   */
  addTimer(kind: TimerKind, name: string | null, body: string, seconds: number, fn?: () => void): Timer {
    if (this.disposed) throw new DefineError('Store is disposed.');
    const nm = name ?? `delay#${++this.delaySeq}`;
    this.removeTimer(kind, nm);
    const ms = Math.max(kind === 'ticker' ? 50 : 0, seconds * 1000);
    const t: Timer = { kind, name: nm, body, seconds, cls: this.openClass, handle: null, at: this.scheduler.now() + ms, ...(fn ? { fn } : {}) };
    this.timers.set(kind + ':' + nm, t);
    this.arm(t, ms);
    return t;
  }

  private arm(t: Timer, ms: number): void {
    t.handle = this.scheduler.set(() => this.fire(t), ms);
  }

  private fire(t: Timer): void {
    if (this.timers.get(t.kind + ':' + t.name) !== t) return;
    if (t.kind === 'delay') {
      this.timers.delete(t.kind + ':' + t.name);
    } else {
      const period = Math.max(50, t.seconds * 1000);
      const now = this.scheduler.now();
      t.at += period;
      if (t.at < now) t.at = now + period;
      this.arm(t, t.at - now);
    }
    this.onTimer(t, this);
  }

  /** Stops timers by name or glob. Returns the number removed. */
  removeTimer(kind: TimerKind, pattern: string): number {
    const k = kind + ':' + pattern;
    const t = this.timers.get(k);
    if (t) {
      this.scheduler.clear(t.handle);
      this.timers.delete(k);
      return 1;
    }
    if (!pattern.includes('*')) return 0;
    const re = globToRegExp(pattern);
    let n = 0;
    for (const [key, tt] of [...this.timers]) {
      if (tt.kind === kind && re.test(tt.name)) {
        this.scheduler.clear(tt.handle);
        this.timers.delete(key);
        n++;
      }
    }
    return n;
  }

  timerList(kind: TimerKind): Timer[] {
    return [...this.timers.values()].filter((t) => t.kind === kind);
  }

  // --------------------------------------------------------------- classes

  /** Removes every rule, variable and timer of class `cls`. Returns the count. */
  killClass(cls: string): number {
    let n = 0;
    for (const kind of LIST_KINDS) {
      for (const r of this.lists[kind].slice()) {
        if (r.cls === cls && this.removeKey(kind, r.pattern)) n++;
      }
    }
    for (const [name, c] of [...this.varClass]) {
      if (c === cls) {
        this.vars.delete(name);
        this.varClass.delete(name);
        n++;
      }
    }
    for (const [key, t] of [...this.timers]) {
      if (t.cls === cls) {
        this.scheduler.clear(t.handle);
        this.timers.delete(key);
        n++;
      }
    }
    if (this.openClass === cls) this.openClass = null;
    this.version++;
    return n;
  }

  /** Stops every timer; the store is not used again. */
  dispose(): void {
    this.disposed = true;
    for (const t of this.timers.values()) this.scheduler.clear(t.handle);
    this.timers.clear();
  }
}

function insertSorted(list: readonly Rule[], rule: Rule): Rule[] {
  let i = list.length;
  while (i > 0) {
    const r = list[i - 1]!;
    if (r.priority < rule.priority || (r.priority === rule.priority && r.seq < rule.seq)) break;
    i--;
  }
  const out = list.slice(0, i) as Rule[];
  out.push(rule);
  for (let k = i; k < list.length; k++) out.push(list[k]!);
  return out;
}

/** Compares two rules: priority, then definition order. */
export function ruleOrder(a: Rule, b: Rule): number {
  return a.priority - b.priority || a.seq - b.seq;
}
