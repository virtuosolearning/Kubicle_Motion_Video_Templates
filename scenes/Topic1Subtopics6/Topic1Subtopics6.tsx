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

// Topic1Subtopics6 — split-screen header pill + 6 detail pills typing in waterfall.
//   • Oxford Blue right panel pans in from the right (easeInOutCubic, 0.60 s).
//   • Anchor icon fades in on the left panel (0.50 → 1.00 s).
//   • Header pill slides in from the right (0.50 → 1.30 s).
//   • Six detail pills appear sequentially in a waterfall starting at 1.30 s:
//     each pill scales in with a subtle easeOutBack (0.60 s), then its text
//     types out character-by-character (0.80 s). Each row starts as the
//     previous finishes, so the last finishes at 9.70 s.
//   • Default composition length is 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
export const topic1Subtopics6TimingsSchema = z
  .object({
    navyPanDuration:     z.number().positive(),
    iconFadeStart:       z.number().nonnegative(),
    iconFadeDuration:    z.number().positive(),
    headerSlideStart:    z.number().nonnegative(),
    headerSlideDuration: z.number().positive(),
    row0Start:           z.number().nonnegative(),
    rowScaleDuration:    z.number().positive(),
    rowTypeDuration:     z.number().positive(),
  })
  .partial();

export const topic1Subtopics6Schema = z.object({
  // The bold headline in the header pill (e.g. "Data modelling").
  // One line only — keep under 30 characters.
  mainTitle: z.string().min(1).max(30),
  // Exactly 6 detail lines, one per pill. Each types out sequentially.
  // Aim for under 45 characters so text fits the pill without wrapping.
  details: z.array(z.string().min(1).max(45)).length(6),
  // Icon ID for the large left-panel anchor illustration. Matches a filename
  // in icons/ without the .svg extension (e.g. "edit", "analytics").
  anchorIcon: z.string().min(1),
  timings: topic1Subtopics6TimingsSchema.optional(),
});

export type Topic1Subtopics6Props = z.infer<typeof topic1Subtopics6Schema>;

export const topic1Subtopics6Meta = {
  description:
    'Split-screen elaboration: a large line-art anchor icon on a light-blue left ' +
    'panel; an oxford-blue right panel holds a bold header pill announcing one ' +
    'core concept, with six detail pills beneath that type in sequentially ' +
    '(waterfall). Best for unpacking a single idea into its main supporting ' +
    'facts, drivers, dimensions, or examples — one concept fanning out into six.',
  authoringNotes:
    'mainTitle goes in the header pill — bold white, one line, max 30 chars. ' +
    'GOOD: "Data modelling", "Cost drivers", "Risk factors". ' +
    'BAD: "Understanding data modelling concepts" (too long). ' +
    'details is an array of exactly 6 items, each typing into its own pill row. ' +
    'Aim for parallel phrasing — noun phrases or short sentences, max 45 chars each. ' +
    'anchorIcon is the icon ID for the large left-panel illustration; pick one from ' +
    'the catalog\'s available_icons list. Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BG_SRC          = staticFile('images/oxford_blue_splitscreen_bg.png');
const TITLE_PILL_SRC  = staticFile('images/title_pill.png');
const PILL_OUTLINE_SRC = staticFile('images/pill_outline.png');
const SATOSHI_BOLD_SRC  = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_BLACK_SRC = staticFile('fonts/Satoshi-Black.woff2');

// ─── Layout constants (measured from the supplied PNGs) ───────────────────────

// Detail pill graphic in Pill_Outline.png lives at x=949..1835, y=228..313.
const PILL_SRC_CX = 1392;   // (949 + 1835) / 2
const PILL_SRC_CY = 270;    // (228 + 313) / 2

// Centre-y of each detail pill row in the 1920×1080 frame.
const ROW_CYS = [270, 378, 490, 601, 711, 821] as const;

// Text bounds inside each pill.
const TEXT_LEFT  = 1040;
const TEXT_RIGHT = 1820;

// Title pill — centre of Title_Pill.png asset.
const TITLE_CY = 158;

// Bulb icon inside the title pill — left-aligned.
const BULB_SIZE = 64;
const BULB_X    = 985;

// Anchor icon — large illustration on the left panel.
const ANCHOR_SIZE = 520;
const ANCHOR_CX   = 432;
const ANCHOR_CY   = 540;

// Oxford Blue BG travel distance: slides in from the right.
const NAVY_TRAVEL = 1080;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  navyPanDuration:     0.60,
  iconFadeStart:       0.50,
  iconFadeDuration:    0.50,
  headerSlideStart:    0.50,
  headerSlideDuration: 0.80,
  // Waterfall: row 0 starts at 1.30 s; each row is 1.40 s (0.60 scale + 0.80 type).
  row0Start:        1.30,
  rowScaleDuration: 0.60,
  rowTypeDuration:  0.80,
} as const;

// easeOutBack with a subtle overshoot (c1=0.6) — lively but not bouncy.
const subtleBackEase = Easing.out(Easing.back(0.6));
const cubicInOut     = Easing.inOut(Easing.cubic);

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold  = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,  { weight: '700', display: 'block' });
    const black = new FontFace('Satoshi', `url(${SATOSHI_BLACK_SRC}) format('woff2')`, { weight: '900', display: 'block' });
    const [b, k] = await Promise.all([bold.load(), black.load()]);
    const fonts = document.fonts as FontFaceSet & { add(f: FontFace): void };
    fonts.add(b);
    fonts.add(k);
  })();
  return fontsPromise;
}

