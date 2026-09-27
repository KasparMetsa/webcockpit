// The real trackers of the hub (ADR 0017; P1 fills this in): affects,
// stored spells, blinds, charms, herblores, with the shared cast queue and
// the stat/info reconcile wired between them. `TimersHub` calls
// `createTrackers(host)` once, unless its options give another factory.

import type { Tracker, TrackerHost } from './tracker';

/** The trackers, in the order the hub calls them. */
export function createTrackers(_host: TrackerHost): Tracker[] {
  return [];
}
