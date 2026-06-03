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

// Ports the Course Summary prototype:
//   • Banner (Course_Summary_Banner.png) drops down from above into the top-left
//     corner over 0.10–1.80 s with easeOutCubic + opacity ramp 0.10–0.90 s.
//   • 6 recap pills cascade in from above, each rolling out from under the
//     previous: pill 1 from y=−160 → 80, pill 2 from 80 → 235, etc. Each pill's
//     entry takes 1.20 s with easeOutCubic. Pills enter at 1.80, 4.00, 6.20,
//     8.40, 10.60, 12.80 s (cycle = 2.20 s).
//   • Z-order: pill 0 is on top, pill 5 underneath, so each rolls out from
//     beneath its predecessor.
//   • Default composition length is 450 frames (15 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
export const courseSummaryTimingsSchema = z
  .object({
    bannerStart:  z.number().nonnegative(),
    bannerEnd:    z.number().positive(),
    bannerFadeEnd: z.number().positive(),
    // 1 to 6 entries — should have at least `recaps.length`; only the first
    // recaps.length entries are used.
    pillStarts:   z.array(z.number().nonnegative()).min(1).max(6),
    pillDuration: z.number().positive(),
  })
  .partial();

export const courseSummarySchema = z.object({
  // 1 to 6 recap lines, ordered top → bottom. The pill band auto-centres
  // vertically for the count (3 pills sit centred in the frame, etc.).
  recaps: z.array(z.string().min(1).max(40)).min(1).max(6),
  timings: courseSummaryTimingsSchema.optional(),
});

export type CourseSummaryProps = z.infer<typeof courseSummarySchema>;

export const courseSummaryMeta = {
  description:
    'End-of-course recap: banner drops down top-left, then 6 pills cascade in ' +
    'from above, each rolling out from under the previous. Best for summarising ' +
    'the 6 main takeaways of a lesson.',
  authoringNotes:
    'Supply 1 to 6 recap lines — the pill band auto-centres vertically for the ' +
    'count (3 pills sit centred in the frame, etc.). Each line is bold black ' +
    'inside the white pill — 40-character max at 37 px in Satoshi Bold; if a ' +
    'sentence is longer it wraps onto a second line inside the pill (never ' +
    'spills onto the background). Aim for parallel structure (e.g. all noun ' +
    'phrases, all verb phrases). GOOD: "Define your target audience". BAD: ' +
    '"It\'s important to define your target audience first" (too long, not ' +
    'parallel). Default duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BANNER_SRC = staticFile('Template-Specific-Assets/course_summary_banner.png');
const PILL_SRC   = staticFile('Template-Specific-Assets/course_summary_pill.png');
const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (lifted directly from the prototype) ────────────────────

// Course_Summary_Pill.png places one pill at y=116..261 inside a 1920×1080
// canvas; pill alpha-bbox runs x=605..1785.
const PILL_ASSET_TOP = 116;
const PILL_HEIGHT    = 145;
const PILL_RIGHT     = 1785;

// Vertical layout — the band of `count` pills (1-6) auto-centres on the canvas.
const ROW_PITCH = 155;
const CANVAS_CY = 540;
const firstPillTopFor = (count: number) =>
  CANVAS_CY - ((count - 1) * ROW_PITCH + PILL_HEIGHT) / 2;
const pillTopFor     = (count: number, i: number) => firstPillTopFor(count) + i * ROW_PITCH;
// Pill 0's entry starts off-canvas above; each later pill enters from where
// the previous one landed.
const pillFromTopFor = (count: number, i: number) =>
  i === 0 ? -160 : pillTopFor(count, i - 1);

// Text position relative to the pill row. Width is capped to the pill's body
// so a long sentence wraps onto a second line inside the pill (never spills
// onto the background).
const TEXT_LEFT      = 790;
const TEXT_MAX_WIDTH = PILL_RIGHT - TEXT_LEFT - 30;   // 965

// Banner enters from above.
const BANNER_TRAVEL = -400;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  // Banner slide + fade in.
  bannerStart:    0.10,
  bannerEnd:      1.80,
  bannerFadeEnd:  0.90,
  // Pill cycle = 2.20 s (1.20 motion + 1.00 dwell). Each pill begins as the
  // previous one finishes its dwell.
  pillStarts: [1.80, 4.00, 6.20, 8.40, 10.60, 12.80] as readonly number[],
  pillDuration:   1.20,
} as const;

