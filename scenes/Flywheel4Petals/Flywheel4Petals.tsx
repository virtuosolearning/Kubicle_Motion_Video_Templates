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

// Flywheel4Petals — large canvas-filling 4-petal flywheel.
//   • Platinum-blue (#E6ECF2) canvas.
//   • Donut wheel takes ~90 % of canvas height. 4 segments (top / right /
//     bottom / left), each a 90° pie-slice of the annulus.
//   • Four shades of dodger blue going clockwise (lightest at top, deepest
//     oxford on the left) so each petal is visually distinct without
//     breaking the brand palette.
//   • Inside each petal, top → bottom radially: big "01..04" number near
//     the rim, lucide-style icon in the middle, phase name, short body line.
//   • Central white hub holds the headline title + small "Machine" sub-label
//     + bot icon.
//   • Subtle motion: hub scales in (back overshoot), petals stagger in
//     clockwise (opacity + soft scale 0.92→1), per-petal content cascades
//     in after its petal lands (number pops with overshoot, then icon
//     fades, then label, then body line).
//   • Default duration 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const flywheel4PetalsPetalSchema = z.object({
  label: z.string().min(1).max(14),
  body:  z.string().min(1).max(48),
  // Small-Icons id — resolves to small-icons/<id>.svg. Those SVGs are
  // pre-coloured white so they read on the dodger-blue petal.
  icon:  z.string().min(1),
});

export const flywheel4PetalsTimingsSchema = z
  .object({
    hubDuration:     z.number().positive(),
    hubContentDelay: z.number().nonnegative(),
    petalStart:      z.number().nonnegative(),
    petalStagger:    z.number().positive(),
    petalDuration:   z.number().positive(),
    contentOffset:   z.number().nonnegative(),   // gap between petal land and its content cascade
    contentStagger:  z.number().positive(),      // stagger between number/icon/label/body within a petal
    contentDuration: z.number().positive(),
    // After the intro completes, each petal highlights in turn (dodger →
    // oxford → dodger) with a subtle scale pulse.
    highlightStart:    z.number().nonnegative(), // absolute time the cycle begins
    highlightDuration: z.number().positive(),    // per-petal highlight window
    highlightGap:      z.number().nonnegative(), // gap between petals
  })
  .partial();

export const flywheel4PetalsSchema = z.object({
  title:       z.string().min(1).max(28),   // central hub headline
  subtitle:    z.string().min(1).max(40),   // small line under the title in the hub
  // Master Icons/ id — resolves to icons/<id>.svg. Use a -dark-suffix icon
  // from the catalogue: those are platinum + dodger-blue line art and read
  // brightly on the oxford-blue → black hub.
  centerIcon:  z.string().min(1),
  // 2 to 4 petals, clockwise from the top. The wheel auto-divides 360° by
  // the count; 4 → top/right/bottom/left, 3 → top/lower-right/lower-left,
  // 2 → top/bottom semicircles.
  petals:      z.array(flywheel4PetalsPetalSchema).min(2).max(4),
  timings:     flywheel4PetalsTimingsSchema.optional(),
});

export type Flywheel4PetalsProps = z.infer<typeof flywheel4PetalsSchema>;

