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

// Topic1Subtopics6Character — character-only variant of Topic1Subtopics6
// (the renamed OnePoint7Subtopics).
//
// Same layout, animation, and waterfall typing as the icon version. The
// only difference is the left-panel anchor: instead of a 520×520 line-art
// icon floating on the platinum-blue background, this variant draws a
// dodger-blue rounded panel on the left half of the canvas and renders a
// character portrait inside it, with:
//   • the figure horizontally centred in the panel,
//   • the FACE landing at the panel's vertical centrepoint (tuned via
//     characterHeight + characterY),
//   • a silhouette drop shadow that lifts the figure off the dodger blue,
//   • lower body clipped by the panel's bottom edge via overflow: hidden
//     so the framing always reads as a clean head-and-shoulders portrait.

// ─── Schema ──────────────────────────────────────────────────────────────────

const characterAnchorSchema = z.object({
  id:              z.string().min(1),
  // Rendered height of the character image in px (width preserved by aspect).
  characterHeight: z.number().min(200).max(1500).optional(),
  // Top offset inside the panel, in px. Negative crops the top of the image.
  characterY:      z.number().optional(),
});

export const topic1Subtopics6CharacterTimingsSchema = z
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

export const topic1Subtopics6CharacterSchema = z.object({
  mainTitle: z.string().min(1).max(30),
  details:   z.array(z.string().min(1).max(45)).length(6),
  character: characterAnchorSchema,
  timings:   topic1Subtopics6CharacterTimingsSchema.optional(),
});

export type Topic1Subtopics6CharacterProps = z.infer<
  typeof topic1Subtopics6CharacterSchema
>;

export const topic1Subtopics6CharacterMeta = {
  description:
    'Split-screen elaboration: a dodger-blue panel on the left holding a ' +
    'character portrait (face at the centrepoint); an oxford-blue panel ' +
    'on the right with a bold header pill announcing one core concept and ' +
    'six detail pills that type in sequentially (waterfall). Same ' +
    'animation as Topic1Subtopics6; only the left-panel anchor differs.',
  authoringNotes:
    'mainTitle ≤30 chars in the header pill. details: exactly 6 lines, ' +
    'each ≤45 chars, typed into pill rows in turn. character.id is a PNG ' +
    'in characters/<id>.png. characterHeight + characterY tune the face ' +
    'position inside the dodger-blue panel; defaults work for typical ' +
    'presenter PNGs (face ~35% from PNG top). Default duration 300 ' +
    'frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BG_SRC          = staticFile('images/oxford_blue_splitscreen_bg.png');
const TITLE_PILL_SRC  = staticFile('images/title_pill.png');
const PILL_OUTLINE_SRC = staticFile('images/pill_outline.png');
const SATOSHI_BOLD_SRC  = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_BLACK_SRC = staticFile('fonts/Satoshi-Black.woff2');

// ─── Layout constants (measured from the supplied PNGs) ───────────────────────

// Detail pill graphic in Pill_Outline.png lives at x=949..1835, y=228..313.
const PILL_SRC_CX = 1392;
const PILL_SRC_CY = 270;

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

// Dodger-blue character panel on the left half. Positioned where the
// icon used to sit (centred around the original ANCHOR_CX = 432) so the
// rest of the composition still feels balanced.
const PANEL_LEFT   = 100;
const PANEL_TOP    = 60;
const PANEL_WIDTH  = 660;
const PANEL_HEIGHT = 920;
const PANEL_RADIUS = 40;
const PANEL_CENTER_Y = PANEL_HEIGHT / 2;          // 460
// Vertical dodger-blue gradient — lighter at the top, deeper toward the
// bottom. Gives the panel a subtle sense of dimension instead of a flat
// fill.
const PANEL_FILL   =
  'linear-gradient(180deg, #38B0FF 0%, #0496FF 50%, #0274C9 100%)';

// Default character framing — chosen so presenter-grey (face ~35 % from
// the top of the PNG) lands the face at the panel centrepoint.
const DEFAULT_CHARACTER_HEIGHT = 850;
const DEFAULT_CHARACTER_Y      = 163;             // ≈ PANEL_CENTER_Y − 0.35 × 850

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
  row0Start:        1.30,
  rowScaleDuration: 0.60,
  rowTypeDuration:  0.80,
} as const;

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

// ─── Character anchor (dodger-blue panel + portrait) ─────────────────────────

function CharacterAnchor({
  frame,
  id,
  characterHeight,
  characterY,
  iconFadeStart,
  iconFadeDur,
}: {
  frame: number;
  id: string;
  characterHeight: number;
  characterY:      number;
  iconFadeStart:   number;
  iconFadeDur:     number;
}) {
  const opacity = interpolate(
    frame,
    [iconFadeStart, iconFadeStart + iconFadeDur],
    [0, 1],
    {
      extrapolateLeft:  'clamp',
      extrapolateRight: 'clamp',
      easing: cubicInOut,
    },
  );

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
        opacity,
        pointerEvents: 'none',
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
          // Two-layer silhouette drop shadow against the dodger-blue panel.
          filter:
            'drop-shadow(0 18px 24px rgba(2, 18, 36, 0.45)) ' +
            'drop-shadow(0 4px 8px rgba(2, 18, 36, 0.35))',
        }}
      />
    </div>
  );
}

// ─── Header pill ──────────────────────────────────────────────────────────────

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

// ─── Detail pill ──────────────────────────────────────────────────────────────

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

  const settled   = frame >= scaleEnd;
  const scaleProg = interpolate(frame, [rowStart, scaleEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const drawScale = settled ? 1 : (scaleProg > 0 ? subtleBackEase(scaleProg) : 0);

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

export const Topic1Subtopics6Character: React.FC<Topic1Subtopics6CharacterProps> = ({
  mainTitle,
  details,
  character,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() =>
    delayRender('Loading Topic1Subtopics6Character fonts'),
  );
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

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

  const characterHeight = character.characterHeight ?? DEFAULT_CHARACTER_HEIGHT;
  const characterY      = character.characterY      ?? DEFAULT_CHARACTER_Y;

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
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

      <CharacterAnchor
        frame={frame}
        id={character.id}
        characterHeight={characterHeight}
        characterY={characterY}
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

// ─── Demo / test props ────────────────────────────────────────────────────────

export const topic1Subtopics6CharacterDefaultProps: Topic1Subtopics6CharacterProps = {
  mainTitle: 'Data modelling',
  character: {
    id: 'presenter-grey',
    // 1414×1441 PNG with the face centred horizontally; face is ~35 %
    // from the top of the PNG. At 850 px tall with characterY=163 the
    // eyes/nose land at the dodger-blue panel's vertical centre.
    characterHeight: 850,
    characterY:      163,
  },
  details: [
    'Define entities and relationships',
    'Choose a normalisation level',
    'Map primary and foreign keys',
    'Validate against business rules',
    'Review with stakeholders',
    'Document the final schema',
  ],
};
