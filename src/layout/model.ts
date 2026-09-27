// Layout model operations (ADR 0010 "Docking", ADR 0012). Pure: each
// returns a new LayoutModel (or settings patch) and never mutates its input,
// so the result can go straight into `settings.update`.

import type { PaneSettings } from '../settings/types';
import { DEFAULT_BOTTOM_DESIRED, isSideDock, minContent } from './allocate';
import {
  DEFAULT_PANE_DESIRED,
  DOCK_IDS,
  type DockId,
  type DockPane,
  type LayoutModel,
  type PaneId,
} from './types';

function copy(m: LayoutModel): LayoutModel {
  const docks = {} as LayoutModel['docks'];
  for (const d of DOCK_IDS) docks[d] = { size: m.docks[d].size, panes: m.docks[d].panes.map((p) => ({ ...p })) };
  return { docks };
}

/** The dock that holds `id` and its index there, or null. */
export function findPane(m: LayoutModel, id: PaneId): { dock: DockId; index: number } | null {
  for (const dock of DOCK_IDS) {
    const index = m.docks[dock].panes.findIndex((p) => p.id === id);
    if (index >= 0) return { dock, index };
  }
  return null;
}

/** The desired size a pane gets when it enters `dock` from another axis. */
export function defaultDesired(id: PaneId, dock: DockId): number {
  return isSideDock(dock) ? DEFAULT_PANE_DESIRED[id] : DEFAULT_BOTTOM_DESIRED;
}

/**
 * Moves `id` to `dock` before the pane now at `index` (an index into the
 * target dock's list *including* the moving pane when it is the same dock;
 * `index` = list length appends). Reordering is a move within a dock.
 * `desired` is kept when the axis stays the same (left ↔ right) and reset
 * to the default for the new axis otherwise.
 */
export function movePane(m: LayoutModel, id: PaneId, dock: DockId, index: number): LayoutModel {
  const from = findPane(m, id);
  if (!from) return m;
  const out = copy(m);
  const src = out.docks[from.dock].panes;
  const [entry] = src.splice(from.index, 1) as [DockPane];
  let at = Math.max(0, Math.min(index, out.docks[dock].panes.length + (from.dock === dock ? 1 : 0)));
  if (from.dock === dock && at > from.index) at--;
  if (isSideDock(from.dock) !== isSideDock(dock)) entry.desired = defaultDesired(id, dock);
  out.docks[dock].panes.splice(at, 0, entry);
  return out;
}

/** True when `movePane(m, id, dock, index)` would change nothing. */
export function isNoopMove(m: LayoutModel, id: PaneId, dock: DockId, index: number): boolean {
  const from = findPane(m, id);
  return !from || (from.dock === dock && (index === from.index || index === from.index + 1));
}

/** Sets a dock's width (left/right) or height (top/bottom) in cells (≥ 1). */
export function setDockSize(m: LayoutModel, dock: DockId, size: number): LayoutModel {
  const s = Math.max(1, Math.round(size));
  if (m.docks[dock].size === s) return m;
  const out = copy(m);
  out.docks[dock].size = s;
  return out;
}

/**
 * Sets the desired content size of the given panes (drag end of a resize
 * between panes). Values are clamped to the pane's minimum in its dock.
 */
export function setDesired(m: LayoutModel, sizes: Partial<Record<PaneId, number>>): LayoutModel {
  const out = copy(m);
  let changed = false;
  for (const [id, v] of Object.entries(sizes) as [PaneId, number][]) {
    const at = findPane(out, id);
    if (!at) continue;
    const p = out.docks[at.dock].panes[at.index]!;
    const d = Math.max(minContent(id, at.dock), Math.round(v));
    if (p.desired !== d) {
      p.desired = d;
      changed = true;
    }
  }
  return changed ? out : m;
}

/**
 * Moves the boundary between two neighbouring shown panes by `delta` cells
 * (positive: `a` grows, `b` shrinks). `a` and `b` are their current content
 * sizes; the result keeps both at or above their minimums and their sum
 * constant. Returns the new content sizes.
 */
export function shiftBoundary(
  a: { id: PaneId; size: number },
  b: { id: PaneId; size: number },
  dock: DockId,
  delta: number,
): { a: number; b: number } {
  const minA = minContent(a.id, dock);
  const minB = minContent(b.id, dock);
  const total = a.size + b.size;
  const na = Math.max(minA, Math.min(total - minB, a.size + Math.round(delta)));
  return { a: na, b: total - na };
}

/** The settings patch that toggles `id` on or off. */
export function togglePatch(
  panes: Readonly<Record<PaneId, PaneSettings>>,
  id: PaneId,
): { panes: Partial<Record<PaneId, Partial<PaneSettings>>> } {
  return { panes: { [id]: { on: !panes[id].on } } };
}
