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

// OrgChartV1 — 3-level organisational chart.
//   • Platinum-blue (#E6ECF2) canvas.
//   • Hierarchy: 1 CEO at the top, 3 direct reports below, 2 sub-reports
//     stacked under each direct (10 cards total).
//   • Cards distinguished by level, not branch — top is the darkest oxford,
//     directs are dodger blue, subs are a lighter dodger. Keeps the chart
//     monochrome and on-palette.
//   • Each card carries a white avatar circle with a dodger-blue person
//     icon, plus name + position to the right.
//   • Connectors are soft slate-blue lines drawn on with stroke-dashoffset.
//   • Animation reveals top-down — CEO scales in, connector tree draws to
//     the directs row, directs stagger in, vertical lines to subs draw, sub
//     rows cascade in. Subtle back overshoot on every card scale-in.
//   • Default duration 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const orgChartV1PersonSchema = z.object({
  name:     z.string().min(1).max(28),
  position: z.string().min(1).max(28),
});

export const orgChartV1BranchSchema = z.object({
  direct: orgChartV1PersonSchema,
  subs:   z.array(orgChartV1PersonSchema).length(2),  // 2 sub-reports per direct
});

export const orgChartV1TimingsSchema = z
  .object({
    ceoStart:        z.number().nonnegative(),
    ceoDuration:     z.number().positive(),
    trunkOffset:     z.number().nonnegative(),
    trunkDuration:   z.number().positive(),
    directsStart:    z.number().nonnegative(),
    directsStagger:  z.number().positive(),
    directsDuration: z.number().positive(),
    subTrunkOffset:  z.number().nonnegative(),
    subTrunkDuration: z.number().positive(),
    subsStart:       z.number().nonnegative(),
    subsRowStagger:  z.number().positive(),
    subsColStagger:  z.number().positive(),
    subsDuration:    z.number().positive(),
  })
  .partial();

export const orgChartV1Schema = z.object({
  ceo:      orgChartV1PersonSchema,
  branches: z.array(orgChartV1BranchSchema).length(3),
  timings:  orgChartV1TimingsSchema.optional(),
});

export type OrgChartV1Props = z.infer<typeof orgChartV1Schema>;

export const orgChartV1Meta = {
  description:
    'Three-level organisational chart: 1 CEO at the top, 3 direct reports, ' +
    '2 sub-reports under each direct. Cards are colour-coded by level (CEO ' +
    'oxford, directs dodger blue, subs lighter dodger). Use for team ' +
    'structures, reporting lines, or any 1→3→6 hierarchy.',
  authoringNotes:
    'Supply ceo (single person), then 3 branches each with one direct and ' +
    'exactly 2 subs. Each person has a name (≤28 chars, Satoshi Bold white) ' +
    'and position (≤28 chars, Satoshi Medium white-dim). Avatars are auto-' +
    'rendered as white circles with the bundled person icon (dodger blue). ' +
    'Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BLACK_SRC  = staticFile('fonts/Satoshi-Black.woff2');
const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (1920×1080 canvas) ─────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Vertical offset applied to every chart element — shifts the whole chart
// down so it's centred in the 1080-tall canvas instead of starting at the top.
const CHART_Y_OFFSET = 112;

// CEO card (level 1)
const CEO_W       = 420;
const CEO_H       = 130;
const CEO_CX      = 960;
const CEO_TOP_Y   = 80 + CHART_Y_OFFSET;         // 192
const CEO_BOT_Y   = CEO_TOP_Y + CEO_H;           // 322
const CEO_LEFT    = CEO_CX - CEO_W / 2;          // 750

// Connector trunk between CEO and directs row
const TRUNK_TOP_Y    = CEO_BOT_Y;                // 322
const HORIZONTAL_BAR_Y = 290 + CHART_Y_OFFSET;   // 402
const TRUNK_BOT_Y    = HORIZONTAL_BAR_Y;

// Directs row (level 2)
const DIRECT_W      = 380;
const DIRECT_H      = 110;
const DIRECT_TOP_Y  = 360 + CHART_Y_OFFSET;      // 472
const DIRECT_BOT_Y  = DIRECT_TOP_Y + DIRECT_H;   // 582
// 3 directs evenly spread across the canvas with generous edge margins
const DIRECT_CXS = [320, 960, 1600] as const;

// Sub trunk from each direct down to its first sub
const SUB_TRUNK_TOP_Y = DIRECT_BOT_Y;            // 582
const SUB_ROW_1_Y     = 560 + CHART_Y_OFFSET;    // 672
const SUB_ROW_2_Y     = 760 + CHART_Y_OFFSET;    // 872

// Sub cards (level 3) — two per direct, stacked vertically below
const SUB_W   = 360;
const SUB_H   = 95;
const SUB_GAP = 25;     // gap between sub cards in a column
// Sub Y positions: stacked
const SUB_1_TOP = SUB_ROW_1_Y;                   // 672
const SUB_1_BOT = SUB_1_TOP + SUB_H;             // 767
const SUB_2_TOP = SUB_1_BOT + SUB_GAP;           // 792
const SUB_2_BOT = SUB_2_TOP + SUB_H;             // 887

// Avatars
const AVATAR_CEO    = 72;
const AVATAR_DIRECT = 64;
const AVATAR_SUB    = 56;

// Card padding (between avatar and right edge)
const CARD_PAD     = 18;
const AVATAR_RIGHT_PAD = 16;

// Connector styling
const CONNECTOR_COLOR  = 'rgba(11,30,51,0.30)';  // soft oxford on platinum
const CONNECTOR_WIDTH  = 2.5;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  ceoStart:         0.10,
  ceoDuration:      0.75,
  trunkOffset:      0.55,   // delay after CEO start before trunk lines draw
  trunkDuration:    0.90,
  directsStart:     1.55,
  directsStagger:   0.18,
  directsDuration:  0.70,
  subTrunkOffset:   2.40,   // absolute time the vertical sub trunks start drawing
  subTrunkDuration: 0.70,
  subsStart:        2.85,
  subsRowStagger:   0.45,   // gap between row 1 and row 2
  subsColStagger:   0.15,   // gap between cards within a row (across branches)
  subsDuration:     0.65,
} as const;

