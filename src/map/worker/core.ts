// The map worker's logic (ADR 0020), apart from the worker globals so it
// runs in Node tests: map loading, the view, on-demand rendering, and
// tracking (player, prespam path, group mates; src/map/tracking.ts). The
// entry (map.worker.ts) feeds it `MainToWorker` messages.
//
// Tracking: every `events` batch goes through the Tracker. When the scene
// changed, the renderer gets it (`setScene`) and a render is requested;
// when a Room.Info was located the view re-centres on the player and
// switches to the player's layer (MMapper behaviour); `status` is posted
// when located / room / how changed. Learned server ids are saved through
// `WorkerHost.ids` when `persistIds` is on, and loaded after every load.
//
// Rendering is on demand: every change calls `requestRender()`, which
// draws once in the next animation frame (setTimeout fallback) and never
// while the pane is hidden.

import { type AssetResolver, assetResolver } from '../assets';
import { buildIndexes, type MapData } from '../model';
import { type Inflate, inflateZlib, mapHash, readMm2 } from '../mm2';
import { MAP_PROTOCOL_VERSION, type MainToWorker, type MapEvent, type MapSource, type WorkerToMain } from '../protocol';
import { type Renderer, createRenderer } from '../render/renderer';
import { Tracker } from '../tracking';
import type { LearnedIdStore } from './ids';
import { type View, ZOOM_MAX, ZOOM_MIN, centreOn, changeLayer, defaultView, pan, zoomAt } from '../view';

export interface WorkerHost {
  post(m: WorkerToMain): void;
  /** Frame scheduler (worker requestAnimationFrame, else a 16 ms timeout). */
  requestFrame(cb: () => void): void;
  fetch: typeof fetch;
  inflate?: Inflate;
  now(): number;
  /** Builds the renderer for a GL context (default `createRenderer`); `onChange` asks for a redraw. */
  createRenderer?: (gl: WebGL2RenderingContext, assets: AssetResolver, onChange: () => void) => Renderer;
  /** Where learned server ids persist (used only after `persistIds` on). */
  ids?: LearnedIdStore;
}

export class MapWorkerCore {
  map: MapData | null = null;
  view: View = defaultView();
  /** Canvas size in CSS px and the device pixel ratio. */
  private css = { w: 0, h: 0, dpr: 1 };
  private canvas: OffscreenCanvas | null = null;
  private renderer: Renderer | null = null;
  private visible = true;
  private scheduled = false;
  /** The newest load request; older results are dropped. */
  private loadReq = -1;
  /** Frames drawn (tests, debugging). */
  frames = 0;
  readonly tracker = new Tracker();
  private persistIds = false;
  private lastStatus = '';

  constructor(private readonly host: WorkerHost) {}

  handle(m: MainToWorker): void {
    switch (m.t) {
      case 'init':
        this.init(m);
        return;
      case 'load':
        void this.load(m.req, m.source);
        return;
      case 'resize':
        this.resize(m.width, m.height, m.dpr);
        return;
      case 'pan':
        this.setView(pan(this.view, m.dx, m.dy));
        return;
      case 'zoom':
        this.setView(zoomAt(this.view, m.steps, m.x, m.y, this.css.w, this.css.h));
        return;
      case 'layer':
        this.setView(changeLayer(this.view, m.dz));
        return;
      case 'visible':
        this.visible = m.visible;
        if (m.visible) this.requestRender();
        return;
      case 'events':
        this.events(m.events);
        return;
      case 'persistIds':
        this.persistIds = m.on;
        if (m.on) this.loadIds();
        return;
      case 'debugScene':
        this.debugScene(m);
        return;
      default:
        // An unknown message from a newer client: ignore (protocol.ts).
        return;
    }
  }

