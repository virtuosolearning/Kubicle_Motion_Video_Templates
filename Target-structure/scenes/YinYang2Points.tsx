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
  useVideoConfig,
} from 'remotion';
import { z } from 'zod';

// Ports the Yin Yang 2 Points prototype exactly:
//   • Two dark-navy panels on a light-blue background
//   • Left panel slides UP from bottom, right panel slides DOWN from top (0.20 → 3.20 s)
//   • Title 1 fades in (3.30 s), then pairs pulse in sequence (3.80, 4.60 s)
//   • Title 2 fades in (5.40 s), then pairs pulse in sequence (5.95, 6.75 s)
//   • Icons scale-bounce in (easeOutBack) with an opacity fade
//   • White box labels fade in alongside their icon

// ─── Schema ──────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  // Icon ID from the catalog's available_icons list (e.g. "running_man_speed")
  icon: z.string().min(1),
  label: z.string().min(1).max(16),
});

// Optional per-render timing overrides. All values are in SECONDS (the
// scene runs at 30 fps and converts internally). pairStarts must contain
// exactly 4 entries (left-0, left-1, right-0, right-1). Any field omitted
// falls back to the corresponding DEFAULT_TIMINGS entry.
export const yinYang2PointsTimingsSchema = z
  .object({
    entryStart: z.number().nonnegative(),
    entryEnd: z.number().nonnegative(),
    fadeDuration: z.number().positive(),
    pulseDuration: z.number().positive(),
    opacityDuration: z.number().positive(),
    title1Start: z.number().nonnegative(),
    title2Start: z.number().nonnegative(),
    pairStarts: z.array(z.number().nonnegative()).length(4),
    outroDuration: z.number().nonnegative(),
  })
  .partial();

export const yinYang2PointsSchema = z.object({
  title1: z.string().min(1).max(20),
  title2: z.string().min(1).max(20),
  // Exactly 2 items per panel: icon id + white box label
  left:  z.array(itemSchema).min(2).max(2),
  right: z.array(itemSchema).min(2).max(2),
  // Optional animation timing overrides (seconds, internally converted to frames @ 30fps).
  timings: yinYang2PointsTimingsSchema.optional(),
});

export type YinYang2PointsProps = z.infer<typeof yinYang2PointsSchema>;

export const yinYang2PointsMeta = {
  description:
    'Two-panel comparison card. Left panel (blue accent) and right panel (pink ' +
    'accent) each show a title bar, two icons that bounce in, and two white ' +
    'label boxes. Panels slide in from opposite sides simultaneously.',
  authoringNotes:
    'title1/title2 appear in the coloured title bar — hard limit 20 chars (2–3 words max). Each panel ' +
    'holds exactly 2 items; pick icon ids from the catalog\'s available_icons list. ' +
    'Label text fits in the white box — strict 16-character max. Write single punchy nouns or very ' +
    'short fragments (1–2 short words). GOOD: "Visibility", "Fast output", "Less waste", "Full control". ' +
    'BAD: "Better visibility", "Improved alignment" (too long — drop the adjective). ' +
    'Default duration 300 frames (10 s). The scene works best for contrasting ' +
    'two groups of concepts (e.g. "Before vs After", "Input vs Output").',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BASE_1_SRC      = staticFile('images/yin_yang_base_1.png');
const BASE_1_BOXES    = staticFile('images/yin_yang_base_1_two_boxes.png');
const BASE_2_SRC      = staticFile('images/yin_yang_base_2.png');
const BASE_2_BOXES    = staticFile('images/yin_yang_base_2_two_boxes.png');
const TITLE1_BOX_SRC  = staticFile('images/yin_yang_title1_box.png');
const TITLE2_BOX_SRC  = staticFile('images/yin_yang_title2_box.png');
const INTER_EXTRABOLD = staticFile('fonts/Inter-ExtraBold.woff2');
const INTER_BOLD      = staticFile('fonts/Inter-Bold.woff2');

// ─── Layout constants (match prototype pixel-for-pixel) ──────────────────────

const ICON_SIZE = 300;
const ICON_CY   = 600;   // vertical centre of all icons

// cx of each icon slot (from prototype's ICON_POS_L / ICON_POS_R)
const ICON_CX_L = [284, 673] as const;
const ICON_CX_R = [1256, 1644] as const;

// Title centre positions
const TITLE1_CX = 490;
const TITLE2_CX = 1445;
const TITLE_CY  = 348;

// Label box geometry
const BOX_CY = 856;
const BOX_W  = 354;

// ─── Animation timeline ───────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

// Defaults expressed in SECONDS so the prototype's reference timeline is
// readable at a glance; conversion to frames happens inside the component
// once we've merged in any caller-supplied overrides.
const DEFAULT_TIMINGS = {
  // Panels slide in
  entryStart: 0.20,
  entryEnd: 3.20,
  // Fade durations
  fadeDuration: 0.50,
  pulseDuration: 0.70,
  opacityDuration: 0.35,
  // Reveal sequence
  title1Start: 3.30,
  title2Start: 5.40,
  pairStarts: [3.80, 4.60, 5.95, 6.75] as readonly number[],
  // Outro
  outroDuration: 1.10,
} as const;

// ─── Easing ──────────────────────────────────────────────────────────────────

const easeOutCubic = Easing.out(Easing.cubic);
// easeOutBack: overshoots ~10% then settles — matches the prototype's pulse
const easeOutBack  = Easing.out(Easing.back(1.70158));
const easeIn       = Easing.in(Easing.cubic);

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadBrandFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const extraBold = new FontFace('Inter', `url(${INTER_EXTRABOLD}) format('woff2')`, { weight: '800', display: 'block' });
    const bold      = new FontFace('Inter', `url(${INTER_BOLD})      format('woff2')`, { weight: '700', display: 'block' });
    const [a, b] = await Promise.all([extraBold.load(), bold.load()]);
    const fonts = document.fonts as FontFaceSet & { add(f: FontFace): void };
    fonts.add(a);
    fonts.add(b);
  })();
  return fontsPromise;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Full 1920×1080 layer that slides as a unit (base + title bar + white boxes). */
