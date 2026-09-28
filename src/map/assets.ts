// Asset resolver for the map worker (ADR 0020 "Package notes"): every
// tile and font file is read through one function, so the app (files
// under public/map/) and the HTML replay (embedded data URIs / Blobs)
// share the renderer. Pure apart from `fetch`.

import type { AssetSource } from './protocol';

/** A transparent 1×1 PNG: the HTML replay's answer for a tile it did not embed (`AssetSource.fallback`). */
export const EMPTY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';

/** Reads one asset by its path relative to the asset root (`pixmaps/…`, `fonts/…`). */
export type AssetResolver = (path: string) => Promise<Blob>;

export function assetResolver(src: AssetSource, fetchFn: typeof fetch = fetch): AssetResolver {
  if (src.kind === 'base') {
    const base = src.url.endsWith('/') ? src.url : `${src.url}/`;
    return async (path) => {
      const res = await fetchFn(base + path);
      if (!res.ok) throw new Error(`map asset ${path}: HTTP ${res.status}`);
      return res.blob();
    };
  }
  const files = src.files;
  const fallback = src.fallback;
  return async (path) => {
    let f = Object.hasOwn(files, path) ? files[path] : undefined;
    if (f === undefined && fallback !== undefined && path.startsWith('pixmaps/')) f = fallback;
    if (f === undefined) throw new Error(`map asset ${path}: not included`);
    if (typeof f !== 'string') return f;
    return (await fetchFn(f)).blob(); // data: URI
  };
}
