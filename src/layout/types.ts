// Layout data types (ADR 0010 "Docking"). Types and the default model
// only: allocation lives in src/layout/allocate.ts, model operations in
// src/layout/model.ts (ADR 0012). The settings store persists a
// `LayoutModel` as plain data and repairs a damaged one on load
// (src/settings/migrate.ts).

/** The framed side panes, in Cockpit's order (Inv §2.1). */
export type PaneId = 'character' | 'timers' | 'group' | 'comm' | 'ui';

/** Every pane id in Cockpit's default stack order. */
export const PANE_IDS: readonly PaneId[] = ['character', 'timers', 'group', 'comm', 'ui'];

/** Frame labels (Inv §2.1 "Pane frame"). */
export const PANE_LABELS: Readonly<Record<PaneId, string>> = {
  character: 'Character',
  timers: 'Timers',
  group: 'Group',
  comm: 'Comm',
  ui: 'UI',
};

/**
 * Pane tint names (Inv §10.4). `black` is stored but shown as "None": the
 * pane has no fill of its own and sits on the terminal background.
 */
export type PaneColor = 'black' | 'red' | 'green' | 'blue' | 'grey' | 'orange' | 'purple';

/** Every tint, in the column order of the Options → Panes grid. */
export const PANE_COLORS: readonly PaneColor[] = [
  'black', 'red', 'green', 'blue', 'grey', 'orange', 'purple',
];

/** The three docks around the game pane. */
export type DockId = 'left' | 'right' | 'bottom';

export const DOCK_IDS: readonly DockId[] = ['left', 'right', 'bottom'];

/** One pane's place in a dock. */
export interface DockPane {
  id: PaneId;
  /**
   * Wanted content size in cells: rows in a left/right dock, columns in
   * the bottom dock. Allocation may give less (or more, to the
   * highest-priority pane); drag end stores the new value here.
   */
  desired: number;
}

/** One dock. */
export interface DockState {
  /** Width in cells (left/right) or height in cells (bottom). */
  size: number;
  /** Panes in stack order (top→bottom, or left→right for the bottom dock). */
  panes: DockPane[];
}

/**
 * The whole pane layout. Every `PaneId` appears in exactly one dock
 * (whether it is on or off: on/off is `Settings.panes[id].on`), so a pane
 * that is switched back on returns to where it was.
 */
export interface LayoutModel {
  docks: Record<DockId, DockState>;
}

/** Default desired content rows per pane (Cockpit's default heights). */
export const DEFAULT_PANE_DESIRED: Readonly<Record<PaneId, number>> = {
  character: 9,
  timers: 8,
  group: 6,
  comm: 10,
  ui: 5,
};

/** Default width of the right (and left) dock in cells. */
export const DEFAULT_SIDE_DOCK_SIZE = 33;
/** Default height of the bottom dock in cells. */
export const DEFAULT_BOTTOM_DOCK_SIZE = 10;

/** A fresh copy of Cockpit's default layout (ADR 0010). */
export function defaultLayout(): LayoutModel {
  return {
    docks: {
      left: { size: DEFAULT_SIDE_DOCK_SIZE, panes: [] },
      right: {
        size: DEFAULT_SIDE_DOCK_SIZE,
        panes: PANE_IDS.map((id) => ({ id, desired: DEFAULT_PANE_DESIRED[id] })),
      },
      bottom: { size: DEFAULT_BOTTOM_DOCK_SIZE, panes: [] },
    },
  };
}
