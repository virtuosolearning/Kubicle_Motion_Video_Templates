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

// IconPointsV1 — conveyor-belt sequence of labelled pills inside a right-side
// container, mirrored by a fading "covered topics" stack on the left.
//
//   • 0.0–1.0 s : platinum-blue background; the container rises from below
//     the canvas (ease-out) into its docked position on the right.
//   • 1.0 s onward : each pill enters from the LEFT edge of the container,
//     holds at the top-centre for a beat (long enough to read the label),
//     then pans off the RIGHT edge — all clipped to the container's bounds.
//     As a pill slides off the right, a faded copy of the SAME pill rises
//     from opacity 0 on the LEFT of the canvas at the next slot of a
//     growing "covered" stack. The left stack signals "we've talked about
//     this — moving on".
//   • Final frame : container empty on the right; all N pills stacked on
//     the left.
//
// All visuals (container, pill, icon) are drawn in CSS / inline SVG — there
// are no PNG dependencies. Default duration 450 frames (15 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const iconPointsV1TimingsSchema = z
  .object({
    containerRiseStart:    z.number().nonnegative(),
    containerRiseDuration: z.number().positive(),
    firstPillStart:        z.number().nonnegative(),
    pillEnterDuration:     z.number().positive(),
    pillHoldDuration:      z.number().positive(),
    pillExitDuration:      z.number().positive(),
    stackFadeDuration:     z.number().positive(),
  })
  .partial();

// Each pill has its own icon. `icon` is the stem of a LIGHT-MODE SVG from the
// shared Icons library (e.g. "ai-agent-chatbot-light" → icons/ai-agent-chatbot-light.svg).
// It must end in `-light` (optionally `-light-2`, …) so the glyph reads in the
// library's oxford-blue + dodger-blue palette against this scene's light
// container. This id drives the LARGE icon shown in the right-hand box.
const LIGHT_ICON_RE = /-light(-\d+)?$/i;

export const iconPointsV1PillSchema = z.object({
  // Label text. Capped at 18 chars so it always fits inside the pill; the
  // component also auto-shrinks the font as a safety net, so text never clips.
  label: z.string().min(1).max(18),
  // Any light-mode icon id from the Icons library (must end in `-light`).
  icon:  z.string().min(1).regex(LIGHT_ICON_RE, 'icon must be a light-mode library id ending in "-light"'),
});

export const iconPointsV1Schema = z.object({
  // Pill list in order (2–6) — first pill ends up at the TOP of the left
  // stack, last at the BOTTOM. The right-hand conveyor mirrors this list
  // exactly: N pills on the left ⇒ N pills pan through the box on the right.
  // The box + stack resize and vertically centre to suit the chosen count.
  pills:   z.array(iconPointsV1PillSchema).min(2).max(6),
  timings: iconPointsV1TimingsSchema.optional(),
});

export type IconPointsV1Props = z.infer<typeof iconPointsV1Schema>;

export const iconPointsV1Meta = {
  description:
    'A right-side container rises up; pills with an icon pan through it ' +
    'left-to-right like a conveyor belt, one at a time. As each pill exits ' +
    'the container on the right, a copy of it fades in on the left in a ' +
    'growing stack — signalling "covered topics". Final frame: container ' +
    'empty + all pills stacked on the left.',
  authoringNotes:
    'Supply 2–6 pills. The right-hand conveyor mirrors the list exactly — N ' +
    'pills left ⇒ N pills panning on the right — and the box + left stack ' +
    'resize and vertically centre to suit the count. Each pill has: label ' +
    '(≤18 chars; the component also auto-shrinks the font so text never ' +
    'clips its box) and icon (the stem of any LIGHT-MODE icon from the Icons ' +
    'library, e.g. "ai-agent-chatbot-light", "business-motivation-rocket-light" ' +
    '— must end in "-light"). That icon is rendered LARGE inside the right ' +
    'box; the small blue badge on every pill is a fixed graduation cap and is ' +
    'not configurable. Default duration 450 frames (15 s); each pill ' +
    'enters → holds → exits with smooth ease-in/out, paired with a fade-in of ' +
    'the left copy.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants ─────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Container — right-side rounded rectangle drawn in CSS. Height matches the
// vertical extent of the 6-pill stack on the left (top of pill 1 → bottom of
// pill 6) so the two halves of the frame feel balanced.
const CONTAINER_X      = 920;
const CONTAINER_WIDTH  = 900;
const CONTAINER_RADIUS = 32;
// Container Y + height are now derived per-render from the pill count
// (see "Count-adaptive layout" in the main component).

// Pill geometry (drawn in CSS).
const PILL_WIDTH  = 760;
const PILL_HEIGHT = 130;
const PILL_RADIUS = 24;

// Pill vertical position INSIDE the container — pinned near the top edge.
const PILL_TOP_INSIDE = 40;

// Pill horizontal travel inside the container's clip region.
const PILL_X_OFF_LEFT  = -(PILL_WIDTH + 20);
const PILL_X_CENTRE    = (CONTAINER_WIDTH - PILL_WIDTH) / 2;     // 70
const PILL_X_OFF_RIGHT = CONTAINER_WIDTH + 20;

// Left-side "covered topics" stack — sits in canvas-space, NOT inside the
// container. Each slot is a fixed (x, y) where the faded copy materialises.
const STACK_X     = 80;
const STACK_PITCH = 145;
// Stack top Y is derived per-render from the pill count (vertical centring).

// Container slide-up travel from below the canvas.
const CONTAINER_TRAVEL_Y = 1080;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  containerRiseStart:    0.00,
  containerRiseDuration: 0.80,
  firstPillStart:        0.90,
  pillEnterDuration:     0.55,    // ease-out slide-in
  pillHoldDuration:      0.75,    // hold long enough to read the label
  pillExitDuration:      0.50,    // ease-in pan off-right
  stackFadeDuration:     0.45,    // left copy fade-in window
} as const;

