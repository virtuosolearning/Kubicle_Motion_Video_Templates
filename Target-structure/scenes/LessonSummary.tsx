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

// Mirrors the media-team's Lesson Summary Screen prototype: the title
// "Lesson Summary" is fixed branding; callers supply 1-5 short recap
// lines, one per pill. Pills stagger-slide up in order at 1s, 2s, 3s,
// 4s, 5s; slots without a pill simply don't render. Any pills beyond
// the five reserved timing slots are rejected by the schema.
// Optional per-render timing overrides. All values are in frames at 30 fps;
// any field omitted falls back to the corresponding entry in DEFAULT_TIMINGS.
// pillInStarts, when provided, must contain at least as many entries as the
// number of pills supplied (one start frame per pill).
export const lessonSummaryTimingsSchema = z
  .object({
    titleInStart: z.number().nonnegative(),
    titleInDuration: z.number().positive(),
    pillInStarts: z.array(z.number().nonnegative()).min(1).max(5),
    pillInDuration: z.number().positive(),
    outroDuration: z.number().nonnegative(),
  })
  .partial();

export const lessonSummarySchema = z.object({
  pills: z.array(z.string().min(1).max(80)).min(1).max(5),
  // Optional animation timing overrides (frames @ 30fps).
  timings: lessonSummaryTimingsSchema.optional(),
});

export type LessonSummaryProps = z.infer<typeof lessonSummarySchema>;

export const lessonSummaryMeta = {
  description:
    'Closing summary card with 1-5 recap pills that stagger-slide up. ' +
    'Title is fixed to "Lesson Summary"; caller supplies the recap lines.',
  authoringNotes:
    'Use at the end of a lesson, typically before outro_card. Each pill ' +
    'should be a short recap fragment (aim for under 60 characters) - ' +
    'the pill text does not wrap. Prefer 3-5 pills for a paced reveal; ' +
    'fewer pills simply occupy the upper rows. Default composition ' +
    'length is 300 frames (10s at 30fps); longer or shorter durations ' +
    'are fine, the outro fade always hugs the last 1.1 seconds.',
} as const;

// Palette - title in the same Dodger Blue used across the brand card
// set; pill text is white on the dark pill graphic.
const TITLE_COLOR = '#0496FF';
const PILL_TEXT_COLOR = '#FFFFFF';

const BACKGROUND_SRC = staticFile('images/lesson_summary_background.png');
const PILL_SRC = staticFile('images/pill.png');
const INTER_EXTRABOLD_URL = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_MEDIUM_URL = staticFile('fonts/Satoshi-Medium.woff2');

// Natural geometry of the pill graphic inside its 1920x1080 canvas,
// measured from the source PNG. Kept here (not hoisted) because it
// describes this specific asset; if the pill art is re-exported at a
// different position these numbers have to move with it.
const PILL_NATURAL = { top: 329, height: 93, left: 133, width: 1136 } as const;
const PILL_CENTER_Y = PILL_NATURAL.top + PILL_NATURAL.height / 2;

// Layout knobs lifted verbatim from the prototype's TWEAK_DEFAULTS so
// the port is a pixel-for-pixel reproduction of the design the media
// team signed off on.
const PILL_SPACING = 118;
const PILL_TEXT_LEFT = 242;
const PILL_TEXT_SIZE = 28;
const TITLE_GAP = 110;
const TITLE_SIZE = 62;
const TITLE_RISE_PX = 22;
const PILL_SLIDE_PX = 130;

// Animation timeline in frames at 30 fps. Matches the prototype's
// reference 10s timeline exactly:
//
//   t (s)  frame  event
//   0.20     6    title rise-in    (duration 0.45s / 14f)
//   1.00    30    pill 1 slide-up  (duration 0.55s / 17f)
//   2.00    60    pill 2 slide-up
//   3.00    90    pill 3 slide-up
//   4.00   120    pill 4 slide-up
//   5.00   150    pill 5 slide-up
//   tail   -33    outro fade-out   (duration 1.10s / 33f, from end)
const DEFAULT_TIMINGS = {
  titleInStart: 6,
  titleInDuration: 14,
  pillInStarts: [30, 60, 90, 120, 150] as readonly number[],
  pillInDuration: 17,
  outroDuration: 33,
} as const;

// Matches Easing.easeOutCubic in the prototype.
const entryEase = Easing.out(Easing.cubic);
const outroEase = Easing.ease;

