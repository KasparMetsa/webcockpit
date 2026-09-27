// The Spotlights reel in the in-app player (ADR 0019 "Spotlights", Inv
// §7.6): a PlayerHost playing one timeline over every spotlight (each its
// window with a blank transition), with the spotlight header, the info box
// overlay, `←` / `→` and the markers of the moments. It starts playing with
// the chrome hidden (a pointer move or a key shows it; the info box stays)
// and parks paused at the end (the engine stops there). ESC closes the
// player (the shell shows the start page as it was).

import type { PlayerHost } from '../app/player-host';
import type { HeaderHint } from './strip';
import type { PlayerHeaderModel } from './view';
import { BOX_W, type Reel, countdownHalf, fmtDate, navTarget, reelMarks, spotAt, spotMoments, spotStarts } from './spotlight-reel';
import { SpotlightBox } from './spotlight-box';
import { BLANK_LINES } from './timeline';

/** Opens `reel` on `host` and starts playing. */
export function openSpotlightReel(host: PlayerHost, reel: Reel): void {
  const doc = host.el.ownerDocument;
  const win = doc.defaultView!;
  const { spots, chain } = reel;
  const total = spots.length;
  let starts: number[] = [];
  let moments: number[] = [];

  const go = (dir: -1 | 1): void => {
    const eng = host.engine;
    if (!eng) return;
    const t = navTarget(starts, eng.position, dir);
    if (t === null) return;
    // Parked at the end: moving on plays again.
    const parked = eng.atEnd;
    eng.seek(t);
    if (parked) eng.play();
  };
  const box = new SpotlightBox(doc, go);

  const onEsc = (): void => host.close();
  const hints: HeaderHint[] = [
    { text: 'ESC Back', drop: Infinity, cls: 'wc-player-back', onClick: onEsc },
    { text: '←→ Prev/next', drop: 1 },
  ];
  const header = (): PlayerHeaderModel => {
    const eng = host.engine;
    const i = eng ? spotAt(starts, eng.position) : 0;
    const s = spots[i]!;
    return {
      left: [
        { text: s.character + (s.level !== undefined ? ` (L${s.level})` : ''), cls: 'wc-player-name' },
        { text: `SPOTLIGHT ${i + 1} / ${total}` },
        { text: fmtDate(s.atUs) },
      ],
      hints,
    };
  };

  host.openChain(
    chain,
    [],
    { character: spots[0]!.character },
    {
      edits: { windows: spots.map((s) => ({ fromUs: s.fromUs, toUs: s.toUs })), blankLines: BLANK_LINES },
      marks: (tl) => {
        starts = spotStarts(tl);
        moments = spotMoments(tl, spots);
        return reelMarks(tl, spots);
      },
      view: {
        header,
        onEsc,
        keys: (e) => {
          if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
          if (e.key === 'ArrowRight') go(1);
          else if (e.key === 'ArrowLeft') go(-1);
          else return false;
          return true;
        },
        overlay: { el: box.el, keepVisible: true },
        startHidden: true,
      },
    },
  );

  // The box follows the engine (ticks at least every 250 ms while playing).
  let raf: number | null = null;
  const draw = (): void => {
    raf = null;
    const eng = host.engine;
    if (!eng || !box.el.isConnected) return;
    const p = eng.position;
    const i = spotAt(starts, p);
    const cellW = box.el.offsetWidth / BOX_W;
    box.update({
      index: i,
      total,
      spot: spots[i]!,
      half: countdownHalf(starts[i] ?? 0, moments[i] ?? 0, p),
      cols: cellW > 0 ? Math.floor(host.el.clientWidth / cellW) : Infinity,
    });
  };
  const schedule = (): void => {
    if (raf === null) raf = win.requestAnimationFrame(draw);
  };
  host.engine?.subscribe(schedule);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => (box.el.isConnected ? schedule() : ro.disconnect()));
    ro.observe(host.el);
  }
  draw();
}
