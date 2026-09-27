# Stage 3 — Script engine and profile editor

> Status: In progress.
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
- [ ] Merge P2 + P3; wire the editor's live host to the engine.
- [ ] Benchmarks pass (§1.3), cold start < 1 s, editor chunk lazy.
- [ ] Main-session verification in a browser.
- [ ] Test guide ready.
- [ ] Owner test.

## Live checks for the owner

1. **Idle timeout** (carried from stage 1): stay idle 5+ minutes; does
   the link survive, and does `Link:` in the ESC menu keep updating?
2. **Auto-open on disconnect** (carried from stage 2): after a real
   disconnect (e.g. `quit`), the ESC menu opens with Reconnect selected.
3. **The PvP profile in play:** aliases, macros, actions and highlights
   behave as in Cockpit.

## Test guide

(Written when the stage is built.)

## Owner feedback

(After testing.)
