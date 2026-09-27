// Character state from GMCP `Char.*` (Inv §2.2, §8.2). Pure TS, no DOM.
//
// - `Char.Name {name, fullname}`: the character. A different name starts a
//   new session (the XP/TP session anchors are dropped).
// - `Char.StatusVars`: race (TP scaling), level (fallback only), names.
// - `Char.Vitals`: a flat object merged key by key. A key that is absent
//   keeps its value; JSON `null` sets it to null ("off" for the toggles).
//   `wimpy` is also set from the text lines `Wimpy set to: N` /
//   `Wimpy removed.` (system rules, `setWimpy`).
//
// Session anchors: the first `xp` / `tp` seen after `reset()` or a new
// character is the session start; the bars split there (levels.ts).
// `reset()` (a new connection, a live disconnect) clears everything, so the
// pane starts from `—` until GMCP arrives (Inv §2.1 "Inactive panes").

import { type SessionBar, levelFromXp, tpBar, xpBar } from './levels';

export type Toggle = 'sneak' | 'ride' | 'climb' | 'swim';
export const TOGGLES: readonly Toggle[] = ['sneak', 'ride', 'climb', 'swim'];

/** Gauge steps, low → high (Inv §2.2 "Rows 4–9"). */
export const MOOD_STEPS: readonly string[] = ['wimpy', 'prudent', 'normal', 'brave', 'aggressive', 'berserk'];
export const ALERTNESS_STEPS: readonly string[] = ['normal', 'careful', 'attentive', 'vigilant', 'paranoid'];
export const POSITION_STEPS: readonly string[] = ['sleeping', 'resting', 'sitting', 'standing'];

/** What the Character pane draws. */
export interface CharView {
  /** Capitalised `Char.Name` name, or null when unknown. */
  name: string | null;
  /** Level from XP (StatusVars level when XP is unknown), or null. */
  level: number | null;
  /** XP bar through the level, or null while XP is unknown. */
  xp: SessionBar | null;
  /** TP bar through the level, or null while XP or TP is unknown. */
  tp: SessionBar | null;
  toggles: Record<Toggle, boolean>;
  /** Lower-case values, or null when unknown. */
  mood: string | null;
  alertness: string | null;
  position: string | null;
  wimpy: number | null;
  maxhp: number | null;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const lower = (v: unknown): string | null => {
  const s = str(v)?.trim();
  return s ? s.toLowerCase() : null;
};

/** `rasta` → `Rasta`. */
export const capitalise = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export class CharModel {
  /** `Char.Name` name as sent, or null. */
  name: string | null = null;
  fullname: string | null = null;
  /** `Char.StatusVars`, merged (absent keys keep their value). */
  readonly statusVars: Map<string, unknown> = new Map();
  /** `Char.Vitals`, merged; a present `null` is kept as null. */
  readonly vitals: Map<string, unknown> = new Map();
  /** XP / TP at session start, or null before the first value. */
  anchorXp: number | null = null;
  anchorTp: number | null = null;
  /** Bumped on every change (renderers may compare). */
  version = 0;

  /**
   * Applies one GMCP message (`pkg` as sent, matched case-insensitively).
   * Returns true when the state changed.
   */
  apply(pkg: string, data: unknown): boolean {
    switch (pkg.toLowerCase()) {
      case 'char.name':
        return this.applyName(data);
      case 'char.statusvars':
        return this.merge(this.statusVars, data);
      case 'char.vitals': {
        const changed = this.merge(this.vitals, data);
        this.anchor();
        return changed;
      }
    }
    return false;
  }

  private applyName(data: unknown): boolean {
    if (!isObj(data)) return false;
    const name = str(data.name);
    const fullname = str(data.fullname);
    if (name !== null && this.name !== null && name.toLowerCase() !== this.name.toLowerCase()) {
      // Another character on this connection: a new session.
      this.statusVars.clear();
      this.vitals.clear();
      this.anchorXp = null;
      this.anchorTp = null;
    }
    if (name !== null) this.name = name;
    if (fullname !== null) this.fullname = fullname;
    this.version++;
    return true;
  }

  private merge(into: Map<string, unknown>, data: unknown): boolean {
    if (!isObj(data)) return false;
    let changed = false;
    for (const [k, v] of Object.entries(data)) {
      if (into.has(k) && Object.is(into.get(k), v)) continue;
      into.set(k, v);
      changed = true;
    }
    if (changed) this.version++;
    return changed;
  }

  private anchor(): void {
    if (this.anchorXp === null) this.anchorXp = num(this.vitals.get('xp'));
    if (this.anchorTp === null) this.anchorTp = num(this.vitals.get('tp'));
  }

  /** Wimpy from the text lines (`Wimpy removed.` is 0). */
  setWimpy(n: number | null): boolean {
    if (this.vitals.get('wimpy') === n) return false;
    this.vitals.set('wimpy', n);
    this.version++;
    return true;
  }

  /** Forgets everything (new connection, live disconnect). */
  reset(): void {
    this.name = null;
    this.fullname = null;
    this.statusVars.clear();
    this.vitals.clear();
    this.anchorXp = null;
    this.anchorTp = null;
    this.version++;
  }

  /** The derived view for the pane. */
  view(): CharView {
    const v = this.vitals;
    const xp = num(v.get('xp'));
    const tp = num(v.get('tp'));
    const race = str(this.statusVars.get('race'));
    const level = xp !== null ? levelFromXp(xp) : num(this.statusVars.get('level'));
    return {
      name: this.name ? capitalise(this.name) : null,
      level,
      xp: xp !== null ? xpBar(xp, this.anchorXp) : null,
      tp: xp !== null && tp !== null ? tpBar(xp, tp, this.anchorTp, race) : null,
      toggles: {
        sneak: isFlag(v.get('sneak'), 's'),
        ride: isOn(v.get('ride')),
        climb: isFlag(v.get('climb'), 'c'),
        swim: v.get('swim') === true,
      },
      mood: lower(v.get('mood')),
      alertness: lower(v.get('alertness')),
      position: lower(v.get('position')),
      wimpy: num(v.get('wimpy')),
      maxhp: num(v.get('maxhp')),
    };
  }
}

/** `s`/`S` (sneak) or `c`/`C` (climb) → on; null, absent, anything else → off. */
function isFlag(v: unknown, letter: string): boolean {
  return typeof v === 'string' && v.toLowerCase() === letter;
}

/** Truthy → on (ride: a mount name or true); null, false, '', 0 → off. */
function isOn(v: unknown): boolean {
  return v !== null && v !== undefined && v !== false && v !== '' && v !== 0;
}
