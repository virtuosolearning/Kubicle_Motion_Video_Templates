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

// Ports the media team's "3 Big Points v2" prototype. Three columns on
// an Oxford-Blue panel, each with an SVG icon above a pill label. A
// loading bar sweeps left→right during the hold, and pills pop in at
// ~14%, ~39%, and ~72% of the bar's travel.
// Optional per-render timing overrides. All values are in frames at 30 fps;
// any field omitted falls back to the corresponding entry in DEFAULT_TIMINGS.
// pillStarts, when provided, must contain exactly three entries (one per
// column). All ranges are inclusive starts / exclusive ends matching the
// prototype's reference timeline.
export const threeBigPointsTimingsSchema = z
  .object({
    containerFadeStart: z.number().nonnegative(),
    containerFadeEnd: z.number().nonnegative(),
    containerScaleEnd: z.number().nonnegative(),
    barBaseFadeStart: z.number().nonnegative(),
    barBaseFadeEnd: z.number().nonnegative(),
    iconAnimStart: z.number().nonnegative(),
    iconAnimEnd: z.number().nonnegative(),
    barFillStart: z.number().nonnegative(),
    barFillEnd: z.number().nonnegative(),
    pillStarts: z.array(z.number().nonnegative()).length(3),
    pillDuration: z.number().positive(),
    outroDuration: z.number().nonnegative(),
  })
  .partial();

export const threeBigPointsSchema = z.object({
  // Exactly three points; layout is hard-coded to three equal columns.
  points: z
    .array(
      z.object({
        // Icon id from the shared icon library (remotion/assets/icons/).
        // Bundled set includes "rocket", "idea", "money-bag" plus the
        // 25 icons from the Icon Library. See available_icons in
        // GET /scene-catalog. Unknown ids degrade to an empty column
        // silently rather than crashing the render.
        icon: z.string().min(1),
        // Pill caption. Rendered in Satoshi Black 900 inside the pill
        // graphic; keep under 25 characters so it fits on one line.
        label: z.string().min(1).max(25),
      }),
    )
    .length(3),
  // Optional animation timing overrides (frames @ 30fps).
  timings: threeBigPointsTimingsSchema.optional(),
});

export type ThreeBigPointsProps = z.infer<typeof threeBigPointsSchema>;

