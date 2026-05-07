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

// Ports the Course Summary prototype exactly:
//   • Course_Summary_Banner.png slides in from top (0.10 → 1.80s)
//   • Each Course_Summary_Pill.png (one per row, full 1920×1080 canvas)
//     rolls out from beneath the previous pill in cascade
//   • Black text overlaid at x=790, vertically centred on each pill row
//
// Asset geometry (1920 × 1080 canvas):
//   Course_Summary_Banner.png  visible at x 113–534, y 0–355
//   Course_Summary_Pill.png    visible at x 605–1785, y 116–261
//   → PILL_ASSET_TOP=116 is the top-y of the pill within the 1080px asset

// Optional per-render timing overrides. All values are in SECONDS (the
// scene runs at 30 fps and converts internally). pillStarts must contain
// at least as many entries as pills supplied (one start time per row).
// Any field omitted falls back to the corresponding DEFAULT_TIMINGS entry.
export const courseSummaryTimingsSchema = z
  .object({
    bannerStart: z.number().nonnegative(),
    bannerEnd: z.number().nonnegative(),
    pillStarts: z.array(z.number().nonnegative()).min(1).max(6),
    pillDuration: z.number().positive(),
    outroDuration: z.number().nonnegative(),
  })
  .partial();

export const courseSummarySchema = z.object({
  // 1–6 short recap strings, one per pill row.
  // Keep each under 60 characters so it fits on one line at 37px.
  pills: z.array(z.string().min(1).max(60)).min(1).max(6),
  // Optional animation timing overrides (seconds, internally converted to frames @ 30fps).
  timings: courseSummaryTimingsSchema.optional(),
});

export type CourseSummaryProps = z.infer<typeof courseSummarySchema>;

export const courseSummaryMeta = {
  description:
    'Course summary card with a blue banner (top-left) and up to 6 recap ' +
    'pills that cascade in from below. Banner slides down first; each pill ' +
    'rolls out from under the previous one.',
  authoringNotes:
    'Supply 1–6 short recap strings — strict 60-character max each, one line per pill. ' +
    'Write concise takeaway sentences or noun phrases. ' +
    'GOOD: "Pivot tables summarise large datasets instantly", "Use VLOOKUP to join tables". ' +
    'BAD: "You have learned how to use pivot tables to summarise large datasets" (too long — cut to the key fact). ' +
    'At 30 fps the last of 6 pills finishes around frame 420 (14 s); the ' +
    'default duration is 450 frames (15 s) for a comfortable hold. ' +
    'Fewer pills finish earlier — only the first N pill slots animate. ' +
    'Use at the end of a full course, not a single lesson (see lesson_summary for per-lesson recaps).',
} as const;

// ─── Asset paths ────────────────────────────────────────────────────────────

const BANNER_SRC = staticFile('images/course_summary_banner.png');
const PILL_SRC   = staticFile('images/course_summary_pill.png');
const SATOSHI_MEDIUM_URL = staticFile('fonts/Satoshi-Medium.woff2');
const INTER_BOLD_URL     = staticFile('fonts/Inter-Bold.woff2');

// ─── Layout constants (match prototype pixel-for-pixel) ──────────────────────

// Top-y of the pill artwork inside the 1920×1080 Course_Summary_Pill.png
const PILL_ASSET_TOP = 116;
// Opaque height of one pill row
const PILL_HEIGHT    = 145;
// Final resting y of the first pill (80px from canvas top = vertically centred)
const FIRST_PILL_TOP = 80;
// Vertical pitch between consecutive pill final positions
const ROW_PITCH      = 155;
// x-offset where pill label text begins (right of the icon box in the PNG)
const TEXT_LEFT      = 790;

// Precomputed final y positions for each pill slot (0-indexed)
const PILL_TOPS = Array.from({ length: 6 }, (_, i) => FIRST_PILL_TOP + i * ROW_PITCH);

// ─── Animation timeline (seconds → frames at 30 fps) ─────────────────────────
//
// Timing lifted verbatim from the prototype to reproduce the approved design.
//
//   Phase            start(s)  end(s)   description
//   Banner in        0.10      1.80     slides from translateY(-400) to 0
//   Pill 0 in        1.80      3.00     rolls out from -160 to PILL_TOPS[0]
//   Pill 1 in        4.00      5.20     rolls out from PILL_TOPS[0] to [1]
//   Pill 2 in        6.20      7.40     …
//   Pill 3 in        8.40      9.60
//   Pill 4 in        10.60     11.80
//   Pill 5 in        12.80     14.00
//   default hold     14.00     15.00    all pills visible, no motion

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  bannerStart: 0.10,
  bannerEnd: 1.80,
  pillStarts: [1.80, 4.00, 6.20, 8.40, 10.60, 12.80] as readonly number[],
  pillDuration: 1.20,
  outroDuration: 1.10,
} as const;