  private init(m: Extract<MainToWorker, { t: 'init' }>): void {
    if (m.protocol !== MAP_PROTOCOL_VERSION) {
      this.host.post({ t: 'error', stage: 'init', message: `map protocol ${m.protocol}, worker speaks ${MAP_PROTOCOL_VERSION}` });
      return;
    }
    this.canvas = m.canvas;
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = m.canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
      });
    } catch {
      gl = null;
    }
    if (!gl) {
      this.host.post({ t: 'error', stage: 'init', message: 'WebGL2 is not available' });
      return;
    }
    const make = this.host.createRenderer ?? createRenderer;
    const assets = assetResolver(m.assets, this.host.fetch);
    const glc = gl;
    const build = () => make(glc, assets, () => this.requestRender());
    this.renderer = build();
    m.canvas.addEventListener?.('webglcontextlost', (e) => {
      e.preventDefault();
      this.host.post({ t: 'error', stage: 'render', message: 'WebGL context lost' });
    });
    // Restored: everything on the GPU is gone; build the renderer again
    // and give it the map and the tracker's current scene.
    m.canvas.addEventListener?.('webglcontextrestored', () => {
      this.renderer?.dispose();
      this.renderer = build();
      this.renderer.setMap(this.map);
      if (this.map) this.renderer.setScene(this.tracker.current);
      this.resize(this.css.w, this.css.h, this.css.dpr);
      this.host.post({ t: 'restored' });
    });
    this.resize(m.width, m.height, m.dpr);
    this.host.post({ t: 'ready' });
  }

  private resize(w: number, h: number, dpr: number): void {
    this.css = { w, h, dpr };
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas && (this.canvas.width !== pw || this.canvas.height !== ph)) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.renderer?.resize(pw, ph, dpr);
    this.requestRender();
  }

  private setView(v: View): void {
    if (v === this.view) return;
    this.view = v;
    this.requestRender();
  }

  /** `debugScene` (development and tests): a scene, a centre and a zoom without the tracking side. */
  private debugScene(m: Extract<MainToWorker, { t: 'debugScene' }>): void {
    if (m.scene) this.renderer?.setScene(m.scene);
    let v = this.view;
    const c = m.center;
    if (c && 'room' in c) {
      const map = this.map;
      if (map && c.room >= 0 && c.room < map.roomCount) v = centreOn(v, map.x[c.room]!, map.y[c.room]!, map.z[c.room]!);
    } else if (c) {
      v = { ...v, x: c.x, y: c.y, layer: c.z };
    }
    if (m.zoom !== undefined) v = { ...v, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, m.zoom)) };
    this.view = v;
    this.requestRender();
  }

  /** Loads a map; the previous one stays if this fails. */
  async load(req: number, source: MapSource): Promise<void> {
    this.loadReq = req;
    const t0 = this.host.now();
    try {
      let map: MapData;
      let hash = '';
      let name: string;
      if (source.kind === 'data') {
        map = source.map;
        buildIndexes(map);
        name = source.name;
      } else {
        let bytes: Uint8Array;
        if (source.kind === 'url') {
          const res = await this.host.fetch(source.url);
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${source.url}`);
          bytes = new Uint8Array(await res.arrayBuffer());
          name = source.name ?? decodeURIComponent(source.url.split('/').pop() ?? source.url);
        } else {
          bytes = new Uint8Array(source.bytes);
          name = source.name;
        }
        map = await readMm2(bytes, this.host.inflate ?? inflateZlib);
        hash = await mapHash(bytes);
      }
      if (req !== this.loadReq) return;
      this.map = map;
      this.view = centreOn(this.view, map.selected.x, map.selected.y, map.selected.z);
      this.renderer?.setMap(map);
      this.tracker.setMap(map, hash);
      this.renderer?.setScene(this.tracker.current);
      this.postStatus();
      this.loadIds();
      this.host.post({
        t: 'loaded',
        req,
        info: {
          name,
          rooms: map.roomCount,
          infomarks: map.infomarks.count,
          serverIds: map.byServerId.size,
          hash,
          ms: Math.round(this.host.now() - t0),
        },
      });
      this.requestRender();
    } catch (err) {
      if (req !== this.loadReq) return;
      this.host.post({ t: 'error', stage: 'load', req, message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Applies a batch of game events (tracking.ts). */
  private events(events: readonly MapEvent[]): void {
    const r = this.tracker.apply(events);
    const map = this.map;
    const room = this.tracker.current.room;
    let draw = r.changed;
    if (r.moved && map && room !== null) {
      const v = centreOn(this.view, map.x[room]!, map.y[room]!, map.z[room]!);
      if (v.x !== this.view.x || v.y !== this.view.y || v.layer !== this.view.layer) {
        this.view = v;
        draw = true;
      }
    }
    if (r.changed) this.renderer?.setScene(this.tracker.current);
    if (draw) this.requestRender();
    this.postStatus();
    if (r.learned.length > 0 && this.persistIds && this.host.ids && this.tracker.mapHash !== '') {
      this.host.ids.save(this.tracker.mapHash, r.learned).catch(() => {});
    }
  }

  private postStatus(): void {
    const s = this.tracker.status;
    const key = `${s.located}|${s.room}|${s.how}`;
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.host.post({ t: 'status', located: s.located, room: s.room, how: s.how });
  }

  /** Loads the stored ids of the current map (when persisting). */
  private loadIds(): void {
    const hash = this.tracker.mapHash;
    const store = this.host.ids;
    if (!this.persistIds || !store || hash === '') return;
    store.load(hash).then(
      (ids) => {
        if (this.tracker.addLearned(hash, ids)) {
          this.renderer?.setScene(this.tracker.current);
          this.requestRender();
        }
      },
      () => {},
    );
  }

  /** Draws once in the next frame (coalesced; skipped while hidden). */
  requestRender(): void {
    if (this.scheduled || !this.renderer || !this.visible) return;
    this.scheduled = true;
    this.host.requestFrame(() => {
      this.scheduled = false;
      if (!this.renderer || !this.visible) return;
      try {
        this.renderer.render(this.view);
        this.frames++;
      } catch (err) {
        this.host.post({ t: 'error', stage: 'render', message: err instanceof Error ? err.message : String(err) });
      }
    });
  }
}
