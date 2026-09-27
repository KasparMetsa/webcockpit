# Stage 5 — Timers and trackers

> Status: Done 2026-09-27.
> Source: spec §5 row 5, §2.4 (Timers row), §1.4. Inv §2.6 (all of it),
> §8.3 (affect, reconcile, cast, store, blind and charm rows), §2.4 (the
> `◆ TAG:` lines). ADR 0017.

## Goal

The owner fights with a Timers pane that shows, as in Cockpit, what is on
the character and how long it lasts: spells, buffs and debuffs (affects),
stored spells, blinds on others, charmed followers and herblores. The
trackers learn real durations per character and keep their state across
reloads and reconnects (owner wish, 2026-09-27).

## Scope

In:

- **Game data** in our own format (facts about MUME, no Cockpit code):
  affects (type, duration, start/refresh/drop lines, damage-droppable),
  storable spells (shortest prefixes), herblore catalogue (phases).
- **Common timed-entry model**: bar drain (round half up), countdown
  format, sort orders, untracked and overrun states.
- **Trackers** (Inv §2.6.5–2.6.10): affects with learned durations
  (3-sample mean, armour floor, drop line as truth, 2.5× safety net),
  stat/info reconcile, stored spells (store FIFO, decay, blast, recall,
  learned durations), shared cast-attempt queue, blinds, charms
  (in-flight gating, controlled mobs, ids), herblores (manual).
- **Per-character persistence** in IndexedDB: loaded on `Char.Name`,
  saved on every change, never touched on disconnect, expired entries
  dropped on load, restore silent. Replays never read or write it.
- **`◆ TAG: name verb.` lines** in the UI pane for every landing and
  removal (SPELL/BUFF/DEBUFF/STORE/BLIND/CHARM/HERB).
- **Timers pane** (Inv §2.6.1–2.6.2): groups, grid with column caps,
  bars, separators, countdown ladder, charm rows with `×`, corner `+`
  and the herblore add-view, scroll and indicator, 1 Hz aligned redraw,
  light-pane handling, blank when inactive.
- **Options → Panes → Timers** (Inv §2.6.3): colours, column caps,
  clock and bar per group, headers, compact. Applies live.
- **Offline demo** `timers-demo.log` exercising every group.

Out: kill/pkill/death UI lines and run events (stage 6), a log player
clock for trackers (stage 6 uses the injected clock, ADR 0017), the
Cockpit blink (removed in Cockpit, not reimplemented).

## Owner decisions

None yet. Carried: per-character timers state survives sessions
(2026-09-27) — in scope.

## Tasks

- [x] Stage file and ADR 0017.
- [x] P0. Foundation: timers settings key + migration + view snapshot,
      IndexedDB v4 `timers` store and archive, `GameState.timers` hub
      skeleton with its public API and persistence lifecycle, input tap
      (live and replayed sends, empty Enter), entry maths, pane factory
      stub. Notes in ADR 0017.
- [x] P1. Game data tables and the six trackers, system rules, UI
      lines, demo fixture. Notes in ADR 0017.
- [x] P2. Timers pane and Options → Panes → Timers. Notes in ADR 0017.
- [x] Merge P1 + P2; bench still passes (§1.3). The merge slowed the
      replay burst (~1.3 → ~2.0 s); fixed to ~1.5 s (ADR 0017 "Burst
      fix"). 500 rules + system rules 27 µs/line; max burst frame
      42/36 ms (Chromium/Firefox).
- [x] Main-session verification (781 unit, 124 e2e; timers demo
      screenshot: spells, untracked detect magic, debuffs, stored,
      blind, charms, `◆` lines in the UI pane).
- [x] Test guide ready.
- [x] Owner test (approved 2026-09-27: "seems to work well").

## Live checks for the owner

1. Buffs land and drop with the game text; bars drain; after a few
   casts the learned durations match the game.
2. `stat` / `info` reconcile: entries seen there but not tracked show
   dark (untracked) and graduate on the next refresh.
3. Stored spells: `store` → entry; recall and decay remove it.
4. Blind a mob: `2.orc` bar for 90 s. Charm a mob: row with minutes
   counting up; `×` forgets it.
5. Reload the page mid-buff and log in again: the timers are back,
   minus the time passed.

## Test guide

**Start:** `cd ~/proj/webcockpit && npm run dev` (restart it if it was
already running), then open http://localhost:5173/.

**Offline demo (no login):**
http://localhost:5173/?fixture=timers-demo.log (~60 s; `&speed=4` is
quicker). Look at:

1. **Timers pane:** `Spells:` with SANCTUARY, ARMOUR, SHIELD, BLESS
   bars in blue; DETECT MAGIC dark (untracked, seen only in `stat`);
   Debuffs in red (HUNGER full, TIREDNESS draining); Stored magenta
   (two EARTHQUAKE); a `2.ORC` blind bar; Charmies rows
   `Huge stone troll  0m ×` and `Enslaved shadow ×`. Wheel scrolls;
   `↓ N more rows` / `↑ N rows above` (click returns to the top).
2. **Charm `×`:** click it; the row goes away.
3. **Corner `+`:** opens the herblore list; click `[+] Healing`; it
   turns `[-]`; corner `×` goes back; a HEALING buff bar is there.
4. **UI pane:** `◆ SPELL: sanctuary up.`, `◆ STORE: …`, `◆ BLIND: 2.orc
   up.`, `◆ CHARM: …`, `◆ BUFF: second wind down.` etc.
5. **Options:** ESC → Options → Panes → Timers: pick colours (or none
   to hide a group), `◄ N ►` columns, Clock (countdown `4m`/`45s` on
   the bars), Bar off, headers, compact. The pane changes at once.
6. Light terminal background (Appearance): the pane stays readable.

**Live (log in):** live checks 1–5 above. Please tell me in particular:
does the pane look like Cockpit's, are durations and drops right, and
does anything land in the wrong group or not at all (the exact game
line helps).
