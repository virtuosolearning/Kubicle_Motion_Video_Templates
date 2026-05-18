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

// FivePoints1SubtopicV2 — V1 layout + animation, with a discriminated `anchor`
// prop that accepts either an icon (line-art SVG, 500×500) or a character
// portrait (transparent-background PNG that fills the left panel).
//
//   • anchor.kind === 'icon'      → renders icons/<id>.svg (matches V1)
//   • anchor.kind === 'character' → renders characters/<id>.png inside the
//     panel content bbox, object-fit: contain, bottom-anchored.

// ─── Schema ──────────────────────────────────────────────────────────────────

const milestoneSchema = z.object({
  title:       z.string().min(1).max(20),
  description: z.string().min(1).max(32),
});

export const fivePoints1SubtopicV2AnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('icon'),      id: z.string().min(1) }),
  z.object({ kind: z.literal('character'), id: z.string().min(1) }),
]);

export const fivePoints1SubtopicV2TimingsSchema = z
  .object({
    panelFadeStart: z.number().nonnegative(),
    panelFadeEnd:   z.number().positive(),
    cardInStagger: z.number().positive(),
    cardInDuration: z.number().positive(),
    spineDrawStart: z.number().nonnegative(),
    spineDrawEnd:   z.number().positive(),
    peaks:          z.array(z.number().nonnegative()).length(5),
    transitDuration: z.number().positive(),
    spotlightEnter: z.number().nonnegative(),
    spotlightExit:  z.number().positive(),
    spotlightFade:  z.number().positive(),
  })
  .partial();

export const fivePoints1SubtopicV2Schema = z.object({
  milestones: z.array(milestoneSchema).length(5),
  anchor:     fivePoints1SubtopicV2AnchorSchema,
  timings:    fivePoints1SubtopicV2TimingsSchema.optional(),
});

export type FivePoints1SubtopicV2Props = z.infer<typeof fivePoints1SubtopicV2Schema>;

export const fivePoints1SubtopicV2Meta = {
  description:
    'Vertical 5-step roadmap (V2): dark-panel anchor on the left (icon OR ' +
    'character portrait); on the right a dotted spine connects 5 milestone ' +
    'circles, each next to a card. A spotlight travels down the spine, ' +
    'lighting each tick and pulling the active card forward.',
  authoringNotes:
    'Always supply exactly 5 milestones in order. anchor is a discriminated ' +
    "union: { kind: 'icon', id } renders icons/<id>.svg (500×500 line art); " +
    "{ kind: 'character', id } renders characters/<id>.png fitted to the " +
    'panel (object-fit: contain, bottom-anchored). Character PNGs should be ' +
    'pre-cut with a transparent background — anything else will read as a ' +
    'coloured rectangle on the panel. Default duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const ICON_BASE_SRC        = staticFile('images/icon_base.png');
const PILL_BASE_SRC        = staticFile('images/pill_base.png');
const DOTTED_LINE_SRC      = staticFile('images/dotted_line_base.png');
const BLUE_DOTTED_LINE_SRC = staticFile('images/blue_dotted_line_base.png');
const TICK_BASE_SRC        = staticFile('images/tick_base.png');
const TICK_SRC             = staticFile('images/tick.png');
const INTER_BOLD_SRC       = staticFile('fonts/Inter-Bold.woff2');
const SATOSHI_REG_SRC      = staticFile('fonts/Satoshi-Regular.woff2');

// ─── Layout constants ─────────────────────────────────────────────────────────

const PILL_SRC_LEFT = 1065;
const PILL_SRC_TOP  = 76;
const CARD_W = 755;
const CARD_H = 158;

const CARD_CYS = [139, 340, 540, 740, 940] as const;

const TICK_SRC_CX = 995;
const TICK_SRC_CY = 141;
const TICK_GLYPH_LEFT  = 981;
const TICK_GLYPH_RIGHT = 1008;

const TICK_CYS = [141, 339, 540, 740, 941] as const;

const SPINE_TOP_Y    = 136;
const SPINE_BOTTOM_Y = 940;
const SPINE_HEIGHT   = SPINE_BOTTOM_Y - SPINE_TOP_Y;

// Icon-mode anchor: 500×500 square centred on the panel.
const PANEL_CX = 482;
const PANEL_CY = 536;
const PANEL_ICON_SIZE = 500;

// Character-mode anchor: full panel content bbox.
const PANEL_CONTENT_LEFT   = 107;
const PANEL_CONTENT_TOP    = 61;
const PANEL_CONTENT_WIDTH  = 858 - 107;
const PANEL_CONTENT_HEIGHT = 1012 - 61;
const PANEL_CORNER_RADIUS  = 40;

const CARD_TEXT_LEFT   = 154;
const CARD_TITLE_TOP   = 30;
const CARD_DESC_TOP    = 86;
const CARD_TEXT_RIGHT_PAD = 24;

const FOCUS_NEAR = 20;
const FOCUS_FAR  = 210;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  panelFadeStart: 0.05,
  panelFadeEnd:   0.50,
  cardInStagger:  0.25,
  cardInDuration: 0.70,
  spineDrawStart: 0.25,
  spineDrawEnd:   1.90,
  peaks: [3.50, 5.50, 7.50, 9.50, 11.50] as readonly number[],
  transitDuration: 1.40,
  spotlightEnter: 2.50,
  spotlightExit:  13.00,
  spotlightFade:  1.50,
} as const;

