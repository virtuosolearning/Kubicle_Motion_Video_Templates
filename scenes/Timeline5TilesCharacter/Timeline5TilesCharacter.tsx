import React, { useEffect, useState } from 'react';
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

// Timeline5TilesCharacter — character-only variant of Timeline5Tiles.
//   • Left: a blue panel hosting a character portrait from the shared character
//     library. The portrait is rendered large and matted to the panel's exact
//     alpha shape, so the head sits near the top, the torso-cut bottom of the
//     source spills past the panel and is clipped, and nothing ever bleeds onto
//     the platinum background.
//   • Right: an oxford-blue rounded container that AUTO-SIZES to the number of
//     steps (1–5) and stays vertically centred — no empty space below the last
//     step. Each step reveals with a circle pop-in and a single typewritten
//     phrase; a progress bar beneath fills 1/N per step.
//   • Default composition length is 450 frames (15 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
export const timeline5TilesCharacterTimingsSchema = z
  .object({
    splitInStart:    z.number().nonnegative(),
    splitInDuration: z.number().positive(),
    stepFirstStart:  z.number().nonnegative(),
    stepStagger:     z.number().positive(),
    circleScaleDuration: z.number().positive(),
    typeStartOffset:     z.number().nonnegative(),
    typeDuration:        z.number().positive(),
  })
  .partial();

// Character library — every PNG in the shared CHARACTER LIBRARY (PNG) set.
// Swapping a character is just changing its id; all render at one fixed framing.
export const CHARACTER_IDS = [
  'Female_middleage_Asian',
  'female_earlycareer_black',
  'female_earlycareer_middleeastern',
  'female_earlycareer_white',
  'female_earlycareer_white2',
  'female_earlycareer_white3',
  'female_midcareer_white',
  'female_middleage_white',
  'female_middleage_white2',
  'female_middleage_white3',
  'male_earlycareer_black',
  'male_middleage_asian',
  'male_middleage_black',
  'male_middleage_white',
  'male_middleage_white2',
  'male_middleage_white3',
] as const;

export const characterIdSchema = z.enum(CHARACTER_IDS);

export const timeline5TilesCharacterSchema = z.object({
  // 1 to 5 step lines, ordered top → bottom. Bold white at 37 px in the
  // Satoshi family. ≤30 chars each so the typewriter completes in 1.3 s. The
  // oxford-blue container resizes to fit however many you supply.
  steps: z.array(z.string().min(1).max(30)).min(1).max(5),
  // Character portrait — any id from the character library. All render at one
  // fixed framing, so swapping a character is just changing its id.
  character: characterIdSchema,
  timings: timeline5TilesCharacterTimingsSchema.optional(),
});

export type Timeline5TilesCharacterProps = z.infer<typeof timeline5TilesCharacterSchema>;

