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

// BigPoints3V1 — three-column row of icon + pill captions with a sweeping loading bar.
//   • Oxford-Blue panel scales/fades in.
//   • Loading bar base fades in, then the blue fill sweeps left → right.
//   • Three icons fade in with an easeOutBack scale.
//   • Three pills pop in staggered (~14%, ~39%, ~72% of the bar's travel),
//     each with an easeOutBack scale + easeOutCubic translate-up + opacity ramp.
//   • Default composition length is 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
export const bigPoints3V1TimingsSchema = z
  .object({
    containerFadeStart:  z.number().nonnegative(),
    containerFadeEnd:    z.number().positive(),
    containerScaleEnd:   z.number().positive(),
    barBaseFadeStart:    z.number().nonnegative(),
    barBaseFadeEnd:      z.number().positive(),
    iconAnimStart:       z.number().nonnegative(),
    iconAnimEnd:         z.number().positive(),
    barFillStart:        z.number().nonnegative(),
    barFillEnd:          z.number().positive(),
    // Percentages (0..100) where the loading bar pauses so the narrator can
    // talk about each point. Should hold (pointCount - 1) entries: 2 stops for
    // 3 points (default ≈ [33, 67]), 1 stop for 2 points (default ≈ [50]).
    // Omit to auto-compute evenly-spaced stops for the point count.
    barPauseStops:       z.array(z.number().min(0).max(100)).min(1).max(2),
    // How long each pause lasts (seconds). 0 = continuous sweep, no pauses.
    barPauseDuration:    z.number().nonnegative(),
    // Accepted for backward-compat but ignored — pill reveals are keyed to the
    // loading bar's arrival at each column.
    pillStarts:          z.array(z.number().nonnegative()),
    pillDuration:        z.number().positive(),
  })
  .partial();

export const bigPoints3V1Schema = z.object({
  // 2 or 3 points. The oxford-blue panel + loading bar shrink to fit the count
  // and stay centred in frame (no negative space for the 2-point case).
  points: z
    .array(
      z.object({
        // Icon id from icons/ (e.g. "rocket", "idea", "money-bag").
        // Unknown ids degrade silently to an empty column.
        icon:  z.string().min(1),
        // Pill caption — bold white inside the pill graphic. ≤25 chars.
        label: z.string().min(1).max(25),
      }),
    )
    .min(2)
    .max(3),
  timings: bigPoints3V1TimingsSchema.optional(),
});

export type BigPoints3V1Props = z.infer<typeof bigPoints3V1Schema>;

