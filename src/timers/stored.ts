// Stored spells tracker (Inv §2.6.6).
//
//   sent `sto|stor|store X`, `cast [speed] 'store' X`
//                        X joins the store FIFO (resolved by prefix)
//   sent `cast … 'X'`, echo `[cast n 'X']`
//                        X is the last cast intent (for a recall)
//   `You stored it.`     FIFO front → a tracked entry (`◆ STORE: X stored.`)
//   store fail lines, a shared cast failure, an empty Enter
//                        FIFO front dropped (`▶ STORE: cast attempt for X failed.`)
//   `Your mind feels empty for a while.`
//                        the oldest entry decays; a tracked one records its
//                        age as a sample and the others of that spell get
//                        their expiry from the new mean
//   recall line          the newest entry of the last cast intent goes
//   magic blast lines    every entry becomes untracked (grey), warning
//   stat/info            multiset reconcile per name (silent)
//
// Learned: last 3 natural decays per spell, floor(mean), default 5400 s.
// Saved: every entry (untracked ones never expire) and the samples.

import type { CastQueue } from './castq';
import { parseCast, parseCastEcho } from './castq';
import { STORABLE_SPELLS, STORED_DEFAULT_S, resolveSpell } from './data/spells';
import type { TimerCell } from './entry';
import type { LineRouter } from './lines';
import { LEARN_SAMPLES } from './affects';
import type { Tracker, TrackerHost } from './tracker';

export const STORE_OK = 'You stored it.';
export const STORE_DECAY = 'Your mind feels empty for a while.';
export const STORE_BLAST = 'You blast the area with magical energies.';
export const STORE_BLAST_OTHER = ' blasts the area with magical energies.';
export const STORE_FAIL_LINES: readonly string[] = [
  'Your mind is too full to store it.',
  'You failed.',
  'You do not know any such a spell.',
  'You can cast quickly, fast, normally, carefully, or thoroughly.',
];

interface Stored {
  id: number;
  name: string;
  /** ms; null when only seen in stat/info. */
  startedAt: number | null;
  expected: number | null;
  expiresAt: number | null;
  tracked: boolean;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const age = (e: Stored): number => e.startedAt ?? -Infinity;

/** `m:ss` of a duration in seconds (`89:58`). */
function mmss(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const STORE_WORD = /^(store|stor|sto)\s+(\S.*)$/i;

export class StoredTracker implements Tracker {
  readonly key = 'stored';
  private readonly host: TrackerHost;
  private entries: Stored[] = [];
  private learned = new Map<string, number[]>();
  /** Store attempts in flight (runtime only). */
  private pending: string[] = [];
  /** The last non-store spell cast (runtime only). */
  private lastIntent: string | null = null;
  private nextId = 1;

  constructor(host: TrackerHost, casts: CastQueue) {
    this.host = host;
    casts.onFailed(() => this.drainPending());
    casts.onAborted(() => this.drainPending());
    casts.onRecalled((now) => this.recall(now));
  }

  route(router: LineRouter): void {
    router.onLine(STORE_OK, () => this.stored(this.host.now()));
    router.onLine(STORE_DECAY, () => this.decay(this.host.now()));
    router.onLine(STORE_BLAST, () => this.blast());
    router.onSuffix(STORE_BLAST_OTHER, () => this.blast());
    for (const l of STORE_FAIL_LINES) router.onLine(l, () => this.drainPending());
    router.onPrefix('[c', (text) => {
      const spell = parseCastEcho(text);
      const full = spell ? resolveSpell(spell) : null;
      if (full && full !== 'store') this.lastIntent = full;
    });
  }

  /** Expected decay time of a spell, ms. */
  expectedMs(name: string): number {
    const s = this.learned.get(name);
    if (s && s.length > 0) return Math.floor(s.reduce((a, b) => a + b, 0) / s.length) * 1000;
    return STORED_DEFAULT_S * 1000;
  }

  // ------------------------------------------------------------- input

  onSent(text: string): void {
    const t = text.trim();
    if (!t) return;
    const w = STORE_WORD.exec(t);
    if (w) {
      const target = resolveSpell(w[2]!);
      if (target) this.pending.push(target);
      return;
    }
    const c = parseCast(t);
    if (!c) return;
    const spell = resolveSpell(c.spell);
    if (!spell) return;
    if (spell === 'store') {
      const target = resolveSpell(c.tail);
      if (target) this.pending.push(target);
    } else this.lastIntent = spell;
  }

  // ------------------------------------------------------------- events

  private stored(now: number): void {
    const name = this.pending.shift();
    if (name === undefined) return;
    const expected = this.expectedMs(name);
    this.entries.push({ id: this.nextId++, name, startedAt: now, expected, expiresAt: now + expected, tracked: true });
    this.host.changed();
    this.host.announce('STORE', name, 'stored');
  }

  private drainPending(): void {
    const name = this.pending.shift();
    if (name === undefined) return;
    this.host.message({ kind: 'event', name: 'STORE', parts: ['cast attempt for ', { value: name }, ' failed.'] });
  }

  private recall(_now: number): void {
    const name = this.lastIntent;
    if (!name) return;
    let best = -1;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.name === name && (best < 0 || age(e) > age(this.entries[best]!))) best = i;
    }
    if (best < 0) return;
    this.entries.splice(best, 1);
    this.host.changed();
    this.host.announce('STORE', name, 'recalled');
  }