// ─── Bulb icon (fixed header decoration) ─────────────────────────────────────

function BulbIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} fill="#FFFFFF">
      <path d="M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm2.86 11.18-.86.62V16h-4v-2.2l-.86-.62a5 5 0 1 1 5.72 0z" />
      <path d="M10 22h4a1 1 0 0 1 0 2h-4a1 1 0 0 1 0-2z" />
    </svg>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AnchorIcon({
  frame,
  icon,
  iconFadeStart,
  iconFadeDur,
}: {
  frame: number;
  icon: string;
  iconFadeStart: number;
  iconFadeDur: number;
}) {
  const opacity = interpolate(frame, [iconFadeStart, iconFadeStart + iconFadeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: cubicInOut,
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: ANCHOR_CX - ANCHOR_SIZE / 2,
        top:  ANCHOR_CY - ANCHOR_SIZE / 2,
        width:  ANCHOR_SIZE,
        height: ANCHOR_SIZE,
        opacity,
        pointerEvents: 'none',
      }}
    >
      <Img
        src={staticFile(`icons/${icon}.svg`)}
        alt=""
        style={{ width: ANCHOR_SIZE, height: ANCHOR_SIZE }}
      />
    </div>
  );
}

function HeaderPill({
  frame,
  mainTitle,
  slideStart,
  slideDur,
}: {
  frame: number;
  mainTitle: string;
  slideStart: number;
  slideDur: number;
}) {
  const slideX = interpolate(frame, [slideStart, slideStart + slideDur], [1920, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: cubicInOut,
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateX(${slideX}px)`,
        pointerEvents: 'none',
      }}
    >
      <Img
        src={TITLE_PILL_SRC}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      <div
        style={{
          position: 'absolute',
          left: BULB_X,
          top:  TITLE_CY - BULB_SIZE / 2,
          width:  BULB_SIZE,
          height: BULB_SIZE,
        }}
      >
        <BulbIcon size={BULB_SIZE} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: BULB_X + BULB_SIZE + 22,
          top:  TITLE_CY,
          transform: 'translateY(-50%)',
          color: '#FFFFFF',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 900,
          fontSize: 55,
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap',
        }}
      >
        {mainTitle}
      </div>
    </div>
  );
}

function DetailPill({
  index,
  frame,
  text,
  rowStart,
  scaleDur,
  typeDur,
}: {
  index: number;
  frame: number;
  text: string;
  rowStart: number;
  scaleDur: number;
  typeDur: number;
}) {
  const targetCY = ROW_CYS[index]!;
  const offsetY  = targetCY - PILL_SRC_CY;
  const scaleEnd = rowStart + scaleDur;

  // Scale-in with subtle easeOutBack, locks to 1 once settled.
  const settled   = frame >= scaleEnd;
  const scaleProg = interpolate(frame, [rowStart, scaleEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const drawScale = settled ? 1 : (scaleProg > 0 ? subtleBackEase(scaleProg) : 0);

  // Typewriter — characters revealed proportionally over typeDur frames.
  const typeProg  = interpolate(frame, [scaleEnd, scaleEnd + typeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const charsShow = Math.floor(text.length * typeProg);
  const visible   = text.slice(0, charsShow);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateY(${offsetY}px) scale(${drawScale})`,
          transformOrigin: `${PILL_SRC_CX}px ${PILL_SRC_CY}px`,
          pointerEvents: 'none',
        }}
      >
        <Img
          src={PILL_OUTLINE_SRC}
          alt=""
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left:  TEXT_LEFT,
          top:   targetCY,
          width: TEXT_RIGHT - TEXT_LEFT,
          transform: 'translateY(-50%)',
          color: '#FFFFFF',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 33,
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap',
          opacity: settled ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        {visible}
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const Topic1Subtopics6: React.FC<Topic1Subtopics6Props> = ({
  mainTitle,
  details,
  anchorIcon,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Topic1Subtopics6 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  // Merge caller-supplied overrides, then convert seconds → frames once.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const ROW_TOTAL       = f(t.rowScaleDuration) + f(t.rowTypeDuration);
  const NAVY_DUR        = f(t.navyPanDuration);
  const ICON_FADE_START = f(t.iconFadeStart);
  const ICON_FADE_DUR   = f(t.iconFadeDuration);
  const HEADER_START    = f(t.headerSlideStart);
  const HEADER_DUR      = f(t.headerSlideDuration);
  const ROW0_START      = f(t.row0Start);
  const ROW_SCALE_DUR   = f(t.rowScaleDuration);
  const ROW_TYPE_DUR    = f(t.rowTypeDuration);

  const navyX = interpolate(frame, [0, NAVY_DUR], [NAVY_TRAVEL, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: cubicInOut,
  });

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Oxford Blue right panel pans in from the right */}
      <Img
        src={BG_SRC}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          transform: `translateX(${navyX}px)`,
        }}
      />

      <AnchorIcon
        frame={frame}
        icon={anchorIcon}
        iconFadeStart={ICON_FADE_START}
        iconFadeDur={ICON_FADE_DUR}
      />

      <HeaderPill
        frame={frame}
        mainTitle={mainTitle}
        slideStart={HEADER_START}
        slideDur={HEADER_DUR}
      />

      {([0, 1, 2, 3, 4, 5] as const).map(i => (
        <DetailPill
          key={i}
          index={i}
          frame={frame}
          text={details[i]!}
          rowStart={ROW0_START + i * ROW_TOTAL}
          scaleDur={ROW_SCALE_DUR}
          typeDur={ROW_TYPE_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};