const easeOutCubic   = Easing.out(Easing.cubic);
const easeInCubic    = Easing.in(Easing.cubic);
const easeInOutCubic = Easing.inOut(Easing.cubic);

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG_COLOR = '#E6ECF2';

// Container — soft white → very-light-blue vertical gradient with subtle shadow.
const CONTAINER_BG =
  'linear-gradient(180deg, #FFFFFF 0%, #F7FAFD 40%, #E2EBF5 100%)';
const CONTAINER_SHADOW =
  '0 10px 30px rgba(20, 50, 90, 0.10), 0 2px 6px rgba(20, 50, 90, 0.06)';

// Pill body — clean white with a soft drop shadow.
const PILL_BG     = '#FFFFFF';
const PILL_SHADOW =
  '0 4px 14px rgba(20, 50, 90, 0.10), 0 1px 3px rgba(20, 50, 90, 0.08)';

// Blue badge that hosts the small white icon inside each pill — same on every pill.
const ICON_BADGE_BG =
  'linear-gradient(180deg, #57BBFF 0%, #1A9CFE 60%, #0A7FE0 100%)';

const TEXT_COLOR = '#0A0F18';

// Size of the large icon parented below each conveyor pill (centred in
// container horizontally on the pill's centre).
const LARGE_ICON_SIZE = 460;
const LARGE_ICON_TOP  = 270;

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`, { weight: '700', display: 'block' });
    const b    = await bold.load();
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(b);
  })();
  return fontsPromise;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Pill badge icon (white graduation cap, the same on every pill) ─────────

function GradCapIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 10L12 5 2 10l10 5 10-5z" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth={1.2} />
      <path d="M6 12v5c0 1 3 3 6 3s6-2 6-3v-5" />
      <line x1="22" y1="10" x2="22" y2="15" />
      <circle cx="22" cy="16.5" r="1.2" fill="#FFFFFF" stroke="#FFFFFF" />
    </svg>
  );
}

// ─── Large per-pill icon (loaded from icons/<id>.svg) ────────────────────────
//
// The 6 source SVGs in icons/ have been recoloured at port time:
//   • paths with no explicit fill   → oxford blue  (#052438) via root <g fill>
//   • paths styled fill:#33CCCC     → dodger blue  (#1A9CFE)
// Rendered ~400 px below each conveyor pill, parented to its horizontal
// motion so they pan together and stay clipped by the container's matte.

function LargeIcon({ id, size }: { id: string; size: number }) {
  return (
    <Img
      src={staticFile(`icons/${id}.svg`)}
      alt=""
      style={{ width: size, height: size, display: 'block' }}
    />
  );
}

// ─── Shared pill visual (icon + label) ───────────────────────────────────────

function PillBody({
  label,
  background = PILL_BG,
}: {
  label: string;
  background?: string;
}) {
  const BADGE_SIZE  = 96;
  const ICON_MARGIN = (PILL_HEIGHT - BADGE_SIZE) / 2;

  // Width left for the label after the badge + gaps + padding.
  const TEXT_AVAIL = PILL_WIDTH - 2 * ICON_MARGIN - BADGE_SIZE - 24;
  // Auto-fit: estimate the rendered width with a conservative per-glyph advance
  // and scale the font down if it would exceed the available width. Combined
  // with the 18-char schema cap this guarantees the label never clips the box.
  const BASE_FONT = 55;
  const estWidth  = label.length * 0.6 * BASE_FONT;
  const fontSize  = estWidth > TEXT_AVAIL ? Math.max(36, (BASE_FONT * TEXT_AVAIL) / estWidth) : BASE_FONT;

  return (
    <div
      style={{
        width:  PILL_WIDTH,
        height: PILL_HEIGHT,
        borderRadius: PILL_RADIUS,
        background,
        boxShadow:    PILL_SHADOW,
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${ICON_MARGIN}px`,
        gap: 24,
        boxSizing: 'border-box',
      }}
    >
      {/* Dodger-blue rounded badge with the white graduation-cap icon — same on every pill. */}
      <div
        style={{
          width:  BADGE_SIZE,
          height: BADGE_SIZE,
          borderRadius: 22,
          background:   ICON_BADGE_BG,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <GradCapIcon size={56} />
      </div>
      <span
        style={{
          color: TEXT_COLOR,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize,
          letterSpacing: '-0.01em',
          // Roomy line box so descenders (g, y, p, q, j) are never clipped.
          // Horizontal fit is already guaranteed by the 18-char cap + auto-fit,
          // so no overflow clipping is needed here.
          lineHeight: 1.25,
          whiteSpace: 'nowrap',
          maxWidth: TEXT_AVAIL,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Conveyor pill (inside the container, panning left → right) ─────────────

function ConveyorPill({
  frame,
  label,
  iconId,
  startFrame,
  enterDur,
  holdDur,
  exitDur,
}: {
  frame: number;
  label: string;
  iconId: string;
  startFrame: number;
  enterDur: number;
  holdDur: number;
  exitDur: number;
}) {
  if (frame < startFrame) return null;

  const localFrame = frame - startFrame;
  const holdStart  = enterDur;
  const holdEnd    = enterDur + holdDur;
  const exitEnd    = enterDur + holdDur + exitDur;

  let x: number;
  if (localFrame < holdStart) {
    // ENTERING — ease-OUT: fast in, decelerates as it settles at centre.
    x = interpolate(localFrame, [0, holdStart], [PILL_X_OFF_LEFT, PILL_X_CENTRE], {
      easing: easeOutCubic,
    });
  } else if (localFrame < holdEnd) {
    // HOLDING — parked at centre.
    x = PILL_X_CENTRE;
  } else if (localFrame < exitEnd) {
    // EXITING — ease-IN: slow at start (drifts off centre), accelerates off-right.
    x = interpolate(localFrame, [holdEnd, exitEnd], [PILL_X_CENTRE, PILL_X_OFF_RIGHT], {
      easing: easeInCubic,
    });
  } else {
    return null;
  }

  // Parent wrapper that holds BOTH the pill and the large icon — both pan
  // together with `x` and are clipped by the container's matte.
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top:  0,
        width:  PILL_WIDTH,
        pointerEvents: 'none',
      }}
    >
      {/* Pill at the top of the container. */}
      <div style={{ position: 'absolute', left: 0, top: PILL_TOP_INSIDE }}>
        {/* Conveyor pill uses the same platinum→white gradient as the stack
            and the container, so the whole composition stays consistent. */}
        <PillBody label={label} background={CONTAINER_BG} />
      </div>

      {/* Large icon, centred horizontally on the pill (so it lands at the
          container's centre when the pill is at its hold position). */}
      <div
        style={{
          position: 'absolute',
          left: (PILL_WIDTH - LARGE_ICON_SIZE) / 2,
          top:  LARGE_ICON_TOP,
          width:  LARGE_ICON_SIZE,
          height: LARGE_ICON_SIZE,
        }}
      >
        <LargeIcon id={iconId} size={LARGE_ICON_SIZE} />
      </div>
    </div>
  );
}

// ─── Stack pill (fades in on the left as the conveyor pill exits right) ──────

function StackPill({
  frame,
  label,
  stackIndex,
  stackTopY,
  fadeStartFrame,
  fadeDur,
}: {
  frame: number;
  label: string;
  stackIndex: number;
  stackTopY: number;
  fadeStartFrame: number;
  fadeDur: number;
}) {
  if (frame < fadeStartFrame) return null;

  const localFrame = frame - fadeStartFrame;
  const opacity = clamp01(easeOutCubic(clamp01(localFrame / fadeDur)));

  return (
    <div
      style={{
        position: 'absolute',
        left: STACK_X,
        top:  stackTopY + stackIndex * STACK_PITCH,
        opacity,
        pointerEvents: 'none',
      }}
    >
      {/* Left-stack pills use the container's platinum-blue → white gradient
          so the "covered" stack reads visually as the calm twin of the
          active container on the right. No large icon — that lives only
          inside the container, parented to the conveyor pill. */}
      <PillBody label={label} background={CONTAINER_BG} />
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const IconPointsV1: React.FC<IconPointsV1Props> = ({ pills, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading IconPointsV1 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const RISE_START   = f(t.containerRiseStart);
  const RISE_DUR     = f(t.containerRiseDuration);
  const FIRST_PILL   = f(t.firstPillStart);
  const PILL_ENTER   = f(t.pillEnterDuration);
  const PILL_HOLD    = f(t.pillHoldDuration);
  const PILL_EXIT    = f(t.pillExitDuration);
  const STACK_FADE   = f(t.stackFadeDuration);

  // Container slide-up from below.
  const riseProg = clamp01((frame - RISE_START) / RISE_DUR);
  const riseY    = (1 - easeOutCubic(riseProg)) * CONTAINER_TRAVEL_Y;

  // Pill cycle length — pill N+1 starts as pill N finishes exiting.
  const STAGGER = PILL_ENTER + PILL_HOLD + PILL_EXIT;

  // ── Count-adaptive layout ───────────────────────────────────────────────
  // The left stack spans (N-1) pitches + one pill height. The right box must
  // also be tall enough to frame the large icon. Both are vertically centred
  // as one group, and the stack is centred within the box, so 2–6 pills stay
  // balanced rather than stranded at the top of a 6-tall container.
  const N = pills.length;
  const STACK_EXTENT  = (N - 1) * STACK_PITCH + PILL_HEIGHT;
  const ICON_MIN_H    = LARGE_ICON_TOP + LARGE_ICON_SIZE + 40; // frame the large icon
  const CONTAINER_H   = Math.max(STACK_EXTENT, ICON_MIN_H);
  const GROUP_TOP     = Math.round((CANVAS_H - CONTAINER_H) / 2);
  const STACK_TOP     = GROUP_TOP + Math.round((CONTAINER_H - STACK_EXTENT) / 2);

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {/* LEFT-SIDE STACK — fades in as each conveyor pill exits the right
          edge of the container. Stays visible for the rest of the comp,
          building a "covered topics" list. */}
      {pills.map((p, i) => {
        const startFrame   = FIRST_PILL + i * STAGGER;
        const exitStart    = startFrame + PILL_ENTER + PILL_HOLD;
        // Fade the left copy in DURING the conveyor pill's exit — so as
        // the pill slides off right, the left copy materialises.
        return (
          <StackPill
            key={`stack-${i}`}
            frame={frame}
            label={p.label}
            stackIndex={i}
            stackTopY={STACK_TOP}
            fadeStartFrame={exitStart}
            fadeDur={STACK_FADE}
          />
        );
      })}

      {/* CONTAINER — rounded rectangle on the right with overflow: hidden so
          conveyor pills are clipped to the container's bounds. */}
      <div
        style={{
          position: 'absolute',
          left:   CONTAINER_X,
          top:    GROUP_TOP,
          width:  CONTAINER_WIDTH,
          height: CONTAINER_H,
          borderRadius: CONTAINER_RADIUS,
          background:   CONTAINER_BG,
          boxShadow:    CONTAINER_SHADOW,
          overflow: 'hidden',
          transform: `translateY(${riseY}px)`,
          pointerEvents: 'none',
        }}
      >
        {pills.map((p, i) => {
          const startFrame = FIRST_PILL + i * STAGGER;
          return (
            <ConveyorPill
              key={`pill-${i}`}
              frame={frame}
              label={p.label}
              iconId={p.icon}
              startFrame={startFrame}
              enterDur={PILL_ENTER}
              holdDur={PILL_HOLD}
              exitDur={PILL_EXIT}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── Demo / test props ────────────────────────────────────────────────────────

export const iconPointsV1DefaultProps: IconPointsV1Props = {
  pills: [
    { label: 'Python basics',    icon: 'big-data-binarycode-light' },
    { label: 'Data wrangling',   icon: 'ai-agent-data-light' },
    { label: 'Visualization',    icon: 'arrows-infographics-elements-barchart-light' },
    { label: 'Machine learning', icon: 'ai-agent-aibrain-light' },
    { label: 'Model deployment', icon: 'business-motivation-rocket-light' },
    { label: 'Capstone project', icon: 'business-motivation-award-light' },
  ],
};
