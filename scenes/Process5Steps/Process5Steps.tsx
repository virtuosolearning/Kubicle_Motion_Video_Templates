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

// Process5Steps — 5-step horizontal chevron flow.
//   • Platinum-blue (#E6ECF2) base. An oxford-blue → near-black radial
//     gradient scales 0 → 1 from the centre over the first ~0.85 s
//     (same staging idea as TreeDiagram4x2).
//   • Title pill at the top in dodger blue with white Satoshi Bold label.
//   • Five chevron-shaped arrows in a chain, each pointing right. Cards
//     get progressively deeper dodger blue (lightest → oxford) so the
//     "process advances" reads visually.
//   • Each chevron carries a white lucide-style icon, a big "01..05"
//     number, and a short label.
//   • All content sits inside the broadcast-action-safe area (90 % of canvas).
//   • Subtle animation: bg expands, title settles, chevrons stagger in
//     left-to-right with a back overshoot, then per-chevron icon → number
//     → label cascade. Default duration 300 frames (10 s).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const process5StepsStepSchema = z.object({
  label: z.string().min(1).max(14),
  icon:  z.string().min(1),
});

export const process5StepsTimingsSchema = z
  .object({
    bgDuration:       z.number().positive(),
    chevronStart:     z.number().nonnegative(),
    chevronStagger:   z.number().positive(),
    chevronDuration:  z.number().positive(),
    // Content reveal happens AFTER all chevrons have landed. Each chevron's
    // icon/number/label cascade in turn, staggered by contentStagger.
    contentStart:     z.number().nonnegative(),
    contentStagger:   z.number().positive(),
    iconOffset:       z.number().nonnegative(),
    iconDuration:     z.number().positive(),
    numberOffset:     z.number().nonnegative(),
    numberDuration:   z.number().positive(),
    labelOffset:      z.number().nonnegative(),
    labelDuration:    z.number().positive(),
  })
  .partial();

export const process5StepsSchema = z.object({
  steps:   z.array(process5StepsStepSchema).min(2).max(5),
  timings: process5StepsTimingsSchema.optional(),
});

export type Process5StepsProps = z.infer<typeof process5StepsSchema>;

