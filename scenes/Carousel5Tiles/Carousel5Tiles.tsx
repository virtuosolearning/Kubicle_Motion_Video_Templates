import { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { z } from 'zod';

// Carousel5Tiles — 5-tile 3D coverflow carousel.
//   • Platinum-blue (#E6ECF2) canvas — matches the rest of the template library.
//   • Each tile: 540×760 portrait card, linear-gradient(135deg, #052438 → black),
//     subtle white inner border + dodger-blue inner glow at top-left.
//   • Center tile (slot 0) is head-on; flanking tiles rotateY ∓22°/∓44° to
//     produce thin sliver edges (coverflow effect). Side tiles fade out via
//     opacity so they recede into the platinum background.
//   • Content per tile: icon (110 px) + Satoshi Black 46 px dodger-blue title +
//     thin divider + up to 3 Satoshi Medium 33 px white bullets.
//   • Cycle: 0.0–0.8 s intro fade/scale; then 5 dwell+slide windows each
//     ~2.6 s long. The final tile dwells (no wrap-around) when loopAfterLast
//     is false. Default duration 450 frames (15 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const carousel5TilesTileSchema = z.object({
  // Tile heading. Satoshi Bold 44 px, dodger-blue. ≤28 chars so it fits in one
  // line of the 540-wide tile.
  title:   z.string().min(1).max(28),
  // Icon id resolving to icons/<id>.svg. Provided icons: terminal, sparkles,
  // zap, layers, shield-check. Authors may add their own.
  icon:    z.string().min(1),
  // 2–3 short bullet points. Satoshi Medium 33 px white. ≤34 chars each.
  bullets: z.array(z.string().min(1).max(34)).min(2).max(3),
});

export const carousel5TilesTimingsSchema = z
  .object({
    introDuration: z.number().positive(),   // seconds — intro fade/scale
    tileWindow:    z.number().positive(),   // seconds — dwell+slide per tile
    slideDuration: z.number().positive(),   // seconds — slide portion of window
    loopAfterLast: z.boolean(),
  })
  .partial();

export const carousel5TilesSchema = z.object({
  // 2 to 5 tiles. The coverflow ring sizes itself to the tile count (slotFor /
  // computeCarouselIndex both use tiles.length), so fewer tiles just makes a
  // shorter ring — the centred tile and its neighbours render the same way.
  tiles:   z.array(carousel5TilesTileSchema).min(2).max(5),
  timings: carousel5TilesTimingsSchema.optional(),
});

export type Carousel5TilesProps = z.infer<typeof carousel5TilesSchema>;

export const carousel5TilesMeta = {
  description:
    '3D coverflow carousel: 5 oxford-blue portrait tiles cycle horizontally on ' +
    'a black canvas, each showing an icon + dodger-blue title + 2-3 white ' +
    'bullets in Satoshi Medium. Best for cycling related concepts.',
  authoringNotes:
    'Supply 2 to 5 tiles — the coverflow ring sizes to the count, so fewer ' +
    'tiles simply makes a shorter cycle. Titles ≤28 chars, bullets ≤34 chars each ' +
    '(2-3 bullets per tile). Use parallel imperative phrasing across tiles. ' +
    'Pick an icon id matching the catalog (terminal, sparkles, zap, layers, ' +
    'shield-check) or drop a new patched SVG into icons/. Default duration ' +
    '450 frames (15 s) — sized so each tile gets ~2.6 s on stage. Set ' +
    'timings.loopAfterLast=true to continue cycling instead of holding the ' +
    'last tile.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BLACK_SRC  = staticFile('fonts/Satoshi-Black.woff2');
const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const STAGE_CX = 960;
const STAGE_CY = 540;

const TILE_W = 540;
const TILE_H = 760;
const TILE_GAP = 520;             // px between adjacent tile centers
const TILE_ROT_DEG = -22;         // each +1 slot rotates by this many degrees
const PERSPECTIVE = 1800;

const ICON_SIZE = 110;
const CONTENT_PAD = 56;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  introDuration: 0.80,
  tileWindow:    2.60,   // 5 × 2.60 = 13.0 s, + 0.8 intro = 13.8 s; final hold fills to 15 s
  slideDuration: 0.60,
  loopAfterLast: false,
} as const;

const easeInOutCubic    = Easing.inOut(Easing.cubic);
const easeOutCubic      = Easing.out(Easing.cubic);
const easeOutBackSubtle = Easing.out(Easing.back(1.05));

