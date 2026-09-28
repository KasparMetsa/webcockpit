// Main-thread side of the map (ADR 0020): starts the worker, transfers
// the pane's canvas to it and posts small messages. Loaded lazily by the
// Map pane (src/panes/map.ts) the first time it is shown, so none of this
// (nor the worker) is part of the app's cold start.
//
// Main-thread cost: one postMessage per call; map bytes are transferred,
// not copied. Nothing here parses or draws.

import {
  type AssetSource,
  MAP_PROTOCOL_VERSION,
  type MainToWorker,
  type MapEvent,
  type MapSource,
  type WorkerToMain,
} from './protocol';
import { spawnMapWorker } from './spawn-worker';

export interface MapClientOptions {
  canvas: HTMLCanvasElement;
  /** Canvas size in CSS px and devicePixelRatio. */
  width: number;
  height: number;
  dpr: number;
  assets: AssetSource;
  onMessage: (m: WorkerToMain) => void;
}

export class MapClient {
  private nextReq = 1;
  private disposed = false;

  private constructor(private readonly worker: Worker) {}

  /** Starts the worker and hands it the canvas (which becomes an OffscreenCanvas). */
  static async create(o: MapClientOptions): Promise<MapClient> {
    const worker = await spawnMapWorker();
    const client = new MapClient(worker);
    worker.addEventListener('message', (e: MessageEvent<WorkerToMain>) => {
      if (!client.disposed) o.onMessage(e.data);
    });
    worker.addEventListener('error', (e: ErrorEvent) => {
      if (!client.disposed) o.onMessage({ t: 'error', stage: 'init', message: e.message || 'map worker failed to start' });
    });
    const canvas = o.canvas.transferControlToOffscreen();
    client.post(
      { t: 'init', protocol: MAP_PROTOCOL_VERSION, canvas, width: o.width, height: o.height, dpr: o.dpr, assets: o.assets },
      [canvas],
    );
    return client;
  }

  private post(m: MainToWorker, transfer: Transferable[] = []): void {
    if (!this.disposed) this.worker.postMessage(m, transfer);
  }

  /** Loads a map; returns the request id echoed by `loaded` / `error`. */
  load(source: MapSource): number {
    const req = this.nextReq++;
    this.post({ t: 'load', req, source }, source.kind === 'bytes' ? [source.bytes] : []);
    return req;
  }

  resize(width: number, height: number, dpr: number): void {
    this.post({ t: 'resize', width, height, dpr });
  }

  pan(dx: number, dy: number): void {
    this.post({ t: 'pan', dx, dy });
  }

  zoom(steps: number, x: number, y: number): void {
    this.post({ t: 'zoom', steps, x, y });
  }

  layer(dz: number): void {
    this.post({ t: 'layer', dz });
  }

  visible(visible: boolean): void {
    this.post({ t: 'visible', visible });
  }

  /** Forwards a batch of game events (P2 batches per frame). */
  events(events: MapEvent[]): void {
    if (events.length > 0) this.post({ t: 'events', events });
  }

  dispose(): void {
    this.disposed = true;
    this.worker.terminate();
  }
}
