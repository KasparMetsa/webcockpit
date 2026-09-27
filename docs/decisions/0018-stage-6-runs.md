# 0018 — Stage 6: run events, the run library, History, Statistics and the log player

- Status: Accepted
- Date: 2026-09-27

## Context

Stage 6 (spec §2.8, §5 row 6) turns the raw capture of ADR 0008 and
0016 into runs the owner can browse, rate, keep, back up and watch. Three
builders work on it: P0 (foundation) first, then P1 (History,
Statistics, Exit rating) and P2 (log player) in parallel. This ADR fixes
the contracts between them. Builders add their details under "Package
notes".

## Decision

### Modules

| Module | Owner | Role |
|---|---|---|
| `src/runs/events.ts` | P0 | `RunEvent` types and `RunEventDeriver`: bus in, events out. Pure TS, injected clock and timer. |
| `src/runs/store.ts` | P0 | DB v5 stores and record shapes (extends `src/capture/store.ts`). |
| `src/runs/library.ts` | P0 | `RunLibrary`: sessions, chain loading, save/rate, delete, retention sweep, backup/restore, storage estimate. |
| `src/runs/stitch.ts` | P0 | Pure chain stitching and session summaries. |
| `src/runs/stats.ts` | P0 | Pure aggregation: events → `StatsModel` (tables, sparklines, XP ruler data). |
| `src/runs/live.ts` | P0 | `LiveRuns` on `App`: the current run's events in memory, save/rate of the live chain. |
| `src/chrome/frames/history*.tsx`, `statistics.tsx` | P1 | History, Rate, Delete modal, Statistics (one renderer, two surfaces). |
| `src/player/*` | P2 | Log player: timeline, controllable replay, view, chrome. |

No DOM outside `src/chrome`, `src/player` view files and `src/app`.

### Run lifecycle

- The raw capture keeps its lifecycle (ADR 0008): a run starts at
  `playing` and is sealed when the connection leaves it.
- `run_start` is written at the first `Char.Vitals` of the run (Inv
  §7.2), with the baseline `level`, `xp`, `tp` when known and
  `previousRunId` = the character's latest sealed run at that moment
  (after orphan sealing).
- **Too short:** a run sealed without a `run_start` is deleted (meta,
  chunks, events). It had nothing but a login.
- `run_end` on a clean seal; `orphan_close` when an orphan is sealed at
  start-up (its `us` is the seal time; `endedUs` stays the last chunk's
  `lastUs` as today).
- Events are buffered in memory and written on the recorder's promise
  chain with the chunks (every 2 s, on pagehide, at seal). Replays never
  write events (the recorder never has a run for them).

### Run events

```ts
type RunEvent =
  | { type: 'run_start'; us: number; character: string; level?: number; xp?: number; tp?: number; previousRunId?: string; schema: 1 }
  | { type: 'run_end'; us: number }
  | { type: 'orphan_close'; us: number }
  | { type: 'level_up'; us: number; level: number }
  | { type: 'kill'; us: number; logUs: number; mobName: string; xpDelta: number }
  | { type: 'pkill'; us: number; logUs: number; name: string; race: string; xpDelta: number }
  | { type: 'tp_gained'; us: number; tpDelta: number }
  | { type: 'xp_loss'; us: number; xpDelta: number }
  | { type: 'tp_loss'; us: number; tpDelta: number }
  | { type: 'char_death'; us: number; logUs: number; level?: number }
  | { type: 'achievement'; us: number; name: string }
  | { type: 'group_changed'; us: number; members: string[] };
```

- `us` is µs since the epoch on the capture clock (the frame receive
  time of the line or GMCP message that caused it; the fold time for
  kill/pkill). `logUs` is the `Line.ts` of the death line itself, so the
  player and stage 7 can find the exact `.log` line without content
  matching (Inv §7.2 browser note).
- Field semantics follow Inv §7.2 exactly (kill fold 500 ms, even split
  with remainder to the last, negative XP resets the fold anchor, mob
  name with article and the trailing ` (LABEL)` stripped, pkill `name` up
  to ` the `, `race` = `"the Orc"` or `""`, level-ups only upwards, level
  derived from XP, group members = player allies in join order, first
  `Group.Set` before the baseline ignored). Unknown event types are
  ignored by readers. Additive changes do not bump `schema`.
