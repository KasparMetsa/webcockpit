// One shell per pane (ADR 0016). Kept apart from pane.ts because every
// pane subclass imports PaneShell from there: a table in pane.ts would be
// an import cycle. Plain shells until a stage swaps in its subclass here
// (P1: character, group; P2: comm, ui; stage 5: timers).

import type { PaneId } from '../layout/types';
import { CharacterPane } from './character';
import { GroupPane } from './group';
import { type PaneFactory, PaneShell } from './pane';

export const PANE_FACTORIES: Readonly<Record<PaneId, PaneFactory>> = {
  character: (ctx) => new CharacterPane(ctx),
  timers: (ctx) => new PaneShell(ctx, 'timers'),
  group: (ctx) => new GroupPane(ctx),
  comm: (ctx) => new PaneShell(ctx, 'comm'),
  ui: (ctx) => new PaneShell(ctx, 'ui'),
};
