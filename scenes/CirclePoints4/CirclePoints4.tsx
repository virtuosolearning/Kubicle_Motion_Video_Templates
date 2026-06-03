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

// CirclePoints4 — 4 circles in a row, each with a white icon and a bold label.
//   • 4 circles on a #E6ECF2 background.
//   • Pass 1: each circle pops in (easeOutBack scale 0→1 over 0.70 s) staggered
//     at 0.30 / 0.80 / 1.30 / 1.80 s.
//   • Pass 2: each circle pulses (sine bump, +15 % peak over 0.60 s) and its
//     label fades in alongside, staggered at 2.70 / 3.50 / 4.30 / 5.10 s.
//   • Icons rendered Pure White line art (HTML SvgIcon recolours fill:#33CCCC
//     → white plus root fill="white"). Patched at port time, see icons/.
//   • Default composition length is 300 frames (10 s @ 30 fps).
//
// Layout note: column centres are [315, 755, 1196, 1637] taken verbatim from
// the prototype — NOT the evenly-distributed formula used in some Target-
// structure variants. The HTML wins.

// ─── Schema ──────────────────────────────────────────────────────────────────

const pointSchema = z.object({
  // Icon ID from the icon library — any icon works; it's forced solid white
  // at runtime (see the icon Img filter), so it reads on the blue disc.
  icon:  z.string().min(1),
  // Pill caption — bold black under each circle. ≤20 chars at 37 px.
  label: z.string().min(1).max(20),
});

// Optional per-render timing overrides. All values in SECONDS.
// pass1Starts and pass2Starts must each contain exactly 4 entries.
export const circlePoints4TimingsSchema = z
  .object({
    pass1Starts:  z.array(z.number().nonnegative()).length(4),
    pass1Duration: z.number().positive(),
    pass2Starts:  z.array(z.number().nonnegative()).length(4),
    pass2Duration: z.number().positive(),
    textFade:     z.number().positive(),
  })
  .partial();

export const circlePoints4Schema = z.object({
  // 1 to 4 points — one per circle, ordered left → right. The row auto-centres
  // horizontally for the count (e.g. 2 circles sit centred in the frame).
  points: z.array(pointSchema).min(1).max(4),
  timings: circlePoints4TimingsSchema.optional(),
});

export type CirclePoints4Props = z.infer<typeof circlePoints4Schema>;

export const circlePoints4Meta = {
  description:
    'Four circles in a row on a light blue background. Each circle holds a ' +
    'white icon and reveals a bold black label beneath it. Circles pop in ' +
    'one-by-one (easeOutBack), then each pulses while its label fades in.',
  authoringNotes:
    'Provide 1 to 4 items — the circle row auto-centres horizontally for the ' +
    'count (2 circles sit centred, etc.). Each item needs an icon id from the ' +
    'icon library (any icon — it is forced solid white to read on the blue ' +
    'disc) and a short label — strict 20-character max, bold black below each ' +
    'circle. Write tight noun phrases (1–3 words). GOOD: "Data quality", "Fast ' +
    'queries", "Low cost", "Easy setup". BAD: "Improve data quality" (too long ' +
    '— strip verbs, keep the noun core). Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BASE_CIRCLE_SRC = staticFile('Template-Specific-Assets/base_circle.png');
const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (lifted from the prototype) ─────────────────────────────

// Circle row — auto-centred horizontally for 1-4 circles. Pitch (440) is the
// spacing taken from the prototype's column centres [315, 755, 1196, 1637].
const CANVAS_CX    = 960;
const CIRCLE_PITCH = 440;
const circleCxFor = (count: number, i: number) =>
  CANVAS_CX - ((count - 1) * CIRCLE_PITCH) / 2 + i * CIRCLE_PITCH;
const CIRCLE_CY  = 533;
const CIRCLE_D   = 382;

// Where the circle sits inside Base_Circle.png (a full 1920×1080 PNG).
const SRC_CIRCLE_CX = 315;
const SRC_CIRCLE_CY = 533;

const ICON_SIZE = 240;
const TEXT_Y    = 830;

// Sine-pulse amplitude (peak overshoot above scale 1).
const PULSE_AMP = 0.15;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  pass1Starts:   [0.30, 0.80, 1.30, 1.80] as readonly number[],
  pass1Duration: 0.70,
  pass2Starts:   [2.70, 3.50, 4.30, 5.10] as readonly number[],
  pass2Duration: 0.60,
  textFade:      0.60,
} as const;