const easeOutCubic         = Easing.out(Easing.cubic);
const easeInOutCubic       = Easing.inOut(Easing.cubic);
const easeOutBackSubtle    = Easing.out(Easing.back(1.1));
const easeOutBackOvershoot = Easing.out(Easing.back(1.3));

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG_COLOR = '#E6ECF2';

// CEO — deep oxford → near-black
const CEO_BG =
  'linear-gradient(135deg, #0a3050 0%, #052438 50%, #02101c 100%)';
// Directs — dodger blue
const DIRECT_BG =
  'linear-gradient(135deg, #38AEFF 0%, #1A9CFE 50%, #0686EE 100%)';
// Subs — lighter dodger blue
const SUB_BG =
  'linear-gradient(135deg, #7CC7FF 0%, #38AEFF 50%, #1A9CFE 100%)';

const CARD_BORDER = '1px solid rgba(255,255,255,0.08)';
const CARD_SHADOW = '0 10px 26px rgba(5,36,56,0.20)';

// Default avatar — oxford-blue → near-black sphere with a WHITE icon. Used
// by directs and subs (sits as a dark badge inside the dodger card).
const AVATAR_BG =
  'radial-gradient(circle at 32% 28%, #1a4870 0%, #0a3050 32%, #052438 62%, #02101c 100%)';
const AVATAR_SHADOW =
  'inset 0 -3px 6px rgba(0,0,0,0.45), ' +
  'inset 3px 3px 6px rgba(255,255,255,0.08), ' +
  '0 2px 6px rgba(5,36,56,0.20)';

// CEO avatar — dodger-blue sphere with a WHITE icon, so it pops against the
// dark oxford-blue CEO card.
const CEO_AVATAR_BG =
  'radial-gradient(circle at 32% 28%, #7CC7FF 0%, #2EA3FE 32%, #0A8AEF 62%, #005EAA 100%)';
const CEO_AVATAR_SHADOW =
  'inset 0 -3px 6px rgba(0,40,90,0.30), ' +
  'inset 4px 4px 8px rgba(255,255,255,0.18), ' +
  '0 2px 6px rgba(5,36,56,0.20)';

const TEXT_WHITE       = '#FFFFFF';
const TEXT_WHITE_DIM   = 'rgba(255,255,255,0.72)';

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

// ─── Sub-components ──────────────────────────────────────────────────────────

type CardLevel = 'ceo' | 'direct' | 'sub';