export const bigPoints3V1Meta = {
  description:
    'A row of 2–3 columns on an oxford-blue base, each column holding a single ' +
    'bold icon and a coloured pill caption beneath. A loading bar sweeps left → ' +
    'right revealing the icons in turn, then the caption pills pop in staggered. ' +
    'The panel and bar shrink to fit the column count and stay centred. Best for ' +
    'surfacing two or three top-level takeaways or features as a quick visual ' +
    'recap with minimal supporting copy.',
  authoringNotes:
    'Supply 2 or 3 points. The panel auto-sizes and centres for the count. icon is ' +
    'an id from the catalog\'s available_icons list (e.g. "rocket", "idea", ' +
    '"money-bag"); unknown ids leave the slot empty. label is the pill caption — ' +
    'strict 25-character max, one line at 34 px in Satoshi Black. Write short noun ' +
    'phrases (2–4 words). GOOD: "Faster processing", "Real-time sync", "Zero ' +
    'downtime". BAD: "Processes data faster" (too long). Default duration 300 ' +
    'frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const PILL_SRC             = staticFile('Template-Specific-Assets/pill_box.png');
const SATOSHI_BLACK_SRC    = staticFile('fonts/Satoshi-Black.woff2');
const INTER_EXTRABOLD_SRC  = staticFile('fonts/Inter-ExtraBold.woff2');

// ─── Layout constants ─────────────────────────────────────────────────────────
// The Oxford-blue panel and the loading bar used to be fixed 1920×1080 PNGs, so
// the layout was locked to 3 columns. They are now drawn in CSS (colours +
// geometry matched to the original artwork) so the panel can shrink to fit 2 or
// 3 columns with no negative space and stay centred in frame.

// Per-column horizontal allocation, and the distance from the outer column
// centres to the panel edge. Derived from the original 3-column artwork:
//   panel x[59..1863] (w 1804); columns at 360 / 961 / 1562 → spacing 601;
//   outer columns sit 301 px in from each panel edge.
const COL_SPACING = 601;
const COL_EDGE    = 301;
const panelWidthFor = (n: number) => (n - 1) * COL_SPACING + 2 * COL_EDGE;
const panelLeftFor  = (n: number) => Math.round((1920 - panelWidthFor(n)) / 2);
const colCxFor      = (i: number, n: number) => panelLeftFor(n) + COL_EDGE + i * COL_SPACING;

// Panel box (vertical position matches the original artwork; width is dynamic).
const PANEL_TOP    = 274;
const PANEL_HEIGHT = 733;
const PANEL_RADIUS = 56;
const PANEL_GRADIENT =
  'linear-gradient(180deg, #052234 0%, #041C2C 45%, #02121C 100%)';
const PANEL_SHADOW =
  '0 40px 80px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.35)';

// Loading bar — floats just above the panel top, inset from the panel sides.
const BAR_TOP         = 205;
const BAR_HEIGHT      = 51;
const BAR_INSET       = 46;     // gap between each bar end and the panel side
const BAR_TRACK_COLOR = '#052438';
const BAR_FILL_GRADIENT =
  'linear-gradient(180deg, #48B2FF 0%, #0496FF 100%)';

// Whole composition shifts up so the panel + bar group reads as vertically
// centred on the canvas.
const VERTICAL_OFFSET = -60;
// Icon visual size — prototype renders at 165 px then scales 2.45×.
const ICON_SZ = 404;
// Icon vertical centre.
const ICON_CY = 574;
// Pulse triggered as each pill reveals — sine bump, ±8 % peak over 0.45 s.
const PULSE_AMP = 0.08;
const PULSE_DUR_S = 0.45;
// Pill graphic is a 552×113 region inside a 1920×1080 PNG, top-left at (106, 854).
const PILL_W     = 552;
const PILL_H     = 113;
const PILL_IMG_X = 106;
const PILL_IMG_Y = 854;
const PILL_TOP   = 854;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

// Defaults expressed in SECONDS — readable at a glance.
//
//   t (s)   event
//   0.10    container (Oxford Blue) fade start
//   0.57    container fade end
//   0.67    container scale 0.93→1.0 end
//   0.30    loading-bar base fade start
//   0.67    loading-bar base fade end
//   0.50    icons fade + scale start
//   0.93    icons fade + scale end
//   0.60    loading bar fill begins sweep
//   2.57    loading bar reaches first pause stop (33%) — pill 1 pops
//   4.07    bar pause 1 ends, sweep resumes
//   6.04    loading bar reaches second pause stop (66%) — pill 2 pops
//   7.54    bar pause 2 ends, sweep resumes
//   9.50    loading bar fill reaches 100% — pill 3 pops
const DEFAULT_TIMINGS = {
  containerFadeStart: 0.10,
  containerFadeEnd:   0.57,
  containerScaleEnd:  0.67,
  barBaseFadeStart:   0.30,
  barBaseFadeEnd:     0.67,
  iconAnimStart:      0.50,
  iconAnimEnd:        0.93,
  barFillStart:       0.60,
  barFillEnd:         9.50,
  barPauseDuration:   1.50,
  pillDuration:       0.47,
  // barPauseStops is intentionally NOT defaulted here — it depends on the point
  // count and is auto-computed in the component (or taken from a caller override).
} as const;

const easeOutCubic = Easing.out(Easing.cubic);
const easeOutBack  = Easing.out(Easing.back(1.70158));

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const satoshi = new FontFace('Satoshi', `url(${SATOSHI_BLACK_SRC}) format('woff2')`,   { weight: '900', display: 'block' });
    const inter   = new FontFace('Inter',    `url(${INTER_EXTRABOLD_SRC}) format('woff2')`, { weight: '800', display: 'block' });
    const [s, i]  = await Promise.all([satoshi.load(), inter.load()]);
    const fonts   = document.fonts as FontFaceSet & { add(f: FontFace): void };
    fonts.add(s);
    fonts.add(i);
  })();
  return fontsPromise;
}

