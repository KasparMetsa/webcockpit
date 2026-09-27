// Recorded layout (ADR 0018 "Recorded layout", amended 2026-09-28): the
// player lays the cockpit out on the viewer's window (left of the strip)
// with the recorded VIEW applied over the viewer's settings — layout, pane
// settings and appearance, font size included — so docks keep their
// recorded cell sizes and the game pane flexes to fill the rest, as in the
// live client. The recorded SIZE is not used for the layout. Pure.

import { MIN_VIEW_COLS, MIN_VIEW_ROWS } from '../layout/allocate';
import { nominalCell } from '../theme/cells';
import { type AppearanceSettings, FONT_SIZE_MIN, type Settings, type ViewSnapshot } from '../settings/types';

/**
 * The player's font size in a `w` × `h` px window with `reserveCols` cells
 * kept free on the right (the strip): the appearance's own size, or, when
 * its grid would be below the cockpit's minimum (MIN_VIEW_COLS ×
 * MIN_VIEW_ROWS), the largest smaller size that meets it (FONT_SIZE_MIN
 * when none does).
 */
export function playerFontSize(a: Readonly<AppearanceSettings>, w: number, h: number, reserveCols: number): number {
  for (let size = a.size; size > FONT_SIZE_MIN; size--) {
    const c = nominalCell({ ...a, size });
    if (Math.floor(w / c.w) - reserveCols >= MIN_VIEW_COLS && Math.floor(h / c.h) >= MIN_VIEW_ROWS) return size;
  }
  return FONT_SIZE_MIN;
}

/** The parts of the settings a VIEW record carries. */
export const VIEW_KEYS = ['appearance', 'panes', 'layout', 'group', 'comm', 'timers'] as const;

/** A VIEW payload as a partial snapshot (known keys holding objects), or null. */
export function parseView(json: string): Partial<ViewSnapshot> | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, unknown> = {};
  for (const k of VIEW_KEYS) {
    const part = (v as Record<string, unknown>)[k];
    if (part && typeof part === 'object') out[k] = part;
  }
  return Object.keys(out).length > 0 ? (out as Partial<ViewSnapshot>) : null;
}

/** Replaces the snapshot's parts in `draft` whole (a settings store update; the store migrates it). */
export function overlayView(draft: Settings, view: Partial<ViewSnapshot>): void {
  const d = draft as unknown as Record<string, unknown>;
  for (const k of VIEW_KEYS) {
    const part = view[k];
    if (part !== undefined) d[k] = JSON.parse(JSON.stringify(part)) as unknown;
  }
}
