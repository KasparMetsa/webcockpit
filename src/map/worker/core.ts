// The map worker's logic (ADR 0020), apart from the worker globals so it
// runs in Node tests: map loading, the view, on-demand rendering. The
// entry (map.worker.ts) feeds it `MainToWorker` messages.
//
// Rendering is on demand: every change calls `requestRender()`, which
// draws once in the next animation frame (setTimeout fallback) and never
// while the pane is hidden.

import { type AssetResolver, assetResolver } from '../assets';
import { buildIndexes, type MapData } from '../model';
import { type Inflate, inflateZlib, mapHash, readMm2 } from '../mm2';
import { MAP_PROTOCOL_VERSION, type MainToWorker, type MapSource, type WorkerToMain } from '../protocol';
import { type Renderer, createRenderer } from '../render/renderer';
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
        // P2: locator, prespam path, group mates.
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
    // Restored: everything on the GPU is gone; build the renderer again.
    m.canvas.addEventListener?.('webglcontextrestored', () => {
      this.renderer = build();
      this.renderer.setMap(this.map);
      this.resize(this.css.w, this.css.h, this.css.dpr);
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