  private decay(now: number): void {
    if (this.entries.length === 0) return;
    let oldest = 0;
    for (let i = 1; i < this.entries.length; i++) if (age(this.entries[i]!) < age(this.entries[oldest]!)) oldest = i;
    const e = this.entries.splice(oldest, 1)[0]!;
    if (e.tracked && e.startedAt !== null) {
      const observed = Math.floor((now - e.startedAt) / 1000);
      const s = this.learned.get(e.name) ?? [];
      s.push(observed);
      while (s.length > LEARN_SAMPLES) s.shift();
      this.learned.set(e.name, s);
      const expected = this.expectedMs(e.name);
      for (const o of this.entries) {
        if (o.name !== e.name || !o.tracked || o.startedAt === null) continue;
        o.expected = expected;
        o.expiresAt = o.startedAt + expected;
      }
      this.host.changed();
      this.host.announce('STORE', e.name, 'decayed', `${mmss(observed)} — sample recorded`);
    } else {
      this.host.changed();
      this.host.announce('STORE', e.name, 'decayed', 'untracked');
    }
  }

  private blast(): void {
    if (this.entries.length === 0) return;
    for (const e of this.entries) {
      e.tracked = false;
      e.expiresAt = null;
      e.expected = null;
    }
    this.host.changed();
    this.host.message({ kind: 'warn', parts: ['STORE: lost track of stored spells.'] });
  }

  /** The stored spells a `stat`/`info` block listed (duplicates count). Silent. */
  reconcile(observed: readonly string[]): void {
    const want = new Map<string, number>();
    for (const o of observed) {
      const n = o.trim().toLowerCase();
      if (STORABLE_SPELLS[n] === undefined) continue;
      want.set(n, (want.get(n) ?? 0) + 1);
    }
    const have = new Map<string, number>();
    for (const e of this.entries) have.set(e.name, (have.get(e.name) ?? 0) + 1);
    let changed = false;
    for (const name of new Set([...want.keys(), ...have.keys()])) {
      const w = want.get(name) ?? 0;
      let h = have.get(name) ?? 0;
      for (; h < w; h++) {
        this.entries.push({ id: this.nextId++, name, startedAt: null, expected: null, expiresAt: null, tracked: false });
        changed = true;
      }
      while (h > w) {
        // Untracked first, then the oldest tracked.
        let pick = -1;
        for (let i = 0; i < this.entries.length; i++) {
          const e = this.entries[i]!;
          if (e.name !== name) continue;
          if (pick < 0) pick = i;
          else {
            const p = this.entries[pick]!;
            if ((!e.tracked && p.tracked) || (e.tracked === p.tracked && age(e) < age(p))) pick = i;
          }
        }
        this.entries.splice(pick, 1);
        h--;
        changed = true;
      }
    }
    if (changed) this.host.changed();
  }

  // ------------------------------------------------------------ Tracker

  cells(): TimerCell[] {
    return this.entries.map((e) => ({
      id: `stored:${e.id}`,
      name: e.name,
      group: 'stored' as const,
      startedAt: e.startedAt,
      expiresAt: e.tracked ? e.expiresAt : null,
      expected: e.tracked ? e.expected : null,
      tracked: e.tracked,
    }));
  }

  serialize(): unknown {
    const learned: Record<string, number[]> = {};
    for (const [k, v] of this.learned) if (v.length > 0) learned[k] = [...v];
    return {
      active: this.entries.map((e) => ({
        name: e.name,
        startedAt: e.startedAt,
        expected: e.expected,
        expiresAt: e.expiresAt,
        tracked: e.tracked,
      })),
      learned,
    };
  }

  restore(saved: unknown, now: number): void {
    if (typeof saved !== 'object' || saved === null) return;
    const s = saved as { active?: unknown; learned?: unknown };
    if (s.learned && typeof s.learned === 'object') {
      for (const [name, v] of Object.entries(s.learned as Record<string, unknown>)) {
        if (STORABLE_SPELLS[name] === undefined || !Array.isArray(v)) continue;
        const old = v.filter((x): x is number => isNum(x) && x > 0).map(Math.floor);
        const merged = [...old, ...(this.learned.get(name) ?? [])].slice(-LEARN_SAMPLES);
        if (merged.length > 0) this.learned.set(name, merged);
      }
    }
    if (!Array.isArray(s.active)) return;
    const restored: Stored[] = [];
    for (const raw of s.active as Array<Record<string, unknown>>) {
      if (!raw || typeof raw.name !== 'string' || STORABLE_SPELLS[raw.name] === undefined) continue;
      const tracked = raw.tracked === true;
      const startedAt = isNum(raw.startedAt) ? raw.startedAt : null;
      if (tracked) {
        if (startedAt === null || !isNum(raw.expected) || !isNum(raw.expiresAt) || raw.expiresAt <= now) continue;
        restored.push({ id: 0, name: raw.name, startedAt, expected: raw.expected, expiresAt: raw.expiresAt, tracked });
      } else {
        restored.push({ id: 0, name: raw.name, startedAt, expected: null, expiresAt: null, tracked });
      }
    }
    for (const e of restored) e.id = this.nextId++;
    // Saved (older) entries go first; the lines seen while loading stay.
    this.entries = [...restored, ...this.entries];
  }

  reset(): void {
    this.entries = [];
    this.learned.clear();
    this.pending = [];
    this.lastIntent = null;
  }

  /** Learned samples, seconds (tests). */
  samples(name: string): number[] {
    return [...(this.learned.get(name) ?? [])];
  }

  /** Store attempts in flight (tests). */
  get pendingCount(): number {
    return this.pending.length;
  }
}
