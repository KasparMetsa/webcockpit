// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createPaneContext } from '../../src/panes/context';
import { MapPane, defaultMapHost, mapUnsupported } from '../../src/panes/map';

const place = (p: MapPane, w: number, h: number): void =>
  p.place({ rect: { x: 0, y: 0, w, h }, content: { x: 1, y: 1, w: w - 2, h: h - 2 }, framed: true }, { w: 8, h: 16 });

describe('MapPane', () => {
  it('builds a canvas and does nothing until shown', () => {
    const p = new MapPane(createPaneContext({ doc: document }));
    expect(p.label).toBe('Map');
    expect(p.blankWhenInactive).toBe(false);
    expect(p.content.querySelector('canvas')).not.toBeNull();
    expect(p.content.dataset.mapState).toBe('idle');
    p.dispose();
  });

  it('shows a notice where OffscreenCanvas is missing', async () => {
    const p = new MapPane(createPaneContext({ doc: document }));
    place(p, 30, 12);
    await Promise.resolve();
    expect(p.content.dataset.mapState).toBe('unsupported');
    expect(p.content.querySelector('.wc-map-notice')!.textContent).toMatch(/OffscreenCanvas/);
    p.dispose();
  });

  it('loads the bundled map by default', () => {
    const h = defaultMapHost();
    expect(h.source()).toEqual({ kind: 'url', url: '/map/arda.mm2', name: 'arda.mm2' });
    expect(h.assets).toEqual({ kind: 'base', url: '/map/' });
    expect(mapUnsupported(null)).toBe('no window');
  });
});
