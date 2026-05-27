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

// Ports the Lesson Goal screen. The HTML uses CSS animations with these
// tweaked defaults (speed = 0.6, startDelay = 0.4 s — baked in as the
// production timing):
//   • Stripe (Lesson_Goal_Stripe.png) sweeps up from off-canvas bottom-left
//     and fades in. Opacity 0→1 over the first 15 % of the slide; transform
//     translate(-60%, 110%) scale(1.05) → translate(0, 0) scale(1).
//   • Heading "Lesson Goal" (Inter ExtraBold, Dodger Blue) rises 24 px + fades.
//   • Goal text (Satoshi Medium, ink) rises 24 px + fades right after.
//   • Default composition length is 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
export const lessonGoalTimingsSchema = z
  .object({
    stripeStart: z.number().nonnegative(),
    stripeDuration: z.number().positive(),
    headingStart: z.number().nonnegative(),
    headingDuration: z.number().positive(),
    goalStart: z.number().nonnegative(),
    goalDuration: z.number().positive(),
  })
  .partial();

export const lessonGoalSchema = z.object({
  // The body text — the actual lesson goal in the author's own words.
  // Wraps to multiple lines via `text-wrap: pretty` style (replicated as
  // CSS textWrap below); aim for under 120 characters so it fits 2–3 lines.
  goal: z.string().min(1).max(160),
  // Optional override for the eyebrow heading. Defaults to "Lesson Goal".
  heading: z.string().min(1).max(40).optional(),
  timings: lessonGoalTimingsSchema.optional(),
});

export type LessonGoalProps = z.infer<typeof lessonGoalSchema>;

export const lessonGoalMeta = {
  description:
    'Single-screen lesson opener: Dodger Blue "Lesson Goal" headline with the ' +
    'goal copy below, plus a decorative stripe sweeping in from the bottom-left.',
  authoringNotes:
    'goal is the body text — write it as a clear outcome the learner can ' +
    'measure. GOOD: "Identify three risks in a project plan and propose a ' +
    'mitigation for each." BAD: "Learn about risks" (too vague). Aim for under ' +
    '120 chars so it fits 2–3 lines at 72 px. heading defaults to "Lesson Goal" ' +
    '— override only if a course uses different terminology (e.g. "Module ' +
    'Objective"). Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const STRIPE_SRC = staticFile('Template-Specific-Assets/lesson_goal_stripe.png');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_MEDIUM_SRC  = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout + design constants (lifted from the prototype's tweaked defaults) ─

const PLATINUM = '#E6ECF2';
const DODGER   = '#0496FF';
const INK      = '#0B1F33';

// Type sizes (post-tweak).
const HEAD_SIZE = 116;
const SUB_SIZE  = 72;

// Content block: left:7%, top:50% (translateY(-50%)), maxWidth:55%.
const CONTENT_LEFT_PCT  = 7;
const CONTENT_MAX_WIDTH = '55%';
const HEAD_BOTTOM_GAP   = 28; // px

// Stripe travel: starts off-canvas bottom-left, scaled 1.05.
const STRIPE_FROM_X_PCT = -60;
const STRIPE_FROM_Y_PCT = 110;
const STRIPE_FROM_SCALE = 1.05;
// Opacity reaches 1 at 15 % of the stripe-reveal animation.
const STRIPE_OPACITY_RAMP = 0.15;

// Rise-in offset for heading + goal text.
const RISE_FROM_Y = 24;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

// Defaults expressed in SECONDS. Baked from the prototype's CSS at speed=0.6,
// startDelay=0.4 s (the persisted TWEAK_DEFAULTS).
//
//   t (s)   event              duration (s)
//   0.82    stripe begins      2.33
//   1.98    heading rises in   1.42
//   2.82    goal rises in      1.42
const DEFAULT_TIMINGS = {
  stripeStart:     0.82,
  stripeDuration:  2.33,
  headingStart:    1.98,
  headingDuration: 1.42,
  goalStart:       2.82,
  goalDuration:    1.42,
} as const;

