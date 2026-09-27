# Stage 1 — Connect and play

> Status: In progress. Started 2026-09-27.
> Source: spec §5 row 1, §1.1–1.4, §2.1, §2.2, §2.8 (capture only), §4.

## Goal

The owner can open WebCockpit in the browser, log in to MUME and play
plain MUME at tt++ speed. No panes, menus or scripting yet: a full-window
output pane, the input line and a temporary status line.

## Scope

In:

- **Transport:** one WebSocket to `wss://mume.org/ws-play/`, subprotocol
  `binary`, `binaryType = 'arraybuffer'` (ADR 0002).
- **Telnet:** IAC parsing across frame boundaries, option negotiation,
  GMCP, CHARSET (UTF-8, Latin-1 fallback), NAWS (cells of the output
  pane, updated on resize), TTYPE, MSSP (parsed, kept for the clock
  later), ECHO (password masking), GA prompt boundaries. MCCP2 is
  declined for now (ADR 0007).
- **GMCP:** one module registry builds a single `Core.Supports.Set`:
  `Char 1`, `Comm.Channel 1`, `Event 1`, `Core 1`, `Group 1`, `Room 1`,
  `Room.Chars 1`, `MUME.Client 1`. `Core.Hello`, then
  `MUME.Client.XML {"enable":true,"silent":true}`. `Comm.Channel.Enable`
  for every channel in `Comm.Channel.List`. On `Char.Name`:
  `change width all 500` and `change width table terminal`.
- **Line layer:** line and prompt assembly, ANSI SGR, MUME XML tags,
  entity decoding. Output: the line model (plain text, style runs, tag
  metadata, prompt flag).
- **Event bus:** ordered, synchronous, non-swallowing; taps for raw bytes
  in/out, lines, GMCP raw+parsed, sent commands, connection state.
- **Output pane:** batched DOM append (≤ 1 paint per frame), scrollback
  20 000 lines with node recycling, PageUp/PageDown, wheel, live-tail
  indicator while scrolled, snap to tail on send, ESC leaves scroll,
  copy-on-select, click returns focus to input.
- **Input pane:** Inv §1.2 minus autosuggest, clock strip and macros
  (Enter semantics, recall state, history, clipboard and editing keys,
  password masking without history).
- **Command echo** in the output (form verified live, see below).
- **Session state:** connecting / login / playing (after `Char.Name`) /
  disconnected (`Core.Goodbye` or socket close). While disconnected,
  Enter reconnects. "Leave page?" prompt while connected.
- **Keep-alive and `Link:`:** GMCP `Core.Ping` after 30 s without
  outbound traffic; RTT shown in the status line; missing pong within
  10 s marks the link as suspect.
- **Raw run capture:** Inv §7.1 format, in IndexedDB chunks (ADR 0006),
  starting at `Char.Name`, sealed on disconnect; Web Lock per
  character; orphan sealing on start. A dev command downloads the
  current run's `.log`.
- **Replay mode:** a fake socket replays a Cockpit `.log` file (loaded
  with a file picker) at real or accelerated speed, without logging in.
- **Benchmark:** replay-driven, measures the §1.3 budgets that exist in
  stage 1 (frame → paint, 1 MB burst, scrollback fill, key → send).
- **Tests:** Vitest for telnet, line/XML parser, capture format;
  Playwright smoke test in Firefox and Chrome against replay mode.

Out (later stages): layout and right-column panes, bundled fonts and
appearance settings, start page, ESC menu, script engine, macros,
autosuggest, clock strip, run events and screens.

## Temporary chrome (replaced in stage 2)

- Top status line: connection state, character name, `Link: NNms`,
  capture state.
- Font: `"DejaVu Sans Mono", monospace` 15 px, Cockpit's DOS palette
  (Inv §1.1), default fg `#C0C0C0` on `#000000`.
- Client lines in the output are prefixed `[SYSTEM]`.
- Built-in commands (become part of the script engine in stage 3):
  `#connect`, `#disconnect`, `#reconnect`, `#runlog` (download the
  current or last run's raw capture), `#replay` (open a log file).

## Tasks

- [x] Stage file and ADR 0007.
- [x] Scaffold: Vite + TypeScript + Vitest + Playwright, `npm run dev`,
      `npm test`, `npm run bench`.
- [x] Event bus and shared types (line model, events).
- [ ] Telnet layer + GMCP registry + keep-alive, with unit tests.
- [ ] Line layer: ANSI + XML parser, with unit tests.
- [ ] Output pane and input pane.
- [ ] Session wiring, status line, built-in commands.
- [ ] Raw capture in IndexedDB, Web Lock, orphan sealing.
- [ ] Replay mode (fake socket).
- [ ] Benchmark and Playwright smoke tests.
- [ ] Main-session verification in a browser against replay.
- [ ] Test guide ready; owner live test.

## Live checks for the owner

These can only be answered on a real login:

1. **XML mode** — does MUME send XML tags after login? (Status line shows
   `XML: on` once a tag is seen.)
2. **Idle timeout** — stay idle 5+ minutes without typing; does the link
   survive? Does `Link:` keep updating?
3. **Core.Ping** — does MUME answer our `Core.Ping`? (`Link:` shows a
   number, not `—`.)
4. **Echo form** — compare the echo of sent commands with tt++.
5. **Password** — is the password masked and absent from history and
   the run log?
6. **Raw capture** — `#runlog` after some play: does the file look like
   a Cockpit `.log`?

## Test guide

(Written when the build is done.)

## Owner feedback

(Filled in after the owner tests.)