// Module-level singleton so repeated scene instances (Series.Sequence
// mounts/unmounts on scrub) don't hand out a fresh delayRender handle
// per mount; document.fonts is global so the second call is a no-op
// once the woff2 has registered.
let fontsPromise: Promise<void> | null = null;

function loadBrandFonts(): Promise<void> {
  if (fontsPromise) {
    return fontsPromise;
  }
  fontsPromise = (async () => {
    const inter = new FontFace('Inter', `url(${INTER_EXTRABOLD_URL}) format('woff2')`, {
      weight: '800',
      style: 'normal',
      display: 'block',
    });
    const satoshi = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_URL}) format('woff2')`, {
      weight: '500',
      style: 'normal',
      display: 'block',
    });
    const [loadedInter, loadedSatoshi] = await Promise.all([inter.load(), satoshi.load()]);
    const fonts = document.fonts as FontFaceSet & { add(font: FontFace): void };
    fonts.add(loadedInter);
    fonts.add(loadedSatoshi);
  })();
  return fontsPromise;
}

export const LessonSummary: React.FC<LessonSummaryProps> = ({ pills, timings }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Merge caller-supplied timing overrides over the signed-off defaults.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const TITLE_IN_START = t.titleInStart;
  const TITLE_IN_DURATION = t.titleInDuration;
  const PILL_IN_STARTS = t.pillInStarts;
  const PILL_IN_DURATION = t.pillInDuration;
  const OUTRO_DURATION = t.outroDuration;

  const [handle] = useState(() => delayRender('Loading LessonSummary fonts'));
  useEffect(() => {
    loadBrandFonts()
      .catch(() => {
        // Swallow - see LessonGoal for the same pattern rationale.
      })
      .finally(() => continueRender(handle));
  }, [handle]);

  const titleProgress = interpolate(
    frame,
    [TITLE_IN_START, TITLE_IN_START + TITLE_IN_DURATION],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: entryEase },
  );
  const titleTy = (1 - titleProgress) * TITLE_RISE_PX;

  const outroStart = Math.max(0, durationInFrames - OUTRO_DURATION);
  const outroOpacity = interpolate(
    frame,
    [outroStart, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: outroEase },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden', opacity: outroOpacity }}>
      <AbsoluteFill>
        <Img
          src={BACKGROUND_SRC}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          alt=""
        />
      </AbsoluteFill>

      {/* Content group - title + pills share the same 1920x1080
          coordinate system as the prototype so the positions below
          line up with PILL_NATURAL. */}
      <AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            top: PILL_NATURAL.top - TITLE_GAP,
            left: PILL_NATURAL.left,
            opacity: titleProgress,
            transform: `translateY(${titleTy}px)`,
          }}
        >
          <span
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 800,
              fontSize: TITLE_SIZE,
              letterSpacing: '-0.5px',
              color: TITLE_COLOR,
              whiteSpace: 'nowrap',
            }}
          >
            Lesson Summary
          </span>
        </div>

        {pills.map((pillText, i) => {
          const start = PILL_IN_STARTS[i]!;
          const raw = interpolate(
            frame,
            [start, start + PILL_IN_DURATION],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          // Pill stays fully hidden (and unmounted visually) until its
          // reveal frame, matching the prototype's `if (raw === 0) return null`.
          if (raw <= 0) {
            return null;
          }
          const eased = entryEase(raw);
          const slideTy = (1 - eased) * PILL_SLIDE_PX;
          const yShift = i * PILL_SPACING;
          const pillOpacity = Math.min(1, raw * 4);

          return (
            <AbsoluteFill
              key={i}
              style={{
                opacity: pillOpacity,
                transform: `translateY(${yShift + slideTy}px)`,
              }}
            >
              <Img
                src={PILL_SRC}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                alt=""
              />
              <div
                style={{
                  position: 'absolute',
                  top: PILL_CENTER_Y,
                  left: PILL_TEXT_LEFT,
                  transform: 'translateY(-50%)',
                  color: PILL_TEXT_COLOR,
                  fontFamily: "'Satoshi', 'Inter', system-ui, sans-serif",
                  fontWeight: 500,
                  fontSize: PILL_TEXT_SIZE,
                  letterSpacing: '0.01em',
                  whiteSpace: 'nowrap',
                }}
              >
                {pillText}
              </div>
            </AbsoluteFill>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