export const timeline5TilesCharacterMeta = {
  description:
    'Split-screen compact 1–5 step list with a character portrait on the left. ' +
    'The portrait is matted to the blue panel and framed head-to-chest; on the ' +
    'right an oxford-blue container auto-sizes to the number of steps, each ' +
    'revealing with a circle pop-in and a single typewritten phrase, accompanied ' +
    'by a progress bar filling beneath. Use to put a "presenter" beside a short ' +
    'process.',
  authoringNotes:
    'Supply 1 to 5 steps in chronological order. Each is a short one-line ' +
    'description (Satoshi Bold 37 px white, ≤30 chars). Aim for parallel ' +
    'imperative phrasing. GOOD: "Plan the project scope". BAD: "You should ' +
    'plan the project carefully" (too long). The oxford-blue container ' +
    'auto-sizes and stays vertically centred for whatever count you supply, so ' +
    '1, 2, 3, 4 or 5 all read with no empty space. character is an id from the ' +
    'character library (use a CHARACTER_IDS value) — every portrait renders at ' +
    'the same fixed framing, matted to the panel, so swapping a character never ' +
    'changes its size or position. Default duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const ICON_BASE_SRC       = staticFile('Template-Specific-Assets/icon_base.png');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_BOLD_SRC     = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (1920×1080 canvas) ─────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Left blue panel (icon_base.png bbox: x 0..858, y 50..1021 → centre 428, 535).
const ICON_PANEL_CX = 428;

// Character anchor. Two things to get right:
//   1. The library PNGs are hard-cropped at the torso (the figure runs to the
//      very bottom edge of the source). Rendering the portrait LARGER than the
//      panel and top-anchored pushes that flat cut below the panel, leaving a
//      clean head-and-shoulders/chest framing.
//   2. The portrait is matted to the blue panel's exact shape using
//      icon_base.png's alpha as a CSS mask, so it can never spill past the panel
//      onto the platinum background (the panel has a large right-corner radius
//      and a flush left edge — the mask matches it precisely).
const CHAR_IMG_W    = 1060;                          // portrait size (square)
const CHAR_IMG_TOP  = 48;                            // portrait top (canvas-y)
const CHAR_IMG_LEFT = ICON_PANEL_CX - CHAR_IMG_W / 2; // centred on the panel

// Right oxford-blue container — horizontal extent fixed; height derived from N.
const CONTAINER_LEFT   = 944;
const CONTAINER_W      = 877;
const CONTAINER_RADIUS = 40;

// Vertical model inside the container (measured from container top):
const BAR_FROM_TOP   = 85;     // progress-bar centre
const ROW0_FROM_TOP  = 215;    // first step's circle centre
const ROW_PITCH      = 157.25; // centre-to-centre between steps
const BOTTOM_PAD      = 131;    // below the last step's circle centre

function containerHeight(n: number): number {
  return ROW0_FROM_TOP + (n - 1) * ROW_PITCH + BOTTOM_PAD;
}
function containerTop(n: number): number {
  return (CANVAS_H - containerHeight(n)) / 2;
}

// Progress bar (relative to container left).
const BAR_LEFT_REL = 83;       // 1027 − CONTAINER_LEFT
const BAR_WIDTH    = 710;
const BAR_HEIGHT   = 44;

// Numbered circle.
const CIRCLE_CX = 1059;
const CIRCLE_R  = 63;          // diameter 126

// Step text region.
const TEXT_LEFT  = 1185;
const TEXT_WIDTH = 615;

// Left panel slides in from this far off-canvas left.
const PANEL_TRAVEL = 1100;
// Right container's slide-up + fade-up offset.
const CONTAINER_TY_FROM = 30;

// ─── Palette (sampled from the original prototype PNGs) ──────────────────────

const CONTAINER_BG = 'linear-gradient(180deg, #041E2E 0%, #020D14 100%)';
// Track is the dodger blue darkened (matches the original base PNG at 50%).
const BAR_TRACK    = '#024B80';
// Bar fill + circles share the same top-lit vertical gradient as the source
// PNGs: light blue at the top falling to dodger blue at the bottom.
const BAR_FILL     = 'linear-gradient(180deg, #45B1FF 0%, #0496FF 100%)';
const CIRCLE_BG    = 'linear-gradient(180deg, #5ABAFF 0%, #1A9FFF 52%, #0496FF 100%)';

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  splitInStart:    0.00,
  splitInDuration: 1.20,
  stepFirstStart:  1.50,
  stepStagger:     2.20,
  circleScaleDuration: 0.55,
  typeStartOffset:     0.40,
  typeDuration:        1.30,
} as const;

const easeInOutCubic    = Easing.inOut(Easing.cubic);
const easeOutBackSubtle = Easing.out(Easing.back(1.05));

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const inter   = new FontFace('Inter',   `url(${INTER_EXTRABOLD_SRC}) format('woff2')`, { weight: '800', display: 'block' });
    const satoshi = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,    { weight: '700', display: 'block' });
    const [i, s]  = await Promise.all([inter.load(), satoshi.load()]);
    const fonts   = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(i);
    fonts.add(s);
  })();
  return fontsPromise;
}

// ─── Loading-bar progress (N segments, 1/N per step) ─────────────────────────

