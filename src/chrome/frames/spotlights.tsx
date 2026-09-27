// Spotlights on the start page (ADR 0019, Inv §7.6). The reel itself plays
// in the player (src/player/spotlight-mode.ts, opened through
// `ChromeServices.openSpotlights`); this file holds the start page side:
// the menu action and the empty-state frames that Spotlights and Credits
// share (title, a centred body, `Any key to return`).

import type { VNode } from 'preact';
import { useGrid } from '../kit/hooks';
import { wrapText } from '../kit/nav';
import { type Nav, useKeys, useNav } from '../kit/stack';
import { Blank, Centered, Page, useBodyRows } from '../kit/widgets';
import type { ChromeServices } from '../kit/hooks';

export type EmptyKind = 'no_data' | 'filtered';

/** Empty-state bodies (our own wording, Inv §7.6). */
export const SPOTLIGHTS_EMPTY: Readonly<Record<EmptyKind, string>> = {
  no_data:
    'No spotlights yet. Play a session, and your highlights (kills, deaths, level-ups and achievements) will be kept here, ready to replay.',
  filtered:
    'Every kind of highlight that could be shown here is switched off. Turn some on in Options → Spotlights to see them.',
};

export const CREDITS_EMPTY: Readonly<Record<EmptyKind, string>> = {
  no_data:
    'No chronicle yet. Your tale is written as you play: kills, deaths, level-ups and achievements each earn a line. Come back once you have made some history.',
  filtered:
    'Your chronicle has entries, but the kinds that would be told are switched off. Turn some on in Options → Spotlights to roll the credits.',
};

/** Keys that are not "a key" for `Any key to return` (bare modifiers). */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/** Title, a body centred on the page, and `Any key to return` (any key or ESC pops). */
export function EmptyStateFrame(p: { title: string; body: string }): VNode {
  const nav = useNav();
  const { cols } = useGrid();
  const rows = useBodyRows();
  useKeys((e) => {
    if (MODIFIERS.has(e.key)) return false;
    nav.pop();
    return true;
  });
  const lines = wrapText(p.body, Math.max(20, Math.min(cols - 8, 64)));
  const top = Math.max(0, Math.floor((rows - lines.length) / 2) - 1);
  return (
    <Page title={p.title} footer={['Any key to return']}>
      <div class="wc-empty-state" onClick={() => nav.pop()}>
        <Blank n={top} />
        {lines.map((l) => (
          <Centered text={l} class="wc-c-body" />
        ))}
      </div>
    </Page>
  );
}

/**
 * Start page → Spotlights: loads the reel and plays it, or pushes the empty
 * state. `busy` guards against a second activation while it loads.
 */
let busy = false;
export async function startSpotlights(nav: Nav, services: ChromeServices): Promise<void> {
  if (busy) return;
  if (!services.openSpotlights) return nav.flash('Spotlights are not available here.', 'fail');
  busy = true;
  try {
    nav.flash('Loading spotlights…');
    const empty = await services.openSpotlights();
    if (empty) nav.push(<EmptyStateFrame title="Spotlights" body={SPOTLIGHTS_EMPTY[empty]} />);
  } catch (err) {
    console.error('WebCockpit: Spotlights could not open', err);
    nav.flash('Spotlights could not be loaded.', 'fail');
  } finally {
    busy = false;
  }
}
