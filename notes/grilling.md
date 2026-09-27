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

Questions asked (awaiting answers):

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
