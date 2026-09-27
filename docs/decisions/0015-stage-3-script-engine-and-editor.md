# 0015 — Stage 3: script engine, profile document and editor

- Status: Accepted
- Date: 2026-09-27

## Context

Stage 3 (spec §1.2 layers 5–6, §2.7, §3) adds the tt++ script engine,
the display pipeline, macros and the profile editor. Three builders work
on it: P1 (document model and key table) first, then P2 (engine) and P3
(editor) in parallel. This ADR fixes the contracts between them. The
builders add their own details below "Package notes".

## Decision

### Modules

| Module | Owner | Role |
|---|---|---|
| `src/script/doc/` | P1 | Lossless profile document model. Used by the editor and by variable write-back. |
| `src/script/keys.ts` | P1 | The one key table (Inv §1.2 lesson, ADR 0082 in Cockpit). |
| `src/script/engine/` | P2 | Command parser, interpreter, pattern compiler, rule stores, timers, display pipeline. |
| `src/editor/` | P3 | Preact + CodeMirror 6 profile editor. Its own lazy chunk, separate from `src/chrome/`. |

`src/script/` never imports the DOM, Preact or CodeMirror. It is pure
TypeScript, unit tested in Node.

### Two parsers, one language

- **The document model** understands file structure only: top-level
  entries (command word, brace arguments, trailing text), comments,
  blank lines, and passthrough. It never executes anything.
- **The engine** loads a profile by executing its top-level commands in
  order, as tt++ reads a file. It tokenises bodies (`;`, `{}`, `\`
  escapes) at run time with its own tokenizer, cached per body.
- Both share one command table (name, kind, minimum abbreviation,
  inert flag) in `src/script/commands.ts`, owned by P1.

### Document model contract

- `parseProfile(text)` never throws. Every byte of the input belongs to
  exactly one node; `serialize(parseProfile(t)) === t` for every `t`.
- Entries of the five lite kinds (action, alias, highlight, macro,
  substitute) and `#variable` are exposed as typed entries with
  pattern, body, optional priority and the command word as written.
- Editing an entry re-serialises only that entry, in canonical form
  `#<word> {pattern} {body}[ {priority}]`, keeping the command word as
  written and the priority. Untouched entries keep their exact text.
- **Order is kept.** A new entry goes after the last entry of the same
  kind (after the last entry of any kind if none, separated by a blank
  line). The lite list sorts for display only. This replaces Cockpit's
  canonical re-sort (Inv §5.9), which spec §2.7 rules out.
- `setVariable(doc, name, value)` rewrites only the value argument of an
  existing top-level `#variable` entry.

### Key names

- Canonical form: modifiers in the order `Ctrl+Alt+Shift+Meta`, then the
  key, from `KeyboardEvent.code` with the `Key`/`Digit` prefix dropped:
  `F5`, `Numpad0`, `NumpadAdd`, `Alt+A`, `Ctrl+Shift+F1`, `Alt+1`.
- Reading accepts case-insensitive names, `Numpad 0`-style display
  names and the tt++ escape forms (`\eOp`…, `\e[15~`…, `\ea`, `^G`); the
  text is kept as written. Display names follow Inv §5.6.
- **Not bindable:** bare ESC (menu), Enter, printable keys without Ctrl
  or Alt (letters, digits, punctuation, space, with or without Shift),
  and keys the browser keeps (Ctrl+W/T/N, Ctrl+Shift+W/T/N, Ctrl+Tab,
  Ctrl+Shift+Tab). Numpad keys are bindable with or without NumLock.
- **A bound macro wins** over the input line's own use of a key (for
  example Ctrl+A or Alt+B), as in tt++. Unbound keys keep their input
  line meaning. The editor warns when a macro shadows an input key.

### Engine contract

- `ScriptEngine` owns two rule stores. **User** is replaced as a whole
  by `loadProfile(text)`. **System** is written only through code
  (`engine.system`) and is never serialised.
- `loadProfile` is atomic: it builds a new user store and swaps it in
  only when loading finished. Timers from the old store stop at the swap.
- Actions from both stores fan out: every matching rule fires, in
  priority order (lower first, default 5, ties in definition order).
- Nested definitions (an action defined inside an alias) are registered
  synchronously, in line order (Inv §6.4).
- Input: `engine.input(text)` handles a typed line: `#` commands,
  aliases, `;` splitting, `$var` expansion, unused-argument append.
  Commands for MUME go to `Sender.sendCommand`, one per command.
- **Built-ins.** The stage 1 commands (`#connect`, `#disconnect`,
  `#reconnect`, `#runlog`, `#replay`, `#help`) join the command table as
  client commands. `_send` is a built-in alias that sends its argument;
  it cannot be shadowed by a profile alias (the editor warns).
- **Echo.** Every command sent to MUME is echoed, as in stage 1. `_send`
  therefore behaves like a bare command. (Owner feedback wanted.)
- Unknown `#` commands and inert commands report through `sys.message`.
- Timers (`#ticker`, `#delay`) use an injectable clock.

### Display pipeline and bus

- New bus event `text.display`: `{ line: Line; source: Line }` for each
  line that is shown; `line` is the displayed copy, `source` the
  original. A gagged line emits nothing. The output pane subscribes to
  `text.display` instead of `text.line`. Capture and all other taps keep
  using `text.line`.
- Order per line: actions (on the original), then substitutes, then
  gags, then highlights (on the substituted text).
- Partial lines (`text.partial`) get substitutes and highlights but no
  actions; actions run when the line completes.
- `#showme` lines are shown through the display pipeline and run
  actions, as in tt++, with a recursion guard. They are not captured.
- Colour codes (`<xyz>`, `<Frrggbb>`, `<Frgb>`, `<Brrggbb>`) become style
  runs; unknown codes are dropped silently.

### Live profile and write-back

- The selected profile loads into the engine when a session starts, and
  again on Apply from the ESC menu.
- **Runtime variables** (owner decision 2026-09-27): when a script sets a
  variable that has a top-level `#variable` entry in the saved profile,
  the saved text is updated with `setVariable` (debounced, flushed on
  `pagehide` and disconnect). Only after a complete load ("has loaded"
  guard, Inv §5.9). Write-back is applied to the latest stored text, so
  an edit made in the editor meanwhile is not overwritten.
- Everything else created at runtime (rules, new variables) lives for
  the session.

### Editor host

- `src/editor/` exports `openProfileEditor(host)`, where the host gives
  the profile name and text, whether the session is live, and
  `apply(text) → { ok: true } | { ok: false; reason }`. The start page
  and the ESC menu provide the host; the ESC menu's host calls the
  engine.
- CodeMirror 6 (MIT) is added as a dependency for the editor view only.

## Consequences

- The profile text is always the source of truth; the lite view is a
  view over document entries.
- The game output pane depends on the display pipeline, so the engine
  sits on the hot path. It is measured by the benchmark (spec §1.3).

## Package notes

(P1–P3 append decisions made while building.)
