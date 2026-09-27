# Progress

Current stage: **2 — Look and layout** (owner testing).

## Stages

| # | Stage | Status | Stage file |
|---|---|---|---|
| 1 | Connect and play | Done | `docs/stages/01-connect-and-play.md` |
| 2 | Look and layout | Owner testing | `docs/stages/02-look-and-layout.md` |
| 3 | Script engine and profile editor | — | — |
| 4 | GMCP panes | — | — |
| 5 | Timers and trackers | — | — |
| 6 | Runs | — | — |
| 7 | Sharing | — | — |
| 8 | Hardening → v1 | — | — |
| 9 | Map (after v1) | — | — |

Statuses: Next, In progress, Owner testing, Done.

## Session log

Newest first.

### 2026-09-27 — Stage 2 build

- **Done:** stage file, ADRs 0010–0013. Owner chose the MUME/COCKPIT
  wordmark. A: settings store, theme tokens, colour toolkit, bundled
  fonts, whole-pixel cell grid, custom caret, status line removed.
  B: docking engine (left/right/bottom), glyph pane frames, drag/resize/
  toggle, narrow collapse, size gate. C: Preact TUI kit, start page,
  profiles (import/export), Options (Panes, Appearance), About, ESC menu
  with auto-open. 334 unit, 60 e2e tests; bench passes; cold start
  ~0.3 s throttled.
- **Next:** owner tests stage 2 (test guide in the stage file), then
  stage 3.
- **Open issues:** idle-timeout live check still open; Chromium burst
  worst frame borderline (39–57 ms vs 50 ms); chrome not light-themed
  on "paper"; Panes grid clipped near 60 cols.
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