// ─── Font loading ────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const black  = new FontFace('Satoshi', `url(${SATOSHI_BLACK_SRC}) format('woff2')`,  { weight: '900', display: 'block' });
    const bold   = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,   { weight: '700', display: 'block' });
    const medium = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`, { weight: '500', display: 'block' });
    const [k, b, m] = await Promise.all([black.load(), bold.load(), medium.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(k);
    fonts.add(b);
    fonts.add(m);
  })();
  return fontsPromise;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Signed slot for a tile relative to the centred carousel index.
//
// For 3+ tiles we wrap around the ring (shortest path) so tiles can re-enter
// from the opposite side — the coverflow loop. For exactly 2 tiles that ring is
// degenerate: the "other" tile sits at the antipode (distance n/2 = 1), and the
// wrap flips the exiting tile from slot −1 to +1 mid-transition, teleporting it
// across the screen (the cull at 1.4 can't hide it because the flip is at 1.0).
// So with 2 tiles we use the raw linear distance: the exiting tile simply slides
// off one side and stays off — no reappearing ghost.
function slotFor(tileIdx: number, carouselIdx: number, n: number): number {
  const raw = tileIdx - carouselIdx;
  if (n < 3) return raw;
  let d = ((raw % n) + n) % n;
  if (d > n / 2) d -= n;
  return d;
}

// Carousel index float — which tile is currently centered.
// Window n starts at introEndFrame + n * tileWindowFrames.
// Dwell: most of the window is held at integer n.
// Slide: last `slideFrames` of each window eases linearly from n → n+1.
function computeCarouselIndex(
  frame: number,
  introEndFrame: number,
  tileWindowFrames: number,
  slideFrames: number,
  tileCount: number,
  loop: boolean,
): number {
  if (frame <= introEndFrame) return 0;

  const elapsed = frame - introEndFrame;
  const lastWindowEnd = tileWindowFrames * tileCount;

  if (!loop && elapsed >= lastWindowEnd) {
    return tileCount - 1;
  }

  const totalElapsed = loop ? elapsed % (tileWindowFrames * tileCount) : elapsed;
  const n = Math.floor(totalElapsed / tileWindowFrames);
  const intoWindow = totalElapsed - n * tileWindowFrames;

  // Slide happens at the END of each window (so the next tile is showcased
  // at the start of the next window).
  const slideStart = tileWindowFrames - slideFrames;
  if (intoWindow < slideStart) {
    return n;
  }
  // Don't slide past the last tile when not looping — otherwise the carousel
  // would wrap around (tile 4 → tile 0) and produce a visible glitch.
  if (!loop && n >= tileCount - 1) {
    return tileCount - 1;
  }
  const slideProg = (intoWindow - slideStart) / slideFrames;
  const eased = easeInOutCubic(Math.max(0, Math.min(1, slideProg)));
  return n + eased;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Tile({
  tile,
  slot,
}: {
  tile: z.infer<typeof carousel5TilesTileSchema>;
  slot: number;
}) {
  // Only show center + immediate neighbors. Anything further back overlaps
  // the slot-±1 tile and reads as a translucent double-rectangle on the
  // platinum background. The 1.4 cull leaves room for the cross-fade as a
  // back tile slides in from slot 2 → 1 (or out from −1 → −2) during a
  // transition — past that point it's hidden entirely.
  const absSlot = Math.abs(slot);
  if (absSlot > 1.4) return null;

  // Translate + rotate.
  const translateX = slot * TILE_GAP;
  const rotateY    = slot * TILE_ROT_DEG;

  // Opacity: center tile fully opaque, slot ±1 at half, fully hidden by 1.4.
  const tileOp = interpolate(absSlot, [0, 1, 1.4], [1, 0.5, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  // Content (icon + title + bullets) only visible on near-center tiles.
  const contentOp = interpolate(absSlot, [0, 0.5], [1, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  // z-index: center tile on top.
  const z = 100 - Math.round(absSlot * 10);

  return (
    <div
      style={{
        position: 'absolute',
        left: STAGE_CX,
        top:  STAGE_CY,
        width:  TILE_W,
        height: TILE_H,
        transform: `translate(-50%, -50%) translateX(${translateX}px) rotateY(${rotateY}deg)`,
        transformStyle: 'preserve-3d',
        opacity: tileOp,
        zIndex: z,
      }}
    >
      {/* Tile face */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 28,
          background:
            'linear-gradient(135deg, #052438 0%, #0a3050 32%, #061b2b 62%, #000000 100%)',
          border: '1.5px solid rgba(255,255,255,0.10)',
          boxShadow:
            'inset 80px 80px 140px rgba(7,148,253,0.08), ' +
            '0 30px 80px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Soft top-left highlight blob — matches the "lit corner" in the reference */}
        <div
          style={{
            position: 'absolute',
            left:   -120,
            top:    -120,
            width:  420,
            height: 420,
            background:
              'radial-gradient(circle, rgba(7,148,253,0.22) 0%, rgba(7,148,253,0) 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Content */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            padding: CONTENT_PAD,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            opacity: contentOp,
          }}
        >
          {/* Icon */}
          <div
            style={{
              width:  ICON_SIZE,
              height: ICON_SIZE,
            }}
          >
            <Img
              src={staticFile(`icons/${tile.icon}.svg`)}
              alt=""
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>

          {/* Title — Satoshi Black 900 for a clear weight gap above the
              Satoshi Medium 500 bullets below. */}
          <div
            style={{
              color: '#0794FD',
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: 900,
              fontSize: 46,
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              marginTop: 8,
            }}
          >
            {tile.title}
          </div>

          {/* Divider */}
          <div
            style={{
              width: 60,
              height: 2,
              background: 'rgba(7,148,253,0.55)',
              marginTop: 2,
              marginBottom: 6,
            }}
          />

          {/* Bullets */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {tile.bullets.map((b, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 16,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    background: '#0794FD',
                    marginTop: 16,
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    color: '#FFFFFF',
                    fontFamily: "'Satoshi', system-ui, sans-serif",
                    fontWeight: 500,
                    fontSize: 33,
                    lineHeight: 1.35,
                    letterSpacing: '-0.005em',
                  }}
                >
                  {b}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const Carousel5Tiles: React.FC<Carousel5TilesProps> = ({
  tiles,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Carousel5Tiles fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const INTRO_END     = f(t.introDuration);
  const TILE_WINDOW   = f(t.tileWindow);
  const SLIDE_FRAMES  = f(t.slideDuration);

  // Intro fade + scale.
  const introOp = interpolate(frame, [0, INTRO_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const introScale = interpolate(frame, [0, INTRO_END], [0.92, 1.0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutBackSubtle,
  });

  const carouselIdx = computeCarouselIndex(
    frame,
    INTRO_END,
    TILE_WINDOW,
    SLIDE_FRAMES,
    tiles.length,
    t.loopAfterLast,
  );

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          perspective: `${PERSPECTIVE}px`,
          perspectiveOrigin: '50% 50%',
          opacity: introOp,
          transform: `scale(${introScale})`,
          transformOrigin: '50% 50%',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transformStyle: 'preserve-3d',
          }}
        >
          {tiles
            .map((tile, idx) => ({
              tile,
              idx,
              slot: slotFor(idx, carouselIdx, tiles.length),
            }))
            // Sort so far-from-center tiles paint first (so center is on top).
            .sort((a, b) => Math.abs(b.slot) - Math.abs(a.slot))
            .map(({ tile, idx, slot }) => (
              <Tile key={idx} tile={tile} slot={slot} />
            ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const carousel5TilesDefaultProps: Carousel5TilesProps = {
  tiles: [
    {
      title: 'Prompt-First',
      icon:  'terminal',
      bullets: [
        'Describe intent, not steps',
        'Let the model draft v1',
        "Edit, don't rewrite",
      ],
    },
    {
      title: 'AI Pair Programming',
      icon:  'sparkles',
      bullets: [
        'Treat the model as a peer',
        'Push back on weak ideas',
        'Ship code you understand',
      ],
    },
    {
      title: 'Tight Iteration Loops',
      icon:  'zap',
      bullets: [
        'Small diffs, fast feedback',
        'Run, observe, refine',
        'Trust the test suite',
      ],
    },
    {
      title: 'Context Is Everything',
      icon:  'layers',
      bullets: [
        'Feed the model real files',
        'Pin the relevant docs',
        'Cut noise, keep signal',
      ],
    },
    {
      title: 'Verify, Don’t Trust',
      icon:  'shield-check',
      bullets: [
        'Read every diff',
        'Run the code yourself',
        'Catch hallucinated APIs',
      ],
    },
  ],
};
