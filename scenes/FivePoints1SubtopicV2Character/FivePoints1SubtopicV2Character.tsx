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

// FivePoints1SubtopicV2Character — character-only variant of FivePoints1SubtopicV2.
//
// Same layout, animation, and spine/spotlight logic as the icon version. The
// only difference is the left-panel anchor: instead of a 500×500 line-art
// icon, the panel hosts a character PNG positioned so:
//   • the figure is proportionally centred horizontally inside the Oxford
//     Blue panel content area;
//   • the FACE (not the bounding box) lands at the vertical centrepoint of
//     the panel — controlled by `characterHeight` + `characterY` so authors
//     can swap PNGs without re-engineering;
//   • no cropping (`overflow: hidden` is OFF on the anchor container) — if a
//     character is sized larger than the panel, that's an authoring error
//     to fix via the schema knobs, not silent clipping.
//
// Authoring notes for tuning a new character PNG:
//   1. Pick a characterHeight that comfortably fits the 951-tall panel
//      (650 is a safe default; bigger if the PNG framing is tight to the
//      head, smaller if it includes more body).
//   2. Estimate the FACE-CENTRE Y in the PNG (as a fraction of PNG height).
//      For a typical presenter PNG that's ~0.27 (face sits in the upper
//      third). Then characterY = PANEL_CONTENT_H/2 − faceFraction × characterHeight.
//   3. Render. Nudge characterY ±20 px if needed.

// ─── Schema ──────────────────────────────────────────────────────────────────

const milestoneSchema = z.object({
  title:       z.string().min(1).max(20),
  description: z.string().min(1).max(32),
  // Small-Icons id — resolves to small-icons/<id>.svg. The SVGs in that
  // folder are pre-coloured white so they read on the dodger-blue square.
  icon:        z.string().min(1),
});

const characterAnchorSchema = z.object({
  // Character PNG id — resolves to characters/<id>.png.
  id:              z.string().min(1),
  // Rendered height of the character in px (width preserved by aspect ratio).
  // Default 650 fits the 951-tall panel with the face at the centre.
  characterHeight: z.number().min(200).max(1200).optional(),
  // Top offset of the character inside the panel content box, in px.
  // Tune so the face's vertical centre lands at the panel centre (~475 px).
  characterY:      z.number().optional(),
});

export const fivePoints1SubtopicV2CharacterTimingsSchema = z
  .object({
    panelFadeStart: z.number().nonnegative(),
    panelFadeEnd:   z.number().positive(),
    cardInStagger: z.number().positive(),
    cardInDuration: z.number().positive(),
    spineDrawStart: z.number().nonnegative(),
    spineDrawEnd:   z.number().positive(),
    peaks:          z.array(z.number().nonnegative()).min(1).max(5),
    transitDuration: z.number().positive(),
    spotlightEnter: z.number().nonnegative(),
    spotlightExit:  z.number().positive(),
    spotlightFade:  z.number().positive(),
  })
  .partial();

export const fivePoints1SubtopicV2CharacterSchema = z.object({
  // 1 to 5 milestones — the spine + card band auto-centre vertically for
  // the count (3 milestones sit centred in the frame, etc.).
  milestones: z.array(milestoneSchema).min(1).max(5),
  character:  characterAnchorSchema,
  timings:    fivePoints1SubtopicV2CharacterTimingsSchema.optional(),
});

export type FivePoints1SubtopicV2CharacterProps = z.infer<
  typeof fivePoints1SubtopicV2CharacterSchema
>;

