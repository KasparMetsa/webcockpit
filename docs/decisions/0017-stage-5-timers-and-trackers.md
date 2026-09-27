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
