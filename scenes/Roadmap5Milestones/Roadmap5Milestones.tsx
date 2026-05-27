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

// Roadmap5Milestones — vertical 5-milestone roadmap with a descending spotlight.
//   • Phase 1 (0.10–3.80 s): left icon panel fades in; spine dotted track draws
//     on from the top; 5 cards stagger in (each 1.40 s scale-in, 0.50 s offset).
//   • Phase 2 (5.20 s onward): a "spotlight" descends through the cards, pausing
//     on each in turn. Active card scales to 1.05 + opacity 1.0; idle cards
//     stay at scale 1 + opacity 0.70 (smoothstep falloff with vertical distance).
//   • Each milestone (blue circle + white tick) lights up as the spotlight
//     arrives: circle scale-pop (easeOutBack subtle), tick trim-path reveal.
//   • Blue progress line (Blue_Dotted_Line_Base.png) tracks the spotlight's y.
//   • Spotlight peaks at 8.50 / 12.83 / 17.20 / 21.20 / 25.27 s; exits at 27.40 s.
//   • Default composition length is 900 frames (30 s @ 30 fps).
//
// Anchor icon (graphic.svg) recoloured at port time: #052438 → #E6ECF2 base,
// #0496FF Dodger Blue accents preserved.

// ─── Schema ──────────────────────────────────────────────────────────────────

const milestoneSchema = z.object({
  // Card title — Inter Bold 37 px, black. ≤20 chars to fit the card's
  // text region (card width 755 px, text region ~577 px wide).
  title:       z.string().min(1).max(20),
  // Description below the title — Satoshi Regular 33 px, grey. ≤32 chars
  // to fit at any font fallback; container also has overflow:hidden.
  description: z.string().min(1).max(32),
});

// Optional per-render timing overrides. All values in SECONDS.
// peaks must contain exactly 5 entries.
export const roadmap5MilestonesTimingsSchema = z
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

export const roadmap5MilestonesSchema = z.object({
  // Exactly 5 milestones, ordered top → bottom.
  milestones: z.array(milestoneSchema).length(5),
  // Anchor icon for the left panel — pick from the catalog (e.g. "graphic").
  anchorIcon: z.string().min(1),
  timings: roadmap5MilestonesTimingsSchema.optional(),
});

export type Roadmap5MilestonesProps = z.infer<typeof roadmap5MilestonesSchema>;

export const roadmap5MilestonesMeta = {
  description:
    'Vertical milestone roadmap with rich cards. Anchor-icon panel on the left; ' +
    'on the right a dotted spine connects 5 milestone circles, each paired with ' +
    'a card carrying both a short title and a one-line description. A spotlight ' +
    'descends the spine pausing on each milestone in turn — ticks light up, the ' +
    'active card scales forward, idle cards dim back. Best for narrating a ' +
    'multi-stage journey where every stage deserves both a headline and a ' +
    'supporting line of detail.',
  authoringNotes:
    'Always supply exactly 5 milestones, in chronological/sequential order. ' +
    'title is the card headline (Inter Bold 37 px, black, ≤20 chars). description ' +
    'is one short phrase underneath (Satoshi Regular 33 px, grey, ≤32 chars). ' +
    'The card\'s text region is ~577 px wide so go shorter when you can — ' +
    'descriptions that look fine in Satoshi can spill the card under font ' +
    'fallback. Aim for parallel structure across all 5 cards. GOOD: title ' +
    '"Discovery", description "Research user needs". BAD: full sentences ' +
    'with commas (the design is single-line, not body copy). anchorIcon is the ' +
    'icon id for the left panel — Platinum Blue body + Dodger Blue accents per ' +
    'the patched SVG. Default duration 450 frames (15 s); animation completes ' +
    'by ~14.5 s and the prototype\'s 30 s pacing is halved to fit.',
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

// ─── Layout constants (lifted directly from the prototype) ────────────────────

// Pill_Base.png card graphic at x=1065..1819, y=76..233 (centre 1442, 154).
const PILL_SRC_LEFT = 1065;
const PILL_SRC_TOP  = 76;
const CARD_W = 755;
const CARD_H = 158;

// Final-comp y centres for the 5 cards.
const CARD_CYS = [139, 340, 540, 740, 940] as const;

// Tick_Base.png blue circle at (995, 141), 56×56. Tick.png white check covers
// x=981..1008.
const TICK_SRC_CX = 995;
const TICK_SRC_CY = 141;
const TICK_GLYPH_LEFT  = 981;
const TICK_GLYPH_RIGHT = 1008;

// Milestone y centres (line up with cards).
const TICK_CYS = [141, 339, 540, 740, 941] as const;

// Spine geometry.
const SPINE_TOP_Y    = 136;
const SPINE_BOTTOM_Y = 940;
const SPINE_HEIGHT   = SPINE_BOTTOM_Y - SPINE_TOP_Y;

// Left icon panel — Icon_Base.png solid bbox x=107..858, y=61..1012, centre (482, 536).
const PANEL_CX = 482;
const PANEL_CY = 536;
const PANEL_ICON_SIZE = 500;

// Card content padding (from inside the card asset's own coordinate space).
const CARD_TEXT_LEFT   = 154;
const CARD_TITLE_TOP   = 30;
const CARD_DESC_TOP    = 86;
const CARD_TEXT_RIGHT_PAD = 24;

// Focus falloff (vertical pixels from spotlight Y).
const FOCUS_NEAR = 20;
const FOCUS_FAR  = 210;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  // Compressed to fit a 15 s composition (the prototype runs ~28 s; halving
  // the timeline keeps the same beats but lets the whole animation play in
  // the default 15 s render). Each card gets ~2 s of focus instead of ~4 s.
  panelFadeStart: 0.05,
  panelFadeEnd:   0.50,
  cardInStagger:  0.25,
  cardInDuration: 0.70,
  spineDrawStart: 0.25,
  spineDrawEnd:   1.90,
  // Spotlight peaks (seconds at which it sits on each card centre).
  peaks: [3.50, 5.50, 7.50, 9.50, 11.50] as readonly number[],
  transitDuration: 1.40,
  spotlightEnter: 2.50,
  spotlightExit:  13.00,
  spotlightFade:  1.50,
} as const;