const easeOutCubic = Easing.out(Easing.cubic);

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

// ─── Banner ───────────────────────────────────────────────────────────────────

function Banner({
  frame,
  bannerStart,
  bannerEnd,
  bannerFadeEnd,
}: {
  frame: number;
  bannerStart: number;
  bannerEnd: number;
  bannerFadeEnd: number;
}) {
  const ty = interpolate(frame, [bannerStart, bannerEnd], [BANNER_TRAVEL, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const opacity = interpolate(frame, [bannerStart, bannerFadeEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Img
      src={BANNER_SRC}
      alt=""
      style={{
        position: 'absolute',
        left: 0,
        top:  0,
        width:  1920,
        height: 1080,
        transform: `translateY(${ty}px)`,
        opacity,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    />
  );
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

function Pill({
  index,
  label,
  startFrame,
  pillDur,
  fromTop,
  toTop,
}: {
  index: number;
  label: string;
  startFrame: number;
  pillDur: number;
  fromTop: number;
  toTop: number;
}) {
  const frame = useCurrentFrame();

  // Don't render until this pill's entry begins, so it doesn't flash at fromTop.
  if (frame < startFrame) return null;

  const prog = interpolate(frame, [startFrame, startFrame + pillDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const currentTop  = fromTop + (toTop - fromTop) * prog;
  const assetOffsetY = currentTop - PILL_ASSET_TOP;

  // Earlier pills cover later ones: pill 0 on top (z=20), pill 5 below (z=15).
  const zIndex = 20 - index;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top:  0,
        width:  1920,
        height: 1080,
        zIndex,
        pointerEvents: 'none',
      }}
    >
      {/* Single-pill PNG translated so its pill row lands at currentTop */}
      <Img
        src={PILL_SRC}
        alt=""
        style={{
          position: 'absolute',
          left: 0,
          top:  assetOffsetY,
          width:  1920,
          height: 1080,
          display: 'block',
        }}
      />

      {/* Label centred vertically on the pill. Width is capped to the pill body
          and text wraps onto the next line if it's too long; vertical overflow
          is clipped so it never spills past the pill onto the background. */}
      <div
        style={{
          position: 'absolute',
          left: TEXT_LEFT,
          top:  currentTop,
          width:  TEXT_MAX_WIDTH,
          height: PILL_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 37,
          lineHeight: 1.15,
          color: '#000',
          letterSpacing: '-0.01em',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          overflow: 'hidden',
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const CourseSummary: React.FC<CourseSummaryProps> = ({ recaps, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading CourseSummary fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BANNER_START    = f(t.bannerStart);
  const BANNER_END      = f(t.bannerEnd);
  const BANNER_FADE_END = f(t.bannerFadeEnd);
  const PILL_STARTS     = t.pillStarts.map(f);
  const PILL_DUR        = f(t.pillDuration);

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Pills first so the banner (zIndex 100) sits on top. */}
      {recaps.map((label, i) => (
        <Pill
          key={i}
          index={i}
          label={label}
          startFrame={PILL_STARTS[i]!}
          pillDur={PILL_DUR}
          fromTop={pillFromTopFor(recaps.length, i)}
          toTop={pillTopFor(recaps.length, i)}
        />
      ))}

      <Banner
        frame={frame}
        bannerStart={BANNER_START}
        bannerEnd={BANNER_END}
        bannerFadeEnd={BANNER_FADE_END}
      />
    </AbsoluteFill>
  );
};
