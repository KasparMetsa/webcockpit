// The banner (Inv §10.7): starfield + MUME/COCKPIT wordmark, 45 × 11
// cells, centred. Stars twinkle on one timer (12 Hz on the start page,
// 6 Hz in the ESC menu) that runs only while the banner is visible and
// the page is not hidden; a tick touches only the star spans whose look
// changed (class and glyph), never re-renders.

import type { VNode } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { BANNER_W, STARS, bannerRows, makeAnims, starLook } from './banner-data';
import { centreLeft } from './kit/nav';
import { useGrid } from './kit/hooks';
import { indent } from './kit/widgets';

export interface BannerProps {
  /** Redraw rate. */
  hz: number;
  /** Animate (the banner's frame is the visible one). */
  run: boolean;
}

const CLS = { word: 'wc-banner-word', 'word-dim': 'wc-banner-word-dim', space: '', star: '' } as const;

export function Banner(p: BannerProps): VNode {
  const { cols } = useGrid();
  const rows = useMemo(() => bannerRows(), []);
  const anims = useMemo(() => makeAnims(), []);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    const doc = host?.ownerDocument;
    const win = doc?.defaultView;
    if (!p.run || !host || !doc || !win) return;
    const spans = STARS.map((_, i) => host.querySelector<HTMLSpanElement>(`[data-star="${i}"]`));
    const t0 = win.performance.now();
    const tick = (): void => {
      if (doc.hidden) return;
      const t = (win.performance.now() - t0) / 1000;
      STARS.forEach((s, i) => {
        const el = spans[i];
        if (!el) return;
        const look = starLook(s, anims[i]!, t);
        const cls = `wc-star-${look.tier}`;
        if (el.className !== cls) el.className = cls;
        if (el.textContent !== look.glyph) el.textContent = look.glyph;
      });
    };
    tick();
    const id = win.setInterval(tick, Math.round(1000 / p.hz));
    return () => win.clearInterval(id);
  }, [p.run, p.hz, anims]);

  const at = centreLeft(cols, BANNER_W);
  return (
    <div class="wc-banner" ref={ref} aria-label="MUME Cockpit" role="img">
      {rows.map((segs, r) => (
        <div class="wc-line" key={r} style={indent(at)}>
          {segs.map((s, k) =>
            s.cls === 'star' ? (
              <span key={k} data-star={s.star} class={`wc-star-${STARS[s.star!]!.tier}`}>
                {s.text}
              </span>
            ) : s.cls === 'space' ? (
              s.text
            ) : (
              <span key={k} class={CLS[s.cls]}>
                {s.text}
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
