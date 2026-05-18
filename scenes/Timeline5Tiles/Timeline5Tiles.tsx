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

// Timeline5Tiles — split-screen 5-step list with anchor icon and progress bar.
//   • Phase 1 (0.00–1.20 s): left icon panel slides in from off-canvas left
//     (translateX −1100 → 0); right container fades + slides up 30 px.
//   • Phase 2: 5 steps reveal sequentially. Each step at 1.50 + n × 2.20 s.
//     Per step:
//       0.00–0.55 s  numbered circle scales 0 → 1 (easeOutBack subtle, c1=1.05)
//       0.20–0.60 s  number digit fades in
//       0.40–1.70 s  step text typewriter character-by-character
//   • Loading bar fills in 5 segments (20 % per step), each segment animating
//     during its step's circle scale + typewriter window.
//   • Default composition length is 450 frames (15 s @ 30 fps). Step 5
//     finishes around 12.0 s, leaving ~3 s of held composition.
//
// Anchor icon (video-lecture.svg) recoloured fully white at port time
// (Pattern A static patch: both #052438 and #0496FF → #FFFFFF).

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
// stepTexts must contain exactly 5 entries.
export const timeline5TilesTimingsSchema = z
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

// Anchor accepts either an SVG icon or a character portrait PNG. The id is the
// filename stem (no extension); resolved to icons/<id>.svg or characters/<id>.png.
export const timeline5TilesAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('icon'),      id: z.string().min(1) }),
  z.object({ kind: z.literal('character'), id: z.string().min(1) }),
]);

export const timeline5TilesSchema = z.object({
  // Exactly 5 step lines, ordered top → bottom. Bold white at 37 px in the
  // Satoshi family. ≤30 chars each so the typewriter completes in 1.3 s.
  steps: z.array(z.string().min(1).max(30)).length(5),
  // Left-panel anchor: icon (line-art SVG) or character (portrait PNG).
  anchor: timeline5TilesAnchorSchema,
  timings: timeline5TilesTimingsSchema.optional(),
});

export type Timeline5TilesProps = z.infer<typeof timeline5TilesSchema>;

