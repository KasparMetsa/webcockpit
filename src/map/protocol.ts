// Map worker protocol (ADR 0020 "Architecture"): the only messages between
// the main thread (src/map/client.ts) and the map worker
// (src/map/worker/map.worker.ts). Plain structured-clone data; the canvas
// and byte buffers are transferred.
//
// Extending it: add a new member to a union with a new `t` value. Both
// sides ignore a `t` they do not know, so a newer client and an older
// worker (or the reverse) never break each other within one build. Never
// change the meaning of an existing field; add an optional one instead.
//
// Coordinates: every pixel value is in CSS px relative to the canvas'
// top-left corner; the worker multiplies by `dpr` itself.

import type { ConnState } from '../core/types';
import type { MapData } from './model';

/** Bump when a change is not backwards compatible (checked in `init`). */
export const MAP_PROTOCOL_VERSION = 1;

// ------------------------------------------------------------ assets

/**
 * Where the worker finds its static assets (tiles, BMFont), by path
 * relative to the asset root: `pixmaps/terrain-field.png`,
 * `fonts/Cantarell18.fnt` …
 *
 * - `base`: fetched from `url + path` (the app: `${BASE_URL}map/`).
 * - `inline`: looked up in `files` (the HTML replay embeds the files it
 *   needs as data URIs or Blobs); a missing path is an error.
 */
export type AssetSource =
  | { kind: 'base'; url: string }
  | { kind: 'inline'; files: Record<string, string | Blob> };

// --------------------------------------------------------------- maps

/**
 * A map to load.
 * - `url`: a `.mm2` file to fetch (the bundled `arda.mm2`).
 * - `bytes`: a `.mm2` file in memory (an import, or the subset an HTML
 *   replay embeds; transfer the buffer). `name` is shown in status text.
 * - `data`: an already parsed map (structured clone of `MapData`; e.g. a
 *   subset cut on the main thread by `subsetMap`). Derived indexes are
 *   rebuilt by the worker, so they may be left empty.
 */
export type MapSource =
  | { kind: 'url'; url: string; name?: string }
  | { kind: 'bytes'; bytes: ArrayBuffer; name: string }
  | { kind: 'data'; map: MapData; name: string };

/** What the worker reports after a successful load. */
export interface MapInfo {
  name: string;
  rooms: number;
  infomarks: number;
  /** Rooms that have a MUME server id. */
  serverIds: number;
  /** SHA-256 prefix of the file bytes (hex, 32 chars); `''` for `data` sources. */
  hash: string;
  /** Load time in the worker, ms (fetch + inflate + parse + index). */
  ms: number;
}

// ------------------------------------------------------------- events

/** GMCP packages the map uses (ADR 0020); the main thread forwards only these. */
export const MAP_GMCP_PACKAGES = [
  'Room.Info',
  'Event.Moved',
  'Group.Set',
  'Group.Add',
  'Group.Update',
  'Group.Remove',
  'Char.StatusVars',
] as const;
export type MapGmcpPackage = (typeof MAP_GMCP_PACKAGES)[number];

/**
 * Move-failure line kinds (research §6.2): `fail` pops the head of the
 * prespam queue ("Alas, you cannot go that way..." and the others),
 * `dead` clears it ("You are dead!").
 */
export type MoveFailureKind = 'fail' | 'dead';

/** One forwarded game event. */
export type MapEvent =
  | { k: 'gmcp'; pkg: MapGmcpPackage; data: unknown }
  | { k: 'cmd'; text: string }
  | { k: 'fail'; kind: MoveFailureKind }
  | { k: 'conn'; state: ConnState; replay?: boolean };

// ---------------------------------------------------- main → worker

export type MainToWorker =
  | {
      t: 'init';
      protocol: number;
      /** Transferred from the pane's `<canvas>`. */
      canvas: OffscreenCanvas;
      /** Canvas size in CSS px, and devicePixelRatio. */
      width: number;
      height: number;
      dpr: number;
      assets: AssetSource;
    }
  | { t: 'load'; req: number; source: MapSource }
  | { t: 'resize'; width: number; height: number; dpr: number }
  /** Drag: the grabbed point moved by (dx, dy) CSS px. */
  | { t: 'pan'; dx: number; dy: number }
  /** Wheel: `steps` notches (positive = zoom in) around (x, y) CSS px. */
  | { t: 'zoom'; steps: number; x: number; y: number }
  /** Ctrl+wheel: layer change (positive = up). */
  | { t: 'layer'; dz: number }
  /** A batch of game events, in order. */
  | { t: 'events'; events: MapEvent[] }
  /** The pane was hidden or shown (the worker skips rendering while hidden). */
  | { t: 'visible'; visible: boolean };

// ---------------------------------------------------- worker → main

export type WorkerToMain =
  /** After `init`: WebGL2 is up (or `error` with stage `init` instead). */
  | { t: 'ready' }
  | { t: 'loaded'; req: number; info: MapInfo }
  /**
   * `init`: no WebGL2 / context lost; `load`: the map could not be loaded
   * (the previous map, if any, stays); `render`: a draw failed.
   */
  | { t: 'error'; stage: 'init' | 'load' | 'render'; req?: number; message: string }
  /** Locator state (P2): the player's room index, or null when unknown. */
  | { t: 'status'; located: boolean; room: number | null };