// Pure-layout: where the banner enters from. Not exposed as a timing knob
// because the slide direction is part of the design language.
const BANNER_FROM_Y = -400;

// y position a pill starts from: pill 0 enters from above (-160); later pills
// push out from the slot of the previous pill (so they look stacked).
const PILL_FROM_TOPS = PILL_TOPS.map((_, i) => (i === 0 ? -160 : PILL_TOPS[i - 1]!));

// ─── Easing ──────────────────────────────────────────────────────────────────

const easeOut  = Easing.out(Easing.cubic);
const easeIn   = Easing.in(Easing.cubic);

// ─── Font loading (singleton, same pattern as LessonSummary) ─────────────────

let fontsPromise: Promise<void> | null = null;

function loadBrandFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const satoshi = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_URL}) format('woff2')`, {
      weight: '500', style: 'normal', display: 'block',
    });
    const inter = new FontFace('Inter', `url(${INTER_BOLD_URL}) format('woff2')`, {
      weight: '700', style: 'normal', display: 'block',
    });
    const [loadedSatoshi, loadedInter] = await Promise.all([satoshi.load(), inter.load()]);
    const fonts = document.fonts as FontFaceSet & { add(f: FontFace): void };
    fonts.add(loadedSatoshi);
    fonts.add(loadedInter);
  })();
  return fontsPromise;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const CourseSummary: React.FC<CourseSummaryProps> = ({ pills, timings }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Merge caller-supplied timing overrides over the signed-off defaults,
  // then convert from seconds to frames once.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BANNER_START   = f(t.bannerStart);
  const BANNER_END     = f(t.bannerEnd);
  const PILL_WINDOWS   = t.pillStarts.map(s => [f(s), f(s + t.pillDuration)] as const);
  const OUTRO_DURATION = f(t.outroDuration);

  const [handle] = useState(() => delayRender('Loading CourseSummary fonts'));
  useEffect(() => {
    loadBrandFonts()
      .catch(() => { /* font failure is non-fatal; system fallback renders */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  // ── Banner ────────────────────────────────────────────────────────────────

  const bannerTy = interpolate(
    frame,
    [BANNER_START, BANNER_END],
    [BANNER_FROM_Y, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut },
  );
  const bannerOpacity = interpolate(
    frame,
    [BANNER_START, BANNER_START + f(0.8)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // ── Outro ─────────────────────────────────────────────────────────────────

  const outroStart   = Math.max(0, durationInFrames - OUTRO_DURATION);
  const outroOpacity = interpolate(
    frame,
    [outroStart, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeIn },
  );

  return (
    <AbsoluteFill
      style={{ background: '#E6ECF2', overflow: 'hidden', opacity: outroOpacity }}
    >
      {/* Pills — each is the full Course_Summary_Pill.png translated so its
          pill row lands at the target y. Earlier pills have higher z-index so
          they visually cover later ones during the cascade, matching the
          prototype's stacking order. */}
      {pills.map((label, i) => {
        const [winStart, winEnd] = PILL_WINDOWS[i]!;
        if (frame < winStart) return null;

        const fromTop = PILL_FROM_TOPS[i]!;
        const toTop   = PILL_TOPS[i]!;

        const currentTop = interpolate(
          frame,
          [winStart, winEnd],
          [fromTop, toTop],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut },
        );

        // translateY of the full asset so its pill row ends at currentTop
        const assetOffsetY = currentTop - PILL_ASSET_TOP;

        // Pill 0 on top (zIndex 20), pill 5 at bottom (zIndex 15) — matches prototype
        const zIndex = 20 - i;

        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: 0, top: 0,
              width: 1920, height: 1080,
              zIndex,
              pointerEvents: 'none',
            }}
          >
            {/* The pill artwork, offset so its pill row sits at currentTop */}
            <Img
              src={PILL_SRC}
              alt=""
              style={{
                position: 'absolute',
                left: 0,
                top: assetOffsetY,
                width: 1920,
                height: 1080,
                display: 'block',
              }}
            />

            {/* Text overlay — vertically centred on the pill at currentTop */}
            <div
              style={{
                position: 'absolute',
                left: TEXT_LEFT,
                top: currentTop,
                height: PILL_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                fontFamily: "'Satoshi', 'Inter', system-ui, sans-serif",
                fontWeight: 500,
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
      })}

      {/* Banner — slides down into top-left, above all pills (zIndex 100) */}
      <Img
        src={BANNER_SRC}
        alt=""
        style={{
          position: 'absolute',
          left: 0, top: 0,
          width: 1920, height: 1080,
          transform: `translateY(${bannerTy}px)`,
          opacity: bannerOpacity,
          zIndex: 100,
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