const easeInOutCubic    = Easing.inOut(Easing.cubic);
// Remotion's Easing has poly(n) but no `quint` alias — poly(5) IS quint.
const easeInOutQuint    = Easing.inOut(Easing.poly(5));
const easeOutBackSubtle = Easing.out(Easing.back(0.6));

// Smoothstep: zero-velocity at both boundaries.
const smoothstep = (x: number) => x * x * (3 - 2 * x);
const clamp01    = (x: number) => Math.max(0, Math.min(1, x));

// ─── Spotlight model (frame-based, mirrors the HTML's spotlightY function) ───

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

// ─── Spine (dotted line + blue progress) ─────────────────────────────────────

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
  // Grey dotted track draws on from the top during Phase 1.
  const drawProg = interpolate(frame, [spineDrawStart, spineDrawEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const drawHeight  = SPINE_HEIGHT * drawProg;
  const drawClipBot = 1080 - (SPINE_TOP_Y + drawHeight);

  // Blue progress tracks the spotlight Y inside the spine.
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

// ─── Milestone (blue circle + trim-path tick) ────────────────────────────────

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

  // Circle scale-in finishes at peak.
  const circleStart = peakFrame - f(0.65);
  const circleEnd   = peakFrame;
  const circleProg  = clamp01((frame - circleStart) / (circleEnd - circleStart));
  const circleScale = circleProg > 0 ? easeOutBackSubtle(circleProg) : 0;

  // Tick trim-path reveal — runs concurrently with circle scale.
  const trimStart = peakFrame - f(0.50);
  const trimEnd   = peakFrame + f(0.05);
  const trimProg  = clamp01((frame - trimStart) / (trimEnd - trimStart));
  const trimEased = easeInOutCubic(trimProg);
  const tickRevealRight = (1920 - TICK_GLYPH_LEFT) - (TICK_GLYPH_RIGHT - TICK_GLYPH_LEFT) * trimEased;

  const sharedTransform = `translateY(${offset}px) scale(${circleScale})`;
  const sharedOrigin    = `${TICK_SRC_CX}px ${TICK_SRC_CY}px`;

  return (
    <>
      {/* Blue circle */}
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
      {/* White check, trim-path revealed left → right */}
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

// ─── Card (Pill_Base + title + description) ──────────────────────────────────

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
  // Phase 1 — sequential fade/scale-in to baseline (70 % opacity, scale 1).
  const inStart = index * cardInStagger;
  const inProg  = clamp01((frame - inStart) / cardInDur);
  const baseScale   = inProg > 0 ? easeInOutCubic(inProg) : 0;
  const baseOpacity = 0.70 * easeInOutCubic(inProg);

  // Phase 2/3 — proximity focus.
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
      {/* Windowed copy of Pill_Base.png — full asset translated so its card row lands at (0,0) */}
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

      {/* Title (Inter Bold 37 px, black) */}
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
          overflow: 'hidden',  // safety net — clip if the title exceeds the card's text region
        }}
      >
        {title}
      </div>

      {/* Description (Satoshi Regular 33 px, grey) */}
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
          overflow: 'hidden',  // safety net — clip if the description exceeds the card width
        }}
      >
        {description}
      </div>
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const Roadmap5Milestones: React.FC<Roadmap5MilestonesProps> = ({
  milestones,
  anchorIcon,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Roadmap5Milestones fonts'));
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

  // Left icon panel fade.
  const panelOp = interpolate(frame, [PANEL_FADE_START, PANEL_FADE_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Left icon panel */}
      <div style={{ position: 'absolute', inset: 0, opacity: panelOp, pointerEvents: 'none' }}>
        <Img
          src={ICON_BASE_SRC}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
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
            src={staticFile(`icons/${anchorIcon}.svg`)}
            alt=""
            style={{ width: PANEL_ICON_SIZE, height: PANEL_ICON_SIZE }}
          />
        </div>
      </div>

      {/* Spine (behind cards) */}
      <Spine frame={frame} sy={sy} spineDrawStart={SPINE_DRAW_START} spineDrawEnd={SPINE_DRAW_END} />

      {/* Cards */}
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

      {/* Milestones (above the spine, beside the cards) */}
      {[0, 1, 2, 3, 4].map(i => (
        <Milestone key={`m${i}`} index={i} frame={frame} peakFrame={PEAKS[i]!} />
      ))}
    </AbsoluteFill>
  );
};