- Death lines come from system rules (Inv §8.3: pc_death prio 3 wins over
  mob_death prio 4 on the same line; char_death), installed through the
  same `SystemRules` as the timers.
- The deriver runs in every App, replays included (the player's UI pane
  rebuilds the `◆` lines); only the recorder persists what it emits.
- **UI lines:** attributed kills, pkills and deaths get a `◆` line in the
  UI pane, worded as Cockpit's `KILL` / `PKILL` / `DEATH` announces
  (`/home/ole/MUME/docs/events.md`, `ui-pane.md`; P0 records the exact
  forms below).

### Storage (DB version 5)

- `runs` records gain optional fields (absent on older records = the
  default): `saved: boolean` (false), `rating: number` 0–5 (0),
  `savedUs: number | null`, `summary: RunSummary | null`.
- `RunSummary` is kept current by the writer: `{ startUs (run_start),
  lastEventUs, level?, xp?, tp?, kills, pkills, deaths, previousRunId? }`.
  History lists from `runs` alone; it never reads events or chunks.
- New store `runEvents`, keyPath `['runId', 'seq']`, record
  `{ runId, seq, event: RunEvent }`.
- Chunks stay uncompressed (ADR 0008).

### Sessions (stitching)

- A run joins its predecessor's chain when its `summary.previousRunId`
  names that run and `startUs − predecessor.lastEventUs < 3600 s`
  (Inv §7.2). Runs without a summary (stage 1–5 captures) are chains of
  their own; their `startUs` is the meta's.
- `Session = { id (first runId), character, runs: RunMeta[] (oldest
  first), startUs, endUs, saved, rating, hasLog, expiresDays, level? }`.
  `saved` = any run saved; `rating` = max over saved runs; `hasLog` =
  any run with `bytes > 0`; `expiresDays` = ceil((oldest run start + 14 d
  − now) / 1 d), floor 0; null when saved.
