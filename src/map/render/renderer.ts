// Renderer seam (ADR 0020 "Modules"): the worker owns one Renderer and
// calls it on demand. P0 ships `ClearRenderer`, which only clears to the
// MMapper background; P1 replaces `createRenderer` with the WebGL2 tile
// renderer (atlases, per-layer meshes, connections, text …).

import type { AssetResolver } from '../assets';
import type { MapData } from '../model';
import type { View } from '../view';

/** MMapper background (owner config `#2e3436`), 0…1 RGB. */
export const MAP_BG: readonly [number, number, number] = [0x2e / 255, 0x34 / 255, 0x36 / 255];

export interface Renderer {
  /** A new map (null: none); meshes are rebuilt here, not per frame. */
  setMap(map: MapData | null): void;
  /** The drawing buffer size in device px and the CSS→device ratio. */
  resize(width: number, height: number, dpr: number): void;
  /** Draws one frame of `view`. */
  render(view: View): void;
  dispose(): void;
}

/** P0 renderer: clears to MAP_BG. */
export class ClearRenderer implements Renderer {
  private w = 1;
  private h = 1;
  constructor(private readonly gl: WebGL2RenderingContext) {}
  setMap(_map: MapData | null): void {}
  resize(width: number, height: number, _dpr: number): void {
    this.w = width;
    this.h = height;
  }
  render(_view: View): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(MAP_BG[0], MAP_BG[1], MAP_BG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  dispose(): void {}
}

/** The renderer the worker uses (assets are read through `assets` only). */
export function createRenderer(gl: WebGL2RenderingContext, _assets: AssetResolver): Renderer {
  return new ClearRenderer(gl);
}
