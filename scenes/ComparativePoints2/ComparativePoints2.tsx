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

// Two comparative points linked by a centre chain-link connector.
//   • BG.png scales 0 → 1 from the centre (0.0–2.0 s, easeInOutCubic).
//   • Centre connector (Middle_Base + link icon) scales 0 → 1 AND rotates
//     −180° → 0° in lockstep (1.20–2.90 s, easeInOutCubic).
//   • Side frames (left + right) slide in from off-canvas with a gentle
//     easeInOutQuad, fade in early (1.00–5.50 s).
//   • Pill text fades in at the end of the slide (4.50–5.50 s).
//   • Default composition length is 300 frames (10 s @ 30 fps).
//
// Layout: two side points (left + right) joined by a chain-link icon. The
// centre connector is a fixed decoration — its link icon is baked in, not
// user-supplied.

// ─── Schema ──────────────────────────────────────────────────────────────────

const sidePointSchema = z.object({
  // Icon ID from the catalog's available_icons list (e.g. "vocabulary").
  icon:  z.string().min(1),
  // Pill caption — bold white inside the pill graphic. ≤30 chars to fit.
  label: z.string().min(1).max(30),
});

// Optional per-render timing overrides. All values in SECONDS.
export const comparativePoints2TimingsSchema = z
  .object({
    bgStart:        z.number().nonnegative(),
    bgEnd:          z.number().positive(),
    connStart:      z.number().nonnegative(),
    connEnd:        z.number().positive(),
    sidesStart:     z.number().nonnegative(),
    sidesEnd:       z.number().positive(),
    sideFadeIn:     z.number().positive(),
    pillTextStart:  z.number().nonnegative(),
    pillTextEnd:    z.number().positive(),
  })
  .partial();

export const comparativePoints2Schema = z.object({
  // Exactly 2 points — left and right of the centre connector.
  points: z.array(sidePointSchema).length(2),
  timings: comparativePoints2TimingsSchema.optional(),
});

export type ComparativePoints2Props = z.infer<typeof comparativePoints2Schema>;

