# 0017 — Stage 5: timers, trackers and their persistence

- Status: Accepted
- Date: 2026-09-27

## Context

Stage 5 (spec §2.4 Timers row, §5 row 5) adds the Timers pane and the
trackers that feed it (Inv §2.6, §8.3). Three builders work on it: P0
(foundation) first, then P1 (data + trackers) and P2 (pane + options) in
parallel. This ADR fixes the contracts between them. Builders add their
details under "Package notes".

## Decision

### Modules

| Module | Owner | Role |
|---|---|---|
| `src/timers/entry.ts` | P0 | Timed-entry type, bar fill (round half up), countdown text, sort orders. Pure. |
| `src/timers/hub.ts` | P0 skeleton, P1 fills | `TimersHub`: owns the trackers, the clock, persistence and the view. |
| `src/timers/archive.ts` | P0 | IndexedDB `timers` store, one record per character. |
| `src/timers/data/*.ts` | P1 | Affects, storable spells, herblore catalogue. Our own format. |
| `src/timers/{affects,stored,castq,blinds,charm,herblore,reconcile}.ts` | P1 | Trackers, pure TS, unit tested in Node. |
| `src/panes/timers.ts` | P2 | `TimersPane` (a `PaneShell`); pure layout function unit tested. |
| `src/chrome/frames/options-timers.tsx` | P2 | Options → Panes → Timers. |

Pure models, no DOM outside `src/panes` and `src/chrome`. The hot path
rule of ADR 0016 holds: trackers update state and notify; the pane
renders at most once per frame, plus the 1 Hz second-aligned tick.

### Hub (P0 defines, P1 implements the trackers behind it)

`GameState` gains `timers: TimersHub` and the part `'timers'`, so panes
reach it as `ctx.game.timers` and it keeps running while the pane is
hidden (Inv §2.6: trackers run whether or not the pane shows).

```ts
type TimerGroup = 'spell' | 'buff' | 'debuff' | 'stored' | 'blind' | 'charm';

interface TimerCell {             // one entry as the pane draws it
  id: string;                     // stable across updates
  name: string;                   // display name (pane upper-cases)
  group: TimerGroup;
  startedAt: number | null;       // ms
  expiresAt: number | null;       // ms; null = indefinite / untracked / permanent
  expected: number | null;        // ms, the duration the bar drains over
  tracked: boolean;               // false: untracked affect / stored spell
}

interface TimersView {
  cells: Record<TimerGroup, TimerCell[]>;   // already sorted (Inv §2.6.1)
  herbs: Array<{ key: string; name: string; active: boolean }>; // catalogue order
}

class TimersHub {
  view(now: number): TimersView;
  addHerb(key: string): void;
  removeHerb(key: string): void;
  dropCharm(id: string): void;
  installRules(system: SystemRules): void;   // P1's actions, system store
  subscribe(fn: () => void): () => void;
}
```

Herblore phases appear as `buff`/`debuff` cells. `view()` is cheap
enough to call once per frame.

### Time

The hub takes `now()` (ms) and a timer factory from `GameState`, never
`Date.now`/`setInterval` directly. Pruning ticks (10 s affects, 2 s
blinds/charms) run from one hub interval. Stage 6's log player can then
drive trackers at replay time. A replay at speed 1 uses the wall clock
as today.

### Input

Trackers need the sent commands (casts, `store`, empty Enter = abort,
Inv §8.3 "Input-derived"). They listen to `cmd.sent` (after alias
expansion; `text === ''` is the empty Enter). P0 checks whether a replay
re-emits the recorded outbound lines; if not, it adds that (flagged
`replay`, so no consumer re-sends or re-captures them).

### Rules

All game-text triggers are system-store actions (never in the profile),
fanning out with the other consumers. Priority as ADR 0016 (3), with
charm's follow line at 4 behind the others.

### Persistence (P0)

- IndexedDB version 4, store `timers`, keyPath `character`, one record
  per character: `{ character, savedAt, state }`, `state` owned by P1
  (versioned, `v: 1`). Learned durations live in the same record.
- Loaded on a live `Char.Name` (login, reconnect, reload); entries whose
  expiry passed during downtime are dropped silently; permanent charms
  and untracked stored spells survive. Indefinite affects are not saved
  (Inv §2.6.5). Lines that arrive during the load are merged.
- Saved after each change, coalesced (≤ 250 ms) and on `pagehide`.
  Never cleared on disconnect.
- A replay starts empty at its `Char.Name` and never reads or writes.
- Without IndexedDB the hub works in memory.

### Settings (P0)

Global (Inv §2.6.3), additive with defaults:

```ts
timers: {
  groups: Record<TimerGroup, { enabled: boolean; color: TimerColor;
                               cols: number; clock: boolean; bar: boolean }>;
  headers: boolean;   // default true
  compact: boolean;   // default true
}
```

`TimerColor` is one of the seven named swatches (Blue, Green, Red,
Magenta, Cyan, Violet, Orange). Defaults and clamps as Inv §2.6.3;
invalid values fall back per key. `timers` joins `viewSnapshot`.