export const fivePoints1SubtopicV2CharacterMeta = {
  description:
    'Vertical 5-step roadmap: Oxford-Blue panel on the left containing a ' +
    'character portrait (face at the centrepoint), dotted spine on the ' +
    'right linking 5 milestone circles. A spotlight travels the spine, ' +
    'lighting each tick and lifting the active card. Same animation as ' +
    'FivePoints1SubtopicV2; only the panel anchor differs.',
  authoringNotes:
    'Supply 1 to 5 milestones — the spine + card band auto-centre ' +
    'vertically for the count (3 milestones sit centred in the frame, ' +
    'etc.). Each milestone has { title, description, icon }; icon is an ' +
    'id from the Small-Icons/ folder (e.g. "search (1)", "layer-plus", ' +
    '"arrow-trend-up") — those SVGs are pre-coloured white and render on ' +
    'a dodger-blue square that masks the baked arrow inside each pill. ' +
    'character.id is a PNG in characters/<id>.png. characterHeight ' +
    'controls the rendered px height; characterY positions the image ' +
    'from the top of the panel content area. Tune both so the face lands ' +
    'at the panel centre (~475 px from the box top) and nothing is ' +
    'clipped. Default duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const ICON_BASE_SRC        = staticFile('Template-Specific-Assets/icon_base.png');
const PILL_BASE_SRC        = staticFile('Template-Specific-Assets/pill_base.png');
const DOTTED_LINE_SRC      = staticFile('Template-Specific-Assets/dotted_line_base.png');
const BLUE_DOTTED_LINE_SRC = staticFile('Template-Specific-Assets/blue_dotted_line_base.png');
const TICK_BASE_SRC        = staticFile('Template-Specific-Assets/tick_base.png');
const TICK_SRC             = staticFile('Template-Specific-Assets/tick.png');
const INTER_BOLD_SRC       = staticFile('fonts/Inter-Bold.woff2');
const SATOSHI_REG_SRC      = staticFile('fonts/Satoshi-Regular.woff2');

// ─── Layout constants (lifted verbatim from V2) ───────────────────────────────

const PILL_SRC_LEFT = 1065;
const PILL_SRC_TOP  = 76;
const CARD_W = 755;
const CARD_H = 158;

// Vertical layout for 1-5 cards. The 5-card pitch (200 px) is preserved
// from the prototype; for fewer cards the band centres on the canvas.
const CANVAS_CY  = 540;
const CARD_PITCH = 200;
const cardCyFor  = (count: number, i: number) =>
  CANVAS_CY - ((count - 1) * CARD_PITCH) / 2 + i * CARD_PITCH;
const tickCyFor  = (count: number, i: number) => cardCyFor(count, i);
const spineTopFor    = (count: number) => tickCyFor(count, 0);
const spineBottomFor = (count: number) => tickCyFor(count, count - 1);

const TICK_SRC_CX = 995;
const TICK_SRC_CY = 141;
const TICK_GLYPH_LEFT  = 981;
const TICK_GLYPH_RIGHT = 1008;

// Dodger-Blue panel (replaces the Oxford-Blue artwork from V2).
// Bounds match the visible panel in the original icon_base.png so the
// rest of the layout (cards, spine, ticks) aligns exactly as before.
const PANEL_LEFT   = 85;
const PANEL_TOP    = 40;
const PANEL_WIDTH  = 770;
const PANEL_HEIGHT = 970;
const PANEL_RADIUS = 40;
const PANEL_CENTER_Y = PANEL_HEIGHT / 2;         // 485
const PANEL_FILL   = '#0496FF';                  // dodger blue

// Legacy aliases (used by Anchor positioning code lifted from V2).
const PANEL_CONTENT_LEFT   = PANEL_LEFT;
const PANEL_CONTENT_TOP    = PANEL_TOP;
const PANEL_CONTENT_WIDTH  = PANEL_WIDTH;
const PANEL_CONTENT_HEIGHT = PANEL_HEIGHT;

const CARD_TEXT_LEFT   = 154;
const CARD_TITLE_TOP   = 30;
const CARD_DESC_TOP    = 86;
const CARD_TEXT_RIGHT_PAD = 24;

// Per-card icon overlay: a dodger-blue rounded square that masks the
// baked arrow in pill_base.png plus a Small-Icons SVG centred on top.
// Baked-square true alpha bbox in pill_base.png: x=1094..1190, y=110..199
// (radius ~17). Overlay extends 2 px past every edge so no rim peeks through.
const ICON_BOX_LEFT   = 27;     // 1094 - 1065 - 2
const ICON_BOX_TOP    = 33;     // 110  - 76   - 1
const ICON_BOX_WIDTH  = 100;
const ICON_BOX_HEIGHT = 92;
const ICON_BOX_RADIUS = 18;
const ICON_GLYPH_SIZE = 50;
const ICON_BOX_GRADIENT =
  'linear-gradient(180deg, #1FA3FF 0%, #0496FF 100%)';

const FOCUS_NEAR = 20;
const FOCUS_FAR  = 210;

// Default character framing — chosen so a typical presenter PNG (face
// ~27 % from the top) lands the face at the dodger-blue panel centre.
// At 950 px tall the character fills the panel prominently; the lower
// body extends past the panel and is masked by the panel's overflow:
// hidden, leaving a clean head-and-shoulders framing.
const DEFAULT_CHARACTER_HEIGHT = 950;
const DEFAULT_CHARACTER_Y      = 175;            // raises the face ~55 px above panel centre

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
  cardCYs: readonly number[],
): number {
  const last = cardCYs.length - 1;
  if (frame < enter) return -300;
  if (frame < peaks[0]!) {
    const p = clamp01((frame - enter) / (peaks[0]! - enter));
    return -300 + (cardCYs[0]! - (-300)) * easeInOutQuint(p);
  }
  for (let i = 0; i < peaks.length - 1 && i < last; i++) {
    if (frame < peaks[i + 1]!) {
      const dwellEnd = peaks[i + 1]! - transit;
      if (frame < dwellEnd) return cardCYs[i]!;
      const p = clamp01((frame - dwellEnd) / transit);
      return cardCYs[i]! + (cardCYs[i + 1]! - cardCYs[i]!) * easeInOutQuint(p);
    }
  }
  if (frame < exit) return cardCYs[last]!;
  const p = clamp01((frame - exit) / fadeDur);
  return cardCYs[last]! + 400 * easeInOutQuint(p);
}

