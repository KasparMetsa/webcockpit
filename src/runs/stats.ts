// Statistics model (Inv §7.3, ADR 0018 "Statistics model"): run events →
// everything the Statistics frame shows that is data, not layout. Pure TS;
// one model for the live chain (ESC → Statistics) and an archived one
// (History → STATS).
//
// - XP now = the last `run_start` XP + the kill/pkill deltas + `xp_loss`
//   after it (Inv §7.3 "Data"); TP likewise with `tp_gained`/`tp_loss`.
//   The first `run_start` is the chain's start.
// - Level is derived from XP now (it follows death-penalty drops), else
//   the last level an event carried.
// - Duration = last event − first event, or `nowUs` − first event live.
// - Sparklines: kill + pkill XP and `tp_gained` TP as gains per hour
//   (`rateSeries` buckets them for a width the renderer picks); losses
//   are not in them.

import { MAX_LEVEL, levelFromXp, xpForLevel } from '../gmcp/levels';
import type { RunEvent } from './events';

export interface KillRow {
  name: string;
  n: number;
  /** Rounded XP per kill. */
  xpPer: number;
  xpTotal: number;
}

export interface PvpRow {
  name: string;
  race: string;
  /** `*Name the Race*` / `*Name*` as the table shows it. */
  label: string;
  n: number;
  xp: number;
}

export interface Milestone {
  us: number;
  kind: 'achievement' | 'level';
  /** `★ <achievement>` / `↑ Reached level N`. */
  text: string;
  level?: number;
}

export interface Gain {
  us: number;
  delta: number;
}

export interface XpRuler {
  startXp: number;
  nowXp: number;
  /** Net gain (negative for a net loss). */
  delta: number;
  /** Level range the bar spans: level(min(start, now)) … level(max) + 1. */
  fromLevel: number;
  toLevel: number;
  /** Cumulative XP at `fromLevel` and at `toLevel`. */
  fromXp: number;
  toXp: number;
}

export interface StatsModel {
  character: string | null;
  level: number | null;
  /** First event, last event (or now when live), µs. */
  startUs: number | null;
  endUs: number | null;
  durationUs: number;
  /** Union of group members minus the character, alphabetical. */
  allies: string[];
  /** Achievements and level-ups in time order. */
  milestones: Milestone[];
  /** Grouped by mob name; sorted by XP total, highest first. */
  kills: KillRow[];
  killTotal: { n: number; xp: number };
  /** Grouped by name and race; sorted by XP, highest first. */
  pvps: PvpRow[];
  pvpTotal: { n: number; xp: number };
  deaths: number;
  xpGains: Gain[];
  tpGains: Gain[];
  xp: { start: number | null; now: number | null };
  tp: { start: number | null; now: number | null };
  ruler: XpRuler | null;
  /** Number of runs (`run_start` events) in the events. */
  runs: number;
}

export interface StatsOptions {
  /** Live: the duration runs to now (µs). */
  nowUs?: number;
  /** The character (else the first `run_start`'s). */
  character?: string;
}

