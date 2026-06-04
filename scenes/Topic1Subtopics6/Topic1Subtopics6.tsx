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
  // The bold headline in the header pill — locked to 3 WORDS OR FEWER (and
  // ≤30 chars) so the phrase always fits the pill on one line without
  // being clipped mid-word.
  mainTitle: z
    .string()
    .min(1)
    .max(30)
    .refine(
      s => s.trim().split(/\s+/).length <= 3,
      { message: 'mainTitle must be 3 words or fewer (one tight phrase per pill)' },
    ),
  // Small-Icons id (white-pre-coloured) shown inside the header pill, to
  // the left of the title. Resolves to small-icons/<id>.svg — pick any
  // id from the Small-Icons set ("benefit-hand", "ai-assistant",
  // "search (1)", "arrow-trend-up", …).
  titleIcon: z.string().min(1),
  // 1 to 6 detail lines, one per pill. Each types out sequentially and
  // the title pill + row band auto-centre vertically together for the
  // count (3 rows sit centred in the frame with the title pill directly
  // above them, etc.). Each line is capped at 38 chars — the largest
  // comfortable fit inside the 780 px text region at Satoshi Bold 33 px.
  // The overflow:hidden clip is a defensive backstop.
  details: z.array(z.string().min(1).max(38)).min(1).max(6),
  // Master Icons/ catalogue id for the large left-panel anchor. MUST end
  // with `-light` — those SVGs have light-coloured strokes that read on
  // the platinum-blue left panel; -dark variants would vanish into it.
  anchor: z.object({
    id: z.string().min(1).regex(/-light$/, {
      message: 'Anchor icon must end with -light (use a -light-suffix id from the Icons/ catalogue)',
    }),
  }),
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
    'mainTitle goes in the header pill — bold white, 3 WORDS OR FEWER and ≤30 ' +
    'chars so the phrase always fits the pill on one line without clipping. ' +
    'GOOD: "Data modelling", "Cost drivers", "Risk factors". BAD: "Cost ' +
    'drivers in cloud SRE 24/7" (4+ words — will fail validation). ' +
    'titleIcon is a Small-Icons id (e.g. "benefit-hand", "ai-assistant", ' +
    '"arrow-trend-up") — those SVGs are pre-coloured white and sit cleanly ' +
    'inside the header pill. details is 1 to 7 items, each typing into its ' +
    'own pill row; the row band auto-centres vertically for the count. Each ' +
    'line is capped at 38 chars — the largest comfortable fit inside the ' +
    'shell at Satoshi Bold 33 px. Aim for parallel phrasing — noun phrases ' +
    'or short sentences. anchor is { id: "<…>-light" } — pick a -light-suffix ' +
    'id from the master Icons/ catalogue ("ai-agent-aibrain-light", ' +
    '"business-strategy-checklist-light"). For the character-anchor variant ' +
    'of this layout, use the sibling template Topic1Subtopics6Character. ' +
    'Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BG_SRC          = staticFile('Template-Specific-Assets/oxford_blue_splitscreen_bg.png');
const TITLE_PILL_SRC  = staticFile('Template-Specific-Assets/title_pill.png');
const PILL_OUTLINE_SRC = staticFile('Template-Specific-Assets/pill_outline.png');
const SATOSHI_BOLD_SRC  = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_BLACK_SRC = staticFile('fonts/Satoshi-Black.woff2');

// ─── Layout constants (measured from the supplied PNGs) ───────────────────────

// Detail pill graphic in Pill_Outline.png lives at x=949..1835, y=228..313.
const PILL_SRC_CX = 1392;   // (949 + 1835) / 2
const PILL_SRC_CY = 270;    // (228 + 313) / 2

// Detail row band — auto-centres vertically for the supplied count (1-7).
// At count=6 these reproduce the original positions [270, 378, 490, 601,
// 711, 821] exactly; pitch is the original 110 px.
const ROW_BAND_CY = 545;
const ROW_PITCH   = 110;
const rowCyFor = (count: number, i: number) =>
  ROW_BAND_CY - ((count - 1) * ROW_PITCH) / 2 + i * ROW_PITCH;