export const process5StepsMeta = {
  description:
    '5-step horizontal chevron process flow on an oxford-blue gradient ' +
    'background. Each chevron holds an icon + numbered label. Use for ' +
    'workflows, pipelines, or any sequential process.',
  authoringNotes:
    'steps is 2 to 5 entries in left → right execution order, each with a ' +
    'label (≤14 chars) and an icon id. The chevron chain auto-centres and the ' +
    'gradient auto-spreads light → dark across whatever count you supply, so ' +
    '2, 3, 4 or 5 all read cleanly. Aim for parallel phrasing — all verbs or ' +
    'all nouns, not a mix. GOOD label: "Plan", "Build", "Test", "Ship", ' +
    '"Iterate". BAD label: "Plan everything carefully" (too long), or mixing ' +
    '"planning" with "Build" (breaks parallel form). Labels wrap to a second ' +
    'line if needed, but keeping them short keeps the cadence punchy. Icons are ' +
    'pulled from the Small-Icons set (white line icons), e.g. arrow-trend-up, ' +
    'graduation-cap, benefit-hand, ai-assistant, auto-update, search, user. ' +
    'Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BLACK_SRC  = staticFile('fonts/Satoshi-Black.woff2');
const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');

// ─── Layout constants (1920×1080 canvas) ─────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Chevrons (2–5 chained, pointing right). Each chevron has a notch on its
// left (80 px deep) and a tip on its right (80 px) — chained so each
// chevron's body starts at the previous one's body-end. The chain is
// centred on the canvas for whatever count is supplied, so fewer steps sit
// in the middle rather than drifting left. With no title pill above, the
// chain is centred vertically on the canvas mid-line.
const NOTCH_DEPTH       = 80;
const CHEVRON_BODY_W    = 308;
const CHEVRON_OUTER_W   = CHEVRON_BODY_W + 2 * NOTCH_DEPTH;    // 468
const CHEVRON_TOP_Y     = 220;
const CHEVRON_BOT_Y     = 860;
const CHEVRON_HEIGHT    = CHEVRON_BOT_Y - CHEVRON_TOP_Y;       // 640
const CHEVRON_MID_Y     = (CHEVRON_TOP_Y + CHEVRON_BOT_Y) / 2; // 540 — canvas centre

// Chain anchor — first chevron's outer-left x, derived from the step count so
// the whole chain stays centred. Span: (n−1)*CHEVRON_BODY_W + CHEVRON_OUTER_W.
function chainX(n: number): number {
  const chainW = (n - 1) * CHEVRON_BODY_W + CHEVRON_OUTER_W;
  return (CANVAS_W - chainW) / 2;
}

function chevronGeo(i: number, n: number) {
  const outerLeft  = chainX(n) + i * CHEVRON_BODY_W;
  const bodyLeft   = outerLeft + NOTCH_DEPTH;
  const bodyRight  = bodyLeft + CHEVRON_BODY_W;
  const outerRight = bodyRight + NOTCH_DEPTH;
  const centerX    = (bodyLeft + bodyRight) / 2;
  return { outerLeft, bodyLeft, bodyRight, outerRight, centerX };
}

function chevronPath(i: number, n: number): string {
  const g = chevronGeo(i, n);
  return [
    `M ${g.outerLeft} ${CHEVRON_TOP_Y}`,
    `L ${g.bodyLeft}  ${CHEVRON_MID_Y}`,
    `L ${g.outerLeft} ${CHEVRON_BOT_Y}`,
    `L ${g.bodyRight} ${CHEVRON_BOT_Y}`,
    `L ${g.outerRight} ${CHEVRON_MID_Y}`,
    `L ${g.bodyRight} ${CHEVRON_TOP_Y}`,
    'Z',
  ].join(' ');
}

// Content positions inside each chevron (relative to chevron's centerX).
const ICON_SIZE      = 130;
const ICON_CY        = CHEVRON_TOP_Y + 150;   // 430
const NUMBER_CY      = CHEVRON_TOP_Y + 330;   // 610
const LABEL_CY       = CHEVRON_TOP_Y + 500;   // 780
// Labels wrap within the chevron body instead of overflowing into the next
// chevron. Kept a touch under CHEVRON_BODY_W (308) for breathing room.
const LABEL_MAX_W    = 268;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  bgDuration:       0.85,
  chevronStart:     1.00,
  chevronStagger:   0.40,
  chevronDuration:  0.65,
  // Last chevron settles ~3.25 s; small breathing gap then content cascade.
  // Each chevron's content takes ~0.9 s, with 0.65 s stagger so they read
  // sequentially with a slight overlap.
  contentStart:     3.60,
  contentStagger:   0.65,
  iconOffset:       0.00,
  iconDuration:     0.45,
  numberOffset:     0.20,
  numberDuration:   0.45,
  labelOffset:      0.40,
  labelDuration:    0.50,
} as const;

const easeOutCubic         = Easing.out(Easing.cubic);
const easeInOutCubic       = Easing.inOut(Easing.cubic);
const easeOutBackSubtle    = Easing.out(Easing.back(1.1));
const easeOutBackOvershoot = Easing.out(Easing.back(1.35));

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG_COLOR = '#E6ECF2';

// Oxford-blue gradient — scales up over the platinum base.
const OXFORD_BG =
  'radial-gradient(ellipse at 50% 50%, ' +
  '#0a3050 0%, #052438 38%, #02101c 72%, #000000 100%)';

// Five shades of dodger blue going left → right (lightest first, deepest last).
const CHEVRON_GRADIENTS = [
  ['#7CC7FF', '#1A9CFE'],
  ['#5BB6FF', '#0F95FB'],
  ['#1A9CFE', '#0686EE'],
  ['#0686EE', '#0560A8'],
  ['#0560A8', '#0a3050'],
] as const;