const easeOutBack = Easing.out(Easing.back(1.70158));

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`, {
      weight: '700',
      display: 'block',
    });
    const loaded = await bold.load();
    (document.fonts as FontFaceSet & { add(f: FontFace): void }).add(loaded);
  })();
  return fontsPromise;
}

// ─── Single circle ────────────────────────────────────────────────────────────

function CirclePoint({
  cx,
  frame,
  icon,
  label,
  p1Start,
  p1Dur,
  p2Start,
  p2Dur,
  textFadeDur,
}: {
  cx: number;
  frame: number;
  icon: string;
  label: string;
  p1Start: number;
  p1Dur: number;
  p2Start: number;
  p2Dur: number;
  textFadeDur: number;
}) {

  // Pass 1: easeOutBack scale 0 → 1.
  const p1Prog = interpolate(frame, [p1Start, p1Start + p1Dur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const base = p1Prog > 0 ? easeOutBack(p1Prog) : 0;

  // Pass 2: sine bump while p2Prog ∈ (0, 1).
  const p2Prog = interpolate(frame, [p2Start, p2Start + p2Dur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const bump = p2Prog > 0 && p2Prog < 1 ? PULSE_AMP * Math.sin(Math.PI * p2Prog) : 0;

  const scale = Math.max(0, base + bump);

  // Label fades in alongside the pulse.
  const textOpacity = interpolate(frame, [p2Start, p2Start + textFadeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <>
      {/* Wrapper sized to the circle, scaled together so both circle + icon scale */}
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
        {/* Base_Circle.png offset so its blue disc lands at (0,0) of the wrapper */}
        <Img
          src={BASE_CIRCLE_SRC}
          alt=""
          style={{
            position: 'absolute',
            left: -(SRC_CIRCLE_CX - CIRCLE_D / 2),
            top:  -(SRC_CIRCLE_CY - CIRCLE_D / 2),
            width:  1920,
            height: 1080,
            display: 'block',
          }}
        />

        {/* Icon centred on the disc — SVG file is patched all-white at port time */}
        <div
          style={{
            position: 'absolute',
            left: CIRCLE_D / 2 - ICON_SIZE / 2,
            top:  CIRCLE_D / 2 - ICON_SIZE / 2,
            width:  ICON_SIZE,
            height: ICON_SIZE,
          }}
        >
          <Img
            src={staticFile(`icons/${icon}.svg`)}
            alt=""
            // Force any source icon to solid white so it reads on the blue disc.
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
          fontFamily: "'Satoshi', system-ui, sans-serif",
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

// ─── Main scene ───────────────────────────────────────────────────────────────

export const CirclePoints4: React.FC<CirclePoints4Props> = ({ points, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading CirclePoints4 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const P1_STARTS = t.pass1Starts.map(f);
  const P1_DUR    = f(t.pass1Duration);
  const P2_STARTS = t.pass2Starts.map(f);
  const P2_DUR    = f(t.pass2Duration);
  const TEXT_FADE = f(t.textFade);

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {points.map((p, i) => (
        <CirclePoint
          key={i}
          cx={circleCxFor(points.length, i)}
          frame={frame}
          icon={p.icon}
          label={p.label}
          p1Start={P1_STARTS[i]!}
          p1Dur={P1_DUR}
          p2Start={P2_STARTS[i]!}
          p2Dur={P2_DUR}
          textFadeDur={TEXT_FADE}
        />
      ))}
    </AbsoluteFill>
  );
};
