# Stage 3 — Script engine and profile editor

> Status: Done 2026-09-27. Live checks 1–2 (idle timeout, auto-open on a
> real disconnect) carried over to stage 4.
> Source: spec §5 row 3, §1.2 (layers 5–6), §1.3 (key → send, 500
> rules), §2.2 (`_send`), §2.6 (Profile), §2.7, §3, §4. Inv §1.2
> (macro keys), §4.5, §5, §6. ADR 0005, ADR 0015.

## Goal

The owner pastes the tt++ text of the PvP profile into the editor view
and plays with it: aliases, actions, highlights, substitutes, gags,
macros, variables, `#if` logic, tickers and delays work in the live
session. The lite view edits the five Cockpit kinds with forms. Both
views edit the same text, and nothing is lost on a round trip.

## Scope

In:

- **Profile document model** (lossless): parse any text without
  throwing; list, edit, add and remove entries; untouched text is
  written back byte for byte (comments, blank lines, order, unknown and
  multi-line commands). ADR 0005, ADR 0015.
- **One key table** shared by the input line and the editor: readable
  names (`F5`, `Numpad0`, `Alt+A`, `Ctrl+Shift+F1`), tt++ escape forms
  accepted on read, reserved keys rejected.
- **Script engine** over two stores (system, user). spec §3 "Must" and
  "Should" tiers: rules, `#if`/`#elseif`/`#else`, `#showme`, `#nop`,
  `#math`, basic `#format`, `#class` (groups, kill), a curated `#event`
  list, the tt++ pattern language, `$var`/`&var`, colour codes,
  priorities, abbreviations, nested definitions in line order.
- **Inert commands** (`#lua`, `#system`, `#read`, `#session`, …): kept
  verbatim, do nothing, and give a hint when run and in the editor.
- **Display pipeline:** substitutes, gags and highlights change only the
  displayed copy. Taps, capture and actions see the original line.
- **Input path:** typed lines run through the engine (aliases, `;`,
  `#` commands). The stage 1 built-ins (`#connect`, `#help`, …) become
  engine commands. `_send` built-in.
- **Macros** from the key table, in the input line.
- **Live profile:** the selected profile loads when a session starts.
  ESC menu → Profile edits the live profile: Apply / Discard / Keep
  editing when connected, direct save when disconnected (Inv §4.5).
  Apply is all-or-nothing.
- **Runtime variables** (owner decision 2026-09-27): when a script sets
  a variable that exists as a top-level `#variable` in the profile, the
  saved profile is updated in place. Rules and variables created at
  runtime live for the session only. System rules never enter the
  profile.
- **Profile editor** (Inv §5): full-screen frame, LITE (5 kinds, entry
  list, detail panel, highlight colour picker, macro key capture) and
  EDITOR (CodeMirror 6: tt++ highlighting in Cockpit's colours, brace
  matching and auto-close, balance indicator, `Ln, Col`, undo/redo,
  Alt+↑/↓ line swap). Lazily loaded.
- **Entry points:** start page Profile → EDIT and ESC menu → Profile are
  no longer dimmed.
- **Benchmark:** 500 user rules < 0.2 ms per line on average; key →
  `ws.send` < 1 ms with an alias and a macro in the path.

Out: GMCP panes (stage 4), system trigger table and trackers (stage 5;
this stage builds the system store they will use), `#list`,
`#foreach`, `#loop`, `#while`, `#switch`, `#function`, `#regexp`,
`#replace`, `@function()` calls, tt++ file commands.

## Owner decisions

- **2026-09-27 — runtime changes.** Only variables are written back, and
  only those already defined at the top level of the profile. Owner:
  "Here we build something from scratch and are less constrained. If
  something chafes in Cockpit we can find smarter solutions."
- **Note for stages 4–5 (owner, 2026-09-27):** other per-character state
  (spell timers, communication history and similar) should survive
  between sessions.

## Tasks

- [x] Stage file and ADR 0015.
- [x] P1. Document model and key table (`src/script/doc/`,
      `src/script/keys.ts`). Round-trip corpus tests.
- [x] P2. Script engine, display pipeline, app wiring, macros, runtime
      variable write-back, benchmark (`src/script/engine/`). API for P3:
      `App.applyProfile(text)`, `App.script`; bus `text.display`.
- [x] P3. Profile editor (lite + editor views), entry points, live apply
      flow (`src/editor/`).
- [x] Merge P2 + P3; wire the editor's live host to the engine
      (`App.applyProfile`, variable write-back flushed before the editor
      reads the profile).
