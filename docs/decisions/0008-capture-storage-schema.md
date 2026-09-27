# 0008 — Capture storage schema

- Status: Accepted
- Date: 2026-09-27

## Context

Stage 1 starts raw run capture (Inv §7.1, spec §1.4, ADR 0006). The raw
log must survive a tab closing without warning, cost no IndexedDB work
per line, and allow cheap download, playback and retention later.

## Decision

- **Database** `webcockpit`, version 1, shared by every later store.
  Upgrades are a chain of `if (oldVersion < N)` steps.
- **`runs`** (keyPath `runId`): `{ runId, character, startedUs,
  endedUs | null, sealed, bytes, lines }`. Indexes `character` and
  `startedUs`.
  - `runId` is `<Character>/<local time YYYY-MM-DDTHH-MM-SS>`, with a
    `-2`, `-3`, … suffix if the same character starts twice in a second.
  - `bytes` (UTF-8) and `lines` are updated in the same transaction as
    each chunk.
- **`runChunks`** (keyPath `[runId, seq]`): `{ runId, seq, firstUs,
  lastUs, text }`. `text` is the Cockpit `.log` format verbatim, so a
  download is the chunks concatenated in `seq` order.
- **Writes.** Lines are buffered in memory as formatted strings. A chunk
  is written every 2 s and on `pagehide` / `visibilitychange: hidden`.
- **Lifecycle.** A run starts at `playing` (after GMCP `Char.Name`) and
  is sealed (`sealed: true`, `endedUs`) when the connection leaves
  `playing`.
- **One writer.** The Web Lock `webcockpit-run-<Character>` is held for
  the whole run. When it is taken, this tab does not record and says so
  in the status line.
- **Orphans.** An unsealed run whose lock is free is sealed at start-up
  with `endedUs` = its last chunk's `lastUs` (or `startedUs` if it has
  no chunks).
- **No Web Locks or no IndexedDB** → capture is off and the reason is
  shown.
- Chunks are stored uncompressed for now.

## Rationale

- A 2 s chunk loses at most 2 s of log on a crash and keeps IndexedDB
  work off the hot path.
- Keeping the `.log` text verbatim makes the download trivial and keeps
  the format identical to Cockpit's, so the same tools read both.
- `[runId, seq]` keys give ordered range reads per run. They also allow
  deleting a whole run with one key range, which retention needs.

## Revisit if

- Storage size becomes a problem. Gzip per chunk via
  `CompressionStream` is the next step.
- The log player needs time-based seeking. `firstUs`/`lastUs` per chunk
  already support it, but an index may be needed.
