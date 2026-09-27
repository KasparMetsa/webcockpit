# Progress

Current stage: **6 — Runs** (in progress).

## Stages

| # | Stage | Status | Stage file |
|---|---|---|---|
| 1 | Connect and play | Done | `docs/stages/01-connect-and-play.md` |
| 2 | Look and layout | Done | `docs/stages/02-look-and-layout.md` |
| 3 | Script engine and profile editor | Done | `docs/stages/03-script-engine-and-editor.md` |
| 4 | GMCP panes | Done | `docs/stages/04-gmcp-panes.md` |
| 5 | Timers and trackers | Done | `docs/stages/05-timers-and-trackers.md` |
| 6 | Runs | In progress | `docs/stages/06-runs.md` |
| 7 | Sharing | — | — |
| 8 | Hardening → v1 | — | — |
| 9 | Map (after v1) | — | — |

Statuses: Next, In progress, Owner testing, Done.

## Session log

Newest first.

### 2026-09-27 — Stage 5 build

- **Done:** stage file, ADR 0017. P0 timers settings, IndexedDB v4
  `timers` store (per character, survives reloads), `TimersHub`, replays
  re-emit recorded commands. P1 game data (47 affects, 36 spells, 6
  herblores), six trackers behind one line router, `◆` UI lines,
  `timers-demo.log`. P2 Timers pane and Options → Panes → Timers.
  Merge slowed the replay burst; fixed (regex pre-checks, speed-0
  command frames). 781 unit, 124 e2e; bench passes.
- **Next:** owner tests (guide in the stage file), then stage 6.
- **Open issues:** a reconnect during the few-ms state load can drop
  that moment's lines; replays do not echo sent commands (stage 6);
  replay burst still ~15 % slower than stage 4 (real tracker work).
- **Owner test 1:** approved ("seems to work well"). Stage 5 closed.
  Next session: write `docs/stages/06-…md` from spec §5; the log player
  should echo replayed commands and drive trackers with the injected
  clock (ADR 0017).
- **Commits:** da5b76d…(this commit).

### 2026-09-27 — Stage 4 build

- **Done:** stage file, ADR 0016. Owner decision: the log player and
  HTML replay show every pane in the player's layout, so runs now
  record GMCP, layout snapshots and window size. P0 pane context,
  comm store, capture records, demo fixture. P1 Character, Group,
  clock (+MSSP), Options → Panes hub with Group. P2 Comm (archive per
  character, filters, solo), UI pane and its messages, Communication
  options. 696 unit, 114 e2e; bench passes.
- **Owner feedback during build:** the demo lacked MUME's blank lines
  (fixture only); fixed.
- **Next:** owner tests (guide in the stage file), then stage 5.
- **Open issues:** live checks 1–2 still open; MSSP day base unchecked;
  Comm header over the drag grip when borderless.
- **Owner test 1:** group pane follows the fight; carried live checks
  (idle timeout, ESC auto-open) pass; `[SYSTEM]` lines stay in both
  places. Comm talker names shortened as in Cockpit (fixed). Stage 4
  approved and closed. Next session: write `docs/stages/05-…md` from
  spec §5; timers state per character must survive sessions (owner
  wish); the Timers pane plugs into `PaneContext`/`GameState`.
- **Commits:** e93638a…(this commit).

### 2026-09-27 — Stage 3 build

- **Done:** stage file, ADR 0015. Owner decision: only profile-defined
  variables are written back at runtime. P1 lossless document model,
  command table, key table. P2 script engine (tt++ Must + Should),
  display pipeline (`text.display`), macros, `_send`, live profile and
  variable write-back, benchmarks. P3 profile editor (LITE + CodeMirror
  EDITOR), EDIT and ESC → Profile with live Apply. 540 unit, 88 e2e;
  all §1.3 budgets pass (500 rules 17–26 µs/line); cold start 418 ms.
- **Next:** owner tests with the PvP profile (test guide in the stage
  file); then stage 4.
