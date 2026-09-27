// The settings object (ADR 0010 "Settings"). One typed object with one
// default; `migrateSettings` (migrate.ts) fills missing keys from
// `DEFAULT_SETTINGS` and clamps every value, so stored data from any
// older version loads.

import { type LayoutModel, type PaneColor, type PaneId, defaultLayout } from '../layout/types';
import { DEFAULT_TERM_BG, DEFAULT_TERM_FG, DOS_PALETTE } from '../theme/presets';

/** Bundled font families (public/fonts). */
export type FontId = 'dejavu' | 'jetbrains';
export const FONT_IDS: readonly FontId[] = ['dejavu', 'jetbrains'];

export type CursorStyle = 'block' | 'beam' | 'underline';
export const CURSOR_STYLES: readonly CursorStyle[] = ['block', 'beam', 'underline'];

/** Pane frame corners (Inv §2.1). `auto` resolves to quadrant for both bundled fonts. */
export type CornerStyle = 'auto' | 'quadrant' | 'block';
export const CORNER_STYLES: readonly CornerStyle[] = ['auto', 'quadrant', 'block'];

/** Font size range in CSS px (Inv §10.1). */
export const FONT_SIZE_MIN = 6;
export const FONT_SIZE_MAX = 32;
/** Padding around the whole app in CSS px, even steps (Inv §3.7). */
export const PADDING_MIN = 0;
export const PADDING_MAX = 40;
export const PADDING_STEP = 2;

export interface AppearanceSettings {
  font: FontId;
  /** CSS px, 6–32. */
  size: number;
  /** CSS px around the whole app, 0–40, even. */
  padding: number;
  /** Terminal default foreground, `#rrggbb`. */
  fg: string;
  /** Terminal / page background, `#rrggbb`. */
  bg: string;
  /** ANSI colours 0–15, `#rrggbb` each. */
  ansi: string[];
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
}

export interface PaneSettings {
  /** Shown. Allocation never changes this (ADR 0010). */
  on: boolean;
  color: PaneColor;
  /** Draw the half-block frame. */
  border: boolean;
}

export interface Settings {
  /** Schema version of the stored object (bumped only for non-additive changes). */
  version: number;
  appearance: AppearanceSettings;
  panes: Record<PaneId, PaneSettings>;
  corners: CornerStyle;
  layout: LayoutModel;
  /** Selected profile name. */
  profile: string;
}

export const SETTINGS_VERSION = 1;

/** The single default. Treat as read-only; `defaultSettings()` returns a fresh copy. */
export const DEFAULT_SETTINGS: Readonly<Settings> = deepFreeze(defaultSettings());

/** A fresh, mutable copy of the defaults. */
export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    appearance: {
      font: 'dejavu',
      size: 15,
      padding: 0,
      fg: DEFAULT_TERM_FG,
      bg: DEFAULT_TERM_BG,
      ansi: DOS_PALETTE.slice(),
      cursorStyle: 'beam',
      cursorBlink: true,
    },
    panes: {
      character: { on: true, color: 'black', border: true },
      timers: { on: true, color: 'red', border: true },
      group: { on: true, color: 'green', border: true },
      comm: { on: true, color: 'blue', border: true },
      ui: { on: true, color: 'black', border: true },
    },
    corners: 'auto',
    layout: defaultLayout(),
    profile: 'default',
  };
}

/** A recursive partial, for `SettingsStore.update`. Arrays are replaced whole. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type SettingsPatch = DeepPartial<Settings>;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
