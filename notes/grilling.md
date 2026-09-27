# Grilling log

Raw Q&A from the intent sessions. Condensed into `intent.md` when settled.

## Established before grilling (2026-09-27)

- New codebase. Cockpit (`/home/ole/MUME`) is a knowledge and visual
  reference only, no code reuse.
- Runs fully in the user's browser, loaded from a link. No application
  server.
- Audience: hundreds of users, not only the owner.
- tt++-level client parity, minimal latency is the top priority.
- UI for profiles, logs, settings. GMCP integrated, including a GMCP
  editor (new compared to Cockpit).
- Dockable, freely arranged panes (map, group, comm, …).
- Configurable font, colors, cursor, like foot in Cockpit's Windows setup.
- TUI feel, very close to Cockpit visually.
- MMapper-like map as a late stage, designed for from the start.
- Built by Claude Code with subagents, in stages, owner tests between
  stages.

## Round 1

Questions asked:

1. Who is the user? New players who never used tt++, veterans who want
   tt++ power, or both? Who should it be best for first?
2. MUME only, or a generic MUD client?
3. Relationship with MUME: private hobby project, or known/endorsed by
   the MUME admins? (Affects the WebSocket origin question.)
4. What does tt++ parity mean concretely? User-written triggers and
   scripts? tt++ syntax, GUI, JavaScript, or a mix?
5. Should Cockpit's automations (autostab, autobow, affects, blinds,
   timers…) be built in, or left to users? Any automation deliberately
   NOT offered (MUME botting rules)?
6. Where does user data live? Browser-only (lost on clear, no sync) with
   file export/import, or is cross-device sync a requirement?
7. Platforms: desktop Chrome/Firefox/Safari? Mobile/tablet in or out?
8. How is "minimal latency" defined and measured? tt++ parity, faster
   than MUME's own web client, or a concrete number?

Context for Q3/Q6: no app server is possible only if MUME's WebSocket
endpoint accepts connections from our origin. A shared proxy would also
put hundreds of users behind one IP (multiplay/ban risk). Verify early.

### Answers (2026-09-27)

1. Best for veterans first.
2. MUME only.
3. Private hobby project. MUME management is not involved at this stage.
4. tt++ is the reference for speed and feature set (actions, aliases,
   substitutes, scripts, GMCP, logging, …). Syntax need not match tt++
   and it need not be a clone. Creating settings via menus instead of
   typing `#action xx yy` is fine.
5. Standalone user scripts (autostab, autobow, …) are not included.
   Everything else integrated in Cockpit (group, character, timers panes
   etc.) is in scope.
6. Browser storage only at first. Profile settings can be exported to a
   local file.
7. Desktop browsers (Firefox, Chrome). MUME is keyboard-played; mobile
   is out.
8. As fast as the terminal. Text scrolls instantly with no smoothing or
   perceived delay; sent commands go out as fast as possible. tt++ in a
   terminal is the reference.

Notes from round 1:

- Q3 + "no server" means we depend on MUME's public WebSocket endpoint
  accepting a foreign origin, with no help from MUME. Must be verified
  before spec.
- Q5 part "automation deliberately not offered" was not answered;
  follow-up in round 2.

## Round 2

Questions asked:

1. User scripting model: tt++-like command language (+ menus as editor),
   JavaScript, or menus only?
2. Import of existing tt++ / Cockpit configs: goal or not?
3. If MUME's WebSocket rejects our origin: what is acceptable fallback?
4. Automation limits: should the client itself restrict anything (MUME
   rules on botting)?
5. Multiple simultaneous characters/sessions in one tab?
6. Browser-reserved keys (Ctrl+W, Ctrl+T, …): accept limits, or push an
   installed-app (PWA) mode to capture more keys?
7. Logging: purpose and format (download as file, ANSI/HTML/plain)?
8. Success criterion for v1: owner replaces Cockpit for daily play?
   Public release to other players?
9. Open source and hosting (e.g. GitHub Pages under own account)?

### Answers (2026-09-27)

1. C: menus only.
2. No import from tt++ / Cockpit profiles needed.
3. Leans towards contacting MUME if blocked. An existing browser client
   (MMapper in the browser) already works against MUME, so the origin
   question is expected to be a non-issue.
4. Entirely the player's responsibility.
5. One character per tab. Multi-login is cheating in MUME; the player's
   responsibility.
6. Running in a normal browser tab is the priority. Capturing as many
   key combinations as possible is a bonus.
7. Logs are for saving sessions to share or review later. Mirror
   Cockpit's logging functionality fully (raw capture, runs, log
   player, export editor, …).
8. v1 is done when the owner judges the web version as good as Cockpit
   after live PvP use over several sessions.
9. Private until mature.

Notes from round 2:

- "Menus only" (Q2.1) vs "scripts" as a tt++ feature (Q1.4) needs
  clarifying: how much logic can a menu-built rule express?
- Cockpit logging is large: raw .log, per-run JSONL events, statistics,
  history, log player, export editor with HTML replay, spotlights.
  Needs ordering across stages.
- Cockpit relies on a local MMapper proxy for mapping. A browser tab
  cannot reach a local MMapper, so until the built-in map exists,
  players have no map. Affects stage order.

## Round 3

Questions asked (awaiting answers):

1. How much logic can menu-built rules express? Is it acceptable that
   things like autostab cannot be built by users?
2. Logging: which parts first, which parts late?
3. Map: no map until the built-in one exists. Acceptable, or should the
   map move earlier?
4. Other Cockpit features (readability modules, ESC popup, launcher,
   profile picker, statistics, spotlights): all in scope?