export const threeBigPointsMeta = {
  description:
    'Three-column card with icon + pill label per column. A loading ' +
    'bar sweeps left-to-right while the icons appear, then the three ' +
    'pills pop in staggered at roughly 14%, 39%, and 72% of the bar.',
  authoringNotes:
    'Always supply exactly 3 points. icon is an id from the catalog\'s ' +
    'available_icons list (e.g. "rocket", "idea", "money-bag", or any ' +
    'of the 25 library icons); unknown ids leave the icon slot empty. label is ' +
    'the pill caption — strict 25-character max, one line at 34px in the Satoshi Black font. ' +
    'Write short noun phrases (2–4 words). GOOD: "Faster processing", "Real-time sync", "Zero downtime". ' +
    'BAD: "Processes data faster", "Synchronise in real time" (too long — trim to the core noun phrase). ' +
    'Default composition length is 300 frames (10s at 30fps); the outro fade always hugs the last ' +
    '0.67 seconds of whatever duration is requested.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────
const OXFORD_BLUE_SRC = staticFile('images/oxford_blue_base.png');
const PILL_SRC = staticFile('images/pill_box.png');
const LOADING_BAR_SRC = staticFile('images/loading_bar.png');
const LOADING_BAR_BASE_SRC = staticFile('images/loading_bar_base.png');
const SATOSHI_BLACK_URL = staticFile('fonts/Satoshi-Black.woff2');
// Inter ExtraBold is already registered by other scenes that run before
// this one in a typical lesson, but we request it again here so this
// scene is self-contained when rendered in isolation.
const INTER_EXTRABOLD_URL = staticFile('fonts/Inter-ExtraBold.woff2');

// ─── Layout constants (lifted verbatim from the prototype) ────────────────────
// Column centres at equal thirds of the 1920-wide canvas.
const COL_CX = [360, 961, 1562] as const;
const ICON_SZ = 300;
// Icon vertical centre (55% down the Oxford Blue container: y=274 + 0.55×733 ≈ 670)
const ICON_CY = 670;
// Pill is a 552×113 crop from a 1920×1080 full-canvas PNG, top-left at (106, 854).
const PILL_W = 552;
const PILL_H = 113;
const PILL_IMG_X = 106;
const PILL_IMG_Y = 854;
// Pill top Y in the canvas coordinate system.
const PILL_TOP = 854;

// ─── Animation timeline (30fps) ───────────────────────────────────────────────
// Mirrors the prototype's timing at 1× animSpeed.
//
//   t(s)   frame   event
//   0.10     3     container (Oxford Blue) fade start
//   0.55    16.5   container fade end           (→ f17)
//   0.10     3     container scale 0.93→1.0 start
//   0.65    19.5   container scale end           (→ f20)
//   0.30     9     loading bar base fade start
//   0.65    19.5   loading bar base fade end      (→ f20)
//   0.50    15     icons fade+scale start
//   0.95    28.5   icons fade+scale end           (→ f28)
//   0.60    18     loading bar fill starts sweeping
//   9.50   285     loading bar fill reaches 100%
//   1.40    42     pill 1 pop-in
//   3.90   117     pill 2 pop-in
//   7.20   216     pill 3 pop-in
//   tail   -20     outro fade (0.67s)
const DEFAULT_TIMINGS = {
  containerFadeStart: 3,
  containerFadeEnd: 17,
  containerScaleEnd: 20,
  barBaseFadeStart: 9,
  barBaseFadeEnd: 20,
  iconAnimStart: 15,
  iconAnimEnd: 28,
  barFillStart: 18,
  barFillEnd: 285,
  pillStarts: [42, 117, 216] as readonly number[],
  pillDuration: 14,
  outroDuration: 20,
} as const;

const easeOutCubic = Easing.out(Easing.cubic);
const easeOutBack = Easing.out(Easing.back(1.70158));
const outroEase = Easing.ease;

// ─── Font loading ─────────────────────────────────────────────────────────────
let fontsPromise: Promise<void> | null = null;

function loadThreeBigPointsFonts(): Promise<void> {
  if (fontsPromise) {
    return fontsPromise;
  }
  fontsPromise = (async () => {
    const satoshiBlack = new FontFace(
      'Satoshi',
      `url(${SATOSHI_BLACK_URL}) format('woff2')`,
      { weight: '900', style: 'normal', display: 'block' },
    );
    const interEB = new FontFace(
      'Inter',
      `url(${INTER_EXTRABOLD_URL}) format('woff2')`,
      { weight: '800', style: 'normal', display: 'block' },
    );
    const [sb, ie] = await Promise.all([satoshiBlack.load(), interEB.load()]);
    const fonts = document.fonts as FontFaceSet & { add(font: FontFace): void };
    fonts.add(sb);
    fonts.add(ie);
  })();
  return fontsPromise;
}

// ─── SvgIcon ─────────────────────────────────────────────────────────────────
// Fetches an SVG from the static asset folder, strips the XML preamble,
// adds fill="white" so un-styled paths inherit white, and renders via
// dangerouslySetInnerHTML. Unknown icon names render nothing (graceful).
function SvgIcon({ name, size }: { name: string; size: number }) {
  const [html, setHtml] = useState('');
  const [handle] = useState(() => delayRender(`Loading icon: ${name}`));

  useEffect(() => {
    const url = staticFile(`icons/${name}.svg`);
    fetch(url)
      .then((r) => {
        if (!r.ok) {
          throw new Error(`${r.status}`);
        }
        return r.text();
      })
      .then((raw) => {
        // Strip XML declaration and replace the <svg> opening tag with a
        // clean version that carries fill="white" so un-styled outline
        // paths inherit white. viewBox is preserved; width/height are set
        // by the wrapper div so the icon fills its slot regardless of the
        // SVG's intrinsic size.
        const processed = raw
          .replace(/<\?xml[^>]*\?>\s*/g, '')
          .replace(
            /<svg [^>]*>/,
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="white" width="${size}" height="${size}" style="display:block">`,
          );
        setHtml(processed);
      })
      .catch(() => setHtml(''))
      .finally(() => continueRender(handle));
  }, [name, size, handle]);

  if (!html) {
    return null;
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.5))',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Pill ─────────────────────────────────────────────────────────────────────
// Renders one pill using Pill_Box_1.png (full 1920×1080 canvas) windowed to
// the 552×113 region at (106, 854). Entry mirrors the prototype:
// easeOutBack scale-pop + easeOutCubic translateY + quick opacity ramp.
function AnimPill({
  label,
  cx,
  startFrame,
  pillDuration,
}: {
  label: string;
  cx: number;
  startFrame: number;
  pillDuration: number;
}) {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;

  if (localFrame < 0) {
    return null;
  }

  const raw = Math.min(1, localFrame / pillDuration);
  const easeBack = easeOutBack(raw);
  const opacity = Math.min(1, raw / (10.5 / pillDuration));
  const ty = (1 - easeOutCubic(raw)) * 50;
  const sc = 0.6 + easeBack * 0.4;

  return (
    <div
      style={{
        position: 'absolute',
        left: cx - PILL_W / 2,
        top: PILL_TOP,
        width: PILL_W,
        height: PILL_H,
        overflow: 'hidden',
        opacity,
        transform: `translateY(${ty}px) scale(${sc})`,
        transformOrigin: 'center center',
      }}
    >
      <Img
        src={PILL_SRC}
        alt=""
        style={{
          position: 'absolute',
          left: -PILL_IMG_X,
          top: -PILL_IMG_Y,
          width: 1920,
          height: 1080,
          display: 'block',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: '#fff',
            fontFamily: "'Satoshi', 'Inter', system-ui, sans-serif",
            fontWeight: 900,
            fontSize: 34,
            letterSpacing: '-0.01em',
            textShadow: '0 1px 6px rgba(0,0,0,0.25)',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────
export const ThreeBigPoints: React.FC<ThreeBigPointsProps> = ({ points, timings }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Merge caller-supplied timing overrides over the signed-off defaults.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const CONTAINER_FADE_START = t.containerFadeStart;
  const CONTAINER_FADE_END = t.containerFadeEnd;
  const CONTAINER_SCALE_END = t.containerScaleEnd;
  const BAR_BASE_FADE_START = t.barBaseFadeStart;
  const BAR_BASE_FADE_END = t.barBaseFadeEnd;
  const ICON_ANIM_START = t.iconAnimStart;
  const ICON_ANIM_END = t.iconAnimEnd;
  const BAR_FILL_START = t.barFillStart;
  const BAR_FILL_END = t.barFillEnd;
  const PILL_STARTS = t.pillStarts;
  const PILL_DURATION = t.pillDuration;
  const OUTRO_DURATION = t.outroDuration;

  const [fontHandle] = useState(() => delayRender('Loading ThreeBigPoints fonts'));
  useEffect(() => {
    loadThreeBigPointsFonts()
      .catch(() => {})
      .finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  // Container (Oxford Blue panel) — fade + scale-in
  const containerOpacity = interpolate(
    frame,
    [CONTAINER_FADE_START, CONTAINER_FADE_END],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic },
  );
  const containerScale = interpolate(
    frame,
    [CONTAINER_FADE_START, CONTAINER_SCALE_END],
    [0.93, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic },
  );

  // Loading bar base (dark track)
  const barBaseOpacity = interpolate(
    frame,
    [BAR_BASE_FADE_START, BAR_BASE_FADE_END],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Loading bar fill — linear sweep, expressed as right-clip percentage
  const barFillPct = interpolate(
    frame,
    [BAR_FILL_START, BAR_FILL_END],
    [0, 100],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const rightClip = (100 - barFillPct).toFixed(2);

  // Icons — fade + easeOutBack scale
  const iconOpacity = interpolate(
    frame,
    [ICON_ANIM_START, ICON_ANIM_END],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const iconScale = interpolate(
    frame,
    [ICON_ANIM_START, ICON_ANIM_END],
    [0.55, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBack },
  );

  // Outro fade
  const outroStart = Math.max(0, durationInFrames - OUTRO_DURATION);
  const outroOpacity = interpolate(
    frame,
    [outroStart, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: outroEase },
  );

  return (
    <AbsoluteFill
      style={{ backgroundColor: '#E6ECF2', overflow: 'hidden', opacity: outroOpacity }}
    >
      {/* Oxford Blue container — scales up from center */}
      <AbsoluteFill
        style={{
          opacity: containerOpacity,
          transform: `scale(${containerScale})`,
          transformOrigin: 'center center',
        }}
      >
        <Img
          src={OXFORD_BLUE_SRC}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          alt=""
        />
      </AbsoluteFill>

      {/* Loading bar — dark base track */}
      <AbsoluteFill style={{ opacity: barBaseOpacity }}>
        <Img
          src={LOADING_BAR_BASE_SRC}
          style={{ width: '100%', height: '100%' }}
          alt=""
        />
      </AbsoluteFill>

      {/* Loading bar — blue fill, reveals left → right via clipPath */}
      <AbsoluteFill
        style={{
          opacity: barBaseOpacity,
          clipPath: `inset(0 ${rightClip}% 0 0)`,
        }}
      >
        <Img
          src={LOADING_BAR_SRC}
          style={{ width: '100%', height: '100%' }}
          alt=""
        />
      </AbsoluteFill>

      {/* Icons and pills — one per column */}
      {points.map(({ icon, label }, i) => {
        const cx = COL_CX[i]!;
        return (
          <AbsoluteFill key={i}>
            {/* Icon centred at (cx, ICON_CY) */}
            <div
              style={{
                position: 'absolute',
                left: cx - ICON_SZ / 2,
                top: ICON_CY - ICON_SZ / 2,
                width: ICON_SZ,
                height: ICON_SZ,
                opacity: iconOpacity,
                transform: `scale(${iconScale})`,
                transformOrigin: 'center center',
              }}
            >
              <SvgIcon name={icon} size={ICON_SZ} />
            </div>

            <AnimPill
              label={label}
              cx={cx}
              startFrame={PILL_STARTS[i]!}
              pillDuration={PILL_DURATION}
            />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
