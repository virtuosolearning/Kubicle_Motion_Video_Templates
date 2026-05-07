import { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Img,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { z } from 'zod';

// Ports the 4 Circle Points v1 prototype exactly:
//   • Four blue circles evenly spaced on a #E6ECF2 background
//   • Pass 1 — each circle scales 0→1 with easeOutBack, staggered every 0.50 s
//   • Pass 2 — each circle pulses (sine bump ×1.15) while its label fades in,
//              staggered every 0.80 s after all circles have landed
//   • Icons are rendered white via CSS filter brightness(0) invert(1)
//   • Outro opacity fade over the last 1.1 s

// ─── Schema ──────────────────────────────────────────────────────────────────

const pointSchema = z.object({
  // Icon ID from the catalog's available_icons list (e.g. "running_man_speed")
  icon:  z.string().min(1),
  label: z.string().min(1).max(20),
});

// Optional per-render timing overrides. All values are in SECONDS (the
// scene runs at 30 fps and converts internally). pass1Starts and
// pass2Starts must each contain exactly 4 entries (one per circle).
// Any field omitted falls back to the corresponding DEFAULT_TIMINGS entry.
export const fourCirclePointsTimingsSchema = z
  .object({
    pass1Starts: z.array(z.number().nonnegative()).length(4),
    pass1Duration: z.number().positive(),
    pass2Starts: z.array(z.number().nonnegative()).length(4),
    pass2Duration: z.number().positive(),
    textFade: z.number().positive(),
    outroDuration: z.number().nonnegative(),
  })
  .partial();

export const fourCirclePointsSchema = z.object({
  // Exactly 4 items — one per circle.
  points: z.array(pointSchema).min(4).max(4),
  // Optional animation timing overrides (seconds, internally converted to frames @ 30fps).
  timings: fourCirclePointsTimingsSchema.optional(),
});

export type FourCirclePointsProps = z.infer<typeof fourCirclePointsSchema>;

export const fourCirclePointsMeta = {
  description:
    'Four evenly-spaced blue circles on a light-blue background. Each circle ' +
    'holds a white icon and reveals a bold label beneath it. Circles pop in ' +
    'one-by-one (easeOutBack), then each pulses and its label fades in.',
  authoringNotes:
    'Provide exactly 4 items. Each item needs an icon id from the catalog\'s ' +
    'available_icons list and a short label — strict 20-character max, bold black below each circle. ' +
    'Write tight noun phrases (1–3 words). GOOD: "Data quality", "Fast queries", "Low cost", "Easy setup". ' +
    'BAD: "Improve data quality", "Runs queries faster" (too long — strip verbs, keep the noun core). ' +
    'Works best for listing four parallel concepts, features, or steps. Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BASE_CIRCLE_SRC = staticFile('images/four_circle_base.png');
const INTER_BOLD_SRC  = staticFile('fonts/Inter-Bold.woff2');

// ─── Layout constants (match prototype pixel-for-pixel) ───────────────────────

const COUNT      = 4;
const CIRCLE_D   = 382;   // diameter of circle in Base_Circle.png
const CIRCLE_CY  = 533;   // vertical centre of circles (canvas coords)
const ICON_SIZE  = 240;
const TEXT_Y     = 830;   // top of label text

// Where the circle sits inside Base_Circle.png (1920×1080)
const SRC_CX = 315;
const SRC_CY = 533;

// Offset to apply inside the clipping div so the PNG's circle fills the wrapper
const PNG_OFFSET_LEFT = -(SRC_CX - CIRCLE_D / 2);  // -124
const PNG_OFFSET_TOP  = -(SRC_CY - CIRCLE_D / 2);  // -342

// Evenly distributed circle centres (outer gap = inner gap)
const GAP = (1920 - COUNT * CIRCLE_D) / (COUNT + 1);
const CIRCLE_CXS = [0, 1, 2, 3].map(i =>
  Math.round(GAP + CIRCLE_D / 2 + i * (GAP + CIRCLE_D))
); // ≈ [269, 730, 1190, 1651]

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

// Defaults expressed in SECONDS so the prototype's reference timeline is
// readable at a glance; conversion to frames happens inside the component
// once we've merged in any caller-supplied overrides.
const DEFAULT_TIMINGS = {
  // Pass 1 — pop in staggered every 0.50 s
  pass1Starts: [0.30, 0.80, 1.30, 1.80] as readonly number[],
  pass1Duration: 0.70,
  // Pass 2 — sine pulse + label fade staggered every 0.80 s
  pass2Starts: [2.70, 3.50, 4.30, 5.10] as readonly number[],
  pass2Duration: 0.60,
  // Label fade-in alongside the pulse
  textFade: 0.60,
  // Outro
  outroDuration: 1.10,
} as const;

// Pulse amplitude is part of the design language, not a timing knob.
const P2_AMP    = 0.15;    // peak overshoot

// ─── easeOutBack (matches prototype's c1=1.70158) ────────────────────────────

function easeOutBackFn(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadBrandFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold = new FontFace('Inter', `url(${INTER_BOLD_SRC}) format('woff2')`, { weight: '700', display: 'block' });
    const loaded = await bold.load();
    (document.fonts as FontFaceSet & { add(f: FontFace): void }).add(loaded);
  })();
  return fontsPromise;
}

