# 0006 — Browser storage

- Status: Accepted
- Date: 2026-09-27

## Decision

- **IndexedDB** holds all data:
  - profiles, settings, comm history, UI messages;
  - runs, stored as raw-log chunks indexed by time plus event records
    with precise timestamps;
  - the map store, later.
- **`navigator.storage.persist()`** is requested on first use.
- **Saving.** Data is saved as it changes. There is no save-on-exit.
- **One writer per character.** A Web Lock per character stops two tabs
  from recording the same character. Orphaned runs are sealed on the next
  start.
- **Export and import:**
  - a profile as one file;
  - all runs as one backup archive.

## Rationale

A browser tab can close without warning. Clearing site data loses
everything, so users need export. Raw logs are about 1 MB per played
hour, which makes `localStorage` unsuitable.
