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

// The media-team prototype (Lesson Goal Screen.html) treats the heading
// "Lesson Goal" as fixed branding that transitions off the title card.
// Authorable inputs: the subtext, plus optional timing overrides. Every
// other visual choice (colours, typography, slide directions) is baked
// into the component so the ai-service doesn't need to know about them.

// Optional per-render timing overrides. All values are in frames at 30 fps;
// any field omitted falls back to the corresponding entry in DEFAULT_TIMINGS
// (which reproduces the signed-off design beat-for-beat).
export const lessonGoalTimingsSchema = z
  .object({
    stripeInStart: z.number().nonnegative(),
    stripeInDuration: z.number().positive(),
    headingInStart: z.number().nonnegative(),
    headingInDuration: z.number().positive(),
    subtextInStart: z.number().nonnegative(),
    subtextInDuration: z.number().positive(),
    outroDuration: z.number().nonnegative(),
  })
  .partial();

export const lessonGoalSchema = z.object({
  subtext: z.string().min(1).max(200),
  timings: lessonGoalTimingsSchema.optional(),
});

export type LessonGoalProps = z.infer<typeof lessonGoalSchema>;

export const lessonGoalMeta = {
  description:
    'Bright transition card announcing the lesson goal. Heading is fixed ' +
    'to "Lesson Goal"; caller supplies the one-line goal itself as subtext.',
  authoringNotes:
    'Use immediately after the lesson_title. Subtext should be one short ' +
    'sentence describing what the learner will be able to do by the end of ' +
    'the lesson - aim for under 120 characters. Default composition length ' +
    'is 300 frames (10s at 30fps); longer or shorter durations are fine, ' +
    'the outro fade always hugs the last 1.1 seconds.',
} as const;

// Palette locked to the media-team spec. Any change here should be
// cross-checked with the Lesson Goal HTML prototype under
// kubicle design assets.
const PLATINUM = '#E6ECF2';
const DODGER = '#0496FF';
const INK = '#0B1F33';

const STRIPE_SRC = staticFile('images/stripe.png');
const INTER_EXTRABOLD_URL = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_MEDIUM_URL = staticFile('fonts/Satoshi-Medium.woff2');

// Animation timeline, expressed in frames at 30 fps so it tracks the
// 10-second reference timeline in the HTML prototype one-to-one:
//
//   t (s)  frame  event
//   0.25     8    stripe sweep in  (duration 1.40s / 42f)
//   0.95    29    heading rise-in  (duration 0.85s / 26f)
//   1.45    44    subtext rise-in  (duration 0.85s / 26f)
//   tail    -33   outro fade-out   (duration 1.10s / 33f, from end)
//
// STRIPE_OFFSET_* match the CSS `translate(-60%, 110%)` start pose. We
// convert the percentages to pixels against the composition size at
// animate time, not here, so the scene is resolution-agnostic.
const DEFAULT_TIMINGS = {
  stripeInStart: 8,
  stripeInDuration: 42,
  headingInStart: 29,
  headingInDuration: 26,
  subtextInStart: 44,
  subtextInDuration: 26,
  outroDuration: 33,
} as const;

// Matches cubic-bezier(.2, .8, .2, 1) in the prototype - a gentle
// overshoot-free ease-out used for every entry animation.
const entryEase = Easing.bezier(0.2, 0.8, 0.2, 1);
// The outro is a plain ease-in fade; nothing moves.
const outroEase = Easing.ease;

// Load Inter ExtraBold + Satoshi Medium from the bundled woff2 files and
// hold the render open until they register, otherwise Chromium captures
// frame 0 in the system fallback. Single top-level promise so repeated
// scene instances share the same load - FontFace is idempotent, but
// delayRender handles should not be.
let fontsPromise: Promise<void> | null = null;

function loadLessonGoalFonts(): Promise<void> {
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
    // FontFaceSet.add() exists at runtime but some TS DOM lib versions
    // omit the method from the type; cast narrowly rather than bumping
    // the whole lib just for this.
    const fonts = document.fonts as FontFaceSet & { add(font: FontFace): void };
    fonts.add(loadedInter);
    fonts.add(loadedSatoshi);
  })();
  return fontsPromise;
}

