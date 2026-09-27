// Loading stored settings safely (Inv §3.1 lesson: one default object
// fills missing keys on upgrade). `migrateSettings` accepts anything —
// an old version, a partial object, garbage — and always returns a
// complete, valid `Settings`: missing or invalid values take the
// default, numbers are clamped, enums checked, colours normalised, and a
// damaged layout is repaired so every pane appears exactly once. Keys
// that are no longer part of `Settings` (e.g. `corners`, removed after the
// stage 2 feedback) are dropped silently.

import {
  DEFAULT_PANE_DESIRED,
  DOCK_IDS,
  type DockPane,
  type LayoutModel,
  PANE_COLORS,
  PANE_IDS,
  type PaneId,
} from '../layout/types';
import { normalizeHex } from '../theme/color';
import {
  type AppearanceSettings,
  CURSOR_STYLES,
  FONT_IDS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  PADDING_MAX,
  PADDING_MIN,
  PADDING_STEP,
  type PaneSettings,
  SETTINGS_VERSION,
  type Settings,
  defaultSettings,
} from './types';

/** Largest dock size / desired value kept, in cells (a sanity bound only). */
export const MAX_CELLS = 1000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function oneOf<T>(v: unknown, allowed: readonly T[], dflt: T): T {
  return allowed.includes(v as T) ? (v as T) : dflt;
}

function int(v: unknown, lo: number, hi: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}

function hex(v: unknown, dflt: string): string {
  return normalizeHex(v) ?? dflt;
}

/** A complete, valid appearance from anything. */
export function migrateAppearance(raw: unknown): AppearanceSettings {
  const d = defaultSettings().appearance;
  const a = isObj(raw) ? raw : {};
  const ansiRaw = Array.isArray(a.ansi) ? a.ansi : [];
  let padding = int(a.padding, PADDING_MIN, PADDING_MAX, d.padding);
  padding -= padding % PADDING_STEP;
  return {
    font: oneOf(a.font, FONT_IDS, d.font),
    size: int(a.size, FONT_SIZE_MIN, FONT_SIZE_MAX, d.size),
    padding,
    fg: hex(a.fg, d.fg),
    bg: hex(a.bg, d.bg),
    ansi: d.ansi.map((c, i) => hex(ansiRaw[i], c)),
    cursorStyle: oneOf(a.cursorStyle, CURSOR_STYLES, d.cursorStyle),
    cursorBlink: bool(a.cursorBlink, d.cursorBlink),
  };
}

function migratePanes(raw: unknown): Record<PaneId, PaneSettings> {
  const d = defaultSettings().panes;
  const p = isObj(raw) ? raw : {};
  const out = {} as Record<PaneId, PaneSettings>;
  for (const id of PANE_IDS) {
    const x = isObj(p[id]) ? (p[id] as Obj) : {};
    out[id] = {
      on: bool(x.on, d[id].on),
      color: oneOf(x.color, PANE_COLORS, d[id].color),
      border: bool(x.border, d[id].border),
    };
  }
  return out;
}

/**
 * A valid layout from anything: known dock ids only, sizes clamped, each
 * pane id at most once (first occurrence wins), and any pane missing from
 * every dock appended to the right dock with its default height.
 */
export function migrateLayout(raw: unknown): LayoutModel {
  const d = defaultSettings().layout;
  const docksRaw = isObj(raw) && isObj(raw.docks) ? raw.docks : null;
  if (!docksRaw) return d;
  const seen = new Set<PaneId>();
  const out = { docks: {} } as LayoutModel;
  for (const dock of DOCK_IDS) {
    const x = isObj(docksRaw[dock]) ? (docksRaw[dock] as Obj) : {};
    const panes: DockPane[] = [];
    for (const p of Array.isArray(x.panes) ? x.panes : []) {
      if (!isObj(p)) continue;
      const id = p.id as PaneId;
      if (!PANE_IDS.includes(id) || seen.has(id)) continue;
      seen.add(id);
      panes.push({ id, desired: int(p.desired, 1, MAX_CELLS, DEFAULT_PANE_DESIRED[id]) });
    }
    out.docks[dock] = { size: int(x.size, 1, MAX_CELLS, d.docks[dock].size), panes };
  }
  for (const id of PANE_IDS) {
    if (!seen.has(id)) out.docks.right.panes.push({ id, desired: DEFAULT_PANE_DESIRED[id] });
  }
  return out;
}

/** A complete, valid `Settings` from anything (stored data of any version). */
export function migrateSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const s = isObj(raw) ? raw : {};
  const profile = typeof s.profile === 'string' && s.profile !== '' ? s.profile : d.profile;
  return {
    version: SETTINGS_VERSION,
    appearance: migrateAppearance(s.appearance),
    panes: migratePanes(s.panes),
    layout: migrateLayout(s.layout),
    profile,
  };
}