export const flywheel4PetalsMeta = {
  description:
    'Canvas-filling 4-petal flywheel diagram. A central white hub holds ' +
    'the title; four numbered dodger-blue petals around it (light → dark ' +
    'clockwise) each show an icon, phase name, and short body description. ' +
    'Use for iterative cycles (plan → act → observe → reflect), growth ' +
    'flywheels, or any 4-stage loop.',
  authoringNotes:
    'title is the headline inside the central hub (≤28 chars, Satoshi Bold, ' +
    'dark oxford). subtitle is a short supporting line below it (≤40 chars). ' +
    'centerIcon is drawn beneath the title in the hub — use a -dark-suffix ' +
    'icon from the master Icons/ catalogue (those are platinum + dodger-blue ' +
    'line art and stand out against the oxford-blue → black hub). petals is ' +
    '2 to 4 entries in clockwise order starting from the top: 4 → ' +
    '[top, right, bottom, left], 3 → [top, lower-right, lower-left], 2 → ' +
    '[top, bottom]. Each petal carries a label (≤14 chars, short phase ' +
    'name), a body (≤48 chars, single supporting line), and an icon — a ' +
    'Small-Icons id (those SVGs are pre-coloured white and read on the ' +
    'dodger-blue petal). GOOD label: "Plan", "Act", "Observe", "Reflect". ' +
    'BAD label: "Planning phase activities" (too long — strip to the verb ' +
    'or noun core). Long labels/bodies are clipped to the petal interior, ' +
    'never spill onto the background. Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');

// ─── Layout constants (1920×1080 canvas) ─────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

const WHEEL_CX = 960;
const WHEEL_CY = 540;
const OUTER_R  = 490;     // wheel almost fills canvas height (50 px margins)
const INNER_R  = 220;     // hub edge — kept small so each petal has vertical
                          // breathing room for its content stack
const GAP_DEG  = 1.2;     // small angular gap between petals (white slivers)

// Content sits at the petal centroid. Each petal lays out its number, icon,
// label, and body as a VERTICAL stack centred on this point (regardless of
// which petal — so left/right petals don't suffer horizontal cramming).
const CONTENT_R = 355;

// Per-item Y offsets from the petal content centroid (stack height ~210).
const NUMBER_DY = -92;
const ICON_DY   = -16;
const LABEL_DY  = 44;
const BODY_DY   = 92;

// Hub (centred on wheel)
const HUB_R = INNER_R;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  // Reveal pacing — generous so the build-up feels deliberate. Hub settles
  // first, then each petal fades up over ~0.85 s, with content cascading in
  // afterwards.
  hubDuration:     0.95,
  hubContentDelay: 0.25,
  petalStart:      1.10,
  petalStagger:    0.60,
  petalDuration:   0.85,
  contentOffset:   0.45,
  contentStagger:  0.20,
  contentDuration: 0.55,
  // Intro finishes around 4.5 s; highlight cycle kicks off shortly after.
  highlightStart:    5.00,
  highlightDuration: 1.10,
  highlightGap:      0.10,
} as const;

const easeOutCubic         = Easing.out(Easing.cubic);
const easeInOutCubic       = Easing.inOut(Easing.cubic);
const easeOutBackSubtle    = Easing.out(Easing.back(1.1));
const easeOutBackOvershoot = Easing.out(Easing.back(1.4));

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG_COLOR = '#E6ECF2';

// Four shades of dodger blue going clockwise (lightest at top, deepest at
// left). Each petal gets a [outer, inner] gradient pair. Outer = rim side
// (lighter); inner = hub side (darker).
const PETAL_GRADIENTS = [
  ['#5BB6FF', '#1A9CFE'],  // top — lightest
  ['#1A9CFE', '#0686EE'],  // right
  ['#0686EE', '#0066BB'],  // bottom
  ['#0066BB', '#0a3050'],  // left — deepest oxford
] as const;

// Hub — oxford-blue → near-black radial gradient (same palette family as
// Carousel5Tiles tiles and the TreeDiagram4x2 bg).
const HUB_BG =
  'radial-gradient(circle at 38% 32%, #0e3454 0%, #052438 38%, #02101c 75%, #000000 100%)';
const HUB_BORDER = 'rgba(255,255,255,0.08)';
const HUB_SHADOW =
  '0 18px 44px rgba(0,0,0,0.45), ' +
  'inset 0 2px 6px rgba(255,255,255,0.10)';

// Oxford-blue highlight gradient — applied as an overlay during each petal's
// highlight cycle.
const HIGHLIGHT_OUTER = '#0a3050';
const HIGHLIGHT_INNER = '#000000';