- [x] Benchmarks pass (§1.3): 500 rules 26 µs/line (Chromium), 17 µs
      (Firefox); alias Enter p99 0.17/0.22 ms. Cold start 418 ms median
      (throttled); editor chunk 304 kB (99 kB gzip), lazy.
- [x] Main-session verification in a browser (540 unit, 88 e2e; the
      owner's real profile opens in both views and survives open → flip
      → ESC byte for byte; `#var`, `#showme` and aliases run in the
      cockpit).
- [x] Test guide ready.
- [x] Owner test (approved 2026-09-27).

## Live checks for the owner

1. **Idle timeout** (carried from stage 1): stay idle 5+ minutes; does
   the link survive, and does `Link:` in the ESC menu keep updating?
2. **Auto-open on disconnect** (carried from stage 2): after a real
   disconnect (e.g. `quit`), the ESC menu opens with Reconnect selected.
3. **The PvP profile in play:** aliases, macros, actions and highlights
   behave as in Cockpit.

## Test guide

**Start:** `cd ~/proj/webcockpit && npm install && npm run dev`, then open
http://localhost:5173/ (CodeMirror is a new dependency, so `npm install`
is needed).

**Put your PvP profile in:**

1. Start page → Profile → NEW (blank), name it e.g. `pvp`, SELECT it.
2. EDIT → click `EDITOR` (top right) → select all (Ctrl+A) and paste the
   whole text of `khazdul.tin`. ESC saves and goes back. (IMPORT of the
   `.tin` file works too.)
3. EDIT again: LITE shows ACTIONS, ALIASES, HIGHLIGHTS, MACROS,
   SUBSTITUTES. Walk the lists; open an entry; look at the highlight
   colour picker and a macro's key cell. `#variable`, `#ticker` and
   comments stay in the text but have no lite tab (as in Cockpit).
4. EDITOR view: colours, brace matching, `{` auto-close, the
   `N unclosed {` indicator, `Ln, Col`, Ctrl+Z/Y, Alt+↑/↓ moves lines,
   Ctrl+C with no selection copies the line. The leaked `#TICKER … #lua`
   line is underlined: it is kept but does nothing.
5. Export the profile and compare with the original: nothing should be
   lost or reordered.

**Play with it (live):**

1. Enter MUME, log in. Your aliases, macros (numpad, F-keys), actions,
   highlights and substitutes should work as in Cockpit. Try `#var`,
   `#showme`, `#if` aliases, `autobashon`/`autobashoff`.
2. Every command sent to MUME is echoed with what was actually sent
   (an alias shows its expansion). `_send x` behaves like `x`.
3. ESC → Profile while connected: change something, ESC → "Apply
   changes to your profile?" Y applies at once (`Profile updated.`), N
   discards, ESC keeps editing.
4. Set a variable that exists in the profile (e.g. your target alias),
   then reload the page: the new value is kept. A variable or action
   created only at runtime is gone after reload.
5. Typed `#` commands: `#help` lists the client commands; tt++ commands
   work directly in the input line (`#alias {x} {look}`).
6. Live checks 1–3 above.

**Offline:** http://localhost:5173/?fixture=Rasta/2026-09-18T18-11-42.log&speed=0
replays a log through the selected profile (highlights, substitutes,
gags, actions with `#showme`).

**Feedback wanted:**

- Does the PvP profile play as in Cockpit? Anything that fires wrongly,
  not at all, or differently?
- The echo: all sent commands shown (alias expansions included), versus
  Cockpit where only `_send` echoed. Keep, or change?
- Lite and editor view: look, keys, anything missing (e.g. GAGS or
  VARIABLES tabs)?
- Macro keys: any key you want that is refused?

Known in stage 3: undo in the editor view groups by time (CodeMirror)
rather than Cockpit's step rules; Alt+↑/↓ moves a whole selected block;
`White` in the highlight picker is bright white, not Cockpit's grey; the
lite detail panel is cut off in very small windows; `#class` supports
open/close/kill only; `^b%+1..d$` matches `b12` (digits as the range
type), not `b12d`. Some tt++ details were decided without a reference
(ADR 0015 P2 notes) — tell me if one bites.

## Owner feedback

### 2026-09-27 — first test

1. Tested; "seems to work well". Stage 3 approved.
2. Echo of every sent command (alias expansions included): keep as is.
3. Live checks 1–2 not reported; carried to stage 4.
