# WebCockpit — Intent

> Status: APPROVED by owner 2026-09-27.
> Source: `notes/grilling.md`, rounds 1–3 (2026-09-27).

## Vision

A MUME client that runs entirely in a desktop browser, opened from a link,
with no installation and no application server. It should feel as fast
as TinTin++ in a terminal and look and behave nearly identically to
Cockpit (`/home/ole/MUME`): the same start page, panes, menus, design and
TUI feel. It is a new codebase; Cockpit is a knowledge and visual
reference only.

## Users

- **Primary: MUME veterans**, including PvP players, who today use tt++,
  Cockpit or similar power clients, and who want the same speed and
  control without installing anything.
- One character per browser tab. Multi-login rules are the player's
  responsibility, not the client's.
- New players are welcome but are not the design target.

## Goals

1. **Latency on par with tt++ in a terminal.** Incoming text renders
   instantly, with no smooth scrolling, animation or perceived delay. A
   sent command leaves the browser as fast as possible. tt++ is the
   reference.
2. **tt++-level client features:** actions, aliases, substitutes,
   highlights, gags, hotkeys/macros, variables and scripting logic,
   GMCP, logging.
3. **A profile editor that mirrors Cockpit's:**
   - a *lite view* with forms for aliases, actions, hotkeys, highlights,
     substitutes, …;
   - an *editor view* where the whole profile is edited as text in tt++
     syntax.

   Both views edit the same profile.
4. **Cockpit's integrated features:**
   - Panes: character, timers, group, communication, UI messages.
   - Start page with profile picker.
   - ESC menu.
   - Runs.
   - Statistics.
   - History.
   - Log player.
   - Export editor with HTML replay.
   - Spotlights.

   The default layout looks like Cockpit. Panes can be docked and
   arranged freely, toggled on and off, and customised like in Cockpit.
5. **Full GMCP integration, plus a GMCP editor** (new compared to
   Cockpit).
6. **Configurable look:** font, colours and cursor, like foot in
   Cockpit's Windows setup.
7. **Profile data in the browser,** with export and import of a profile
   as a local file.
8. **Hotkeys in a normal browser tab.** Every key combination the browser
   allows can be bound.
9. **An MMapper-based map,** built after the full client works. It will
   either integrate MMapper directly or be new work based on MMapper.
   Getting this integration right is critical. The integration path is
   researched and decided before the spec is approved, so that nothing
   built before then is incompatible with MMapper.

## Non-goals

- Generic MUD client: MUME only.
- Mobile and tablet: desktop Firefox and Chrome only.
- Import of existing tt++ or Cockpit profiles.
- Byte-for-byte tt++ compatibility. tt++ syntax is used in the editor
  view, but the exact supported command set is defined in `spec.md`.
- Cockpit's standalone scripts (autostab, autobow, key manager, …) and
  readability modules.
- Automation limits enforced by the client: following MUME's rules is
  the player's responsibility.
- Cross-device sync or user accounts (not in the first version).
- Pixel-identical copy of Cockpit: the target is "very close".

## Constraints

- **No application server.** Static files only; the browser connects
  directly to MUME's WebSocket endpoint. MMapper's browser client already
  does this, so it is expected to work. This will be verified before the
  spec. If MUME blocks us, the fallback is to contact MUME.
- **Private hobby project.** MUME management is not involved at this
  stage. The repository and deployment stay private until the owner
  judges the client mature.
- **New code only.** Nothing is copied or ported from Cockpit.
- **Build process:** Claude Code with subagents, in stages. Each stage
  ends with something the owner can test in the browser.

## Success criteria

- **v1 is done** when the owner, after live PvP use over several
  sessions, judges WebCockpit to be as good as Cockpit.
- **Latency:** in side-by-side use with tt++, the owner notices no
  difference in output or command send speed.
- **Look and feel:** Cockpit users recognise the start page, panes and
  menus immediately.
- **Profile round-trip:** a profile can be exported to a file and
  re-imported with nothing lost, in both lite view and editor view.

## Open questions

None blocking. The following are decided in `spec.md` or ADRs:

- The supported tt++ command subset.
- Stage order.
- Storage layout.
- Hosting while private.

Researched before spec approval: how MMapper will be integrated (see
Goal 9).
