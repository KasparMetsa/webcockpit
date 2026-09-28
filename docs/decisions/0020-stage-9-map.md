# 0020 — Stage 9: the map pane (MMapper look, tiles, worker renderer)

- Status: Accepted
- Date: 2026-09-28
- Amends: ADR 0003 (TUI look → MMapper tiles; nothing bundled → arda.mm2
  bundled), spec §2.9, spec §5 order (stage 9 is built before stage 8).

## Context

The owner wants the map now, before hardening (2026-09-28). New owner
direction, replacing the "TUI map" of ADR 0003:

- The map looks identical to the owner's MMapper 2D view: tiles, not
  characters. The default MMapper tileset is used as is.
- Only the map canvas: no menus, status bars, clock, weather, tilt/3D.
- Drag inside the map pans; wheel zooms; the pane is moved by its title
  row like other panes. Same borders (toggleable), toggle, dock and
  float as other panes.
- Group mates are shown on the map. Pre-spammed moves show the path
  ahead, as in MMapper.
- Options → Panes → Mapper imports a new MMapper map file. The default
  map is the owner's `arda.mm2`, **bundled with the client** (owner
  decision; the file holds MUME's room texts, which have no licence —
  accepted risk, revisit before any public release).
- Read-only: no auto-mapping, no editing (owner decision).
- Speed is critical: the map must not slow sending or text scrolling.

