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
- Owner decision 2026-09-27: the log player and the HTML replay show
  every pane in the player's layout (not the input pane). The capture
  therefore also records snapshots of the layout and appearance
  settings and the window size in cells, at run start and on change.
  Text-derived pane content (UI messages, timers) is rebuilt from the
  recorded lines, GMCP and sent commands.
- The pane context is where stage 5's Timers pane plugs in.

## Package notes

(Builders append here.)

### P0 — foundation (2026-09-27)

**Pane context** (`src/panes/context.ts`). `PANE_FACTORIES[id]` is
`(ctx: PaneContext) => PaneShell`. App builds the context; the cockpit
passes it to every factory (`cockpit.paneContext`).

```ts
interface PaneContext {
  doc: Document;
  bus: Bus;                                 // gmcp, conn.state, text.line, ui.message …
  settings: SettingsStore;                  // pane colours, group, comm
  cells: CellSource;                        // { get(): {w,h}; subscribe(fn) }
  requestFrame(cb: () => void): void;       // rAF in the app
  sender: Sender;                           // the Session (sendCommand, sendGmcp)
  connState(): ConnState;                   // state now; changes come on the bus
  openDb(): Promise<IDBDatabase>;           // lazy, shared, rejects without IndexedDB
  now(): number;                            // ms, Date.now
  localStorage: Storage | null;             // clock (wc.clock)
  sessionStorage: Storage | null;           // UI message ring
}
createPaneContext({ doc, ...partial })      // test defaults for the rest
```

**PaneShell** (`src/panes/pane.ts`), `new PaneShell(ctx, id, opts?)`:

- `active` follows `conn.state` (`playing` → active); `data-active` on the
  pane element mirrors it. `BLANK_WHEN_INACTIVE` (all but `ui`) or
  `opts.blankWhenInactive` decides whether inactive shows `blank()`.
- `markDirty()` schedules one `render()` in the next frame (coalesced,
  skipped while hidden; showing renders). Size changes, pane colour or
  appearance changes and activation mark dirty by themselves.
- Override `protected render()` (draw `this.cols` × `this.rows` into
  `this.content`), optionally `protected blank()` (default: empty
  content) and `protected onActiveChange(active)` (e.g. reset the model on
  disconnect). `protected own(unsub)` registers bus/settings
  subscriptions for `dispose()`; `protected ctx` is the context.
- Sketch in the file header of `pane.ts`.

**Bus.** `ui.message` as decided (`UiMessage`, `UiMessageKind`,
`UiMessagePart` in `src/core/types.ts`); nobody emits it yet. New for the
capture: `view.settings { json }` (App, at start and when the view part of
the settings changes) and `view.size { cols, rows }` (cockpit relayout).
`gmcp.raw` carries `ts` (frame receive time, µs) when it came through a
Session. `conn.state` carries `replay: true` for every change of a replay
connection.

**Settings.** `group: { showPlayers, npcMode }` and `comm: { filters,
showHeader }` as decided. `comm.filters` keeps only `false` entries
(`migrateComm`); enable a channel by patching it to `true` (the entry is
dropped). `viewSnapshot(s)` picks `appearance, panes, layout, group,
comm` — add a future screen setting to it so the capture records it.

**Comm storage** (`src/gmcp/comm-archive.ts`). DB version 3, store `comm`
(keyPath `seq`, autoIncrement), indexes `character_ts` and `ts`.
`CommArchive.open(ctx.openDb)`, `append(rec) → seq`,
`loadRecent(character, limit = 1000)` (oldest first, last 7 days),
`prune()` (all characters, older than 7 days). `ts` is ms since the epoch;
`talkerType` / `destination` are `null` when absent.

**Capture records** (`src/capture/format.ts`). A line body that starts
with ESC + an upper-case letter is a client record `<ts> ESC<TYPE>
<payload>`; the assembler keeps only SGR (`ESC [ … m`) in `Line.raw`, so
no inbound line can look like one, and Cockpit logs replay unchanged.
`cat -v` shows `^[GMCP Char.Vitals {…}`.

| Record | Payload | When |
|---|---|---|
| `GMCP` | `<Package.Name>[ <json>]`, JSON verbatim (CR/LF → space) | every inbound message except `Core.Ping`; the connection's messages from before the run (≤ 64, e.g. `Comm.Channel.List`, the starting `Char.Name`) are written first |
| `VIEW` | `ViewSnapshot` JSON | run start; 500 ms after a change (last wins); pending change at run end |
| `SIZE` | `{"cols":C,"rows":R}` (cockpit cells) | same as `VIEW` |

`ReplaySocket` turns `GMCP` records into `IAC SB GMCP … IAC SE` at their
timestamps, preceded once by `IAC WILL GMCP`, and skips other records. A
recorded `Char.Name` takes the replay to `playing`, so panes are active
during a replay. The recorder never starts a run for a connection whose
`conn.state` has `replay`, which keeps "replays are never captured".
When the replay ends the connection is `disconnected` and the panes
blank again (UI stays).

**Demo fixture.** `tests/fixtures/gmcp-demo.log` (regenerate with
`node tests/fixtures/gmcp-demo.gen.ts`), ~58 s: login with
`Comm.Channel.List` before `Char.Name`, StatusVars, full Vitals, a group
(ally, labeled MERC, unlabeled dog) with Remove / re-Add under new ids and
the dog promoted by `Group.Update {label}`, partial updates (only
`hp-string`, then only `hp`), a fight with `buffer`/`opponent` and later
`*-hits` only, comm on all ten channels (own messages as `you`, whisper
with destination, ANSI in an enemy yell), `Event.Sun rise`, the `time`
line and `The current time is 8:00am.`, `Wimpy set to: 50`,
`Event.Achieved`, and a level-up from 5 770 000 to 5 795 500 XP (level 25
→ 26 by the XP table). The dev server's fixture route searches
`tests/fixtures` before `$WEBCOCKPIT_FIXTURES`: open
`/?fixture=gmcp-demo.log` (add `&speed=0` for instant, `&speed=2` for
double speed).
