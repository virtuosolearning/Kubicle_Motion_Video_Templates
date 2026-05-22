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

// Timeline5TilesCharacter — character-only variant of Timeline5Tiles
// (the renamed Timeline5TilesV2).
//
// Same split-screen layout, sweep animation, and 5-step waterfall as the
// icon version. The only difference is the LEFT panel anchor: instead of
// a 540×540 line-art icon centred on the dodger-blue gradient panel, this
// variant renders a CHARACTER PORTRAIT inside the same panel with:
//   • the face landing at the upper-middle of the panel,
//   • the figure sized BIG so head + shoulders + chest fill the panel
//     prominently,
//   • the body clipped at the panel's rounded right edge (no straight
//     cut-off line — clipping follows the panel outline),
//   • a silhouette drop shadow lifting the figure off the gradient.

// ─── Schema ──────────────────────────────────────────────────────────────────

const characterAnchorSchema = z.object({
  id:              z.string().min(1),
  characterHeight: z.number().min(200).max(1500).optional(),
  characterY:      z.number().optional(),
});

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

export const timeline5TilesCharacterSchema = z.object({
  steps:     z.array(z.string().min(1).max(30)).length(5),
  character: characterAnchorSchema,
  timings:   timeline5TilesCharacterTimingsSchema.optional(),
});

export type Timeline5TilesCharacterProps = z.infer<typeof timeline5TilesCharacterSchema>;

export const timeline5TilesCharacterMeta = {
  description:
    'Split-screen 5-step list. The left panel hosts a character portrait ' +
    '(face at the upper-middle of the panel, body clipped at the panel\'s ' +
    'rounded right edge); the right side has the original numbered column + ' +
    'sweeping loading bar + typewriter steps. Use to put a "presenter" ' +
    'beside a 5-step process.',
  authoringNotes:
    'Always supply exactly 5 steps (Satoshi Bold 37 px, ≤30 chars each). ' +
    'character.id is a PNG in characters/<id>.png. characterHeight + ' +
    'characterY tune face position inside the panel; defaults work for ' +
    'typical presenter PNGs (face ~27 % from PNG top). Default duration ' +
    '450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const ICON_BASE_SRC      = staticFile('images/icon_base.png');
const CONTAINER_SRC      = staticFile('images/container_right.png');
const NUMBER_CIRCLE_SRC  = staticFile('images/number_circle_base.png');
const LOAD_BAR_BASE_SRC  = staticFile('images/loading_bar_base.png');
const LOAD_BAR_TOP_SRC   = staticFile('images/loading_bar_top.png');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_BOLD_SRC    = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (lifted verbatim from Timeline5Tiles) ───────────────────

const ICON_PANEL_CX = 428;
const ICON_PANEL_CY = 535;

// Character container — matches the icon_base.png panel bbox so the figure
// is clipped at the same rounded edge as the panel.
const CHAR_LEFT   = 0;
const CHAR_TOP    = 50;
const CHAR_WIDTH  = 857;
const CHAR_HEIGHT = 970;
// Panel has rounded RIGHT corners only (the left edge bleeds off-canvas).
// Radius measured from icon_base.png: the blue artwork curves over ~80 px
// at both top-right and bottom-right, so the character container must use
// the same radius to clip the figure to the panel's silhouette exactly.
const CHAR_RADIUS = '0 80px 80px 0';

// Defaults — characterHeight 900 keeps a generous head-and-shoulders
// framing on the panel; characterY 207 lands the face at ~y=500 in canvas
// (slightly above the panel centre, leaving comfortable headroom).
const DEFAULT_CHARACTER_HEIGHT = 900;
const DEFAULT_CHARACTER_Y      = 207;

// Loading bar bbox inside Container_right.png (and Loading_Bar_*.png).
const LOAD_BAR_LEFT  = 1027;
const LOAD_BAR_RIGHT = 1737;

// Number_Circle_Base.png source bbox: x=996..1121, y=198..323.
const CIRCLE_LEFT = 996;
const CIRCLE_TOP  = 198;
const CIRCLE_W    = 126;
const CIRCLE_H    = 126;
const SOURCE_CX = CIRCLE_LEFT + CIRCLE_W / 2;
const SOURCE_CY = CIRCLE_TOP  + CIRCLE_H / 2;

const ROW_CYS = [263, 420, 578, 735, 892] as const;

const TEXT_LEFT  = 1185;
const TEXT_RIGHT = 1800;

const PANEL_TRAVEL = 1100;
const CONTAINER_TY_FROM = 30;

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

// ─── Loading-bar progress (5 segments, 20 % per step) ────────────────────────

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

function IconPanel({
  frame,
  splitStart,
  splitEnd,
  characterId,
  characterHeight,
  characterY,
}: {
  frame: number;
  splitStart: number;
  splitEnd: number;
  characterId: string;
  characterHeight: number;
  characterY: number;
}) {
  const x = interpolate(frame, [splitStart, splitEnd], [-PANEL_TRAVEL, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const iconOp = interpolate(
    frame,
    [splitStart + Math.round((splitEnd - splitStart) * 0.25), splitEnd + 3],
    [0, 1],
    {
      extrapolateLeft:  'clamp',
      extrapolateRight: 'clamp',
      easing: easeInOutCubic,
    },
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateX(${x}px)`,
        pointerEvents: 'none',
      }}
    >
      {/* Dodger-blue gradient panel (artwork) */}
      <Img
        src={ICON_BASE_SRC}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      {/* Character — clipped to the panel shape, face centred in the panel */}
      <div
        style={{
          position: 'absolute',
          left:   CHAR_LEFT,
          top:    CHAR_TOP,
          width:  CHAR_WIDTH,
          height: CHAR_HEIGHT,
          borderRadius: CHAR_RADIUS,
          overflow: 'hidden',
          opacity: iconOp,
        }}
      >
        <Img
          src={staticFile(`characters/${characterId}.png`)}
          alt=""
          style={{
            position: 'absolute',
            left: ICON_PANEL_CX - CHAR_LEFT,
            top:  characterY,
            height: characterHeight,
            width:  'auto',
            transform: 'translateX(-50%)',
            display: 'block',
            filter:
              'drop-shadow(0 18px 24px rgba(2, 18, 36, 0.45)) ' +
              'drop-shadow(0 4px 8px rgba(2, 18, 36, 0.35))',
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

  const scaleProg = interpolate(localFrame, [0, circleScaleDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const settled   = localFrame >= circleScaleDur;
  const drawScale = settled ? 1 : (scaleProg > 0 ? easeOutBackSubtle(scaleProg) : 0);

  const numberOp = interpolate(localFrame, [Math.round(circleScaleDur * 0.36), circleScaleDur + 1.5], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  const typeProg = interpolate(localFrame, [typeStartOffset, typeStartOffset + typeDur], [0, 1], {
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

  const characterHeight = character.characterHeight ?? DEFAULT_CHARACTER_HEIGHT;
  const characterY      = character.characterY      ?? DEFAULT_CHARACTER_Y;

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      <IconPanel
        frame={frame}
        splitStart={SPLIT_START}
        splitEnd={SPLIT_END}
        characterId={character.id}
        characterHeight={characterHeight}
        characterY={characterY}
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

export const timeline5TilesCharacterDefaultProps: Timeline5TilesCharacterProps = {
  steps: [
    'Plan the project scope',
    'Draft the proposal',
    'Get stakeholder sign-off',
    'Build the first version',
    'Ship and review',
  ],
  character: {
    id: 'female_midcareer_white',
    characterHeight: 900,
    characterY:      207,
  },
};