### UI lines

Landings and removals emit `ui.message` `{ kind: 'state', tag, parts }`
(`◆ SPELL: sanctuary up.`), tags and colours per Inv §2.4 /
Cockpit's `docs/ui-messaging.md`. Restores from storage are silent.

### Game data

Affect, spell and herblore facts (game lines, durations, types) are
facts about MUME. P1 reads Cockpit's tables and docs as a reference and
writes them in our own TypeScript format. No Cockpit code.

## Consequences

- The Timers pane is the first pane whose state is text-derived and
  persistent; the same archive shape can carry other per-character state
  later.
- Stage 6's log player rebuilds timers from recorded lines and sends
  with an injected clock.

## Package notes

(Builders append here.)

### P0 — foundation (2026-09-27)

**Files.** `src/timers/entry.ts` (model, pure), `src/timers/tracker.ts`
(the seam, `ManualTracker`, `stateMessage`), `src/timers/trackers.ts`
(`createTrackers(host)`, returns `[]`: **P1 fills it**),
`src/timers/hub.ts` (`TimersHub`), `src/timers/archive.ts`,
`src/panes/timers.ts` (placeholder `TimersPane`: **P2 replaces it**; the
factory entry in `src/panes/factories.ts` is already `new TimersPane(ctx)`).

**Entry model** (`entry.ts`). `TimerGroup`, `TIMER_GROUPS` (pane order),
`TIMER_GROUP_LABELS` (`Spells` … `Charmies`), `TimerCell`, `TimersView`
exactly as above, plus `emptyView()`, `isTimed(c)` (tracked and
`expiresAt` set), `remainingMs(c, now)` (null when not timed),
`barPct(c, now)` (clamped; indefinite tracked = 1; untracked = 0 — the
pane paints untracked stored spells grey-full itself), `barFill(pct, w)` =
`floor(pct*w + 0.5)` clamped 0–w, `countdownText(secs)` (truncates, `Ns`
≤ 90, else `floor((s+30)/60)m`, `0s` floor), `cellCountdown(c, now)`
(null for charms, indefinite, untracked), `charmMinutes(c, now)` (0–99,
null for permanent), `sortCells(group, cells)` (in place; Inv §2.6.1).

**Tracker seam** (`tracker.ts`). The hub builds its trackers once with
`createTrackers(host)`:

```ts
interface TrackerHost {
  now(): number;                       // the hub's injected wall clock, ms
  changed(): void;                     // after EVERY mutation: notify + save
  announce(tag: StateTag, name: string, verb: string, detail?: string): void;  // ◆ line
  message(m: UiMessage): void;         // any UI line (⚠ WARN: STORE: …)
}
interface Tracker {
  readonly key: string;                // key in the saved state; unique
  cells(now): TimerCell[];             // any order; the hub groups and sorts
  tick?(now): void;                    // every 1 s from the hub's one timer
  serialize(now): unknown;             // fresh JSON-safe data; undefined = nothing
  restore(saved: unknown, now): void;  // merge under live entries, drop expired, silent
  reset(): void;                       // forget all (connecting, replay Char.Name), silent
  installRules?(system: SystemRules): void;
  onSent?(text: string, now): void;    // '' = empty Enter
  herbs?(now): {key,name,active}[];  addHerb?(key, now);  removeHerb?(key, now);
  dropCharm?(id: string, now): void;
}
```