/** Builds the model from a chain's events (any order; sorted by time here). */
export function buildStats(events: readonly RunEvent[], opts: StatsOptions = {}): StatsModel {
  const evs = [...events].map((e, i) => ({ e, i })).sort((a, b) => a.e.us - b.e.us || a.i - b.i).map((x) => x.e);
  let character: string | null = opts.character ?? null;
  let xpStart: number | null = null;
  let xpNow: number | null = null;
  let tpStart: number | null = null;
  let tpNow: number | null = null;
  let level: number | null = null;
  let deaths = 0;
  let runs = 0;
  const allies = new Set<string>();
  const milestones: Milestone[] = [];
  const kills = new Map<string, KillRow>();
  const pvps = new Map<string, PvpRow>();
  const xpGains: Gain[] = [];
  const tpGains: Gain[] = [];
  const killTotal = { n: 0, xp: 0 };
  const pvpTotal = { n: 0, xp: 0 };

  for (const e of evs) {
    switch (e.type) {
      case 'run_start':
        runs++;
        if (character === null && e.character) character = e.character;
        if (e.xp !== undefined) {
          xpStart ??= e.xp;
          xpNow = e.xp;
        }
        if (e.tp !== undefined) {
          tpStart ??= e.tp;
          tpNow = e.tp;
        }
        if (e.level !== undefined) level = e.level;
        break;
      case 'kill': {
        const row = kills.get(e.mobName) ?? { name: e.mobName, n: 0, xpPer: 0, xpTotal: 0 };
        row.n++;
        row.xpTotal += e.xpDelta;
        kills.set(e.mobName, row);
        killTotal.n++;
        killTotal.xp += e.xpDelta;
        if (xpNow !== null) xpNow += e.xpDelta;
        if (e.xpDelta > 0) xpGains.push({ us: e.us, delta: e.xpDelta });
        break;
      }
      case 'pkill': {
        const key = e.name + '\u0000' + e.race;
        const label = '*' + (e.race ? `${e.name} ${e.race}` : e.name) + '*';
        const row = pvps.get(key) ?? { name: e.name, race: e.race, label, n: 0, xp: 0 };
        row.n++;
        row.xp += e.xpDelta;
        pvps.set(key, row);
        pvpTotal.n++;
        pvpTotal.xp += e.xpDelta;
        if (xpNow !== null) xpNow += e.xpDelta;
        if (e.xpDelta > 0) xpGains.push({ us: e.us, delta: e.xpDelta });
        break;
      }
      case 'xp_loss':
        if (xpNow !== null) xpNow += e.xpDelta;
        break;
      case 'tp_gained':
        if (tpNow !== null) tpNow += e.tpDelta;
        tpGains.push({ us: e.us, delta: e.tpDelta });
        break;
      case 'tp_loss':
        if (tpNow !== null) tpNow += e.tpDelta;
        break;
      case 'level_up':
        level = e.level;
        milestones.push({ us: e.us, kind: 'level', text: `↑ Reached level ${e.level}`, level: e.level });
        break;
      case 'achievement':
        milestones.push({ us: e.us, kind: 'achievement', text: `★ ${e.name}` });
        break;
      case 'char_death':
        deaths++;
        if (e.level !== undefined) level = e.level;
        break;
      case 'group_changed':
        for (const m of e.members) allies.add(m);
        break;
    }
  }

  const self = character?.toLowerCase();
  const allyList = [...allies].filter((a) => a.toLowerCase() !== self).sort((a, b) => a.localeCompare(b));
  const killRows = [...kills.values()];
  for (const r of killRows) r.xpPer = Math.round(r.xpTotal / r.n);
  killRows.sort((a, b) => b.xpTotal - a.xpTotal || a.name.localeCompare(b.name));
  const pvpRows = [...pvps.values()].sort((a, b) => b.xp - a.xp || a.label.localeCompare(b.label));

  const startUs = evs.length ? evs[0]!.us : null;
  const lastUs = evs.length ? evs[evs.length - 1]!.us : null;
  const endUs = startUs === null ? null : opts.nowUs !== undefined ? Math.max(opts.nowUs, lastUs!) : lastUs;
  if (xpNow !== null) level = levelFromXp(xpNow);

  return {
    character,
    level,
    startUs,
    endUs,
    durationUs: startUs === null || endUs === null ? 0 : endUs - startUs,
    allies: allyList,
    milestones,
    kills: killRows,
    killTotal,
    pvps: pvpRows,
    pvpTotal,
    deaths,
    xpGains,
    tpGains,
    xp: { start: xpStart, now: xpNow },
    tp: { start: tpStart, now: tpNow },
    ruler: xpStart !== null && xpNow !== null ? xpRuler(xpStart, xpNow) : null,
    runs,
  };
}

/** The XP ruler for a start and a current XP (Inv §7.3 "XP ruler"). */
export function xpRuler(startXp: number, nowXp: number): XpRuler {
  const fromLevel = levelFromXp(Math.min(startXp, nowXp));
  const toLevel = Math.min(MAX_LEVEL, levelFromXp(Math.max(startXp, nowXp)) + 1);
  return {
    startXp,
    nowXp,
    delta: nowXp - startXp,
    fromLevel,
    toLevel,
    fromXp: xpForLevel(fromLevel),
    toXp: xpForLevel(toLevel),
  };
}

/**
 * Gains per hour in `buckets` equal slices of [startUs, endUs]: each gain
 * is added to its slice and the slice total scaled to one hour.
 */
export function rateSeries(gains: readonly Gain[], startUs: number, endUs: number, buckets: number): number[] {
  const n = Math.max(1, Math.floor(buckets));
  const out = new Array<number>(n).fill(0);
  const span = endUs - startUs;
  if (span <= 0) {
    for (const g of gains) out[n - 1]! += g.delta;
    return out;
  }
  for (const g of gains) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(((g.us - startUs) / span) * n)));
    out[i]! += g.delta;
  }
  const perHour = 3600e6 / (span / n);
  return out.map((v) => v * perHour);
}