- **Open issues:** idle-timeout and auto-open live checks still open;
  Chromium burst worst frame borderline (49.8 ms); the owner wants
  per-character state (timers, comm) to survive sessions (stages 4–5);
  Firefox e2e flaked once on a cold Vite dep cache.
- **Owner test 1:** approved ("seems to work well"); echo of all sent
  commands kept. Stage 3 closed. Next session: write
  `docs/stages/04-…md` from spec §5, carry the two live checks and the
  per-character persistence wish.
- **Commits:** a95ac8c…(this commit).

### 2026-09-27 — Stage 2 build

- **Done:** stage file, ADRs 0010–0013. Owner chose the MUME/COCKPIT
  wordmark. A: settings store, theme tokens, colour toolkit, bundled
  fonts, whole-pixel cell grid, custom caret, status line removed.
  B: docking engine (left/right/bottom), glyph pane frames, drag/resize/
  toggle, narrow collapse, size gate. C: Preact TUI kit, start page,
  profiles (import/export), Options (Panes, Appearance), About, ESC menu
  with auto-open. 334 unit, 60 e2e tests; bench passes; cold start
  ~0.3 s throttled.
- **Next:** start stage 3. Write `docs/stages/03-…md` from spec §5 and
  carry over the live checks (idle timeout, auto-open on a real
  disconnect).
- **Open issues:** idle-timeout live check still open; Chromium burst
  worst frame borderline (39–57 ms vs 50 ms); chrome not light-themed
  on "paper"; Panes grid clipped near 60 cols.
- **Owner test 1:** fonts OK, quotes OK. Asked for: corners always
  quadrant (setting removed), a top dock, and floating panes (per pane,
  free position and size). Done in ADR 0014; 348 unit, 66 e2e, bench
  passes. Owner retests the docking.
- **Owner test 2:** input line always directly under the game pane
  (side docks full height, bottom dock under the input); a docked pane
  dragged out floats at 36 × 14. Done (ADR 0014 amendment); 350 unit,
  70 e2e, bench passes.
- **Owner test 3:** approved; stage 2 closed.
- **Commits:** c815295…(this commit).

### 2026-09-27 — Stage 1 build

- **Done:** stage file, ADRs 0007–0009. Scaffold (Vite 8, TS 7, Vitest,
  Playwright). Event bus and types; telnet/GMCP/keep-alive/session;
  line layer (ANSI + MUME XML, ~100 MB/s); output and input panes;
  raw capture in IndexedDB; replay mode; browser benchmark (all §1.3
  budgets pass in Chromium and Firefox, `bench/results/latest.md`).
  193 unit tests, 16 e2e tests.
- **Next:** start stage 2. Write `docs/stages/02-look-and-layout.md` from
  spec §5 and carry over live check 5 (idle timeout ≥ 5 min).
- **Open issues:** idle-timeout check not done (carried to stage 2);
  Ctrl+W cannot be intercepted in a normal tab.
- **Owner live test 1:** speed and echo OK, XML confirmed on, `#runlog`
  OK. Fixed after: `Core.Ping` every 10 s so `Link:` shows during play;
  monotonic capture timestamps; `Link:` shows the 60 s minimum (MUME
  answers on a ~250 ms pulse). Idle timeout still untested.
- **Commits:** 1336f54…(this commit).

### 2026-09-27 — Intent and spec

- **Done:**
  - Grilling rounds 1–3.
  - `intent.md` approved.
  - Research: MUME WebSocket (direct connection verified), MMapper
    integration, Cockpit inventory.
  - `spec.md` approved.
  - ADRs 0001–0006.
- **Next:** start stage 1. Write `docs/stages/01-connect-and-play.md` from
  spec §5, then build.
- **Open issues to check live in stage 1:**
  - XML mode after login.
  - Idle timeout.
  - Echo form of sent commands.
  - Password ECHO signal.
  - Whether the raw capture is taken before substitution.
- **Commits:** 3f1a3be…4016cdd, plus this one.
