// TUI kit: shared contexts and hooks (services, settings, cell grid).

import { createContext } from 'preact';
import { useContext, useEffect, useLayoutEffect, useState } from 'preact/hooks';
import type { AppStatusState, AppStatusView } from '../../app/status';
import type { ProfileStore } from '../../profiles';
import type { Settings, SettingsStore } from '../../settings';
import type { CellMetrics, CellSize } from '../../theme/cells';

/** Everything the chrome needs from the rest of the app. */
export interface ChromeServices {
  settings: SettingsStore;
  cells: CellMetrics;
  profiles: ProfileStore;
  /** Build version for About (CLIENT_VERSION). */
  version: string;
}

export const ServicesCtx = createContext<ChromeServices | null>(null);

export function useServices(): ChromeServices {
  const s = useContext(ServicesCtx);
  if (!s) throw new Error('chrome: no services');
  return s;
}

/** The live settings (re-renders on every change). */
export function useSettings(): Readonly<Settings> {
  const { settings } = useServices();
  const [s, set] = useState(settings.get());
  useEffect(() => {
    set(settings.get());
    return settings.subscribe((next) => set(next));
  }, [settings]);
  return s;
}

/** The live cell size. */
export function useCells(): CellSize {
  const { cells } = useServices();
  const [c, set] = useState(cells.get());
  useEffect(() => {
    set(cells.get());
    return cells.subscribe((next) => set(next));
  }, [cells]);
  return c;
}

/** The live app status (ESC menu header). */
export function useStatus(view: AppStatusView): Readonly<AppStatusState> {
  const [s, set] = useState(view.get());
  useEffect(() => {
    set(view.get());
    return view.subscribe((next) => set(next));
  }, [view]);
  return s;
}

/** The pixel size of an element, tracked with a ResizeObserver. */
export function useElementSize(ref: { current: HTMLElement | null }): { w: number; h: number } {
  const [size, set] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      // Hidden (display: none): keep the last size, so showing again paints at once.
      if (w === 0 && h === 0) return;
      set((cur) => (cur.w === w && cur.h === h ? cur : { w, h }));
    };
    read();
    const RO = el.ownerDocument.defaultView?.ResizeObserver;
    if (!RO) return;
    const ro = new RO(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** The chrome's grid in cells, and which surface it is on. */
export interface Grid {
  cols: number;
  rows: number;
  /** `start`: the start page (2 blank rows above titles); `menu`: the ESC menu (1). */
  surface: 'start' | 'menu';
}

export const GridCtx = createContext<Grid>({ cols: 80, rows: 24, surface: 'start' });

export function useGrid(): Grid {
  return useContext(GridCtx);
}

/** Whole cells that fit in an element, and the pixel offsets that centre them. */
export interface HostGrid {
  cols: number;
  rows: number;
  /** Left/top offset in px of a cols × rows box centred in the element. */
  left: number;
  top: number;
  cellW: number;
  cellH: number;
}

export function useHostGrid(ref: { current: HTMLElement | null }): HostGrid {
  const size = useElementSize(ref);
  const c = useCells();
  const cols = c.w > 0 ? Math.floor(size.w / c.w) : 0;
  const rows = c.h > 0 ? Math.floor(size.h / c.h) : 0;
  return {
    cols,
    rows,
    left: Math.floor((size.w - cols * c.w) / 2),
    top: Math.floor((size.h - rows * c.h) / 2),
    cellW: c.w,
    cellH: c.h,
  };
}
