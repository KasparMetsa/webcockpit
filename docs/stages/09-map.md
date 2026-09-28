# Stage 9 — Map

> Status: Owner testing (started 2026-09-28, before stage 8 by owner
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
borders. Options → Mapper imports another `.mm2` file.

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
- Map pane (`map`, on by default since owner test 2), Options → Mapper.
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
- [x] P3. Options → Mapper (import, use bundled, status), pane
      default placement, log player loader, map subset embedded in the
      HTML replay.
- [x] P4. Merge; bench with the map on (ADR 0020 gates); verification
      with screenshots (ADR 0020 "P4").
- [x] Test guide (main session).

## Test guide

**Start:** `cd ~/proj/webcockpit && npm run dev` (restart it if it was
already running), then open http://localhost:5173/.

1. **Turn the map on:** ESC → Options → Mapper → `[X] Show map
   pane` (or the Map row in Options → Panes → General). The pane floats
   top-right over the game text, with a border like the other panes. The
   first load takes about half a second (5.8 MB).
2. **Look:** compare with your MMapper at the same spot: tiles, walls,
   doors and door names, flags, up/down icons, lines, the yellow square.
   Anything that differs (colour, size, line, text) is wanted feedback,
   ideally with a screenshot from both.
3. **Mouse:** drag inside the map pans; the wheel zooms around the
   pointer; Ctrl+wheel changes layer. Drag the title row to move the pane,
   drop it in a dock, float it, resize it, turn the border off (Options →
   Panes → General). Typing still goes to the input line.
4. **Play live:** log in and walk. The map follows every move, also in
   rooms your map has no server id for. Pre-spam `n;n;n` (or quick moves):
   a yellow line shows the path ahead and shrinks as you arrive. A failed
   move (closed door) drops it.
5. **Group:** group with someone and split up: each mate should show on
   their room in their own colour with a name label, or as an arrow at the
   edge when outside the view. (This is the one thing we could not check
   without live GMCP.)
6. **Speed:** play as usual with the map on: sending and scrolling should
   feel exactly as with it off. Tell me if anything feels slower.
7. **Import:** Options → Mapper → Import map file… → another
   `.mm2` (e.g. `~/Documents/MMapper/arda-copy.mm2`). The pane reloads.
   `Use bundled map` goes back to arda.mm2.
8. **Replays:** History → a run you played with the map on → PLAY: the
   map follows along. EXPORT → HTML → open the file: the map is there too
   (the rooms you visited and a margin around them).

Feedback wanted: does it look like your MMapper, the default size and
place of the pane, group mates live, and anything that feels slower.

## Owner feedback

**Owner test 1 (2026-09-28):** "Everything seems to work." A group mate
was verified on the map live (Group `mapid` confirmed). Import of an
older map failed: `~/Downloads/arda(1).mm2` is version 36 ("only version
42 can be read"). Wanted: import older `.mm2` versions too, since some
users still run such files.

- [x] Read older `.mm2` versions (at least 36 → 42, as MMapper 26.06
      does). Done: versions 17–42, as MMapper 26.06 (ADR 0020 amendment).

**Owner test 2 (2026-09-28):** older map import works. Asked: the Mapper
page directly under Options (not Options → Panes), and the map pane on
by default. Done (ADR 0020 amendment); a VIEW recorded before the map
existed still replays with the map off. 1069 unit, 178 e2e.