export const comparativePoints2Meta = {
  description:
    'Two icon-and-pill points flanking a centre chain-link connector that scales ' +
    'and rotates into place. Each side carries a single concise label and a ' +
    'representative icon; the chain icon reads visually as "these belong ' +
    'together". Best for pairing two parallel concepts where the relationship ' +
    'is one of linkage or association — cause and effect, input and output, ' +
    'two complementary skills, two halves of the same idea.',
  authoringNotes:
    'Always supply exactly 2 points (left, right) — this is a comparison layout, not a ' +
    'list. icon is an id from the catalog (e.g. "vocabulary", "strong-mind"); the two ' +
    'icons should be conceptually parallel since the layout reads as a pairing. label ' +
    'is the pill caption — strict 30-character max, one line at 37 px in Satoshi Bold. ' +
    'Write tight noun phrases or short titles. GOOD: "Word recognition", "Working ' +
    'memory". BAD: "Improving word recognition skills" (too long). Default duration ' +
    '300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BG_SRC          = staticFile('Template-Specific-Assets/bg.png');
const MIDDLE_BASE_SRC = staticFile('Template-Specific-Assets/middle_base.png');
const LEFT_SHELL_SRC  = staticFile('Template-Specific-Assets/left_shell_box.png');
const RIGHT_SHELL_SRC = staticFile('Template-Specific-Assets/right_shell_box.png');
const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (lifted directly from the prototype) ────────────────────

// Pill bboxes — measured from Left_Shell_Box.png / Right_Shell_Box.png.
const LEFT_PILL_X  = 156;
const RIGHT_PILL_X = 1232;
const PILL_TOP_Y   = 803;
const PILL_W       = 540;
const PILL_H       = 91;

// Frame icon centres (above the pills).
const LEFT_FRAME_CX  = 425;
const RIGHT_FRAME_CX = 1501;
const SIDE_ICON_CY   = 540;
const SIDE_ICON_SIZE = 380;

// Centre connector — Middle_Base.png solid bbox centre.
const MIDDLE_CX      = 962;
const MIDDLE_CY      = 609;
const LINK_ICON_SIZE = 220;

// Off-canvas travel distance for side frame slide-in.
const SIDE_TRAVEL = 1300;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

// Defaults expressed in SECONDS — readable at a glance.
//
//   t (s)     event
//   0.00–2.00 BG scale-up
//   1.20–2.90 centre connector scale + rotate (lockstep)
//   1.00–5.50 side frames slide in (left from −, right from +)
//   1.00–1.50 side frame opacity fade in
//   4.50–5.50 pill text fade in
const DEFAULT_TIMINGS = {
  bgStart:       0.00,
  bgEnd:         2.00,
  connStart:     1.20,
  connEnd:       2.90,
  sidesStart:    1.00,
  sidesEnd:      5.50,
  sideFadeIn:    0.50,
  pillTextStart: 4.50,
  pillTextEnd:   5.50,
} as const;

const easeInOutCubic = Easing.inOut(Easing.cubic);
const easeInOutQuad  = Easing.inOut(Easing.quad);

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

// ─── Link icon (centre connector decoration — fixed, white line art) ──────────

function LinkIcon({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      fill="#FFFFFF"
    >
      <path d="M387,247.8c-5.6-5.6-14.7-5.6-20.3,0L237.1,377.4c-26.5,26.5-69.6,26.5-96.1,0c-26.5-26.5-26.5-69.6,0-96.1l129.6-129.6c5.6-5.6,5.6-14.7,0-20.3c-5.6-5.6-14.7-5.6-20.3,0L120.7,261c-37.7,37.7-37.7,99.2,0,136.9c37.7,37.7,99.2,37.7,136.9,0L387,268.1C392.6,262.5,392.6,253.4,387,247.8z" />
      <path d="M474.3,114.7c-37.7-37.7-99.2-37.7-136.9,0L208,244.1c-5.6,5.6-5.6,14.7,0,20.3c5.6,5.6,14.7,5.6,20.3,0L357.7,135c26.5-26.5,69.6-26.5,96.1,0c26.5,26.5,26.5,69.6,0,96.1L324.2,360.6c-5.6,5.6-5.6,14.7,0,20.3c5.6,5.6,14.7,5.6,20.3,0l129.6-129.6C512,213.9,512,152.3,474.3,114.7z" />
    </svg>
  );
}

// ─── Background ───────────────────────────────────────────────────────────────

function Background({ frame, bgStart, bgEnd }: { frame: number; bgStart: number; bgEnd: number }) {
  const s = interpolate(frame, [bgStart, bgEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  return (
    <Img
      src={BG_SRC}
      alt=""
      style={{
        position: 'absolute',
        inset: 0,
        width:  '100%',
        height: '100%',
        display: 'block',
        transform: `scale(${s})`,
        transformOrigin: 'center center',
      }}
    />
  );
}

// ─── Centre connector (Middle_Base + link icon, scale + 180° rotate) ──────────

function Connector({ frame, connStart, connEnd }: { frame: number; connStart: number; connEnd: number }) {
  const eased = interpolate(frame, [connStart, connEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const scale    = eased;
  const rotation = -180 + eased * 180;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `rotate(${rotation}deg) scale(${scale})`,
        transformOrigin: `${MIDDLE_CX}px ${MIDDLE_CY}px`,
        opacity: frame >= connStart ? 1 : 0,
        pointerEvents: 'none',
      }}
    >
      <Img
        src={MIDDLE_BASE_SRC}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      <div
        style={{
          position: 'absolute',
          left: MIDDLE_CX - LINK_ICON_SIZE / 2,
          top:  MIDDLE_CY - LINK_ICON_SIZE / 2,
          width:  LINK_ICON_SIZE,
          height: LINK_ICON_SIZE,
        }}
      >
        <LinkIcon size={LINK_ICON_SIZE} />
      </div>
    </div>
  );
}

// ─── Side frame ───────────────────────────────────────────────────────────────

function SideFrame({
  frame,
  side,
  shellSrc,
  icon,
  label,
  sidesStart,
  sidesEnd,
  sideFadeIn,
  pillTextStart,
  pillTextEnd,
}: {
  frame: number;
  side: 'left' | 'right';
  shellSrc: string;
  icon: string;
  label: string;
  sidesStart: number;
  sidesEnd: number;
  sideFadeIn: number;
  pillTextStart: number;
  pillTextEnd: number;
}) {
  const isLeft     = side === 'left';
  const travelFrom = isLeft ? -SIDE_TRAVEL : SIDE_TRAVEL;
  const frameCX    = isLeft ? LEFT_FRAME_CX : RIGHT_FRAME_CX;
  const pillX      = isLeft ? LEFT_PILL_X   : RIGHT_PILL_X;

  const slideX = interpolate(frame, [sidesStart, sidesEnd], [travelFrom, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutQuad,
  });
  const op = interpolate(frame, [sidesStart, sidesStart + sideFadeIn], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const textOp = interpolate(frame, [pillTextStart, pillTextEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateX(${slideX}px)`,
        opacity: op,
        pointerEvents: 'none',
      }}
    >
      {/* Outlined shell (footer pill is baked into the asset) */}
      <Img
        src={shellSrc}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* Library icon, centred above the pill — SVG carries its own white + Dodger Blue */}
      <div
        style={{
          position: 'absolute',
          left: frameCX - SIDE_ICON_SIZE / 2,
          top:  SIDE_ICON_CY - SIDE_ICON_SIZE / 2,
          width:  SIDE_ICON_SIZE,
          height: SIDE_ICON_SIZE,
        }}
      >
        <Img
          src={staticFile(`icons/${icon}.svg`)}
          alt=""
          style={{ width: SIDE_ICON_SIZE, height: SIDE_ICON_SIZE }}
        />
      </div>

      {/* Pill text — flex-centred wrapper sized to the pill's bbox. The wrapper
          clips so a too-long label can never spill past the pill onto the
          background; the span is capped at 100% width and ellipsis-truncated. */}
      <div
        style={{
          position: 'absolute',
          left: pillX,
          top:  PILL_TOP_Y,
          width:  PILL_W,
          height: PILL_H,
          display: 'flex',
          alignItems:     'center',
          justifyContent: 'center',
          overflow: 'hidden',
          opacity: textOp,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            color: '#FFFFFF',
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 37,
            lineHeight: 1,
            letterSpacing: '-0.005em',
            whiteSpace: 'nowrap',
            display: 'inline-block',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            transform: 'translateY(-8px)',
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const ComparativePoints2: React.FC<ComparativePoints2Props> = ({ points, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading ComparativePoints2 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BG_START        = f(t.bgStart);
  const BG_END          = f(t.bgEnd);
  const CONN_START      = f(t.connStart);
  const CONN_END        = f(t.connEnd);
  const SIDES_START     = f(t.sidesStart);
  const SIDES_END       = f(t.sidesEnd);
  const SIDE_FADE_IN    = f(t.sideFadeIn);
  const PILL_TEXT_START = f(t.pillTextStart);
  const PILL_TEXT_END   = f(t.pillTextEnd);

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Phase 1a: BG zooms */}
      <Background frame={frame} bgStart={BG_START} bgEnd={BG_END} />

      {/* Phase 1b: centre connector scales + rotates */}
      <Connector frame={frame} connStart={CONN_START} connEnd={CONN_END} />

      {/* Phase 2: side frames slide in (left + right) */}
      <SideFrame
        frame={frame}
        side="left"
        shellSrc={LEFT_SHELL_SRC}
        icon={points[0]!.icon}
        label={points[0]!.label}
        sidesStart={SIDES_START}
        sidesEnd={SIDES_END}
        sideFadeIn={SIDE_FADE_IN}
        pillTextStart={PILL_TEXT_START}
        pillTextEnd={PILL_TEXT_END}
      />
      <SideFrame
        frame={frame}
        side="right"
        shellSrc={RIGHT_SHELL_SRC}
        icon={points[1]!.icon}
        label={points[1]!.label}
        sidesStart={SIDES_START}
        sidesEnd={SIDES_END}
        sideFadeIn={SIDE_FADE_IN}
        pillTextStart={PILL_TEXT_START}
        pillTextEnd={PILL_TEXT_END}
      />
    </AbsoluteFill>
  );
};