function cardFocus(idx: number, sy: number, cardCYs: readonly number[]): number {
  const dist = Math.abs(sy - cardCYs[idx]!);
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
  spineTop,
  spineBottom,
}: {
  frame: number;
  sy: number;
  spineDrawStart: number;
  spineDrawEnd: number;
  spineTop: number;
  spineBottom: number;
}) {
  const spineHeight = spineBottom - spineTop;
  if (spineHeight <= 0) return null;

  const drawProg = interpolate(frame, [spineDrawStart, spineDrawEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const drawHeight  = spineHeight * drawProg;
  const drawClipBot = 1080 - (spineTop + drawHeight);

  const blueProg   = clamp01((sy - spineTop) / spineHeight);
  const blueHeight = spineHeight * blueProg;
  const blueClipBot = 1080 - (spineTop + blueHeight);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: `inset(${spineTop}px 0 ${drawClipBot}px 0)`,
          pointerEvents: 'none',
        }}
      >
        <Img src={DOTTED_LINE_SRC} alt="" style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: `inset(${spineTop}px 0 ${blueClipBot}px 0)`,
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
  tickCy,
  frame,
  peakFrame,
}: {
  tickCy: number;
  frame: number;
  peakFrame: number;
}) {
  const offset = tickCy - TICK_SRC_CY;

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
  cy,
  cardCYs,
  title,
  description,
  icon,
  cardInStagger,
  cardInDur,
}: {
  index: number;
  frame: number;
  sy: number;
  cy: number;
  cardCYs: readonly number[];
  title: string;
  description: string;
  icon: string;
  cardInStagger: number;
  cardInDur: number;
}) {
  const inStart = index * cardInStagger;
  const inProg  = clamp01((frame - inStart) / cardInDur);
  const baseScale   = inProg > 0 ? easeInOutCubic(inProg) : 0;
  const baseOpacity = 0.70 * easeInOutCubic(inProg);

  const focus        = cardFocus(index, sy, cardCYs);
  const focusScale   = 1 + 0.05 * focus;
  const focusOpacity = 0.70 + 0.30 * focus;

  const settled     = inProg >= 1;
  const drawScale   = settled ? focusScale : baseScale;
  const drawOpacity = settled ? focusOpacity : baseOpacity;

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

      {/* Dodger-blue square that masks the baked arrow; user-chosen Small-Icon
          glyph renders centred on top. */}
      <div
        style={{
          position: 'absolute',
          left:   ICON_BOX_LEFT,
          top:    ICON_BOX_TOP,
          width:  ICON_BOX_WIDTH,
          height: ICON_BOX_HEIGHT,
          borderRadius: ICON_BOX_RADIUS,
          background:   ICON_BOX_GRADIENT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Img
          src={staticFile(`small-icons/${icon}.svg`)}
          alt=""
          style={{ width: ICON_GLYPH_SIZE, height: ICON_GLYPH_SIZE, display: 'block' }}
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

// ─── Character anchor (face-centred in the Oxford Blue panel) ────────────────

function CharacterAnchor({
  id,
  characterHeight,
  characterY,
}: {
  id: string;
  characterHeight: number;
  characterY:      number;
}) {
  // Dodger-blue panel container. overflow:hidden clips the (deliberately
  // oversized) character to the rounded panel shape so the figure reads
  // as fitting inside the panel — face at centre, lower body masked by
  // the panel's bottom edge. No visible bounding frame on the image.
  return (
    <div
      style={{
        position: 'absolute',
        left:   PANEL_LEFT,
        top:    PANEL_TOP,
        width:  PANEL_WIDTH,
        height: PANEL_HEIGHT,
        borderRadius: PANEL_RADIUS,
        background:   PANEL_FILL,
        overflow:     'hidden',
      }}
    >
      <Img
        src={staticFile(`characters/${id}.png`)}
        alt=""
        style={{
          position: 'absolute',
          left: '50%',
          top:  characterY,
          height: characterHeight,
          width:  'auto',
          transform: 'translateX(-50%)',
          display: 'block',
          // Two-layer drop shadow that follows the PNG's alpha mask so
          // the figure (not its bounding box) casts the shadow on the
          // dodger-blue panel. Deep-navy values stay visible against the
          // bright background.
          filter:
            'drop-shadow(0 18px 24px rgba(2, 18, 36, 0.45)) ' +
            'drop-shadow(0 4px 8px rgba(2, 18, 36, 0.35))',
        }}
      />
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const FivePoints1SubtopicV2Character: React.FC<
  FivePoints1SubtopicV2CharacterProps
> = ({ milestones, character, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() =>
    delayRender('Loading FivePoints1SubtopicV2Character fonts'),
  );
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

  const count = milestones.length;
  const cardCYs = Array.from({ length: count }, (_, i) => cardCyFor(count, i));
  const tickCYs = Array.from({ length: count }, (_, i) => tickCyFor(count, i));
  const spineTop    = spineTopFor(count);
  const spineBottom = spineBottomFor(count);

  const sy = spotlightY(frame, SPOT_ENTER, SPOT_EXIT, SPOT_FADE, PEAKS, TRANSIT, cardCYs);

  const panelOp = interpolate(frame, [PANEL_FADE_START, PANEL_FADE_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  const characterHeight = character.characterHeight ?? DEFAULT_CHARACTER_HEIGHT;
  const characterY      = character.characterY      ?? DEFAULT_CHARACTER_Y;

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: panelOp, pointerEvents: 'none' }}>
        <CharacterAnchor
          id={character.id}
          characterHeight={characterHeight}
          characterY={characterY}
        />
      </div>

      <Spine
        frame={frame}
        sy={sy}
        spineDrawStart={SPINE_DRAW_START}
        spineDrawEnd={SPINE_DRAW_END}
        spineTop={spineTop}
        spineBottom={spineBottom}
      />

      {milestones.map((m, i) => (
        <Card
          key={`c${i}`}
          index={i}
          frame={frame}
          sy={sy}
          cy={cardCYs[i]!}
          cardCYs={cardCYs}
          title={m.title}
          description={m.description}
          icon={m.icon}
          cardInStagger={CARD_IN_STAGGER}
          cardInDur={CARD_IN_DUR}
        />
      ))}

      {milestones.map((_, i) => (
        <Milestone
          key={`m${i}`}
          tickCy={tickCYs[i]!}
          frame={frame}
          peakFrame={PEAKS[Math.min(i, PEAKS.length - 1)]!}
        />
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ────────────────────────────────────────────────────────

export const fivePoints1SubtopicV2CharacterDefaultProps: FivePoints1SubtopicV2CharacterProps = {
  milestones: [
    { title: 'Discovery', description: 'Research user needs',   icon: 'search (1)' },
    { title: 'Plan',      description: 'Map scope and risks',   icon: 'map-marker-plus' },
    { title: 'Build',     description: 'Ship the first cut',    icon: 'layer-plus' },
    { title: 'Review',    description: 'Test with real users',  icon: 'ai-assistant' },
    { title: 'Launch',    description: 'Roll out and measure',  icon: 'arrow-trend-up' },
  ],
  character: {
    id: 'presenter-red',
    // Square 1399×1419 PNG with the face centred horizontally at ~27% of
    // the PNG height. At 950 px tall the character fills the dodger-blue
    // panel prominently; characterY 175 raises the face above panel
    // centre for a tighter portrait crop.
    characterHeight: 950,
    characterY:      175,
  },
};