export const timeline5TilesMeta = {
  description:
    'Split-screen compact 5-step list. Large white anchor icon on a dark left ' +
    'panel; on the right a numbered column where each step reveals with a ' +
    'circle pop-in and a single typewritten phrase, accompanied by a progress ' +
    'bar filling beneath. One line per step, no supporting body copy. Best for ' +
    'a fast-reading 5-step process where each step is a short imperative ' +
    'phrase — speed and clarity over narrative detail.',
  authoringNotes:
    'Always supply exactly 5 steps in chronological order. Each is a short ' +
    'one-line description (Satoshi Bold 37 px white, ≤30 chars). Aim for ' +
    'parallel imperative phrasing. GOOD: "Plan the project scope". BAD: ' +
    '"You should plan the project carefully" (too long). anchor is a ' +
    "discriminated union: { kind: 'icon', id } renders icons/<id>.svg (540×540 " +
    "line art on the dark left panel); { kind: 'character', id } renders " +
    'characters/<id>.png fitted to the full panel (object-fit: contain, ' +
    'bottom-anchored). Use pre-cut PNGs with transparent backgrounds. Default ' +
    'duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const ICON_BASE_SRC      = staticFile('images/icon_base.png');
const CONTAINER_SRC      = staticFile('images/container_right.png');
const NUMBER_CIRCLE_SRC  = staticFile('images/number_circle_base.png');
const LOAD_BAR_BASE_SRC  = staticFile('images/loading_bar_base.png');
const LOAD_BAR_TOP_SRC   = staticFile('images/loading_bar_top.png');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_BOLD_SRC    = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (lifted directly from the prototype) ────────────────────

// Icon_Base.png solid bbox: x=0..857, y=50..1020 → centre (428, 535).
const ICON_PANEL_CX = 428;
const ICON_PANEL_CY = 535;
const ICON_SIZE     = 540;

// Character bbox — fills the panel (inset slightly from the bbox edges so the
// subject sits comfortably inside the rounded corners). object-fit: contain
// keeps the head visible at the top regardless of source aspect.
const CHAR_LEFT   = 50;
const CHAR_TOP    = 80;
const CHAR_WIDTH  = 750;
const CHAR_HEIGHT = 900;
const CHAR_RADIUS = 40;

// Loading bar bbox inside Container_right.png (and Loading_Bar_*.png).
const LOAD_BAR_LEFT  = 1027;
const LOAD_BAR_RIGHT = 1737;

// Number_Circle_Base.png source bbox: x=996..1121, y=198..323.
const CIRCLE_LEFT = 996;
const CIRCLE_TOP  = 198;
const CIRCLE_W    = 126;
const CIRCLE_H    = 126;
const SOURCE_CX = CIRCLE_LEFT + CIRCLE_W / 2;  // 1059
const SOURCE_CY = CIRCLE_TOP  + CIRCLE_H / 2;  // 261

// Final-comp circle row centres.
const ROW_CYS = [263, 420, 578, 735, 892] as const;

// Step text region.
const TEXT_LEFT  = 1185;
const TEXT_RIGHT = 1800;

// Left panel slides in from this far off-canvas left.
const PANEL_TRAVEL = 1100;

// Right container's slide-up + fade-up offset.
const CONTAINER_TY_FROM = 30;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  splitInStart:    0.00,
  splitInDuration: 1.20,
  stepFirstStart:  1.50,
  stepStagger:     2.20,
  // Per-step (relative to step start):
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

// ─── Loading-bar progress (5 segments, 20 % per step) ────────────────────────
// Each segment runs from its step's circle scale start to the moment its
// typewriter finishes (TYPE_START_OFFSET + TYPE_DURATION window).

function computeBarProgress(
  frame: number,
  stepFirstStart: number,
  stepStagger: number,
  segDuration: number,
): number {
  if (frame < stepFirstStart) return 0;
  for (let i = 0; i < 5; i++) {
    const segStart = stepFirstStart + i * stepStagger;
    const segEnd   = segStart + segDuration;
    if (frame < segStart) return i * 0.2;
    if (frame < segEnd) {
      const local = (frame - segStart) / segDuration;
      const eased = easeInOutCubic(local);
      return i * 0.2 + eased * 0.2;
    }
  }
  return 1.0;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type AnchorProp = Timeline5TilesProps['anchor'];

function IconPanel({
  frame,
  splitStart,
  splitEnd,
  anchor,
}: {
  frame: number;
  splitStart: number;
  splitEnd: number;
  anchor: AnchorProp;
}) {
  const x = interpolate(frame, [splitStart, splitEnd], [-PANEL_TRAVEL, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const iconOp = interpolate(frame, [splitStart + Math.round((splitEnd - splitStart) * 0.25), splitEnd + 3], [0, 1], {
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
      <Img
        src={ICON_BASE_SRC}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      {anchor.kind === 'icon' ? (
        <div
          style={{
            position: 'absolute',
            left: ICON_PANEL_CX - ICON_SIZE / 2,
            top:  ICON_PANEL_CY - ICON_SIZE / 2,
            width:  ICON_SIZE,
            height: ICON_SIZE,
            opacity: iconOp,
          }}
        >
          <Img
            src={staticFile(`icons/${anchor.id}.svg`)}
            alt=""
            style={{ width: ICON_SIZE, height: ICON_SIZE }}
          />
        </div>
      ) : (
        <div
          style={{
            position: 'absolute',
            left: CHAR_LEFT,
            top:  CHAR_TOP,
            width:  CHAR_WIDTH,
            height: CHAR_HEIGHT,
            borderRadius: CHAR_RADIUS,
            overflow: 'hidden',
            opacity: iconOp,
          }}
        >
          <Img
            src={staticFile(`characters/${anchor.id}.png`)}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              objectPosition: '50% 100%',
              display: 'block',
            }}
          />
        </div>
      )}
    </div>
  );
}

function RightContainer({
  frame,
  splitStart,
  splitEnd,
  stepFirstStart,
  stepStagger,
  segDuration,
}: {
  frame: number;
  splitStart: number;
  splitEnd: number;
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

  const fillProg   = computeBarProgress(frame, stepFirstStart, stepStagger, segDuration);
  const rightInset = (1920 - LOAD_BAR_LEFT) - (LOAD_BAR_RIGHT - LOAD_BAR_LEFT) * fillProg;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: op,
        transform: `translateY(${ty}px)`,
        pointerEvents: 'none',
      }}
    >
      <Img
        src={CONTAINER_SRC}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      {/* Loading bar BASE — darkened to read as "track" */}
      <Img
        src={LOAD_BAR_BASE_SRC}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width:  '100%',
          height: '100%',
          display: 'block',
          filter: 'brightness(0.50) saturate(0.85)',
        }}
      />
      {/* Loading bar TOP — clipped to fill progress */}
      <Img
        src={LOAD_BAR_TOP_SRC}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width:  '100%',
          height: '100%',
          display: 'block',
          clipPath: `inset(0 ${rightInset}px 0 ${LOAD_BAR_LEFT}px)`,
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
  circleScaleDur,
  typeStartOffset,
  typeDur,
}: {
  index: number;
  frame: number;
  text: string;
  startFrame: number;
  circleScaleDur: number;
  typeStartOffset: number;
  typeDur: number;
}) {
  const localFrame = frame - startFrame;
  if (localFrame < 0) return null;

  const offsetY = ROW_CYS[index]! - ROW_CYS[0];

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
      {/* Numbered circle — full-canvas asset translated + scaled around centre */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateY(${offsetY}px) scale(${drawScale})`,
          transformOrigin: `${SOURCE_CX}px ${SOURCE_CY}px`,
          opacity: scaleProg > 0 ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        <Img
          src={NUMBER_CIRCLE_SRC}
          alt=""
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      {/* Number digit — flex-centred to the circle bbox */}
      <div
        style={{
          position: 'absolute',
          left: CIRCLE_LEFT,
          top:  CIRCLE_TOP + offsetY,
          width:  CIRCLE_W,
          height: CIRCLE_H,
          display: 'flex',
          alignItems:     'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 60,
          lineHeight: 1,
          opacity: numberOp,
          transform: `scale(${drawScale})`,
          transformOrigin: 'center center',
          pointerEvents: 'none',
        }}
      >
        {index + 1}
      </div>

      {/* Step text — typewriter, vertically centred against the circle */}
      <div
        style={{
          position: 'absolute',
          left: TEXT_LEFT,
          top:  ROW_CYS[index],
          width: TEXT_RIGHT - TEXT_LEFT,
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

export const Timeline5Tiles: React.FC<Timeline5TilesProps> = ({
  steps,
  anchor,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Timeline5Tiles fonts'));
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
  const SEG_DURATION   = TYPE_OFFSET + TYPE_DUR;  // bar advances during this window per step

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      <IconPanel
        frame={frame}
        splitStart={SPLIT_START}
        splitEnd={SPLIT_END}
        anchor={anchor}
      />

      <RightContainer
        frame={frame}
        splitStart={SPLIT_START}
        splitEnd={SPLIT_END}
        stepFirstStart={STEP_FIRST}
        stepStagger={STEP_STAGGER}
        segDuration={SEG_DURATION}
      />

      {[0, 1, 2, 3, 4].map(i => (
        <Step
          key={i}
          index={i}
          frame={frame}
          text={steps[i]!}
          startFrame={STEP_FIRST + i * STEP_STAGGER}
          circleScaleDur={CIRCLE_DUR}
          typeStartOffset={TYPE_OFFSET}
          typeDur={TYPE_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ────────────────────────────────────────────────────────

export const timeline5TilesDefaultProps: Timeline5TilesProps = {
  steps: [
    'Plan the project scope',
    'Draft the proposal',
    'Get stakeholder sign-off',
    'Build the first version',
    'Ship and review',
  ],
  anchor: { kind: 'icon', id: 'video-lecture' },
};

export const timeline5TilesCharacterDemoProps: Timeline5TilesProps = {
  ...timeline5TilesDefaultProps,
  anchor: { kind: 'character', id: 'presenter-red' },
};
