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
// pillStarts must contain exactly 3 entries (one per column).
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
    // Two percentages (0..100) where the loading bar pauses so the narrator
    // can talk about each point. Defaults [33, 66] — roughly between
    // column 1/2 and column 2/3.
    barPauseStops:       z.array(z.number().min(0).max(100)).length(2),
    // How long each of the two pauses lasts (seconds). Set to 0 to keep
    // the original continuous-sweep behaviour.
    barPauseDuration:    z.number().nonnegative(),
    pillStarts:          z.array(z.number().nonnegative()).length(3),
    pillDuration:        z.number().positive(),
  })
  .partial();

export const bigPoints3V1Schema = z.object({
  // Exactly 3 points; layout is hard-coded to three equal columns.
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
    .length(3),
  timings: bigPoints3V1TimingsSchema.optional(),
});

export type BigPoints3V1Props = z.infer<typeof bigPoints3V1Schema>;

export const bigPoints3V1Meta = {
  description:
    'Three-column row on an oxford-blue base, each column holding a single bold ' +
    'icon and a coloured pill caption beneath. A loading bar sweeps left → right ' +
    'revealing the icons in turn, then the three caption pills pop in staggered. ' +
    'Best for surfacing three top-level takeaways or features as a quick visual ' +
    'recap with minimal supporting copy.',
  authoringNotes:
    'Always supply exactly 3 points. icon is an id from the catalog\'s available_icons list ' +
    '(e.g. "rocket", "idea", "money-bag"); unknown ids leave the slot empty. label is the ' +
    'pill caption — strict 25-character max, one line at 34 px in Satoshi Black. ' +
    'Write short noun phrases (2–4 words). GOOD: "Faster processing", "Real-time sync", ' +
    '"Zero downtime". BAD: "Processes data faster", "Synchronise in real time" (too long — ' +
    'trim to the core noun phrase). Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const OXFORD_BLUE_SRC      = staticFile('Template-Specific-Assets/oxford_blue_base.png');
const PILL_SRC             = staticFile('Template-Specific-Assets/pill_box.png');
const LOADING_BAR_SRC      = staticFile('Template-Specific-Assets/loading_bar.png');
const LOADING_BAR_BASE_SRC = staticFile('Template-Specific-Assets/loading_bar_base.png');
const SATOSHI_BLACK_SRC    = staticFile('fonts/Satoshi-Black.woff2');
const INTER_EXTRABOLD_SRC  = staticFile('fonts/Inter-ExtraBold.woff2');

// ─── Layout constants (lifted verbatim from the prototype) ────────────────────

// Column centres at equal thirds of the 1920-wide canvas.
const COL_CX = [360, 961, 1562] as const;
// Whole composition is shifted up by this many pixels to vertically centre
// the panel + loading-bar artwork on the canvas (the source PNGs are biased
// a bit low). Negative values move content upward.
const VERTICAL_OFFSET = -60;
// Icon visual size — prototype renders at 165 px then scales 2.45×.
const ICON_SZ = 404;
// Icon vertical centre — 55% down the container (670) shifted up 96 px per the prototype.
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
  barPauseStops:      [33, 66] as readonly number[],
  barPauseDuration:   1.50,
  // Pill pop times line up with the bar arriving at each stop.
  pillStarts: [2.57, 6.04, 9.50] as readonly number[],
  pillDuration:       0.47,
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

  // Merge caller-supplied overrides, then convert seconds → frames once.
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
  const BAR_PAUSE_STOPS      = [...t.barPauseStops] as readonly number[];
  const BAR_PAUSE_DURATION   = f(t.barPauseDuration);
  const PILL_STARTS          = t.pillStarts.map(f);
  const PILL_DURATION        = f(t.pillDuration);

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

  // Loading bar base (dark track).
  const barBaseOpacity = interpolate(frame, [BAR_BASE_FADE_START, BAR_BASE_FADE_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  // Loading bar fill — piecewise sweep with two hold segments so the narrator
  // can talk about each point. The total span [BAR_FILL_START, BAR_FILL_END]
  // is split into 3 sweeps and 2 pauses, with sweep durations proportional
  // to the distance between stops.
  //
  //   sweep 1: 0%             → barPauseStops[0]    (e.g. 0 → 33)
  //   hold:                     barPauseStops[0]    (BAR_PAUSE_DURATION frames)
  //   sweep 2: barPauseStops[0] → barPauseStops[1]  (e.g. 33 → 66)
  //   hold:                     barPauseStops[1]    (BAR_PAUSE_DURATION frames)
  //   sweep 3: barPauseStops[1] → 100%              (e.g. 66 → 100)
  const TOTAL_SPAN  = BAR_FILL_END - BAR_FILL_START;
  const SWEEP_BUDGET = Math.max(0, TOTAL_SPAN - 2 * BAR_PAUSE_DURATION);
  const seg1Pct = BAR_PAUSE_STOPS[0]!;
  const seg2Pct = BAR_PAUSE_STOPS[1]! - BAR_PAUSE_STOPS[0]!;
  const seg3Pct = 100 - BAR_PAUSE_STOPS[1]!;
  const segSum  = seg1Pct + seg2Pct + seg3Pct || 1;
  const SWEEP_1 = Math.round((seg1Pct / segSum) * SWEEP_BUDGET);
  const SWEEP_2 = Math.round((seg2Pct / segSum) * SWEEP_BUDGET);
  const SWEEP_3 = SWEEP_BUDGET - SWEEP_1 - SWEEP_2;

  // Anchor keyframes (in frame units, absolute on the timeline).
  const k0 = BAR_FILL_START;
  const k1 = k0 + SWEEP_1;
  const k2 = k1 + BAR_PAUSE_DURATION;
  const k3 = k2 + SWEEP_2;
  const k4 = k3 + BAR_PAUSE_DURATION;
  const k5 = k4 + SWEEP_3;

  const barFillPct = interpolate(
    frame,
    [k0, k1, k2, k3, k4, k5],
    [0, BAR_PAUSE_STOPS[0]!, BAR_PAUSE_STOPS[0]!, BAR_PAUSE_STOPS[1]!, BAR_PAUSE_STOPS[1]!, 100],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const rightClip = (100 - barFillPct).toFixed(2);

  // ─── Per-column arrival frames ────────────────────────────────────────────
  // The loading bar's leading edge sits at canvas X = 1920 × barFillPct/100
  // (the bar PNG is canvas-wide and clipped from the right). Each icon sits
  // at COL_CX[i] on the 1920-wide canvas, so the bar is "directly above"
  // icon i when barFillPct = COL_CX[i] / 19.2. Invert the piecewise sweep
  // to find the frame where that target % is reached. Both the icon scale-
  // in and the pill scale-in are then keyed off this arrival frame instead
  // of the user-supplied PILL_STARTS — so they pop together exactly when
  // the bar passes over them.
  const colArrivalFrame = (cx: number): number => {
    const target = (cx / 1920) * 100;
    const s0 = BAR_PAUSE_STOPS[0]!;
    const s1 = BAR_PAUSE_STOPS[1]!;
    if (target <= s0) {
      return k0 + (target / s0) * (k1 - k0);
    } else if (target <= s1) {
      return k2 + ((target - s0) / (s1 - s0)) * (k3 - k2);
    } else {
      return k4 + ((target - s1) / (100 - s1)) * (k5 - k4);
    }
  };
  const COL_ARRIVAL = COL_CX.map(colArrivalFrame);
  // Override PILL_STARTS so each pill pops in lockstep with its icon.
  const PILL_ARRIVAL = COL_ARRIVAL;

  // Icons — per-column easeOutBack scale + fade, triggered as the bar's
  // leading edge passes over that column. The actual interpolation happens
  // inline in the points.map below; ICON_ANIM_DUR sets the window length.
  const ICON_ANIM_DUR = ICON_ANIM_END - ICON_ANIM_START;

  return (
    <AbsoluteFill style={{ backgroundColor: '#E6ECF2', overflow: 'hidden' }}>
      {/* Vertical-centre nudge — the panel + loading-bar artwork sit slightly
          low in the original PNGs. Shift the whole composition up by
          VERTICAL_OFFSET px so it reads as visually centred on the canvas. */}
      <AbsoluteFill style={{ transform: `translateY(${VERTICAL_OFFSET}px)` }}>
      {/* Oxford Blue container — scales up from centre */}
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
        <Img src={LOADING_BAR_BASE_SRC} style={{ width: '100%', height: '100%' }} alt="" />
      </AbsoluteFill>

      {/* Loading bar — blue fill, reveals left → right via clipPath */}
      <AbsoluteFill
        style={{
          opacity: barBaseOpacity,
          clipPath: `inset(0 ${rightClip}% 0 0)`,
        }}
      >
        <Img src={LOADING_BAR_SRC} style={{ width: '100%', height: '100%' }} alt="" />
      </AbsoluteFill>

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