// ─── SvgIcon ─────────────────────────────────────────────────────────────────
// Fetches an SVG from the static asset folder and rewrites it for the
// "white base + Dodger Blue accents" colour scheme used on the Oxford Blue
// panel:
//   • Root <svg> tag injects fill="white" → unstyled outline paths inherit white.
//   • Source teal accents (#33CCCC) are remapped to Dodger Blue (#1E9AFF).
// Unknown icon names render nothing (graceful degradation).

function SvgIcon({ name, size }: { name: string; size: number }) {
  const [html, setHtml] = useState('');
  const [handle] = useState(() => delayRender(`Loading icon: ${name}`));

  useEffect(() => {
    const url = staticFile(`icons/${name}.svg`);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      })
      .then((raw) => {
        const processed = raw
          .replace(/<\?xml[^>]*\?>\s*/g, '')
          // Recolour teal accents → Dodger Blue.
          .replace(/style="fill:#33CCCC;?"/gi, 'style="fill:#1E9AFF;"')
          .replace(/fill:#33CCCC/gi, 'fill:#1E9AFF')
          .replace(/fill="#33CCCC"/gi, 'fill="#1E9AFF"')
          // Force white default fill + exact render size on the root tag.
          .replace(
            /<svg [^>]*>/,
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="white" width="${size}" height="${size}" style="display:block">`,
          );
        setHtml(processed);
      })
      .catch(() => setHtml(''))
      .finally(() => continueRender(handle));
  }, [name, size, handle]);

  if (!html) return null;

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
// Renders one pill using pill_box.png (full 1920×1080 canvas) windowed to the
// 552×113 region at (106, 854). Entry: easeOutBack scale-pop + easeOutCubic
// translateY + quick opacity ramp.

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

  if (localFrame < 0) return null;

  const raw       = Math.min(1, localFrame / pillDuration);
  const easeBack  = easeOutBack(raw);
  const opacity   = Math.min(1, raw / (10.5 / pillDuration));
  const ty        = (1 - easeOutCubic(raw)) * 50;
  const sc        = 0.6 + easeBack * 0.4;

  return (
    <div
      style={{
        position: 'absolute',
        left: cx - PILL_W / 2,
        top:  PILL_TOP,
        width:  PILL_W,
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
          top:  -PILL_IMG_Y,
          width:  1920,
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

export const BigPoints3V1: React.FC<BigPoints3V1Props> = ({ points, timings }) => {
  const frame = useCurrentFrame();

  const [fontHandle] = useState(() => delayRender('Loading BigPoints3V1 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  // Merge caller-supplied timing overrides, then convert seconds → frames once.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const CONTAINER_FADE_START = f(t.containerFadeStart);
  const CONTAINER_FADE_END   = f(t.containerFadeEnd);
  const CONTAINER_SCALE_END  = f(t.containerScaleEnd);
  const BAR_BASE_FADE_START  = f(t.barBaseFadeStart);
  const BAR_BASE_FADE_END    = f(t.barBaseFadeEnd);
  const ICON_ANIM_START      = f(t.iconAnimStart);
  const ICON_ANIM_END        = f(t.iconAnimEnd);
  const BAR_FILL_START       = f(t.barFillStart);
  const BAR_FILL_END         = f(t.barFillEnd);
  const BAR_PAUSE_DURATION   = f(t.barPauseDuration);
  const PILL_DURATION        = f(t.pillDuration);

  // ── Dynamic geometry for the column count (2 or 3) ─────────────────────────
  const nCols      = points.length;
  const PANEL_W    = panelWidthFor(nCols);
  const PANEL_LEFT = panelLeftFor(nCols);
  const COL_CX     = points.map((_, i) => colCxFor(i, nCols));
  const BAR_LEFT   = PANEL_LEFT + BAR_INSET;
  const BAR_WIDTH  = PANEL_W - 2 * BAR_INSET;

  // Container (Oxford Blue panel) — fade + scale-in.
  const containerOpacity = interpolate(frame, [CONTAINER_FADE_START, CONTAINER_FADE_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const containerScale = interpolate(frame, [CONTAINER_FADE_START, CONTAINER_SCALE_END], [0.93, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });

  // Loading bar track fade-in.
  const barBaseOpacity = interpolate(frame, [BAR_BASE_FADE_START, BAR_BASE_FADE_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  // ── Loading-bar sweep (generalised for 2 or 3 columns) ─────────────────────
  // The bar pauses at (nCols-1) stops so the narrator can talk about each point.
  // Stops default to evenly-spaced positions (≈[50] for 2 cols, ≈[33,67] for 3)
  // and a caller may override them. The sweep budget (total span minus pause
  // time) is split across segments in proportion to their width. Pause
  // keyframes are only inserted when the pause duration is > 0, so
  // barPauseDuration: 0 yields a clean continuous sweep instead of crashing on
  // duplicate keyframes.
  const STOPS = (timings?.barPauseStops
    ? [...timings.barPauseStops]
    : Array.from({ length: nCols - 1 }, (_, j) => Math.round(((j + 1) / nCols) * 100))
  )
    .slice(0, Math.max(0, nCols - 1))
    .map((s) => Math.max(0, Math.min(100, s)))
    .sort((a, b) => a - b);

  const TOTAL_SPAN   = BAR_FILL_END - BAR_FILL_START;
  const SWEEP_BUDGET = Math.max(1, TOTAL_SPAN - STOPS.length * BAR_PAUSE_DURATION);
  const segPcts: number[] = [];
  let prevPct = 0;
  for (const s of STOPS) { segPcts.push(s - prevPct); prevPct = s; }
  segPcts.push(100 - prevPct);
  const segSum = segPcts.reduce((a, b) => a + b, 0) || 1;
  const sweepFrames = segPcts.map((p) => Math.round((p / segSum) * SWEEP_BUDGET));

  // Strictly-increasing keyframes: frame[] → fillPct[].
  const kf: number[] = [BAR_FILL_START];
  const kp: number[] = [0];
  let fr = BAR_FILL_START;
  for (let i = 0; i < segPcts.length; i++) {
    fr += sweepFrames[i]!;
    const pc = i < STOPS.length ? STOPS[i]! : 100;
    kf.push(fr); kp.push(pc);
    if (i < STOPS.length && BAR_PAUSE_DURATION > 0) {
      fr += BAR_PAUSE_DURATION;
      kf.push(fr); kp.push(pc);
    }
  }
  const barFillPct = interpolate(frame, kf, kp, {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  // ── Per-column arrival frames ──────────────────────────────────────────────
  // The bar's leading edge sits at BAR_LEFT + BAR_WIDTH × fillPct/100. Column i
  // (centre COL_CX[i]) is reached when the fill % equals
  // (COL_CX[i] - BAR_LEFT) / BAR_WIDTH × 100. Invert the keyframes to find that
  // frame; both the icon and pill pops key off it so they fire as the bar
  // passes over the column.
  const frameAtPct = (target: number): number => {
    for (let i = 0; i < kf.length - 1; i++) {
      const p0 = kp[i]!, p1 = kp[i + 1]!;
      if (p1 === p0) continue; // pause segment — flat, skip
      if (target <= p1 || i === kf.length - 2) {
        return kf[i]! + ((target - p0) / (p1 - p0)) * (kf[i + 1]! - kf[i]!);
      }
    }
    return kf[kf.length - 1]!;
  };
  const COL_ARRIVAL = COL_CX.map((cx) =>
    frameAtPct(Math.max(0, Math.min(100, ((cx - BAR_LEFT) / BAR_WIDTH) * 100))),
  );
  const PILL_ARRIVAL = COL_ARRIVAL;

  // Icons — per-column easeOutBack scale + fade, triggered as the bar's leading
  // edge passes over that column. ICON_ANIM_DUR sets the window length.
  const ICON_ANIM_DUR = ICON_ANIM_END - ICON_ANIM_START;

  return (
    <AbsoluteFill style={{ backgroundColor: '#E6ECF2', overflow: 'hidden' }}>
      {/* Vertical-centre nudge so the panel + loading-bar group reads as
          centred on the canvas. */}
      <AbsoluteFill style={{ transform: `translateY(${VERTICAL_OFFSET}px)` }}>
      {/* Oxford-blue panel (CSS) — width fits the column count, centred; scales in */}
      <div
        style={{
          position: 'absolute',
          left: PANEL_LEFT,
          top:  PANEL_TOP,
          width:  PANEL_W,
          height: PANEL_HEIGHT,
          borderRadius: PANEL_RADIUS,
          background: PANEL_GRADIENT,
          boxShadow: PANEL_SHADOW,
          opacity: containerOpacity,
          transform: `scale(${containerScale})`,
          transformOrigin: 'center center',
        }}
      />

      {/* Loading bar — dark track */}
      <div
        style={{
          position: 'absolute',
          left: BAR_LEFT,
          top:  BAR_TOP,
          width:  BAR_WIDTH,
          height: BAR_HEIGHT,
          borderRadius: BAR_HEIGHT / 2,
          background: BAR_TRACK_COLOR,
          opacity: barBaseOpacity,
        }}
      />

      {/* Loading bar — blue fill, reveals left → right by width */}
      <div
        style={{
          position: 'absolute',
          left: BAR_LEFT,
          top:  BAR_TOP,
          width:  BAR_WIDTH,
          height: BAR_HEIGHT,
          borderRadius: BAR_HEIGHT / 2,
          overflow: 'hidden',
          opacity: barBaseOpacity,
        }}
      >
        <div
          style={{
            width: `${barFillPct}%`,
            height: '100%',
            background: BAR_FILL_GRADIENT,
            borderRadius: BAR_HEIGHT / 2,
          }}
        />
      </div>

      {/* Icons and pills — one per column */}
      {points.map(({ icon, label }, i) => {
        const cx = COL_CX[i]!;
        const arrival = COL_ARRIVAL[i]!;

        // Per-column icon fade + easeOutBack scale, kicked off when the
        // loading bar's leading edge passes directly over the icon.
        const iconOpacity = interpolate(frame, [arrival, arrival + ICON_ANIM_DUR], [0, 1], {
          extrapolateLeft:  'clamp',
          extrapolateRight: 'clamp',
        });
        const iconScale = interpolate(frame, [arrival, arrival + ICON_ANIM_DUR], [0.55, 1], {
          extrapolateLeft:  'clamp',
          extrapolateRight: 'clamp',
          easing: easeOutBack,
        });

        // Sine pulse triggered at the same arrival moment — peaks at +8 %
        // halfway through the 0.45 s bump, returns to 1 cleanly.
        const pulseDur = f(PULSE_DUR_S);
        const pulseProg = interpolate(frame, [arrival, arrival + pulseDur], [0, 1], {
          extrapolateLeft:  'clamp',
          extrapolateRight: 'clamp',
        });
        const pulse = 1 + PULSE_AMP * Math.sin(Math.PI * pulseProg);

        return (
          <AbsoluteFill key={i}>
            {/* Icon centred at (cx, ICON_CY) */}
            <div
              style={{
                position: 'absolute',
                left: cx - ICON_SZ / 2,
                top:  ICON_CY - ICON_SZ / 2,
                width:  ICON_SZ,
                height: ICON_SZ,
                opacity: iconOpacity,
                transform: `scale(${iconScale * pulse})`,
                transformOrigin: 'center center',
              }}
            >
              <SvgIcon name={icon} size={ICON_SZ} />
            </div>

            <AnimPill
              label={label}
              cx={cx}
              startFrame={PILL_ARRIVAL[i]!}
              pillDuration={PILL_DURATION}
            />
          </AbsoluteFill>
        );
      })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