function ContainerGroup({ isLeft, translateY }: { isLeft: boolean; translateY: number }) {
  const baseSrc  = isLeft ? BASE_1_SRC   : BASE_2_SRC;
  const boxesSrc = isLeft ? BASE_1_BOXES : BASE_2_BOXES;
  const titleSrc = isLeft ? TITLE1_BOX_SRC : TITLE2_BOX_SRC;
  const s: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: 1920, height: 1080 };
  return (
    <div style={{ ...s, transform: `translateY(${translateY}px)`, willChange: 'transform' }}>
      <Img src={baseSrc}  style={s} alt="" />
      <Img src={titleSrc} style={s} alt="" />
      <Img src={boxesSrc} style={s} alt="" />
    </div>
  );
}

/**
 * Icon that scales in with an easeOutBack bounce + opacity fade.
 * Renders the icon via staticFile and applies brightness(0) invert(1) to
 * recolour the navy SVG fill to white on the dark panel backgrounds.
 */
function IconPulse({
  iconId,
  cx,
  startFrame,
  pulseDur,
  opacityDur,
}: {
  iconId: string;
  cx: number;
  startFrame: number;
  pulseDur: number;
  opacityDur: number;
}) {
  const frame = useCurrentFrame();
  if (frame < startFrame) return null;

  const scale   = interpolate(frame, [startFrame, startFrame + pulseDur], [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBack });
  const opacity = interpolate(frame, [startFrame, startFrame + opacityDur], [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div
      style={{
        position: 'absolute',
        left: cx - ICON_SIZE / 2,
        top:  ICON_CY - ICON_SIZE / 2,
        width: ICON_SIZE, height: ICON_SIZE,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        pointerEvents: 'none',
      }}
    >
      <Img
        src={staticFile(`icons/${iconId}.svg`)}
        style={{ width: ICON_SIZE, height: ICON_SIZE, filter: 'brightness(0) invert(1)' }}
        alt=""
      />
    </div>
  );
}

/** Text centred at (cx, cy) that fades in at startFrame over fadeDur. */
function FadingText({
  cx, cy, text, fontSize, fontWeight, maxWidth, color = '#fff', startFrame, fadeDur,
}: {
  cx: number; cy: number; text: string;
  fontSize: number; fontWeight: number; maxWidth: number;
  color?: string; startFrame: number; fadeDur: number;
}) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [startFrame, startFrame + fadeDur], [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - maxWidth / 2,
        top: cy,
        transform: 'translateY(-50%)',
        width: maxWidth,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontWeight, fontSize,
        color,
        letterSpacing: '-0.01em',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        opacity,
      }}
    >
      {text}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const YinYang2Points: React.FC<YinYang2PointsProps> = ({ title1, title2, left, right, timings }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const [handle] = useState(() => delayRender('Loading YinYang2Points fonts'));
  useEffect(() => {
    loadBrandFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  // Merge caller-supplied timing overrides over the signed-off defaults,
  // then convert from seconds to frames once.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const ENTRY_START  = f(t.entryStart);
  const ENTRY_END    = f(t.entryEnd);
  const FADE_DUR     = f(t.fadeDuration);
  const PULSE_DUR    = f(t.pulseDuration);
  const OPACITY_DUR  = f(t.opacityDuration);
  const TITLE1_START = f(t.title1Start);
  const TITLE2_START = f(t.title2Start);
  const PAIR_STARTS  = t.pairStarts.map(f);
  const OUTRO_DUR    = f(t.outroDuration);

  // ── Panel slide ────────────────────────────────────────────────────────────
  const leftTY  = interpolate(frame, [ENTRY_START, ENTRY_END], [1080, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic });
  const rightTY = interpolate(frame, [ENTRY_START, ENTRY_END], [-1080, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic });

  // ── Outro ──────────────────────────────────────────────────────────────────
  const outroStart   = Math.max(0, durationInFrames - OUTRO_DUR);
  const outroOpacity = interpolate(frame, [outroStart, durationInFrames], [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeIn });

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden', opacity: outroOpacity }}>
      {/* 1 — Sliding containers (base + title bar + white boxes) */}
      <ContainerGroup isLeft  translateY={leftTY}  />
      <ContainerGroup isLeft={false} translateY={rightTY} />

      {/* 2 — Title text (fades in over the title bar PNGs) */}
      <FadingText cx={TITLE1_CX} cy={TITLE_CY} text={title1}
        fontSize={55.5} fontWeight={800} maxWidth={800} startFrame={TITLE1_START} fadeDur={FADE_DUR} />
      <FadingText cx={TITLE2_CX} cy={TITLE_CY} text={title2}
        fontSize={55.5} fontWeight={800} maxWidth={800} startFrame={TITLE2_START} fadeDur={FADE_DUR} />

      {/* 3 — Left pair: icon pulse + box label */}
      <IconPulse iconId={left[0].icon}  cx={ICON_CX_L[0]} startFrame={PAIR_STARTS[0]!} pulseDur={PULSE_DUR} opacityDur={OPACITY_DUR} />
      <FadingText cx={ICON_CX_L[0]} cy={BOX_CY} text={left[0].label}
        fontSize={37} fontWeight={700} maxWidth={BOX_W} color="#000" startFrame={PAIR_STARTS[0]!} fadeDur={FADE_DUR} />

      <IconPulse iconId={left[1].icon}  cx={ICON_CX_L[1]} startFrame={PAIR_STARTS[1]!} pulseDur={PULSE_DUR} opacityDur={OPACITY_DUR} />
      <FadingText cx={ICON_CX_L[1]} cy={BOX_CY} text={left[1].label}
        fontSize={37} fontWeight={700} maxWidth={BOX_W} color="#000" startFrame={PAIR_STARTS[1]!} fadeDur={FADE_DUR} />

      {/* 4 — Right pair: icon pulse + box label */}
      <IconPulse iconId={right[0].icon} cx={ICON_CX_R[0]} startFrame={PAIR_STARTS[2]!} pulseDur={PULSE_DUR} opacityDur={OPACITY_DUR} />
      <FadingText cx={ICON_CX_R[0]} cy={BOX_CY} text={right[0].label}
        fontSize={37} fontWeight={700} maxWidth={BOX_W} color="#000" startFrame={PAIR_STARTS[2]!} fadeDur={FADE_DUR} />

      <IconPulse iconId={right[1].icon} cx={ICON_CX_R[1]} startFrame={PAIR_STARTS[3]!} pulseDur={PULSE_DUR} opacityDur={OPACITY_DUR} />
      <FadingText cx={ICON_CX_R[1]} cy={BOX_CY} text={right[1].label}
        fontSize={37} fontWeight={700} maxWidth={BOX_W} color="#000" startFrame={PAIR_STARTS[3]!} fadeDur={FADE_DUR} />
    </AbsoluteFill>
  );
};