const PETAL_SHADOW = 'drop-shadow(0 12px 22px rgba(5,36,56,0.22))';

const TEXT_WHITE       = '#FFFFFF';
const TEXT_WHITE_DIM   = 'rgba(255,255,255,0.85)';
const TEXT_DARK        = '#0B1E33';
const TEXT_DARK_DIM    = 'rgba(11,30,51,0.65)';
const TEXT_ACCENT_BLUE = '#0794FD';

// ─── Font loading ────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold   = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,    { weight: '700', display: 'block' });
    const medium = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`,  { weight: '500', display: 'block' });
    const inter  = new FontFace('Inter',   `url(${INTER_EXTRABOLD_SRC}) format('woff2')`, { weight: '800', display: 'block' });
    const [b, m, i] = await Promise.all([bold.load(), medium.load(), inter.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(b);
    fonts.add(m);
    fonts.add(i);
  })();
  return fontsPromise;
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function rad(deg: number): number { return (deg * Math.PI) / 180; }

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const a = rad(angleDeg);
  return { x: WHEEL_CX + radius * Math.cos(a), y: WHEEL_CY - radius * Math.sin(a) };
}

// Annular sector path. Angles are in math degrees (90° = up).
function petalPath(startDeg: number, endDeg: number, innerR: number, outerR: number): string {
  // SVG arcs: sweep-flag 1 = positive-angle direction = clockwise in screen (y-down).
  // Our angles are math (CCW positive in math, but with screen y-flipped Y the
  // visual direction inverts). Going from startDeg → endDeg with endDeg < startDeg
  // means CW in screen; sweep-flag = 0 for the outer arc (going CW from start to end).
  const p1 = polar(startDeg, outerR);
  const p2 = polar(endDeg,   outerR);
  const p3 = polar(endDeg,   innerR);
  const p4 = polar(startDeg, innerR);

  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;

  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    // Outer arc start → end. Sweep-flag 1 = clockwise in screen coords (y down).
    // Going CCW in math (startDeg → endDeg with endDeg < startDeg) = CW in screen.
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    // Inner arc end → start. Going CW in math (endDeg → startDeg) = CCW in screen.
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

// Petal i of `count` (0-indexed clockwise from top). The wheel is divided
// evenly into `count` slices of (360 / count)°. Petal 0 sits at the top
// (mid = 90°) and each subsequent petal steps clockwise.
//   count=4 → mids [90, 0, -90, 180]
//   count=3 → mids [90, -30, -150]
//   count=2 → mids [90, -90]  (top + bottom semicircles)
function petalAngles(
  i: number,
  count: number,
): { startDeg: number; endDeg: number; midDeg: number } {
  const sweep    = 360 / count;
  const mid      = 90 - i * sweep;            // clockwise from top
  const halfWidth = sweep / 2 - GAP_DEG / 2;
  return {
    startDeg: mid + halfWidth,
    endDeg:   mid - halfWidth,
    midDeg:   mid,
  };
}

// Pick a petal gradient spread evenly across the 4-stop palette so 2 / 3 /
// 4 petals always span lightest → deepest without re-using the same shade.
function petalGradient(i: number, count: number): readonly [string, string] {
  const idx = count === 1 ? 0 : Math.round((i * (PETAL_GRADIENTS.length - 1)) / (count - 1));
  return PETAL_GRADIENTS[idx]!;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Petal({
  i, count, frame, startF, durF, highlightStartF, highlightDurF,
}: {
  i: number; count: number; frame: number; startF: number; durF: number;
  highlightStartF: number; highlightDurF: number;
}) {
  const { startDeg, endDeg, midDeg } = petalAngles(i, count);
  const path = petalPath(startDeg, endDeg, INNER_R, OUTER_R);
  const [outerColor, innerColor] = petalGradient(i, count);

  const local = frame - startF;
  const op = interpolate(local, [0, durF * 0.7], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const introScale = interpolate(local, [0, durF], [0.92, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackSubtle,
  });

  // ─── Highlight cycle ────────────────────────────────────────────────────
  // Each petal runs its highlight in turn after the intro. Three-stage curve:
  // ease-in 0→1 over the first 25 %, hold at 1 for the middle 50 %, ease-out
  // 1→0 for the last 25 %. The pulse uses a sine that peaks at 50 %.
  const hLocal = frame - highlightStartF;
  let highlightOp = 0;
  let pulseScale = 1;
  if (hLocal >= 0 && hLocal <= highlightDurF) {
    const hProg = hLocal / highlightDurF;
    if (hProg < 0.25)        highlightOp = hProg / 0.25;
    else if (hProg < 0.75)   highlightOp = 1;
    else                     highlightOp = (1 - hProg) / 0.25;
    pulseScale = 1 + 0.04 * Math.sin(hProg * Math.PI);
  }
  const scale = introScale * pulseScale;

  if (local < 0) return null;

  // Gradient direction: from outer rim toward the hub, aligned with the petal's
  // midpoint angle so the lit "rim" side sits at the wheel's outer edge.
  const mid = polar(midDeg, OUTER_R);
  const hub = polar(midDeg, INNER_R);
  const gradId      = `petal-grad-${i}`;
  const highlightId = `petal-highlight-${i}`;

  return (
    <g
      style={{
        transformOrigin: `${WHEEL_CX}px ${WHEEL_CY}px`,
        transform: `scale(${scale})`,
        opacity: op,
        filter: PETAL_SHADOW,
      }}
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={mid.x} y1={mid.y}
          x2={hub.x} y2={hub.y}
        >
          <stop offset="0%"   stopColor={outerColor} />
          <stop offset="100%" stopColor={innerColor} />
        </linearGradient>
        <linearGradient
          id={highlightId}
          gradientUnits="userSpaceOnUse"
          x1={mid.x} y1={mid.y}
          x2={hub.x} y2={hub.y}
        >
          <stop offset="0%"   stopColor={HIGHLIGHT_OUTER} />
          <stop offset="100%" stopColor={HIGHLIGHT_INNER} />
        </linearGradient>
      </defs>
      {/* Base petal fill */}
      <path d={path} fill={`url(#${gradId})`} />
      {/* Oxford-blue highlight overlay — fades in/out during the cycle */}
      {highlightOp > 0 && (
        <path d={path} fill={`url(#${highlightId})`} opacity={highlightOp} />
      )}
      {/* Subtle inner highlight along the rim — thin lighter band. */}
      <path
        d={path}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1.5}
      />
    </g>
  );
}

