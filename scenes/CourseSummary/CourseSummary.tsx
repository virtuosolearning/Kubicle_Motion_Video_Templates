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
    pillStarts:   z.array(z.number().nonnegative()).length(6),
    pillDuration: z.number().positive(),
  })
  .partial();

export const courseSummarySchema = z.object({
  // Exactly 6 recap lines, ordered top → bottom in the final composition.
  recaps: z.array(z.string().min(1).max(40)).length(6),
  timings: courseSummaryTimingsSchema.optional(),
});

export type CourseSummaryProps = z.infer<typeof courseSummarySchema>;

export const courseSummaryMeta = {
  description:
    'End-of-course recap: banner drops down top-left, then 6 pills cascade in ' +
    'from above, each rolling out from under the previous. Best for summarising ' +
    'the 6 main takeaways of a lesson.',
  authoringNotes:
    'Always supply exactly 6 recap lines. Each is bold black inside a coloured ' +
    'pill — strict 40-character max, one line at 37 px in Satoshi Bold. Aim for ' +
    'parallel structure (e.g. all noun phrases, all verb phrases). GOOD: ' +
    '"Define your target audience". BAD: "It\'s important to define your target ' +
    'audience first" (too long, not parallel). Default duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BANNER_SRC = staticFile('Template-Specific-Assets/course_summary_banner.png');
const PILL_SRC   = staticFile('Template-Specific-Assets/course_summary_pill.png');
const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (lifted directly from the prototype) ────────────────────

// Course_Summary_Pill.png places one pill at y=116..261 inside a 1920×1080 canvas.
const PILL_ASSET_TOP = 116;
const PILL_HEIGHT    = 145;

// Final layout of the 6 pills (top y values).
const FIRST_PILL_TOP = 80;
const ROW_PITCH      = 155;
const PILL_TOPS = [0, 1, 2, 3, 4, 5].map(i => FIRST_PILL_TOP + i * ROW_PITCH) as readonly number[];
// Pill 1's entry starts off-canvas above; subsequent pills enter from
// where the previous pill landed.
const PILL_FROM_TOPS = PILL_TOPS.map((_, i) => i === 0 ? -160 : PILL_TOPS[i - 1]!);

// Text position relative to the pill row.
const TEXT_LEFT = 790;

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

      {/* Label centred vertically on the pill */}
      <div
        style={{
          position: 'absolute',
          left: TEXT_LEFT,
          top:  currentTop,
          height: PILL_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 37,
          color: '#000',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
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
      {/* Pills first so the banner (zIndex 100) sits on top */}
      {([0, 1, 2, 3, 4, 5] as const).map(i => (
        <Pill
          key={i}
          index={i}
          label={recaps[i]!}
          startFrame={PILL_STARTS[i]!}
          pillDur={PILL_DUR}
          fromTop={PILL_FROM_TOPS[i]!}
          toTop={PILL_TOPS[i]!}
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