// Pick a gradient for chevron i of n, evenly spreading the 5 shades across
// whatever count is supplied so 2/3/4 steps still read lightest → deepest.
function gradientFor(i: number, n: number): readonly [string, string] {
  if (n <= 1) return CHEVRON_GRADIENTS[0];
  const idx = Math.round((i * (CHEVRON_GRADIENTS.length - 1)) / (n - 1));
  return CHEVRON_GRADIENTS[idx]!;
}

const CHEVRON_SHADOW = 'drop-shadow(0 10px 18px rgba(0,0,0,0.30))';

const TEXT_WHITE     = '#FFFFFF';
const TEXT_WHITE_DIM = 'rgba(255,255,255,0.85)';

// ─── Font loading ────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const black  = new FontFace('Satoshi', `url(${SATOSHI_BLACK_SRC}) format('woff2')`,  { weight: '900', display: 'block' });
    const bold   = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,   { weight: '700', display: 'block' });
    const medium = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`, { weight: '500', display: 'block' });
    const inter  = new FontFace('Inter',   `url(${INTER_EXTRABOLD_SRC}) format('woff2')`, { weight: '800', display: 'block' });
    const [k, b, m, i] = await Promise.all([black.load(), bold.load(), medium.load(), inter.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(k);
    fonts.add(b);
    fonts.add(m);
    fonts.add(i);
  })();
  return fontsPromise;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Chevron({
  i, n, frame, startF, durF,
}: { i: number; n: number; frame: number; startF: number; durF: number }) {
  const local = frame - startF;
  if (local < 0) return null;

  const op = interpolate(local, [0, durF * 0.7], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const scale = interpolate(local, [0, durF], [0.90, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackSubtle,
  });
  const dx = interpolate(local, [0, durF], [-30, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackSubtle,
  });

  const path = chevronPath(i, n);
  const [topColor, bottomColor] = gradientFor(i, n);
  const gradId = `chev-grad-${i}`;
  const g = chevronGeo(i, n);

  return (
    <g
      style={{
        transformOrigin: `${g.centerX}px ${CHEVRON_MID_Y}px`,
        transform: `translate(${dx}px, 0) scale(${scale})`,
        opacity: op,
        filter: CHEVRON_SHADOW,
      }}
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={g.centerX} y1={CHEVRON_TOP_Y}
          x2={g.centerX} y2={CHEVRON_BOT_Y}
        >
          <stop offset="0%"   stopColor={topColor} />
          <stop offset="100%" stopColor={bottomColor} />
        </linearGradient>
      </defs>
      <path d={path} fill={`url(#${gradId})`} />
      {/* Thin rim highlight for shape definition */}
      <path d={path} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
    </g>
  );
}

