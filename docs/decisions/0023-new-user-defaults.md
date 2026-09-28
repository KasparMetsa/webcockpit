# 0023 — New-user defaults: None tints, even right dock

- Status: Accepted
- Date: 2026-09-28

## Context

The owner (2026-09-28) wants a first-time user to start with: black
background, the map floating over the game pane, the other panes shown
in the right dock and spread evenly over its height, borders on, and
every pane tinted "None". Until now the defaults followed Cockpit:
Timers red, Group green, Comm blue, and fixed desired heights 9/8/6/10/5
with the leftover rows given to the UI pane (Inv §2.1).

## Decision

- `defaultSettings()`: every pane `color: 'black'` (shown as "None").
  Background (`#000000`), borders and the floating map are unchanged.
- `defaultLayout()`: Character keeps `desired: 9` (its content needs nine
  rows); Timers, Group, Comm and UI get `EVEN_SHARE_DESIRED` (200 rows).
  No window reaches that, so `allocateAxis` always runs in `scaled` mode:
  Character is reserved first, the four others share the rest in
  proportion to `desired − min`, which is equal for them, so they differ
  by at most one row. The allocation algorithm itself is unchanged.
- The first drag of a boundary already freezes every pane in the dock to
  its shown size (`setDesired` at drag start), so from then on the user's
  heights are concrete and behave as before.
- The map's default float (`AUTO_FLOAT`, ADR 0020) shrinks from 50 % × 35 %
  to 25 % × 27 % of the window, still at the game pane's top-right corner
  (owner, 2026-09-28: the larger one covered too much of the game text).
- `DEFAULT_PANE_DESIRED` stays: it still sizes a pane that enters a side
  dock or starts floating.

## Consequences

- Only settings created fresh change (new users, Options → Reset layout).
  Stored settings keep their colours and heights. The map size also
  applies to existing users whose map was never moved or resized
  (`auto` is recomputed on every layout).
- A pane toggled off in the default layout gives its rows to the other
  shared panes, not to one pane by priority.
- Tests that need Cockpit's fixed heights pin them explicitly.