const easeInOutCubic    = Easing.inOut(Easing.cubic);
const easeInOutQuint    = Easing.inOut(Easing.poly(5));
const easeOutBackSubtle = Easing.out(Easing.back(0.6));

const smoothstep = (x: number) => x * x * (3 - 2 * x);
const clamp01    = (x: number) => Math.max(0, Math.min(1, x));

function spotlightY(
  frame: number,
  enter: number,
  exit: number,
  fadeDur: number,
  peaks: number[],
  transit: number,
): number {
  if (frame < enter) return -300;
  if (frame < peaks[0]!) {
    const p = clamp01((frame - enter) / (peaks[0]! - enter));
    return -300 + (CARD_CYS[0] - (-300)) * easeInOutQuint(p);
  }
  for (let i = 0; i < peaks.length - 1; i++) {
    if (frame < peaks[i + 1]!) {
      const dwellEnd = peaks[i + 1]! - transit;
      if (frame < dwellEnd) return CARD_CYS[i]!;
      const p = clamp01((frame - dwellEnd) / transit);
      return CARD_CYS[i]! + (CARD_CYS[i + 1]! - CARD_CYS[i]!) * easeInOutQuint(p);
    }
  }
  if (frame < exit) return CARD_CYS[4]!;
  const p = clamp01((frame - exit) / fadeDur);
  return CARD_CYS[4]! + 400 * easeInOutQuint(p);
}

function cardFocus(idx: number, sy: number): number {
  const dist = Math.abs(sy - CARD_CYS[idx]!);
  if (dist <= FOCUS_NEAR) return 1;
  if (dist >= FOCUS_FAR)  return 0;
  return smoothstep(1 - (dist - FOCUS_NEAR) / (FOCUS_FAR - FOCUS_NEAR));
}

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const inter   = new FontFace('Inter',   `url(${INTER_BOLD_SRC}) format('woff2')`,  { weight: '700', display: 'block' });
    const satoshi = new FontFace('Satoshi', `url(${SATOSHI_REG_SRC}) format('woff2')`, { weight: '400', display: 'block' });
    const [i, s]  = await Promise.all([inter.load(), satoshi.load()]);
    const fonts   = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(i);
    fonts.add(s);
  })();
  return fontsPromise;
}

// ─── Spine ────────────────────────────────────────────────────────────────────