function Card({
  level, x, y, width, height, name, position,
  frame, startF, durF,
}: {
  level: CardLevel;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  position: string;
  frame: number;
  startF: number;
  durF: number;
}) {
  const local = frame - startF;
  if (local < 0) return null;

  // Card entry: subtle scale-up with back overshoot + small downward slide.
  const scale = interpolate(local, [0, durF], [0.88, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const op = interpolate(local, [0, durF * 0.6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const dy = interpolate(local, [0, durF], [-10, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  const cardBg     = level === 'ceo' ? CEO_BG : level === 'direct' ? DIRECT_BG : SUB_BG;
  const avatarSize = level === 'ceo' ? AVATAR_CEO : level === 'direct' ? AVATAR_DIRECT : AVATAR_SUB;
  const nameSize   = level === 'ceo' ? 28 : level === 'direct' ? 24 : 21;
  const posSize    = level === 'ceo' ? 18 : level === 'direct' ? 16 : 15;
  const radius     = level === 'ceo' ? 20 : 18;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top:  y,
        width,
        height,
        transform: `translateY(${dy}px) scale(${scale})`,
        transformOrigin: 'center center',
        opacity: op,
      }}
    >
      {/* Card surface */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          background: cardBg,
          border: CARD_BORDER,
          boxShadow: CARD_SHADOW,
        }}
      />
      {/* Content row: avatar + name/position */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${CARD_PAD}px`,
          gap: AVATAR_RIGHT_PAD,
        }}
      >
        <div
          style={{
            flex: `0 0 ${avatarSize}px`,
            width: avatarSize,
            height: avatarSize,
            borderRadius: '50%',
            background: level === 'ceo' ? CEO_AVATAR_BG : AVATAR_BG,
            boxShadow: level === 'ceo' ? CEO_AVATAR_SHADOW : AVATAR_SHADOW,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <Img
            src={staticFile('icons/user-white.svg')}
            alt=""
            style={{ width: avatarSize * 0.62, height: avatarSize * 0.62, display: 'block' }}
          />
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 4,
            minWidth: 0,
          }}
        >
          <div
            style={{
              color: TEXT_WHITE,
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: level === 'ceo' ? 900 : 700,
              fontSize: nameSize,
              letterSpacing: '-0.012em',
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {name}
          </div>
          <div
            style={{
              color: TEXT_WHITE_DIM,
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: 500,
              fontSize: posSize,
              letterSpacing: '-0.005em',
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {position}
          </div>
        </div>
      </div>
    </div>
  );
}

// Animated line (stroke-dashoffset draw-on).
function AnimLine({
  x1, y1, x2, y2, length, progress,
}: {
  x1: number; y1: number; x2: number; y2: number;
  length: number; progress: number;
}) {
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={CONNECTOR_COLOR}
      strokeWidth={CONNECTOR_WIDTH}
      strokeLinecap="round"
      strokeDasharray={length}
      strokeDashoffset={length * (1 - progress)}
    />
  );
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// ─── Main scene ──────────────────────────────────────────────────────────────

export const OrgChartV1: React.FC<OrgChartV1Props> = ({ ceo, branches, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading OrgChartV1 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const CEO_START          = f(t.ceoStart);
  const CEO_DUR            = f(t.ceoDuration);
  const TRUNK_START        = CEO_START + f(t.trunkOffset);
  const TRUNK_DUR          = f(t.trunkDuration);
  const DIRECTS_START      = f(t.directsStart);
  const DIRECTS_STAG       = f(t.directsStagger);
  const DIRECTS_DUR        = f(t.directsDuration);
  const SUB_TRUNK_START    = f(t.subTrunkOffset);
  const SUB_TRUNK_DUR      = f(t.subTrunkDuration);
  const SUBS_START         = f(t.subsStart);
  const SUBS_ROW_STAG      = f(t.subsRowStagger);
  const SUBS_COL_STAG      = f(t.subsColStagger);
  const SUBS_DUR           = f(t.subsDuration);

  // ─── Connector progress ────────────────────────────────────────────────────
  // 1. Vertical trunk from CEO down to the horizontal bar
  // 2. Horizontal bar across to the leftmost and rightmost direct
  // 3. Short verticals from the bar down to each direct's top
  // Drawing budget is split: 30 % vertical, 50 % horizontal, 20 % directs verticals
  const trunkLocal = frame - TRUNK_START;
  const trunkProg  = clamp01(trunkLocal / TRUNK_DUR);
  const trunkVerticalP = clamp01(trunkProg / 0.30);
  const trunkHorizontalP = clamp01((trunkProg - 0.30) / 0.50);
  const trunkDropsP = clamp01((trunkProg - 0.80) / 0.20);

  // Geometry derived
  const trunkVerticalLen = HORIZONTAL_BAR_Y - TRUNK_TOP_Y;
  const horizontalBarLen = DIRECT_CXS[2]! - DIRECT_CXS[0]!;
  const directDropLen    = DIRECT_TOP_Y - HORIZONTAL_BAR_Y;

  // Sub trunks: from each direct's bottom down past sub 1 to sub 2 bottom.
  // Use one continuous vertical line per branch, plus tiny horizontal nubs
  // implied by the visual proximity. We just draw the long vertical and
  // let the sub cards sit on top.
  const subTrunkLocal = frame - SUB_TRUNK_START;
  const subTrunkP     = clamp01(subTrunkLocal / SUB_TRUNK_DUR);
  const subTrunkLen   = SUB_2_TOP - SUB_TRUNK_TOP_Y;  // covers from direct bottom to top of sub 2

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {/* Connector lines */}
      <svg
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {/* 1. Vertical trunk from CEO bottom to the horizontal bar */}
        <AnimLine
          x1={CEO_CX} y1={TRUNK_TOP_Y}
          x2={CEO_CX} y2={HORIZONTAL_BAR_Y}
          length={trunkVerticalLen}
          progress={easeInOutCubic(trunkVerticalP)}
        />
        {/* 2. Horizontal bar — drawn from the centre outward (we render it
              as two lines emanating from the centre for a nice "expand"). */}
        <AnimLine
          x1={CEO_CX} y1={HORIZONTAL_BAR_Y}
          x2={DIRECT_CXS[0]!} y2={HORIZONTAL_BAR_Y}
          length={CEO_CX - DIRECT_CXS[0]!}
          progress={easeInOutCubic(trunkHorizontalP)}
        />
        <AnimLine
          x1={CEO_CX} y1={HORIZONTAL_BAR_Y}
          x2={DIRECT_CXS[2]!} y2={HORIZONTAL_BAR_Y}
          length={DIRECT_CXS[2]! - CEO_CX}
          progress={easeInOutCubic(trunkHorizontalP)}
        />
        {/* 3. Three vertical drops from the bar to each direct's top */}
        {DIRECT_CXS.map((cx, i) => (
          <AnimLine
            key={`drop-${i}`}
            x1={cx} y1={HORIZONTAL_BAR_Y}
            x2={cx} y2={DIRECT_TOP_Y}
            length={directDropLen}
            progress={easeInOutCubic(trunkDropsP)}
          />
        ))}

        {/* Sub trunks — one vertical line per branch from direct's bottom
            down through both sub positions. */}
        {DIRECT_CXS.map((cx, i) => (
          <AnimLine
            key={`subtrunk-${i}`}
            x1={cx} y1={SUB_TRUNK_TOP_Y}
            x2={cx} y2={SUB_2_TOP}
            length={subTrunkLen}
            progress={easeInOutCubic(subTrunkP)}
          />
        ))}
      </svg>

      {/* CEO card */}
      <Card
        level="ceo"
        x={CEO_LEFT}
        y={CEO_TOP_Y}
        width={CEO_W}
        height={CEO_H}
        name={ceo.name}
        position={ceo.position}
        frame={frame}
        startF={CEO_START}
        durF={CEO_DUR}
      />

      {/* Directs row */}
      {branches.map((branch, i) => (
        <Card
          key={`direct-${i}`}
          level="direct"
          x={DIRECT_CXS[i]! - DIRECT_W / 2}
          y={DIRECT_TOP_Y}
          width={DIRECT_W}
          height={DIRECT_H}
          name={branch.direct.name}
          position={branch.direct.position}
          frame={frame}
          startF={DIRECTS_START + i * DIRECTS_STAG}
          durF={DIRECTS_DUR}
        />
      ))}

      {/* Subs — row 1, then row 2, each branch staggered */}
      {branches.map((branch, branchIdx) => (
        <React.Fragment key={`subs-${branchIdx}`}>
          <Card
            level="sub"
            x={DIRECT_CXS[branchIdx]! - SUB_W / 2}
            y={SUB_1_TOP}
            width={SUB_W}
            height={SUB_H}
            name={branch.subs[0]!.name}
            position={branch.subs[0]!.position}
            frame={frame}
            startF={SUBS_START + branchIdx * SUBS_COL_STAG}
            durF={SUBS_DUR}
          />
          <Card
            level="sub"
            x={DIRECT_CXS[branchIdx]! - SUB_W / 2}
            y={SUB_2_TOP}
            width={SUB_W}
            height={SUB_H}
            name={branch.subs[1]!.name}
            position={branch.subs[1]!.position}
            frame={frame}
            startF={SUBS_START + SUBS_ROW_STAG + branchIdx * SUBS_COL_STAG}
            durF={SUBS_DUR}
          />
        </React.Fragment>
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const orgChartV1DefaultProps: OrgChartV1Props = {
  ceo: { name: 'Alex Morgan',    position: 'Chief Executive Officer' },
  branches: [
    {
      direct: { name: 'Priya Shah',  position: 'VP, Product' },
      subs: [
        { name: 'Daniel Reyes',  position: 'Product Lead, AI' },
        { name: 'Hannah Lin',    position: 'Product Lead, Platform' },
      ],
    },
    {
      direct: { name: 'Marcus Cole', position: 'VP, Engineering' },
      subs: [
        { name: 'Sophie Karam',  position: 'Eng Manager, Infra' },
        { name: 'Theo Park',     position: 'Eng Manager, Apps' },
      ],
    },
    {
      direct: { name: 'Elena Rossi', position: 'VP, Design' },
      subs: [
        { name: 'Noor Khan',     position: 'Design Lead, Brand' },
        { name: 'Jamie Wright',  position: 'Design Lead, Product' },
      ],
    },
  ],
};