// cubic-bezier(.2, .8, .2, 1) — the prototype's primary easing.
const stripeEase = Easing.bezier(0.2, 0.8, 0.2, 1);
const riseEase   = Easing.bezier(0.2, 0.8, 0.2, 1);

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const inter   = new FontFace('Inter',   `url(${INTER_EXTRABOLD_SRC}) format('woff2')`, { weight: '800', display: 'block' });
    const satoshi = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`,   { weight: '500', display: 'block' });
    const [i, s]  = await Promise.all([inter.load(), satoshi.load()]);
    const fonts   = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(i);
    fonts.add(s);
  })();
  return fontsPromise;
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const LessonGoal: React.FC<LessonGoalProps> = ({ goal, heading, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading LessonGoal fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const STRIPE_START   = f(t.stripeStart);
  const STRIPE_END     = STRIPE_START + f(t.stripeDuration);
  const STRIPE_OP_END  = STRIPE_START + Math.round(f(t.stripeDuration) * STRIPE_OPACITY_RAMP);
  const HEAD_START     = f(t.headingStart);
  const HEAD_END       = HEAD_START + f(t.headingDuration);
  const GOAL_START     = f(t.goalStart);
  const GOAL_END       = GOAL_START + f(t.goalDuration);

  // Stripe — opacity ramps over the first 15 % of the slide; transform runs
  // for the full duration.
  const stripeOpacity = interpolate(frame, [STRIPE_START, STRIPE_OP_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const stripeProg = interpolate(frame, [STRIPE_START, STRIPE_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: stripeEase,
  });
  const stripeTx    = STRIPE_FROM_X_PCT * (1 - stripeProg);
  const stripeTy    = STRIPE_FROM_Y_PCT * (1 - stripeProg);
  const stripeScale = STRIPE_FROM_SCALE + (1 - STRIPE_FROM_SCALE) * stripeProg;

  // Heading rise + fade.
  const headProg = interpolate(frame, [HEAD_START, HEAD_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: riseEase,
  });
  const headOpacity = headProg;
  const headOffsetY = (1 - headProg) * RISE_FROM_Y;

  // Goal rise + fade.
  const goalProg = interpolate(frame, [GOAL_START, GOAL_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: riseEase,
  });
  const goalOpacity = goalProg;
  const goalOffsetY = (1 - goalProg) * RISE_FROM_Y;

  return (
    <AbsoluteFill style={{ background: PLATINUM, overflow: 'hidden' }}>
      {/* Stripe — full-canvas BG image, translate from off-canvas */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: stripeOpacity,
          transform: `translate(${stripeTx}%, ${stripeTy}%) scale(${stripeScale})`,
          transformOrigin: 'center center',
        }}
      >
        <Img
          src={STRIPE_SRC}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width:  '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>

      {/* Content block — left:7%, vertically centred, maxWidth:55% */}
      <div
        style={{
          position: 'absolute',
          left: `${CONTENT_LEFT_PCT}%`,
          top:  '50%',
          transform: 'translateY(-50%)',
          maxWidth: CONTENT_MAX_WIDTH,
          pointerEvents: 'none',
        }}
      >
        {/* Heading */}
        <h1
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 800,
            fontSize: HEAD_SIZE,
            lineHeight: 1.0,
            color: DODGER,
            letterSpacing: '-0.03em',
            margin: `0 0 ${HEAD_BOTTOM_GAP}px`,
            opacity: headOpacity,
            transform: `translateY(${headOffsetY}px)`,
          }}
        >
          {heading ?? 'Lesson Goal'}
        </h1>

        {/* Goal copy */}
        <p
          style={{
            fontFamily: "'Satoshi', 'Inter', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: SUB_SIZE,
            lineHeight: 1.15,
            color: INK,
            letterSpacing: '-0.015em',
            margin: 0,
            maxWidth: 1000,
            textWrap: 'pretty',
            opacity: goalOpacity,
            transform: `translateY(${goalOffsetY}px)`,
          }}
        >
          {goal}
        </p>
      </div>
    </AbsoluteFill>
  );
};