function computeBarProgress(
  frame: number,
  stepFirstStart: number,
  stepStagger: number,
  segDuration: number,
  n: number,
): number {
  if (frame < stepFirstStart) return 0;
  const seg = 1 / n;
  for (let i = 0; i < n; i++) {
    const segStart = stepFirstStart + i * stepStagger;
    const segEnd   = segStart + segDuration;
    if (frame < segStart) return i * seg;
    if (frame < segEnd) {
      const local = (frame - segStart) / segDuration;
      return i * seg + easeInOutCubic(local) * seg;
    }
  }
  return 1.0;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CharacterPanel({
  frame,
  splitStart,
  splitEnd,
  characterId,
}: {
  frame: number;
  splitStart: number;
  splitEnd: number;
  characterId: string;
}) {
  const x = interpolate(frame, [splitStart, splitEnd], [-PANEL_TRAVEL, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const op = interpolate(frame, [splitStart + Math.round((splitEnd - splitStart) * 0.25), splitEnd + 3], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateX(${x}px)`,
        pointerEvents: 'none',
      }}
    >
      {/* Dodger-blue gradient panel artwork */}
      <Img
        src={ICON_BASE_SRC}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      {/* Character — matted to the panel's exact alpha shape */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: op,
          WebkitMaskImage: `url(${ICON_BASE_SRC})`,
          maskImage:       `url(${ICON_BASE_SRC})`,
          WebkitMaskSize: `${CANVAS_W}px ${CANVAS_H}px`,
          maskSize:       `${CANVAS_W}px ${CANVAS_H}px`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat:       'no-repeat',
          WebkitMaskPosition: '0px 0px',
          maskPosition:       '0px 0px',
        }}
      >
        <Img
          src={staticFile(`characters/${characterId}.png`)}
          alt=""
          style={{
            position: 'absolute',
            left: CHAR_IMG_LEFT,
            top:  CHAR_IMG_TOP,
            width:  CHAR_IMG_W,
            height: CHAR_IMG_W,
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}

function RightContainer({
  frame,
  splitStart,
  splitEnd,
  n,
  cTop,
  cHeight,
  stepFirstStart,
  stepStagger,
  segDuration,
}: {
  frame: number;
  splitStart: number;
  splitEnd: number;
  n: number;
  cTop: number;
  cHeight: number;
  stepFirstStart: number;
  stepStagger: number;
  segDuration: number;
}) {
  const op = interpolate(frame, [splitStart, splitEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const ty = interpolate(frame, [splitStart, splitEnd], [CONTAINER_TY_FROM, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  const fillProg = computeBarProgress(frame, stepFirstStart, stepStagger, segDuration, n);

  return (
    <div
      style={{
        position: 'absolute',
        left: CONTAINER_LEFT,
        top:  cTop,
        width:  CONTAINER_W,
        height: cHeight,
        borderRadius: CONTAINER_RADIUS,
        background: CONTAINER_BG,
        opacity: op,
        transform: `translateY(${ty}px)`,
        pointerEvents: 'none',
      }}
    >
      {/* Progress bar track */}
      <div
        style={{
          position: 'absolute',
          left: BAR_LEFT_REL,
          top:  BAR_FROM_TOP - BAR_HEIGHT / 2,
          width:  BAR_WIDTH,
          height: BAR_HEIGHT,
          borderRadius: BAR_HEIGHT / 2,
          background: BAR_TRACK,
        }}
      />
      {/* Progress bar fill */}
      <div
        style={{
          position: 'absolute',
          left: BAR_LEFT_REL,
          top:  BAR_FROM_TOP - BAR_HEIGHT / 2,
          width:  Math.max(BAR_HEIGHT, BAR_WIDTH * fillProg),
          height: BAR_HEIGHT,
          borderRadius: BAR_HEIGHT / 2,
          background: BAR_FILL,
        }}
      />
    </div>
  );
}

function Step({
  index,
  frame,
  text,
  startFrame,
  rowCenterY,
  circleScaleDur,
  typeStartOffset,
  typeDur,
}: {
  index: number;
  frame: number;
  text: string;
  startFrame: number;
  rowCenterY: number;
  circleScaleDur: number;
  typeStartOffset: number;
  typeDur: number;
}) {
  const localFrame = frame - startFrame;
  if (localFrame < 0) return null;

  // Circle scale-in.
  const scaleProg = interpolate(localFrame, [0, circleScaleDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const settled   = localFrame >= circleScaleDur;
  const drawScale = settled ? 1 : (scaleProg > 0 ? easeOutBackSubtle(scaleProg) : 0);

  // Number digit fade.
  const numberOp = interpolate(localFrame, [Math.round(circleScaleDur * 0.36), circleScaleDur + 1.5], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  // Typewriter — starts midway through the scale-in.
  const typeProg = interpolate(localFrame, [typeStartOffset, typeStartOffset + typeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const charsShow = Math.floor(text.length * typeProg);
  const visible   = text.slice(0, charsShow);

  return (
    <>
      {/* Numbered circle */}
      <div
        style={{
          position: 'absolute',
          left: CIRCLE_CX - CIRCLE_R,
          top:  rowCenterY - CIRCLE_R,
          width:  CIRCLE_R * 2,
          height: CIRCLE_R * 2,
          borderRadius: '50%',
          background: CIRCLE_BG,
          transform: `scale(${drawScale})`,
          transformOrigin: 'center center',
          opacity: scaleProg > 0 ? 1 : 0,
          display: 'flex',
          alignItems:     'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            color: '#FFFFFF',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 800,
            fontSize: 60,
            lineHeight: 1,
            opacity: numberOp,
          }}
        >
          {index + 1}
        </span>
      </div>

      {/* Step text — typewriter, vertically centred against the circle */}
      <div
        style={{
          position: 'absolute',
          left: TEXT_LEFT,
          top:  rowCenterY,
          width: TEXT_WIDTH,
          transform: 'translateY(-50%)',
          color: '#FFFFFF',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 37,
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap',
          opacity: localFrame >= typeStartOffset ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        {visible}
      </div>
    </>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const Timeline5TilesCharacter: React.FC<Timeline5TilesCharacterProps> = ({
  steps,
  character,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Timeline5TilesCharacter fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const SPLIT_START    = f(t.splitInStart);
  const SPLIT_END      = SPLIT_START + f(t.splitInDuration);
  const STEP_FIRST     = f(t.stepFirstStart);
  const STEP_STAGGER   = f(t.stepStagger);
  const CIRCLE_DUR     = f(t.circleScaleDuration);
  const TYPE_OFFSET    = f(t.typeStartOffset);
  const TYPE_DUR       = f(t.typeDuration);
  const SEG_DURATION   = TYPE_OFFSET + TYPE_DUR;

  const n      = steps.length;
  const cHeight = containerHeight(n);
  const cTop    = containerTop(n);

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      <CharacterPanel
        frame={frame}
        splitStart={SPLIT_START}
        splitEnd={SPLIT_END}
        characterId={character}
      />

      <RightContainer
        frame={frame}
        splitStart={SPLIT_START}
        splitEnd={SPLIT_END}
        n={n}
        cTop={cTop}
        cHeight={cHeight}
        stepFirstStart={STEP_FIRST}
        stepStagger={STEP_STAGGER}
        segDuration={SEG_DURATION}
      />

      {steps.map((text, i) => (
        <Step
          key={i}
          index={i}
          frame={frame}
          text={text}
          startFrame={STEP_FIRST + i * STEP_STAGGER}
          rowCenterY={cTop + ROW0_FROM_TOP + i * ROW_PITCH}
          circleScaleDur={CIRCLE_DUR}
          typeStartOffset={TYPE_OFFSET}
          typeDur={TYPE_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ────────────────────────────────────────────────────────

export const timeline5TilesCharacterDefaultProps: Timeline5TilesCharacterProps = {
  steps: [
    'Plan the project scope',
    'Draft the proposal',
    'Get stakeholder sign-off',
    'Build the first version',
    'Ship and review',
  ],
  character: 'female_midcareer_white',
};