// ─── Single circle + label ────────────────────────────────────────────────────

function CirclePoint({
  index,
  icon,
  label,
  p1Starts,
  p1Dur,
  p2Starts,
  p2Dur,
  textFade,
}: {
  index: 0 | 1 | 2 | 3;
  icon: string;
  label: string;
  p1Starts: readonly number[];
  p1Dur: number;
  p2Starts: readonly number[];
  p2Dur: number;
  textFade: number;
}) {
  const frame = useCurrentFrame();
  const cx = CIRCLE_CXS[index];

  // ── Pass 1: pop in with easeOutBack ──────────────────────────────────────
  const p1Start = p1Starts[index]!;
  const p1 = Math.max(0, Math.min(1, (frame - p1Start) / p1Dur));
  const base = p1 > 0 ? easeOutBackFn(p1) : 0;

  // ── Pass 2: sine pulse bump ───────────────────────────────────────────────
  const p2Start = p2Starts[index]!;
  const p2 = Math.max(0, Math.min(1, (frame - p2Start) / p2Dur));
  const bump = p2 > 0 && p2 < 1 ? P2_AMP * Math.sin(Math.PI * p2) : 0;

  const scale = Math.max(0, base + bump);

  // ── Label fades in alongside the pulse ───────────────────────────────────
  const textOpacity = interpolate(frame, [p2Start, p2Start + textFade], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <>
      {/* Clipping window: sized to the circle, clips the PNG so only the disc shows */}
      <div
        style={{
          position: 'absolute',
          left: cx - CIRCLE_D / 2,
          top:  CIRCLE_CY - CIRCLE_D / 2,
          width:  CIRCLE_D,
          height: CIRCLE_D,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {/* Base_Circle.png offset so its blue disc aligns with this wrapper */}
        <Img
          src={BASE_CIRCLE_SRC}
          alt=""
          style={{
            position: 'absolute',
            left: PNG_OFFSET_LEFT,
            top:  PNG_OFFSET_TOP,
            width: 1920,
            height: 1080,
            display: 'block',
          }}
        />
        {/* Icon centred on the disc; CSS filter makes it white on the blue background */}
        <div
          style={{
            position: 'absolute',
            left: CIRCLE_D / 2 - ICON_SIZE / 2,
            top:  CIRCLE_D / 2 - ICON_SIZE / 2,
            width: ICON_SIZE,
            height: ICON_SIZE,
          }}
        >
          <Img
            src={staticFile(`icons/${icon}.svg`)}
            alt=""
            style={{ width: ICON_SIZE, height: ICON_SIZE, filter: 'brightness(0) invert(1)' }}
          />
        </div>
      </div>

      {/* Label — outside the scaled wrapper so it doesn't scale */}
      <div
        style={{
          position: 'absolute',
          left: cx,
          top:  TEXT_Y,
          transform: 'translate(-50%, 0)',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 37,
          color: '#000000',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          opacity: textOpacity,
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const FourCirclePoints: React.FC<FourCirclePointsProps> = ({ points, timings }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const [handle] = useState(() => delayRender('Loading FourCirclePoints fonts'));
  useEffect(() => {
    loadBrandFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  // Merge caller-supplied timing overrides over the signed-off defaults,
  // then convert from seconds to frames once.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const P1_STARTS = t.pass1Starts.map(f);
  const P1_DUR    = f(t.pass1Duration);
  const P2_STARTS = t.pass2Starts.map(f);
  const P2_DUR    = f(t.pass2Duration);
  const TEXT_FADE = f(t.textFade);
  const OUTRO_DUR = f(t.outroDuration);

  // Outro fade
  const outroStart = Math.max(0, durationInFrames - OUTRO_DUR);
  const outroOpacity = interpolate(frame, [outroStart, durationInFrames], [1, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden', opacity: outroOpacity }}>
      {(points as typeof points).map((pt, i) => (
        <CirclePoint
          key={i}
          index={i as 0 | 1 | 2 | 3}
          icon={pt.icon}
          label={pt.label}
          p1Starts={P1_STARTS}
          p1Dur={P1_DUR}
          p2Starts={P2_STARTS}
          p2Dur={P2_DUR}
          textFade={TEXT_FADE}
        />
      ))}
    </AbsoluteFill>
  );
};
