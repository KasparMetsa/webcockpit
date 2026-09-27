# Progress

Current stage: **1 — Connect and play** (owner testing).

## Stages

| # | Stage | Status | Stage file |
|---|---|---|---|
| 1 | Connect and play | Owner testing | `docs/stages/01-connect-and-play.md` |
| 2 | Look and layout | — | — |
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

### 2026-09-27 — Stage 1 build

- **Done:** stage file, ADRs 0007–0009. Scaffold (Vite 8, TS 7, Vitest,
  Playwright). Event bus and types; telnet/GMCP/keep-alive/session;
  line layer (ANSI + MUME XML, ~100 MB/s); output and input panes;
  raw capture in IndexedDB; replay mode; browser benchmark (all §1.3
  budgets pass in Chromium and Firefox, `bench/results/latest.md`).
  193 unit tests, 16 e2e tests.
- **Next:** owner runs the test guide in `docs/stages/01-connect-and-play.md`
  and answers the six live checks; then fix feedback and start stage 2.
- **Open issues:** live checks 1–6 (XML was seen before login in a quick
  check); Ctrl+W cannot be intercepted in a normal tab.
- **Owner live test 1:** speed and echo OK, XML confirmed on, `#runlog`
  OK. Fixed after: `Core.Ping` every 10 s so `Link:` shows during play;
  monotonic capture timestamps. Idle timeout still untested.
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