// Text bounds inside each pill.
const TEXT_LEFT  = 1040;
const TEXT_RIGHT = 1820;

// Title pill — centre of Title_Pill.png asset in its original layout.
const TITLE_CY = 158;
// Vertical gap between the title pill centre and the first detail row
// centre in the original 6-row layout (270 - 158 = 112). Kept constant so
// the title pill always sits the same distance above the band, no matter
// the count — when the band auto-centres down for fewer rows, the title
// follows it.
const TITLE_TO_FIRST_ROW_GAP = 112;

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function AnchorIcon({
  frame,
  anchorId,
  iconFadeStart,
  iconFadeDur,
}: {
  frame: number;
  anchorId: string;
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
        src={staticFile(`icons/${anchorId}.svg`)}
        alt=""
        style={{ width: ANCHOR_SIZE, height: ANCHOR_SIZE }}
      />
    </div>
  );
}

function HeaderPill({
  frame,
  mainTitle,
  titleIcon,
  titleCY,
  slideStart,
  slideDur,
}: {
  frame: number;
  mainTitle: string;
  titleIcon: string;
  titleCY: number;
  slideStart: number;
  slideDur: number;
}) {
  const slideX = interpolate(frame, [slideStart, slideStart + slideDur], [1920, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: cubicInOut,
  });

  // Title text starts just after the bulb glyph; we cap its width so the
  // rightmost edge sits inside the dodger-blue pill (~x=1840) and clip
  // any overflow so long copy can never spill onto the oxford-blue bg.
  const titleLeft  = BULB_X + BULB_SIZE + 22;
  const titleWidth = 1840 - titleLeft - 16;

  // For counts <6 the band auto-centres down; the title pill must follow
  // so the composition stays together. Shift the full-canvas title pill
  // PNG and the icon/text positions by the same delta.
  const verticalShift = titleCY - TITLE_CY;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translate(${slideX}px, ${verticalShift}px)`,
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Img
          src={staticFile(`small-icons/${titleIcon}.svg`)}
          alt=""
          style={{ width: BULB_SIZE, height: BULB_SIZE, display: 'block' }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: titleLeft,
          top:  TITLE_CY,
          width: titleWidth,
          transform: 'translateY(-50%)',
          color: '#FFFFFF',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 900,
          fontSize: 55,
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {mainTitle}
      </div>
    </div>
  );
}

function DetailPill({
  cy,
  frame,
  text,
  rowStart,
  scaleDur,
  typeDur,
}: {
  cy: number;
  frame: number;
  text: string;
  rowStart: number;
  scaleDur: number;
  typeDur: number;
}) {
  const targetCY = cy;
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
          overflow: 'hidden',
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
  titleIcon,
  details,
  anchor,
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
        anchorId={anchor.id}
        iconFadeStart={ICON_FADE_START}
        iconFadeDur={ICON_FADE_DUR}
      />

      <HeaderPill
        frame={frame}
        mainTitle={mainTitle}
        titleIcon={titleIcon}
        titleCY={rowCyFor(details.length, 0) - TITLE_TO_FIRST_ROW_GAP}
        slideStart={HEADER_START}
        slideDur={HEADER_DUR}
      />

      {details.map((text, i) => (
        <DetailPill
          key={i}
          cy={rowCyFor(details.length, i)}
          frame={frame}
          text={text}
          rowStart={ROW0_START + i * ROW_TOTAL}
          scaleDur={ROW_SCALE_DUR}
          typeDur={ROW_TYPE_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ────────────────────────────────────────────────────────

export const topic1Subtopics6DefaultProps: Topic1Subtopics6Props = {
  mainTitle: 'Data modelling',
  titleIcon: 'ai-assistant',
  anchor: { id: 'ai-agent-aibrain-light' },
  details: [
    'Define entities and relationships',
    'Choose a normalisation level',
    'Map primary and foreign keys',
    'Validate against business rules',
    'Review with stakeholders',
    'Document the final schema',
  ],
};
