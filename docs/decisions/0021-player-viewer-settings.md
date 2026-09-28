# 0021 — Player viewer settings (stage 8 part A)

- Status: Accepted
- Date: 2026-09-28

## Context

The log player (ADR 0018) and the HTML replay (ADR 0019) lay the cockpit
out from the recorded VIEW records over the viewer's settings, so the
viewer sees what the player saw. The owner (2026-09-28) wants the viewer
to be able to change that: toggle, move and resize panes, pick a font
size and a colour theme, all behind a gear in the control box. The
timers pane's `+` (herblore add-view) must not show in a player.

## Decision

### Viewer overrides

`src/player/viewer.ts` (pure): a `ViewerOverrides` value held by the
`PlayerHost`, never by a player App, so it survives App rebuilds on a
backward seek.

```ts
interface ViewerOverrides {
  font: 'default' | 'small' | 'medium' | 'large';
  theme: 'default' | 'dark' | 'teal' | 'paper' | 'sepia' | 'slate';
  /** Pane on/off chosen by the viewer; absent = recorded. */
  panes?: Partial<Record<PaneId, boolean>>;
  /** The viewer's layout (docks, order, sizes); absent = recorded. */
  layout?: LayoutSettings;
}
```

`applyViewer(draft, o)` runs after every `overlayView` and after the
initial settings copy in `build`, so the recorded VIEW applies first and
the viewer's choices always win (sticky across later VIEW records and
seeks). Reset clears `panes` and `layout`.

- Font: Default = the recorded size; Small 12, Medium 15, Large 18 px.
  The window fit (`playerFontSize`) still shrinks below the choice when
  the grid would be under the cockpit minimum.
- Theme: Default = recorded fg/bg and pane colours. Otherwise bg/fg from
  the presets — dark black/silver, teal teal/silver, paper paper/ink,
  sepia sepia/ink, slate slate/ink — and every pane's `color` is
  `black` (None). Borders stay as recorded; with None they take the
  terminal background's shade, as in the live client.
- Layout: the player cockpit's own drag and resize write to the player
  App's in-memory store; the host notices a change of `layout` (or pane
  toggles) that did not come from a VIEW record and stores it as the
  override.

### UI

A gear in the control box's first row toggles a settings section folded
into the box (box-drawing rows like the rest): Panes (one toggle each),
Font `◄ name ►`, Colours `◄ name ►`, Reset layout. The chrome does not
auto-hide while it is open. Clicks inside the box never reach the stage
(no cursor move). The glyph is `⚙` if the bundled fonts render it,
otherwise a fallback chosen by the builder and noted below.

### Not saved

The overrides live for one open. The HTML replay has no storage by
design (ADR 0019), and the in-app player follows it so both behave the
same. Revisit if the owner asks.

### Players are read-only

Player Apps hide pane affordances that change game or profile state:
the timers `+` corner and the herblore add-view. Other panes are audited
in the build; anything found is listed below.

## Consequences

- One code path for RUN LOG, HTML replay and the reel (the reel shows
  only the parts that make sense there).
- VIEW records keep working as before when the viewer changes nothing.

## Package notes
