// Recorded layout (ADR 0018 "Recorded layout"): the player lays the
// cockpit out at the recorded SIZE (cols × rows) with the largest font size
// whose cell grid fits the window, and applies the recorded VIEW over the
// viewer's settings. Pure.

import { nominalCell } from '../theme/cells';
import {
  type AppearanceSettings,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  type Settings,
  type ViewSnapshot,
} from '../settings/types';

/** The largest font size (setting units) at which cols × rows cells fit in w × h px. */
export function fitFontSize(a: Readonly<AppearanceSettings>, cols: number, rows: number, w: number, h: number): number {
  for (let size = FONT_SIZE_MAX; size > FONT_SIZE_MIN; size--) {
    const c = nominalCell({ ...a, size });
    if (cols * c.w <= w && rows * c.h <= h) return size;
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
