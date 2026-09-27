# 0009 — Stage 1 app wiring, replay semantics and output chunks

- Status: Accepted
- Date: 2026-09-27

## Context

Stage 1 wires the net, text, ui and capture layers into one page
(`src/app/app.ts`), adds replay from files and dev fixtures, and a
browser benchmark for spec §1.3. Several choices were left open, and the
benchmark found a scrollback slowdown that changes how the output pane
keeps its rows (spec §1.3 says "old lines are recycled").

## Decision

- **Start-up.** `/` connects to MUME at once, as Cockpit does. `?replay`
  opens offline (no connection; `#replay` loads a log). `?fixture=<rel>
  &speed=<n>` replays a log served by the dev server; it is ignored in a
  production build. `?bench` is offline and loads the benchmark probe as
  a separate chunk.
- **Replays are never captured.** The replay socket is started without a
  character name, so the session stays in `login` and the Recorder,
  which starts only at `playing`, records nothing. The status line shows
  `replay` instead of `connecting`/`login` meanwhile.
- **Enter on a closed connection.** After a live disconnect it
  reconnects ("Press Enter to reconnect."). After a replay, or in an
  offline start, it does not connect to MUME; `#connect` does. This
  keeps a replay session from logging in by accident.
- **Built-ins.** `#connect`, `#disconnect`, `#reconnect`, `#runlog`,
  `#replay [speed]` (1 = real time with gaps capped at 2 s, 0 = max),
  `#help`. The first word is matched case-insensitively; an unknown
  `#word` prints `Unknown command` and is not sent (tt++ semantics).
- **Dev fixtures.** The Vite dev server serves `GET /__fixtures/list`
  and `GET /__fixtures/<rel>.log` read-only from `$WEBCOCKPIT_FIXTURES`
  (default `/home/ole/MUME/data/runs`). Paths are resolved with
  `realpath` and must stay under the root. `apply: 'serve'` keeps it out
  of builds and `vite preview`.
- **Client version.** `package.json` `version` is injected with a Vite
  and Vitest `define` (`__WC_VERSION__`) into `CLIENT_VERSION`.
- **Output rows in chunks instead of node recycling.** Rows live in
  `.wc-chunk` elements of up to 200 rows with `contain: content`. Old
  rows are dropped a whole chunk at a time once the remaining chunks
  still hold the scrollback, so the pane keeps at least 20 000 rows and
  fewer than 20 000 + 200.
- **Replay pacing.** At speed 0 (or when behind real time) the replay
  delivers for at most 8 ms, then waits for the next animation frame.

## Rationale

- Benchmark (bench/results/latest.md): with 20 000 flat rows trimmed on
  every flush, a 50-line flush took 21 ms per frame in Chromium against
  3.8 ms on an empty pane. Removing rows at the top moves every box after
  them. Chunks cut this to ~5 ms, and whole-chunk trimming to the cost of
  an empty pane. Node recycling would still move every row on each trim,
  so it does not address the cause.
- Keeping `login` semantics for replay needs no special case in the
  Recorder or Session.

## Consequences

- Row selectors are `.wc-rows .wc-row` (rows are no longer direct
  children).
- A max-speed replay yields to rendering; it is about 10 % slower than an
  unbroken chain of tasks.
- Revisit chunk size or `content-visibility` if a later benchmark (e.g.
  with 500 rules) shows layout or paint cost at full scrollback. A trial
  with `content-visibility: auto` on chunks was slower in Chromium.