export const LessonGoal: React.FC<LessonGoalProps> = ({ subtext, timings }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();

  // Merge caller-supplied timing overrides over the signed-off defaults.
  // The component keeps using the same SCREAMING_CASE constants below so
  // the body matches the original prototype line-for-line.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const STRIPE_IN_START = t.stripeInStart;
  const STRIPE_IN_DURATION = t.stripeInDuration;
  const HEADING_IN_START = t.headingInStart;
  const HEADING_IN_DURATION = t.headingInDuration;
  const SUBTEXT_IN_START = t.subtextInStart;
  const SUBTEXT_IN_DURATION = t.subtextInDuration;
  const OUTRO_DURATION = t.outroDuration;

  // Hold first-frame capture until the bundled fonts are ready. If they
  // fail to load (missing asset, corrupt woff2) we still continue render
  // so the pipeline doesn't deadlock; Chromium falls back to the system
  // font for that render, which is catchable visually in QA.
  const [handle] = useState(() => delayRender('Loading LessonGoal fonts'));
  useEffect(() => {
    loadLessonGoalFonts()
      .catch(() => {
        // Swallow; see comment above.
      })
      .finally(() => continueRender(handle));
  }, [handle]);

  const stripeProgress = interpolate(
    frame,
    [STRIPE_IN_START, STRIPE_IN_START + STRIPE_IN_DURATION],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: entryEase },
  );
  // The CSS prototype starts the stripe at translate(-60%, 110%) scale(1.05)
  // and ends at translate(0, 0) scale(1). We reproduce that in pixels so
  // the math is explicit.
  const stripeTx = interpolate(stripeProgress, [0, 1], [-0.6 * width, 0]);
  const stripeTy = interpolate(stripeProgress, [0, 1], [1.1 * height, 0]);
  const stripeScale = interpolate(stripeProgress, [0, 1], [1.05, 1]);
  // Opacity ramps to full within the first 15% of the sweep, matching
  // the keyframe in the prototype.
  const stripeOpacity = interpolate(stripeProgress, [0, 0.15, 1], [0, 1, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const headingProgress = interpolate(
    frame,
    [HEADING_IN_START, HEADING_IN_START + HEADING_IN_DURATION],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: entryEase },
  );
  const headingTy = interpolate(headingProgress, [0, 1], [24, 0]);
  const headingOpacity = headingProgress;

  const subtextProgress = interpolate(
    frame,
    [SUBTEXT_IN_START, SUBTEXT_IN_START + SUBTEXT_IN_DURATION],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: entryEase },
  );
  const subtextTy = interpolate(subtextProgress, [0, 1], [20, 0]);
  const subtextOpacity = subtextProgress;

  // Outro always hugs the tail of whatever duration the caller picked.
  // We clamp at 0 in case the caller sent fewer frames than the fade
  // itself (< 33 frames); the scene then simply fades from frame 0.
  const outroStart = Math.max(0, durationInFrames - OUTRO_DURATION);
  const outroOpacity = interpolate(
    frame,
    [outroStart, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: outroEase },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: PLATINUM, overflow: 'hidden', opacity: outroOpacity }}>
      <AbsoluteFill
        style={{
          opacity: stripeOpacity,
          transform: `translate(${stripeTx}px, ${stripeTy}px) scale(${stripeScale})`,
        }}
      >
        <Img
          src={STRIPE_SRC}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          alt=""
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingLeft: `${0.07 * width}px`,
          paddingRight: `${0.07 * width}px`,
        }}
      >
        <h1
          style={{
            margin: '0 0 28px 0',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 800,
            fontSize: 140,
            lineHeight: 1,
            letterSpacing: '-0.03em',
            color: DODGER,
            opacity: headingOpacity,
            transform: `translateY(${headingTy}px)`,
          }}
        >
          Lesson Goal
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: 1000,
            fontFamily: "'Satoshi', 'Inter', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 72,
            lineHeight: 1.15,
            letterSpacing: '-0.015em',
            color: INK,
            opacity: subtextOpacity,
            transform: `translateY(${subtextTy}px)`,
          }}
        >
          {subtext}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
