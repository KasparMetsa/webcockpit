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

/** Which unlabeled NPCs the Group pane shows (Inv §2.3, ADR 0016). */
export type GroupNpcMode = 'off' | 'labeled' | 'all';
export const GROUP_NPC_MODES: readonly GroupNpcMode[] = ['off', 'labeled', 'all'];

/** Options → Panes → Group. */
export interface GroupSettings {
  /** Show player allies. */
  showPlayers: boolean;
  /** `off`: no NPCs; `labeled`: labeled NPCs only; `all`: unlabeled ones too. */
  npcMode: GroupNpcMode;
}

/** Longest channel name kept in `CommSettings.filters`. */
export const COMM_FILTER_KEY_MAX = 64;
/** Most entries kept in `CommSettings.filters` (a sanity bound only). */
export const COMM_FILTERS_MAX = 100;

/** Options → Panes → Communication, and the header's channel filters. */
export interface CommSettings {
  /**
   * Channel filters by GMCP channel name, global (not per character).
   * Sparse: a missing channel is enabled. Only `false` entries are kept, so
   * enabling a channel is `{ comm: { filters: { tells: true } } }` and the
   * migration drops the entry.
   */
  filters: Record<string, boolean>;
  /** Show the one-row channel header. */
  showHeader: boolean;
}

export interface Settings {
  /** Schema version of the stored object (bumped only for non-additive changes). */
  version: number;
  appearance: AppearanceSettings;
  panes: Record<PaneId, PaneSettings>;
  layout: LayoutModel;
  /** Selected profile name. */
  profile: string;
  group: GroupSettings;
  comm: CommSettings;
}

/**
 * The settings a log player needs to rebuild the screen (everything but the
 * input line's behaviour and the profile). Recorded in the run capture as a
 * `VIEW` record (ADR 0016).
 */
export type ViewSnapshot = Pick<Settings, 'appearance' | 'panes' | 'layout' | 'group' | 'comm'>;

/** The `ViewSnapshot` of `s` (shares its objects; serialise, do not mutate). */
export function viewSnapshot(s: Readonly<Settings>): ViewSnapshot {
  return { appearance: s.appearance, panes: s.panes, layout: s.layout, group: s.group, comm: s.comm };
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
    layout: defaultLayout(),
    profile: 'default',
    group: { showPlayers: true, npcMode: 'labeled' },
    comm: { filters: {}, showHeader: true },
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