`StateTag` = SPELL/BUFF/DEBUFF/STORE/BLIND/CHARM/HERB; `GROUP_TAG[group]`
maps a group to its tag. `stateMessage(tag, name, verb, detail?)` gives
`◆ TAG: name verb.` / `… verb (detail).` with the name as the yellow
value. All tag colours already exist in `UI_TAG_COLORS` (src/panes/ui.ts).
Durations, prune cadence (Cockpit's 10 s / 2 s) and the cast queue live
inside the trackers; the hub only ticks at 1 Hz. The shared cast queue
can be an object `createTrackers` passes to several trackers.

**Hub** (`hub.ts`). Public API as decided (`view(now?)`, `addHerb`,
`removeHerb`, `dropCharm`, `installRules`, `subscribe`) plus
`attach(bus)`, `dispose()`, `flushSave()`, `snapshot()`, `idle()` (archive
work done, tests), `characterName`, `persistent`. Options: `now`,
`scheduler` (the engine's `Scheduler`: `set`/`clear`; `FakeScheduler` in
tests), `openDb`, `win`, `trackers` (factory override), `saveDelayMs`
(250), `tickMs` (1000). Lifecycle: `connecting` → pending save flushed,
every tracker `reset()`; live `Char.Name` → load that character's record
and `restore` each tracker (lines that came meanwhile stay; the merged
state is saved afterwards); a second `Char.Name` of the same character on
one connection is ignored; replay `Char.Name` → reset, never read or
written. A disconnect changes nothing. Record: `{ character, savedAt,
state: { v: 1, trackers: { [key]: serialize() } } }`. Known edge: a new
`connecting` while the record is still loading (a few ms) drops the lines
of that moment.

**GameState.** `game.timers: TimersHub`, attached in `game.attach(bus)`;
part `'timers'` on every hub change. `GameStateOptions.timers` passes hub
options (`openDb`, `scheduler`, `win`, `trackers`; `now` is shared).
App shares one `lazyDb` opener between the hub and the pane context,
passes `win` and its `scheduler` option, and calls
`game.timers.installRules(script.system)` right after
`game.installRules`.

**Settings.** `timers` as decided, in `viewSnapshot`. `TimerColor` =
`blue|green|red|magenta|cyan|violet|orange`; `TIMER_COLOR_ORDER`,
`TIMER_COLOR_HEX` (`#66b2ff #00d900 #d90000 #ff66ff #00cccc #b388ff
#ff9933`), `TIMER_COLOR_LABELS`, `TIMER_COLS_MIN` 1, `timerColsMax(g)` (6,
charm 2), `defaultTimersSettings()`, `migrateTimers(raw)` (per-key
fallback, cols clamped). Patch with `settings.update({ timers: { groups:
{ spell: { cols: 3 } } } })`.

**Storage.** DB version 4, store `timers` (keyPath `character`).
`TimersArchive.open(openDb)`, `load(character) → { character, savedAt,
state } | null`, `save(character, state)`.

**Input tap.** Verified: an empty Enter goes engine `input('')` →
`sendCommand('')` → `cmd.sent { text: '' }` (App test). Replays did not
re-emit recorded commands; now `logToFrames(text, { sends: true })` yields
each `> cmd` as its own frame (`sent`, empty bytes, the clock not moved)
and `ReplaySocket.onSent` → Session emits `cmd.sent { text, ts: nowUs(),
replay: true }` between the inbound lines around it. The output pane does
not echo `replay` commands (a log cannot tell typed commands from
`change width`; replays look as before); the recorder does not capture
them; nothing re-sends them. The hub takes only live sends on a live
connection and only `replay` sends during a replay (typed commands during
a replay are ignored); `secret` never. The bench path (`logToFrames`
without `sends`) is unchanged.

**Test hooks.** `new GameState({ timers: { trackers: (h) => [new
ManualTracker('m', h, { persist: true })] } })` puts hand-made cells in
(`put(cell)`, `remove(id)`, `clear()`, `setHerbs(list)`; `dropCharm`
and herb add/remove work). Without injecting: `game.timers.debugAdd(cell)`,
`debugHerbs(list)`, `debugClear()` — an internal, never-saved tracker,
cleared by `connecting`; in the browser `__wc.app.game.timers.debugAdd({
id, name, group, startedAt, expiresAt, expected, tracked })`.

### P2 — Timers pane and options (2026-09-27)

**Modules.** `src/panes/timers.ts`: pure `timersLayout(input)` →
`{ lines: CellLine[], zones, scroll, total, listH, corner, timed }` plus
helpers `effectiveCols`, `cellWidths`, `clockContent` (ladder A/B/C),
`charmName`, `hitKey` (unit tested in `tests/unit/panes-timers.test.ts`),
and `TimersPane` (DOM only). `src/chrome/frames/options-timers.tsx`
(`TimersOptionsFrame`, helpers `colorToggle`, `stepCols`, `timersHeader`),
listed in the Panes hub as General · Timers · Communication · Group · Back.
CSS in `src/panes/panes.css` (`.wc-timers-hit`).

**Clicks.** The layout returns hit zones (charm `×`, herb label, corner,
`↑` indicator); the pane draws one transparent `.wc-timers-hit` box per
zone (`data-hit`, `data-id` / `data-key`), raised above the title-row
grip (z-index 2), and handles `mousedown` / `mousemove` on the content.
Hover is a zone key passed back into the layout, so the colours stay in
one place. Clicks call the hub (`dropCharm`, `addHerb`, `removeHerb`),
no optimistic UI. The wheel listens on the pane element (the grip covers
the top content row when the border is off); 40 px per row as the
anchored list. `data-mode` on the content is `grid` / `add`.

**Tick.** After each render the pane arms one timeout for the next
wall-clock second + 5 ms while any enabled group has a tracked cell with
an expiry (bars, countdowns, charm minutes); none otherwise. Leaving
`playing` resets mode, scroll and hover and clears the timer.

**Deviations.**
- Light pane: the drained-name / charm-minutes grey `#C0C0C0` becomes
  `darkInk(bg)` and the untracked-affect `#3a3a3a` becomes the ramp's
  `dim` (Cockpit only adapts barless names, which we darken with
  `lightShift` as it does). Bars stay the vivid group colour.
- Indicator in the singular for 1 (`↑ 1 row above`, `↓ 1 more row`), as
  the Comm pane.
- Options header: colour names left-aligned over their `[X]███` cells
  like the General grid (Cockpit centres them).
- Barless untracked stored spells paint their name in `#cccccc`.

**Test note.** `playwright.config.ts` reuses any server on 5173; with
parallel worktrees that can be another branch's. P2 ran its e2e with a
private copy of the config on another port.