function Spine({
  frame,
  sy,
  spineDrawStart,
  spineDrawEnd,
}: {
  frame: number;
  sy: number;
  spineDrawStart: number;
  spineDrawEnd: number;
}) {
  const drawProg = interpolate(frame, [spineDrawStart, spineDrawEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const drawHeight  = SPINE_HEIGHT * drawProg;
  const drawClipBot = 1080 - (SPINE_TOP_Y + drawHeight);

  const blueProg   = clamp01((sy - SPINE_TOP_Y) / SPINE_HEIGHT);
  const blueHeight = SPINE_HEIGHT * blueProg;
  const blueClipBot = 1080 - (SPINE_TOP_Y + blueHeight);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: `inset(${SPINE_TOP_Y}px 0 ${drawClipBot}px 0)`,
          pointerEvents: 'none',
        }}
      >
        <Img src={DOTTED_LINE_SRC} alt="" style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: `inset(${SPINE_TOP_Y}px 0 ${blueClipBot}px 0)`,
          pointerEvents: 'none',
        }}
      >
        <Img src={BLUE_DOTTED_LINE_SRC} alt="" style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </>
  );
}

// ─── Milestone ────────────────────────────────────────────────────────────────

function Milestone({
  index,
  frame,
  peakFrame,
}: {
  index: number;
  frame: number;
  peakFrame: number;
}) {
  const offset = TICK_CYS[index]! - TICK_SRC_CY;

  const circleStart = peakFrame - f(0.65);
  const circleEnd   = peakFrame;
  const circleProg  = clamp01((frame - circleStart) / (circleEnd - circleStart));
  const circleScale = circleProg > 0 ? easeOutBackSubtle(circleProg) : 0;

  const trimStart = peakFrame - f(0.50);
  const trimEnd   = peakFrame + f(0.05);
  const trimProg  = clamp01((frame - trimStart) / (trimEnd - trimStart));
  const trimEased = easeInOutCubic(trimProg);
  const tickRevealRight = (1920 - TICK_GLYPH_LEFT) - (TICK_GLYPH_RIGHT - TICK_GLYPH_LEFT) * trimEased;

  const sharedTransform = `translateY(${offset}px) scale(${circleScale})`;
  const sharedOrigin    = `${TICK_SRC_CX}px ${TICK_SRC_CY}px`;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: sharedTransform,
          transformOrigin: sharedOrigin,
          opacity: circleProg > 0 ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        <Img src={TICK_BASE_SRC} alt="" style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: sharedTransform,
          transformOrigin: sharedOrigin,
          clipPath: `inset(0 ${tickRevealRight}px 0 0)`,
          opacity: trimProg > 0 ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        <Img src={TICK_SRC} alt="" style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({
  index,
  frame,
  sy,
  title,
  description,
  cardInStagger,
  cardInDur,
}: {
  index: number;
  frame: number;
  sy: number;
  title: string;
  description: string;
  cardInStagger: number;
  cardInDur: number;
}) {
  const inStart = index * cardInStagger;
  const inProg  = clamp01((frame - inStart) / cardInDur);
  const baseScale   = inProg > 0 ? easeInOutCubic(inProg) : 0;
  const baseOpacity = 0.70 * easeInOutCubic(inProg);

  const focus        = cardFocus(index, sy);
  const focusScale   = 1 + 0.05 * focus;
  const focusOpacity = 0.70 + 0.30 * focus;

  const settled     = inProg >= 1;
  const drawScale   = settled ? focusScale : baseScale;
  const drawOpacity = settled ? focusOpacity : baseOpacity;

  const cy   = CARD_CYS[index]!;
  const left = PILL_SRC_LEFT;
  const top  = cy - CARD_H / 2;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width:  CARD_W,
        height: CARD_H,
        transform: `scale(${drawScale})`,
        transformOrigin: 'center center',
        opacity: drawOpacity,
        pointerEvents: 'none',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <Img
          src={PILL_BASE_SRC}
          alt=""
          style={{
            position: 'absolute',
            left: -left,
            top:  -PILL_SRC_TOP,
            width:  1920,
            height: 1080,
            display: 'block',
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: CARD_TEXT_LEFT,
          top:  CARD_TITLE_TOP,
          right: CARD_TEXT_RIGHT_PAD,
          color: '#000000',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 37,
          letterSpacing: '-0.005em',
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {title}
      </div>

      <div
        style={{
          position: 'absolute',
          left: CARD_TEXT_LEFT,
          top:  CARD_DESC_TOP,
          right: CARD_TEXT_RIGHT_PAD,
          color: '#707070',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 400,
          fontSize: 33,
          letterSpacing: '-0.005em',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {description}
      </div>
    </div>
  );
}

// ─── Anchor (icon or character) ──────────────────────────────────────────────

type Anchor = FivePoints1SubtopicV2Props['anchor'];

function Anchor({ anchor }: { anchor: Anchor }) {
  if (anchor.kind === 'icon') {
    return (
      <div
        style={{
          position: 'absolute',
          left: PANEL_CX - PANEL_ICON_SIZE / 2,
          top:  PANEL_CY - PANEL_ICON_SIZE / 2,
          width:  PANEL_ICON_SIZE,
          height: PANEL_ICON_SIZE,
        }}
      >
        <Img
          src={staticFile(`icons/${anchor.id}.svg`)}
          alt=""
          style={{ width: PANEL_ICON_SIZE, height: PANEL_ICON_SIZE }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        position: 'absolute',
        left: PANEL_CONTENT_LEFT,
        top:  PANEL_CONTENT_TOP,
        width:  PANEL_CONTENT_WIDTH,
        height: PANEL_CONTENT_HEIGHT,
        borderRadius: PANEL_CORNER_RADIUS,
        overflow: 'hidden',
      }}
    >
      <Img
        src={staticFile(`characters/${anchor.id}.png`)}
        alt=""
        style={{
          width:  '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: '50% 100%',
          display: 'block',
        }}
      />
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const FivePoints1SubtopicV2: React.FC<FivePoints1SubtopicV2Props> = ({
  milestones,
  anchor,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading FivePoints1SubtopicV2 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const PANEL_FADE_START = f(t.panelFadeStart);
  const PANEL_FADE_END   = f(t.panelFadeEnd);
  const CARD_IN_STAGGER  = f(t.cardInStagger);
  const CARD_IN_DUR      = f(t.cardInDuration);
  const SPINE_DRAW_START = f(t.spineDrawStart);
  const SPINE_DRAW_END   = f(t.spineDrawEnd);
  const PEAKS            = t.peaks.map(f);
  const TRANSIT          = f(t.transitDuration);
  const SPOT_ENTER       = f(t.spotlightEnter);
  const SPOT_EXIT        = f(t.spotlightExit);
  const SPOT_FADE        = f(t.spotlightFade);

  const sy = spotlightY(frame, SPOT_ENTER, SPOT_EXIT, SPOT_FADE, PEAKS, TRANSIT);

  const panelOp = interpolate(frame, [PANEL_FADE_START, PANEL_FADE_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: panelOp, pointerEvents: 'none' }}>
        <Img
          src={ICON_BASE_SRC}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
        <Anchor anchor={anchor} />
      </div>

      <Spine frame={frame} sy={sy} spineDrawStart={SPINE_DRAW_START} spineDrawEnd={SPINE_DRAW_END} />

      {[0, 1, 2, 3, 4].map(i => (
        <Card
          key={`c${i}`}
          index={i}
          frame={frame}
          sy={sy}
          title={milestones[i]!.title}
          description={milestones[i]!.description}
          cardInStagger={CARD_IN_STAGGER}
          cardInDur={CARD_IN_DUR}
        />
      ))}

      {[0, 1, 2, 3, 4].map(i => (
        <Milestone key={`m${i}`} index={i} frame={frame} peakFrame={PEAKS[i]!} />
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ────────────────────────────────────────────────────────

export const fivePoints1SubtopicV2DefaultProps: FivePoints1SubtopicV2Props = {
  milestones: [
    { title: 'Discovery', description: 'Research user needs' },
    { title: 'Plan',      description: 'Map scope and risks' },
    { title: 'Build',     description: 'Ship the first cut' },
    { title: 'Review',    description: 'Test with real users' },
    { title: 'Launch',    description: 'Roll out and measure' },
  ],
  anchor: { kind: 'icon', id: 'graphic' },
};

export const fivePoints1SubtopicV2CharacterDemoProps: FivePoints1SubtopicV2Props = {
  ...fivePoints1SubtopicV2DefaultProps,
  anchor: { kind: 'character', id: 'presenter-red' },
};