Research: `notes/research/mmapper-rendering.md` (MMapper 26.06.0, the
owner's version; `.mm2` v42 format; exact rendering rules; colours).
MMapper is GPL-2.0-or-later and WebCockpit is GPL-3.0-or-later (ADR
0001), so copying MMapper's tiles and porting its algorithms is allowed.
The files carry their origin and licence notice (`public/map/README`).

## Decision

### Architecture: everything in one worker

- The map runs in a dedicated module worker (`src/map/worker/`) that owns
  an `OffscreenCanvas` (WebGL2). Load (fetch or imported bytes) →
  `DecompressionStream('deflate')` → `.mm2` parse → mesh build →
  render, all off the main thread.
- The main thread only transfers the canvas and posts small messages.
  Game events are forwarded in batches: a subscriber pushes to an array
  and schedules one `postMessage` per microtask/frame. Nothing runs in
  the `cmd.sent` key-press stack beyond an array push.
- Rendering is on demand (view, position, path or group change),
  coalesced per worker animation frame (`setTimeout` fallback). No
  continuous loop.
- Main thread forwards only what the map needs:
  - `gmcp` for `Room.Info`, `Event.Moved`, `Group.Set/Add/Update/Remove`,
    `Char.StatusVars` (race, for troll exits), and `conn.state`;
  - `cmd.sent` (text only);
  - `text.line` only for lines matching one precompiled regex of MMapper's
    move-failure and death messages (research §6.2).
- The locator (which room am I in) runs in the worker, next to the map
  data.

### Modules

| Module | Role |
|---|---|
| `src/map/mm2.ts` | `.mm2` v42 reader (pure; worker and Node). Rejects other versions with a clear error. |
| `src/map/model.ts` | `MapData`: compact typed arrays (coords, terrain, flags, exits, server ids), name/desc strings, infomarks; incoming-exit index; server-id → room index; name hash index. |
| `src/map/locate.ts` | Locator (pure): Room.Info/Event.Moved → room index. |
| `src/map/path.ts` | Prespam queue and path walk (pure). |
| `src/map/group.ts` | Group positions from `mapid` and MMapper's colour generator (pure). |
| `src/map/render/*` | WebGL2 renderer: atlases, per-layer static meshes, connections, infomarks, text (Cantarell BMFont), characters, off-screen arrows. |
| `src/map/worker/map.worker.ts` | Worker entry and message protocol. |
| `src/map/client.ts` | Main-thread `MapClient`: worker lifecycle, event forwarding, protocol. |
| `src/panes/map.ts` | `MapPane` (PaneShell): canvas, pointer/wheel → worker, resize/DPR. |
| `src/chrome/frames/options-mapper.tsx` | Options → Panes → Mapper. |
| `public/map/` | `arda.mm2`, MMapper `pixmaps/`, Cantarell BMFont, licences. |

`src/map/*` has no DOM. Worker/protocol types in `src/map/protocol.ts`.

### Locating the player

Only 4 912 of 30 074 rooms in `arda.mm2` have a server id, so an id
lookup alone fails for most of the map. Order, per `Room.Info` (with
`Event.Moved` direction when one came since the last room):

1. `Room.Info.id` matches a room's server id → that room.
2. From the last known room, follow the moved direction's exit if it has
   exactly one target and the target's name matches `Room.Info.name`.
3. Rooms whose name and description equal `Room.Info` (normalised
   whitespace); if several, prefer one adjacent to the last known room
   via the moved direction, then the one whose exit set matches; unique
   only.
4. Otherwise unknown: the last room stays drawn, the marker switches to
   MMapper's "far" outline style.

A match found by 2 or 3 records `server id → room` in memory (and in
IndexedDB `mapIds` keyed by map hash, so it survives reloads). The map
file is never changed.

### Group mates

MMapper reads `mapid` (server room id) and `room` from `Group.*`
(`group/CGroupChar.cpp:60`); the owner confirms MUME sends them. The
map keeps its own member table in the worker, keyed by the `Group.*`
id, and draws a member when `mapid` resolves (server id or learned id).
Colours, shared-room rotation, labels and off-screen arrows as in
research §7. The existing `GroupModel` is not changed.

### Map files and storage

- Default: `public/map/arda.mm2`, fetched by the worker on first show
  (lazy; not part of cold start).
- Import: Options → Panes → Mapper → Import reads a `.mm2` file; the
  bytes are stored in IndexedDB (DB v7, store `maps`, one record
  `current` with name, size, date, bytes). "Use bundled map" deletes it.
  The worker validates before the record is replaced; a bad file
  flashes an error and keeps the current map.
- Only `.mm2` (v42) is supported now. `.xml` / web JSON stay open.

### Pane

- `PaneId` `map`, label `Map`. Default `on: false`, border on. When
  turned on and not placed before, it floats at the owner's screenshot
  position (top-right over the output, 50 % × 35 % of the window).
- Left-drag pans (pointer capture; focus returns to the input on
  release like other panes); wheel zooms ×1.175 per notch around the
  cursor (0.04…5); Ctrl+wheel changes layer; every move re-centres on
  the player (MMapper behaviour).
- Canvas background MMapper `#2e3436` (owner config), not the pane tint.

### Replays

- The in-app log player shows the map: its App gets a map loader that
  fetches the same map (no DB needed for the bundled map).
- The HTML replay includes the map (owner, 2026-09-28, replacing the
  first draft of this ADR). The export embeds a **map subset**: the rooms
  visited in the exported chain plus a margin around them (and the
  connections/infomarks among them), and only the tiles and font pages
  that subset uses, inline in the file. The replay bundle starts the
  same worker code as an inline blob worker (works from `file://`).
  Target: the subset adds well under 1 MB for a normal fight.
- The map used is the one active at export time.

### Performance gates

- Existing bench budgets hold with the map pane on and a Room.Info-heavy
  fixture replaying (`tests/fixtures/map-demo.log`, generated from a real
  path through `arda.mm2`).
- Main-thread time per forwarded event < 0.05 ms; no main-thread task
  > 5 ms caused by the map (load included).

## Consequences

- WebGL2 + OffscreenCanvas + module workers are required for the map
  (Chrome, Firefox, Safari ≥ 17). Without them the pane shows a notice;
  the client is unaffected.
- `public/map` adds ~7 MB to the deploy, loaded only when the map is on.
- The replay bundle grows by the renderer and worker code.

## Package notes

(Builders add details here.)
