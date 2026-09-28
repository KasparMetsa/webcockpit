// Asset resolver for the map worker (ADR 0020 "Package notes"): every
// tile and font file is read through one function, so the app (files
// under public/map/) and the HTML replay (embedded data URIs / Blobs)
// share the renderer. Pure apart from `fetch`.

import type { AssetSource } from './protocol';

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
  return async (path) => {
    const f = Object.hasOwn(files, path) ? files[path] : undefined;
    if (f === undefined) throw new Error(`map asset ${path}: not included`);
    if (typeof f !== 'string') return f;
    return (await fetchFn(f)).blob(); // data: URI
  };
}
