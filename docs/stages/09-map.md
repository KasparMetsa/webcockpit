# Stage 9 — Map

> Status: In progress (started 2026-09-28, before stage 8 by owner
> request).
> Source: spec §2.9 as amended by ADR 0020; owner brief 2026-09-28
> (screenshot of the owner's MMapper). Research:
> `notes/research/mmapper-rendering.md`, `notes/research/mmapper-integration.md`.

## Goal

The owner turns on the Map pane and sees exactly what their MMapper shows
today: the tiled 2D map around them, the yellow square on their room,
group mates on their rooms, and the path ahead when they pre-spam moves.
The map follows every move with no noticeable cost to sending commands or
scrolling text. It is a pane like the others: toggle, dock, float,
borders. Options → Panes → Mapper imports another `.mm2` file.

## Scope

In:

- `.mm2` v42 reader; bundled `arda.mm2` as the default map; import of a
  user `.mm2` (stored in IndexedDB).
- WebGL2 renderer in a worker, identical to MMapper's default 2D look:
  terrain/road/trail tiles, mob and load flags, walls, doors and door
  names, exits (up/down/climb, unmapped), connections (one-way, distant,
  up/down), infomarks, layer dimming, Cantarell text.
- Pan by drag, zoom by wheel (around the cursor), Ctrl+wheel layer,
  re-centre on every move.
- Locator: server id, then direction + name, then name + description
  (ADR 0020), with learned ids persisted.
- Current room marker, off-screen arrow, other-layer arrow; prespam path
  from sent moves (MMapper queue rules).
- Group mates from `Group.*` `mapid`, with MMapper colours and labels.
- Map pane (`map`, off by default), Options → Panes → Mapper.
- The in-app log player and the exported HTML replay show the map (the
  replay embeds a map subset around the visited rooms).

Out: editing, auto-mapping, weather, tilt/3D, room info panel, search,
path finding, `.xml`/web JSON import.

## Owner decisions

- 2026-09-28: tiles, MMapper default tileset as is; identical look to the
  owner's MMapper; map now (before stage 8).
- 2026-09-28: `arda.mm2` is bundled as the default (accepted risk:
  MUME room texts).
- 2026-09-28: read-only (no auto-mapping or editing).
- 2026-09-28: group room data comes from GMCP (`mapid`), per the owner.
- 2026-09-28: the map follows along in exported HTML replays.

## Tasks

- [x] Research notes, ADR 0020, stage file.
- [x] P0. Foundation: `public/map` assets (arda.mm2, pixmaps, Cantarell,
      licence README), `src/map/protocol.ts`, `mm2.ts` + `model.ts` with
      tests (synthetic and the real file), DB v7 `maps` + `mapIds`, pane
      id `map` plumbing, `MapPane` + `MapClient` + worker skeleton
      (transfers the canvas, clears to `#2e3436`, answers load with
      room counts).
- [x] P1. Renderer (`src/map/render/*`): atlases, per-layer meshes, draw
      order, connections, infomarks, text, zoom/pan/layer, characters
      and arrows. Screenshot parity with the owner's screenshot area.
- [x] P2. Tracking: locator, prespam path, group mates, event
      forwarding, `tests/fixtures/map-demo.log` from a real path.
- [x] P3. Options → Panes → Mapper (import, use bundled, status), pane
      default placement, log player loader, map subset embedded in the
      HTML replay.
- [x] P4. Merge; bench with the map on (ADR 0020 gates); verification
      with screenshots (ADR 0020 "P4").
- [ ] Test guide (main session).

## Test guide

(Written when the build is done.)

## Owner feedback

(After testing.)