function Hub({
  frame, startF, durF, contentDelayF,
  title, subtitle, centerIcon,
}: {
  frame: number; startF: number; durF: number; contentDelayF: number;
  title: string; subtitle: string; centerIcon: string;
}) {
  const local = frame - startF;
  const scale = interpolate(local, [0, durF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const contentOp = interpolate(local, [durF + contentDelayF - f(0.2), durF + contentDelayF + f(0.25)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  if (local < 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: WHEEL_CX - HUB_R,
        top:  WHEEL_CY - HUB_R,
        width:  HUB_R * 2,
        height: HUB_R * 2,
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
      }}
    >
      {/* Hub circle */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: HUB_BG,
          border: `1px solid ${HUB_BORDER}`,
          boxShadow: HUB_SHADOW,
        }}
      />
      {/* Content */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 30,
          opacity: contentOp,
        }}
      >
        <div style={{ width: 92, height: 92 }}>
          <Img
            src={staticFile(`icons/${centerIcon}.svg`)}
            alt=""
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>
        <div
          style={{
            color: TEXT_WHITE,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 38,
            letterSpacing: '-0.015em',
            lineHeight: 1.05,
            textAlign: 'center',
            textTransform: 'uppercase',
            textShadow: '0 1px 3px rgba(0,0,0,0.35)',
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: 'rgba(255,255,255,0.70)',
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 18,
            letterSpacing: '-0.005em',
            lineHeight: 1.35,
            textAlign: 'center',
            maxWidth: 320,
          }}
        >
          {subtitle}
        </div>
      </div>
    </div>
  );
}

