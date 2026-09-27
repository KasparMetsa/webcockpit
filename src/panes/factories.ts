// Pane factories (ADR 0016 "Pane context"): one per pane id. The cockpit
// builds every side pane through this table with the app's PaneContext.
// Plain shells until a stage swaps in its subclass (P1: character, group;
// stage 5: timers). Kept apart from pane.ts, which the subclasses import.

import type { PaneId } from '../layout/types';
import { CommPane } from './comm';
import type { PaneContext } from './context';
import { PaneShell } from './pane';
import { UiPane } from './ui';

/** Builds pane `id` from the context. */
export type PaneFactory = (ctx: PaneContext) => PaneShell;

export const PANE_FACTORIES: Readonly<Record<PaneId, PaneFactory>> = {
  character: (ctx) => new PaneShell(ctx, 'character'),
  timers: (ctx) => new PaneShell(ctx, 'timers'),
  group: (ctx) => new PaneShell(ctx, 'group'),
  comm: (ctx) => new CommPane(ctx),
  ui: (ctx) => new UiPane(ctx),
};