function StepContent({
  i, n, step, frame, startF,
  iconOffsetF, iconDurF,
  numberOffsetF, numberDurF,
  labelOffsetF, labelDurF,
}: {
  i: number;
  n: number;
  step: { label: string; icon: string };
  frame: number;
  startF: number;
  iconOffsetF: number; iconDurF: number;
  numberOffsetF: number; numberDurF: number;
  labelOffsetF: number; labelDurF: number;
}) {
  const local = frame - startF;
  if (local < 0) return null;

  const g = chevronGeo(i, n);
  const cx = g.centerX;

  // Icon — back overshoot scale in.
  const iconLocal = local - iconOffsetF;
  const iconScale = interpolate(iconLocal, [0, iconDurF], [0.55, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const iconOp = interpolate(iconLocal, [0, iconDurF * 0.55], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  // Number — pop with back overshoot.
  const numberLocal = local - numberOffsetF;
  const numberScale = interpolate(numberLocal, [0, numberDurF], [0.65, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const numberOp = interpolate(numberLocal, [0, numberDurF * 0.5], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  // Label — fade with slight slide.
  const labelLocal = local - labelOffsetF;
  const labelOp = interpolate(labelLocal, [0, labelDurF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const labelDy = interpolate(labelLocal, [0, labelDurF], [8, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  const numberStr = String(i + 1).padStart(2, '0');

  return (
    <>
      {/* Icon */}
      <div
        style={{
          position: 'absolute',
          left: cx - ICON_SIZE / 2,
          top:  ICON_CY - ICON_SIZE / 2,
          width:  ICON_SIZE,
          height: ICON_SIZE,
          opacity: iconOp,
          transform: `scale(${iconScale})`,
          transformOrigin: 'center center',
        }}
      >
        <Img
          src={staticFile(`icons/${step.icon}.svg`)}
          alt=""
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      {/* Number */}
      <div
        style={{
          position: 'absolute',
          left: cx,
          top:  NUMBER_CY,
          transform: `translate(-50%, -50%) scale(${numberScale})`,
          opacity: numberOp,
          color: TEXT_WHITE,
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 112,
          letterSpacing: '-0.04em',
          lineHeight: 1,
          textShadow: '0 2px 8px rgba(0,40,80,0.30)',
        }}
      >
        {numberStr}
      </div>

      {/* Label */}
      <div
        style={{
          position: 'absolute',
          left: cx,
          top:  LABEL_CY,
          width: LABEL_MAX_W,
          transform: `translate(-50%, -50%) translateY(${labelDy}px)`,
          opacity: labelOp,
          color: TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 900,
          fontSize: 48,
          letterSpacing: '-0.020em',
          lineHeight: 1.08,
          textAlign: 'center',
          textShadow: '0 1px 4px rgba(0,40,80,0.30)',
          overflowWrap: 'break-word',
        }}
      >
        {step.label}
      </div>
    </>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const Process5Steps: React.FC<Process5StepsProps> = ({ steps, timings }) => {
  const frame = useCurrentFrame();
  const n = steps.length;

  const [handle] = useState(() => delayRender('Loading Process5Steps fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BG_DUR        = f(t.bgDuration);
  const CHEV_START    = f(t.chevronStart);
  const CHEV_STAG     = f(t.chevronStagger);
  const CHEV_DUR      = f(t.chevronDuration);
  const CONTENT_START = f(t.contentStart);
  const CONTENT_STAG  = f(t.contentStagger);
  const ICON_OFF      = f(t.iconOffset);
  const ICON_DUR      = f(t.iconDuration);
  const NUM_OFF       = f(t.numberOffset);
  const NUM_DUR       = f(t.numberDuration);
  const LBL_OFF       = f(t.labelOffset);
  const LBL_DUR       = f(t.labelDuration);

  const bgScale = interpolate(frame, [0, BG_DUR], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOutCubic,
  });

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {/* Oxford-blue gradient panel — scales 0 → 1 from center over platinum. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: OXFORD_BG,
          transform: `scale(${bgScale})`,
          transformOrigin: 'center center',
        }}
      />

      {/* SVG chevrons */}
      <svg
        width={CANVAS_W}
        height={CANVAS_H}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        {steps.map((_, i) => (
          <Chevron
            key={`chev-${i}`}
            i={i}
            n={n}
            frame={frame}
            startF={CHEV_START + i * CHEV_STAG}
            durF={CHEV_DUR}
          />
        ))}
      </svg>

      {/* Per-chevron content — runs AFTER all chevrons have landed, with
          each step's contents cascading one chevron at a time. */}
      {steps.map((step, i) => (
        <StepContent
          key={`step-${i}`}
          i={i}
          n={n}
          step={step}
          frame={frame}
          startF={CONTENT_START + i * CONTENT_STAG}
          iconOffsetF={ICON_OFF}
          iconDurF={ICON_DUR}
          numberOffsetF={NUM_OFF}
          numberDurF={NUM_DUR}
          labelOffsetF={LBL_OFF}
          labelDurF={LBL_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const process5StepsDefaultProps: Process5StepsProps = {
  steps: [
    { label: 'Define',  icon: 'search'        },
    { label: 'Collect', icon: 'add-document'  },
    { label: 'Train',   icon: 'ai-assistant'  },
    { label: 'Deploy',  icon: 'arrow-trend-up'},
    { label: 'Iterate', icon: 'auto-update'   },
  ],
};
