# 0004 — Stack and rendering

- Status: Accepted
- Date: 2026-09-27

## Decision

- **Stack.** TypeScript and Vite produce a static build.
  - Hot path (telnet, parser, engines, output pane): plain TypeScript
    with direct DOM work.
  - UI chrome (launcher, menus, forms): Preact.
  - Editor view: CodeMirror 6.
  - Tests: Vitest and Playwright.
  - All licences are compatible with the GPL (ADR 0001).
- **Output rendering:**
  - Lines are appended to the DOM, coalesced to at most one paint per
    animation frame.
  - A fixed scrollback is enforced by recycling nodes.
  - There is no smooth scrolling.
- **Layout.** All TUI chrome sits on a measured character-cell grid.
- **Docking** is our own implementation.

## Rationale

The DOM is fast enough for MUD line volumes when paints are batched. It
also gives selection, copy and accessibility for free. xterm.js would
impose terminal emulation that a line-oriented MUD client does not need.
Preact is kept off the hot path.

## Revisit if

The spec §1.3 benchmark fails. The fallback is a canvas cell-grid
renderer for the output pane only.
