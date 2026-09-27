// History (Inv §7.4): pure helpers for the frame in history.tsx. Sorting,
// the cells, the filter pill window and small formatters. No DOM; unit
// tested.

import type { Session } from '../../runs/stitch';
import { cellLen } from '../kit/nav';

// ------------------------------------------------------------------ sort

export type HistorySortKey = 'char' | 'date' | 'time' | 'dur' | 'expires' | 'rating';

export interface HistorySort {
  key: HistorySortKey;
  /** 1 = ascending (▲), -1 = descending (▼). */
  dir: 1 | -1;
}

/** Newest first (Inv §7.4). */
export const DEFAULT_HISTORY_SORT: HistorySort = { key: 'date', dir: -1 };

/** A header click: the same column flips; a new one starts at its type's default (text ▲, the rest ▼). */
export function nextHistorySort(cur: HistorySort, key: HistorySortKey): HistorySort {
  if (cur.key === key) return { key, dir: cur.dir > 0 ? -1 : 1 };
  return { key, dir: key === 'char' ? 1 : -1 };
}

const minutesOfDay = (us: number): number => {
  const d = new Date(us / 1000);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * Sessions in `sort` order; start time (newest first) breaks ties.
 * Expires and Rating keep saved sessions above the unsaved ones in both
 * directions (Inv §7.4).
 */
export function sortSessions(list: readonly Session[], sort: HistorySort): Session[] {
  const { key, dir } = sort;
  const cmp = (a: Session, b: Session): number => {
    if (key === 'expires' || key === 'rating') {
      if (a.saved !== b.saved) return a.saved ? -1 : 1;
      if (key === 'rating') return (a.rating - b.rating) * dir;
      return ((a.expiresDays ?? 0) - (b.expiresDays ?? 0)) * dir;
    }
    switch (key) {
      case 'char':
        return a.character.localeCompare(b.character) * dir;
      case 'date':
        return (a.startUs - b.startUs) * dir;
      case 'time':
        return (minutesOfDay(a.startUs) - minutesOfDay(b.startUs)) * dir;
      case 'dur':
        return (a.endUs - a.startUs - (b.endUs - b.startUs)) * dir;
    }
  };
  return [...list].sort((a, b) => cmp(a, b) || b.startUs - a.startUs);
}

// ----------------------------------------------------------------- cells

const p2 = (n: number): string => String(n).padStart(2, '0');

/** `2026-09-26` (local). */
export function fmtDate(us: number): string {
  const d = new Date(us / 1000);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** `21:00` (local). */
export function fmtTime(us: number): string {
  const d = new Date(us / 1000);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** A duration as History shows it: `5h02m`, `34m`. */
export function fmtDur(us: number): string {
  const m = Math.max(0, Math.round(us / 60e6));
  return m >= 60 ? `${Math.floor(m / 60)}h${p2(m % 60)}m` : `${m}m`;
}

/** `★★★` for a rating (blank for 0). */
export const stars = (n: number): string => '★'.repeat(Math.max(0, Math.min(5, n)));

export interface Cell {
  text: string;
  class?: string;
}

/** Expires: `Saved` in gold, else `<N> days` (Inv §7.4). */
export function expiresCell(s: Session): Cell {
  if (s.saved || s.expiresDays === null) return { text: 'Saved', class: 'wc-c-accent' };
  return { text: `${s.expiresDays} days`, class: 'wc-st-label' };
}

/** Rating: N gold stars; blank when unsaved or 0. */
export function ratingCell(s: Session): Cell {
  return s.saved && s.rating > 0 ? { text: stars(s.rating), class: 'wc-st-star' } : { text: '' };
}

/** The characters with sessions, alphabetical (the filter pills after `All`). */
export function pillNames(list: readonly Session[]): string[] {
  return [...new Set(list.map((s) => s.character))].sort((a, b) => a.localeCompare(b));
}

// ----------------------------------------------------------------- pills

/** Cells between pills. */
export const PILL_GAP = 1;
/** Edge slots for `‹` / `›` when the row overflows. */
export const PILL_SLOT = 2;

/** A pill is its label with one cell of padding on each side. */
export const pillWidth = (label: string): number => cellLen(label) + 2;

export interface PillWindow {
  /** First and one-past-last visible pill. */
  start: number;
  end: number;
  /** The row does not fit: edge slots are reserved. */
  overflow: boolean;
  /** Pills hidden to the left / right (the arrows). */
  left: boolean;
  right: boolean;
}

const span = (widths: readonly number[], from: number, to: number): number => {
  let w = 0;
  for (let i = from; i < to; i++) w += widths[i]! + (i > from ? PILL_GAP : 0);
  return w;
};

/** One past the last whole pill that fits from `start` in `inner` cells (at least one pill). */
function fitFrom(widths: readonly number[], start: number, inner: number): number {
  let end = start + 1;
  while (end < widths.length && span(widths, start, end + 1) <= inner) end++;
  return Math.min(end, widths.length);
}

/** The largest start that still fills the row to the last pill. */
function maxStart(widths: readonly number[], inner: number): number {
  let s = widths.length - 1;
  while (s > 0 && span(widths, s - 1, widths.length) <= inner) s--;
  return Math.max(0, s);
}

/**
 * The visible pills from `start` in `avail` cells: all of them when they
 * fit (centred, no arrows), else whole pills inside the edge slots.
 */
export function pillWindow(widths: readonly number[], avail: number, start: number): PillWindow {
  const n = widths.length;
  if (n === 0) return { start: 0, end: 0, overflow: false, left: false, right: false };
  if (span(widths, 0, n) <= avail) return { start: 0, end: n, overflow: false, left: false, right: false };
  const inner = Math.max(1, avail - 2 * PILL_SLOT);
  const s = Math.max(0, Math.min(start, maxStart(widths, inner)));
  const end = fitFrom(widths, s, inner);
  return { start: s, end, overflow: true, left: s > 0, right: end < n };
}

/** The start that keeps pill `cursor` visible, moving the window as little as possible. */
export function scrollPills(widths: readonly number[], avail: number, start: number, cursor: number): number {
  let s = pillWindow(widths, avail, start).start;
  if (cursor < s) return cursor;
  while (s < cursor && pillWindow(widths, avail, s).end <= cursor) s++;
  return pillWindow(widths, avail, s).start;
}

/** `‹` / `›`: the window moves one pill (the cursor stays). */
export function panPills(widths: readonly number[], avail: number, start: number, delta: number): number {
  return pillWindow(widths, avail, start + delta).start;
}

// ---------------------------------------------------------------- misc

/** `12 KB`, `3.4 MB`, `1.2 GB`. */
export function fmtBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, n);
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  const txt = u === 0 || v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  return `${txt} ${units[u]}`;
}

/** The storage line under History: `Storage: 1.2 MB of 2.0 GB`. */
export function storageText(est: { usage: number; quota: number } | null): string {
  if (!est) return '';
  return est.quota > 0
    ? `Storage: ${fmtBytes(est.usage)} of ${fmtBytes(est.quota)}`
    : `Storage: ${fmtBytes(est.usage)}`;
}
