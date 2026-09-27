# 0016 — Stage 4: GMCP state models and panes

- Status: Accepted
- Date: 2026-09-27

## Context

Stage 4 (spec §2.4, §5 row 4) fills the Character, Group, Comm and UI
panes from GMCP and adds the input-line clock. Three builders work on
it: P0 (foundation) first, then P1 (Character, Group, clock) and P2
(Comm, UI) in parallel. This ADR fixes the contracts between them.
Builders add their own details under "Package notes".

## Decision

### Modules

| Module | Owner | Role |
|---|---|---|
| `src/gmcp/` | P1, P2 | Pure-TS state models, no DOM: `char.ts`, `group.ts`, `bands.ts`, `levels.ts` (P1), `clock.ts` (P1), `comm.ts` (P2). Unit tested in Node. |
| `src/panes/` | P0 context; P1 `character.ts`, `group.ts`; P2 `comm.ts`, `ui.ts` | DOM renderers, one `PaneShell` subclass per pane. |
| `src/panes/shade.ts` | P1 | Shade ramp (Inv §2.1) from the pane's effective background. P2 may use it. |
| `src/ui/input-pane.ts` clock strip | P1 | `.wc-input-clock` already exists. |

Hot-path rule: GMCP handlers only update model state and mark the pane
dirty; the pane re-renders once in the next frame (the context's frame
scheduler). No Preact in pane content; direct DOM, cell grid.

### Pane context (P0)

`PANE_FACTORIES[id]` becomes `(ctx: PaneContext) => PaneShell`, where
`PaneContext` carries at least `doc`, `bus`, `settings` (the store),
`requestFrame`, `sender` (for Comm.Channel.Enable etc. if needed) and a
lazy IndexedDB opener. The cockpit gets the context from `App`.
`PaneShell` gets an `active` flag driven by `conn.state` (`playing` →
active). Inactive Character/Group/Comm blank their content; UI does not.

### Bus additions (P0)

- `ui.message`: `{ kind: 'system' | 'event' | 'state' | 'warn' | 'error',
  name?: string, tag?: string, parts: Array<string | { value: string }> }`.
  `{value}` parts are the bold yellow dynamic values. The UI pane renders
  the prefix (`● SYSTEM:`, `▶ NAME:`, `◆ TAG:`, `⚠ WARN:`, `✖ ERROR:`).
  Any module may emit it.

### Settings (P0)

Global, in the settings store (additive, migrate fills defaults):

- `group: { showPlayers: boolean; npcMode: 'off' | 'labeled' | 'all' }`,
  default `true`, `'labeled'`.
- `comm: { filters: Record<string, boolean>; showHeader: boolean }`,
  sparse filters (missing = enabled), default `{}`, `true`.

### Storage (P0)

- IndexedDB gains a `comm` object store (DB version bump): one record
  per message `{ character, ts, seq, channel, talker, talkerType,
  destination, text }`, raw and unnormalised (formatting at render
  time). Index on `[character, ts]`. Pruned to 7 days at start.
- Clock state: `localStorage` key `wc.clock`, global, last writer wins
  (Inv §2.5 "Persistence").
- UI messages: `sessionStorage` ring (1000) so a reload of the tab keeps
  them; a new tab starts empty (Cockpit: current session only).

### GMCP in the raw capture (P0)

Inbound GMCP is recorded in the run's raw capture as its own line type,
so recorded runs replay with panes. The format keeps Cockpit logs
readable (an old log has no such lines) and `ReplaySocket` turns the
lines back into `IAC SB GMCP … IAC SE`. P0 picks the marker and notes
it below.

### Text-derived state

Wimpy (`Wimpy set to: N` / `Wimpy removed.`) and clock lines (`… of the
Third Age.`, `The current time is …`) are system-store actions in the
script engine, never in the profile.

### Game data

The XP level table (1–100) and TP tables are facts about MUME, written
in our own format in `src/gmcp/levels.ts`. No code from Cockpit.

## Consequences

- Stage 6's log player can replay GMCP-driven panes from runs recorded
  from stage 4 on.
- The pane context is where stage 5's Timers pane plugs in.

## Package notes

(Builders append here.)
