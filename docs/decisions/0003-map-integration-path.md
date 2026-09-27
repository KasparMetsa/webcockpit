# 0003 — Map integration path

- Status: Accepted
- Date: 2026-09-27

## Context

intent.md Goal 9: an MMapper-based map added after the full client, with
the integration path fixed early so nothing built is incompatible. See
`notes/research/mmapper-integration.md`.

Key facts: MMapper Web is the full Qt app as a 36.6 MB WASM with no
JavaScript API. Modern MMapper and Play MUME's mapper locate the player by
GMCP `Room.Info` server room ids plus `Event.Moved`. The arda map data has
no licence; room texts belong to MUME.

## Decision

- **Primary:** our own map pane (TypeScript, TUI look) that imports
  MMapper map files supplied by the user and tracks position via GMCP,
  falling back to name/description matching for rooms without ids.
- **Kept open:** a patched MMapper WASM build hosted in a pane (iframe
  with a message bridge), fed from our stream.
- **Rejected:** MMapper as the proxy between client and MUME (36 MB before
  first byte, client depends on the map).
- Map data is never bundled; users import their own map file.

## Consequences

Stage 1 must satisfy the architectural constraints in section 5 of the
research note. These are carried into `spec.md`. In summary:

- One client-owned WebSocket.
- An ordered event bus exposing raw bytes, lines with prompt boundaries,
  GMCP (raw and parsed) and sent commands.
- Gags and substitutes affect display only.
- XML mode handled by the client.
- A single GMCP module registry including Room, Room.Chars and
  MUME.Client.
- A pane host able to hold a canvas or an iframe.
- Hosting compatible with cross-origin isolation.
- IndexedDB storage with room for a map store.
- The map behind a module boundary.