function PetalContent({
  i, count, petal, frame, startF, contentStaggerF, contentDurF,
}: {
  i: number;
  count: number;
  petal: Flywheel4PetalsProps['petals'][number];
  frame: number;
  startF: number;
  contentStaggerF: number;
  contentDurF: number;
}) {
  const local = frame - startF;
  if (local < 0) return null;

  const { midDeg } = petalAngles(i, count);
  // Petal content centroid — same radius for every petal at its midpoint
  // angle. All items stack VERTICALLY around this point so left/right
  // petals don't try to cram items along a horizontal axis.
  const centre = polar(midDeg, CONTENT_R);
  const numberPos = { x: centre.x, y: centre.y + NUMBER_DY };
  const iconPos   = { x: centre.x, y: centre.y + ICON_DY };
  const labelPos  = { x: centre.x, y: centre.y + LABEL_DY };
  const bodyPos   = { x: centre.x, y: centre.y + BODY_DY };

  // Per-element start frames
  const numberStart = 0;
  const iconStart   = contentStaggerF;
  const labelStart  = 2 * contentStaggerF;
  const bodyStart   = 3 * contentStaggerF;

  // Number — pop with back overshoot.
  const numberScale = interpolate(local, [numberStart, numberStart + contentDurF], [0.55, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const numberOp = interpolate(local, [numberStart, numberStart + contentDurF * 0.5], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  // Icon — fade + slight scale.
  const iconOp = interpolate(local, [iconStart, iconStart + contentDurF * 0.6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const iconScale = interpolate(local, [iconStart, iconStart + contentDurF], [0.78, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackSubtle,
  });

  // Label — fade.
  const labelOp = interpolate(local, [labelStart, labelStart + contentDurF * 0.7], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  // Body — fade.
  const bodyOp = interpolate(local, [bodyStart, bodyStart + contentDurF * 0.8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  // Max widths kept consistent across petals — content reads horizontally
  // regardless of which petal it's in. Body width is set so 2-line wrapping
  // happens naturally for 30–50 char descriptions.
  const labelMaxWidth = 240;
  const bodyMaxWidth  = 220;

  const numberStr = String(i + 1).padStart(2, '0');

  return (
    <>
      {/* Number */}
      <div
        style={{
          position: 'absolute',
          left: numberPos.x,
          top:  numberPos.y,
          transform: `translate(-50%, -50%) scale(${numberScale})`,
          opacity: numberOp,
          color: TEXT_WHITE,
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 72,
          letterSpacing: '-0.04em',
          lineHeight: 1,
          textShadow: '0 2px 8px rgba(0,40,80,0.30)',
        }}
      >
        {numberStr}
      </div>

      {/* Icon */}
      <div
        style={{
          position: 'absolute',
          left: iconPos.x,
          top:  iconPos.y,
          width: 64,
          height: 64,
          transform: `translate(-50%, -50%) scale(${iconScale})`,
          opacity: iconOp,
        }}
      >
        <Img
          src={staticFile(`small-icons/${petal.icon}.svg`)}
          alt=""
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      {/* Label — single line by design; long text wraps to 2 lines and
          anything past that is clipped so it never spills onto the bg. */}
      <div
        style={{
          position: 'absolute',
          left: labelPos.x,
          top:  labelPos.y,
          transform: 'translate(-50%, -50%)',
          color: TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 28,
          letterSpacing: '-0.012em',
          lineHeight: 1.05,
          width: labelMaxWidth,
          maxHeight: 28 * 1.05 * 2,
          textAlign: 'center',
          opacity: labelOp,
          textShadow: '0 1px 4px rgba(0,40,80,0.30)',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          overflow: 'hidden',
        }}
      >
        {petal.label}
      </div>

      {/* Body — wraps inside the petal; ≥3 lines is clipped so a runaway
          description can't spill onto the background. */}
      <div
        style={{
          position: 'absolute',
          left: bodyPos.x,
          top:  bodyPos.y,
          transform: 'translate(-50%, -50%)',
          color: TEXT_WHITE_DIM,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500,
          fontSize: 17,
          letterSpacing: '-0.003em',
          lineHeight: 1.30,
          width: bodyMaxWidth,
          maxHeight: 17 * 1.30 * 3,
          textAlign: 'center',
          opacity: bodyOp,
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          overflow: 'hidden',
        }}
      >
        {petal.body}
      </div>
    </>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const Flywheel4Petals: React.FC<Flywheel4PetalsProps> = ({
  title,
  subtitle,
  centerIcon,
  petals,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Flywheel4Petals fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const HUB_DUR        = f(t.hubDuration);
  const HUB_CONTENT_D  = f(t.hubContentDelay);
  const PETAL_START    = f(t.petalStart);
  const PETAL_STAGGER  = f(t.petalStagger);
  const PETAL_DUR      = f(t.petalDuration);
  const CONTENT_OFFSET = f(t.contentOffset);
  const CONTENT_STAG   = f(t.contentStagger);
  const CONTENT_DUR    = f(t.contentDuration);
  const HIGHLIGHT_START   = f(t.highlightStart);
  const HIGHLIGHT_DUR     = f(t.highlightDuration);
  const HIGHLIGHT_GAP     = f(t.highlightGap);
  const HIGHLIGHT_STEP    = HIGHLIGHT_DUR + HIGHLIGHT_GAP;

  const count = petals.length;

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {/* SVG wheel — petals and gradients */}
      <svg
        width={CANVAS_W}
        height={CANVAS_H}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        {petals.map((_, i) => (
          <Petal
            key={`petal-${i}`}
            i={i}
            count={count}
            frame={frame}
            startF={PETAL_START + i * PETAL_STAGGER}
            durF={PETAL_DUR}
            highlightStartF={HIGHLIGHT_START + i * HIGHLIGHT_STEP}
            highlightDurF={HIGHLIGHT_DUR}
          />
        ))}
      </svg>

      {/* Per-petal content (HTML divs over SVG for crisper text + flexible icons) */}
      {petals.map((petal, i) => (
        <PetalContent
          key={`pc-${i}`}
          i={i}
          count={count}
          petal={petal}
          frame={frame}
          startF={PETAL_START + i * PETAL_STAGGER + CONTENT_OFFSET}
          contentStaggerF={CONTENT_STAG}
          contentDurF={CONTENT_DUR}
        />
      ))}

      {/* Central hub — rendered on top of petals */}
      <Hub
        frame={frame}
        startF={0}
        durF={HUB_DUR}
        contentDelayF={HUB_CONTENT_D}
        title={title}
        subtitle={subtitle}
        centerIcon={centerIcon}
      />
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const flywheel4PetalsDefaultProps: Flywheel4PetalsProps = {
  title:      'Agentic Loop',
  subtitle:   'How a machine learns from its own actions',
  centerIcon: 'bot',
  petals: [
    { label: 'Plans',    body: 'Draft the next move from the goal',     icon: 'clipboard' },  // top
    { label: 'Acts',     body: 'Run a tool, write code, send a call',   icon: 'zap'       },  // right
    { label: 'Observes', body: 'Capture results, errors, side effects', icon: 'eye'       },  // bottom
    { label: 'Reflects', body: 'Update the plan from what was learned', icon: 'refresh'   },  // left
  ],
};