- The active run (unsealed, this tab's) is never listed in History.

### RunLibrary (P0; P1 and P2 use it)

```ts
class RunLibrary {
  static open(factory?: IDBFactory): Promise<RunLibrary>;
  listSessions(nowUs: number): Promise<Session[]>;       // newest first
  characters(): Promise<string[]>;                       // with sealed runs, alphabetical
  events(runIds: string[]): Promise<RunEvent[]>;         // in time order
  chainLog(runIds: string[]): Promise<Array<{ meta: RunMeta; text: string }>>;
  save(session: Session, rating?: number): Promise<void>;  // every run in the chain
  remove(session: Session): Promise<void>;               // meta, chunks, events
  sweep(nowUs: number): Promise<number>;                 // retention, see below
  backup(): Promise<Blob>;                               // all runs
  restore(file: Blob): Promise<{ added: number; skipped: number }>;
  estimate(): Promise<{ usage: number; quota: number } | null>;
}
```

- `save` with no rating keeps each run's rating; with a rating sets it
  on every run of the chain. Un-save does not exist; Delete is the only
  way out (Inv §7.8).
- **Retention:** `sweep` seals orphans whose lock is free, then deletes
  every unsaved sealed run whose start is older than 14 days. It runs
  when the start page first shows, under the Web Lock
  `webcockpit-sweep` (`ifAvailable`, so only one tab sweeps). Errors are
  silent.
- **Backup** file `webcockpit-runs-YYYY-MM-DD.jsonl.gz`: gzip
  (`CompressionStream`) of JSON lines — a header
  `{"type":"webcockpit-runs","schema":1,"exportedUs":…}`, then per run a
  `run` line (the meta), its `event` lines and its `chunk` lines.
  `zcat` reads it. **Restore** adds runs whose `runId` is not present and
  skips the rest; a bad file is rejected before anything is written.

### LiveRuns (P0; P1 uses it)

`app.runs: LiveRuns` — `current(): { runId: string; events: RunEvent[] }
| null` (null before `run_start`), `subscribe(fn)`, `chain(): Promise<
Session | null>` (the live run plus its sealed predecessors in the
chain), `saveChain(rating: number)` (Inv §4.6: rating > 0 saves the
chain with it; 0 re-saves an already saved chain keeping its rating and
never creates a save), and the anchor rule for a disconnected tab (the
latest run that started in this tab).

### Statistics model (P0; P1 renders it)

`buildStats(events, opts) → StatsModel`: allies (union of group members
minus self, alphabetical), achievements + level-ups in time order, kill
and pvp tables grouped by name with totals, XP/h and TP/h series (gains
only) for the sparklines, XP ruler data (start, now, level range),
duration, level. Everything in Inv §7.3 that is data, not layout.

### Log player (P2)

- **Entry:** History → RUN LOG or Enter on a row calls
  `ChromeServices.openPlayer(session)`; the shell hides the start page
  (its frame stack and History state intact), shows the player, and
  shows the start page again on ESC. The player is not reachable while a
  live session runs in the tab (History is a start page feature).
- **Engine:** a player `App` of its own (a new instance per open,
  disposed on exit; P2 adds `App.dispose()`), offline, with no profile
  (raw game text, as Cockpit's player and the stage 7 HTML replay), fed
  by a controllable replay socket. It never captures and never reads or
  writes per-character archives (already true for replays).
- **Replay clock:** the player's `GameState`/timers `now()` and the
  scheduler for its trackers follow log time (ADR 0017 "Time"), so bars,
  countdowns and the kill fold are right at any speed and after a seek.
  Gaps longer than 10 s in the log collapse to 0 wall time (Inv §7.5);
  log time still jumps by the real gap.
- **Chain:** the runs of the session play as one timeline; the header
  shows `Run X of Y`. Between runs the player's connection passes
  through `disconnected` so the panes behave as they did live.
- **Speeds:** 0.25×, 0.5×, 1×, 2×, 4×, 8× (keys `1`–`6`, and in the
  control box). Default 1×.
- **Seek:** forward = fast-forward at speed 0 without painting until the
  target; backward = rebuild the player App and fast-forward from the
  chain start. Target: a seek to the end of a 5 h run in ≤ 2 s. If that
  is missed, P2 adds checkpoints or a faster path and notes it here.
- **Recorded layout:** the player's settings are the viewer's current
  settings overlaid with the latest `VIEW` record at the playhead (an
  in-memory store, never saved). The grid is laid out at the recorded
  `SIZE` cols × rows; the font size is chosen so that grid fits the
  window (centred). Runs without `VIEW`/`SIZE` use the current settings
  and the window. The input pane is not shown.
- **Echo:** replayed commands are echoed in the output the way live
  sends are (closes the stage 5 open issue; applies to `#replay` and
  fixtures too).
- **Chrome** (Inv §7.5): header, 2-column strip with played/remaining
  and the gold half-block playhead (click/drag seeks), K/D/A/L markers
  from the chain's events at `logUs ?? us` (click seeks), control box
  (`◄◄ Rewind`, `► Play` / `▌▌ Pause`, speed, `MM:SS / MM:SS`),
  auto-hide after 6 s in play, pause cursor line (Space resumes from
  it), keys as in Inv §7.5, auto-pause at the end.
- The renderer that turns a chain into timed screen updates is kept
  separate from the in-app chrome, so stage 7's HTML replay can reuse it.

### Shared seams

- `ChromeServices` gains `runs: () => Promise<RunLibrary>` and
  `openPlayer(session: Session): void` (P1 adds the fields and the calls;
  P2 implements `openPlayer` in the shell through `src/app/player-host.ts`,
  with a minimal hook in `shell.ts`).
- The ESC menu gets `Statistics` (only while `app.runs.current()` is not
  null) and the Exit confirm gets the rating row; both are P1's.
- Start page: History becomes active (P1). Spotlights and Credits stay
  dim (stage 7).

## Rationale

- Summaries on the run record keep History cheap with months of runs.
- `logUs` on death events removes Cockpit's ADR 0135 content matching.
- A full App per player instance reuses every pane, tracker and parser
  unchanged, so the player shows exactly what the live client showed;
  rebuild-on-backward-seek is simple and, at ~3 MB/s replay speed,
  fast enough for typical runs.
- No profile in the player keeps it deterministic and identical to the
  shareable HTML replay; the owner can ask otherwise after testing.

## Consequences

- Stage 7 reads the same library and events for Spotlights and Credits,
  and reuses the player's renderer for the HTML replay.
- Runs captured in stages 1–5 have no events: they list, play and back
  up, but show empty statistics and no markers.

## Package notes

(Builders append here.)
