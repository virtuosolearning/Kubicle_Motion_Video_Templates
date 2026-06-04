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

// Ports the Lesson Summary screen prototype:
//   • Background covers the full 1920×1080 canvas.
//   • "Lesson Summary" title fades + slides up at 0.20 s (Arial Black 62 px,
//     Dodger Blue, 22 px slide-up over 0.45 s with easeOutCubic).
//   • 1 to 5 recap pills enter at 1.00 / 2.00 / 3.00 / 4.00 / 5.00 s. Each
//     enters with the "slideUp" entry: starts 130 px below its row, slides up
//     + fades in over 0.55 s (easeOutCubic). Each pill is the full-canvas PNG
//     translated by rowIndex × 118 px so it lands at its row.
//   • Fewer than 5 pills auto-centre: the title + pill stack share one vertical
//     offset of (5 − N) × 59 px so the group stays centred where the 5-pill
//     design sits (0 px shift at 5 pills, +236 px at 1 pill).
//   • Default composition length is 300 frames (10 s @ 30 fps).
//
// Note: the original HTML supports four entry styles (slideUp, wipe, slide,
// pop) via a tweak panel. This port locks to slideUp — the persisted default —
// since the other styles aren't part of the approved design.

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
// pillStarts holds 1–5 entries (one per pill). If shorter than the recap
// count, missing pills fall back to the default 1 s/pill cadence.
export const lessonSummaryTimingsSchema = z
  .object({
    titleStart:    z.number().nonnegative(),
    titleDuration: z.number().positive(),
    pillStarts:    z.array(z.number().nonnegative()).min(1).max(5),
    pillDuration:  z.number().positive(),
  })
  .partial();

export const lessonSummarySchema = z.object({
  // 1 to 5 recap lines, each ≤32 chars (the pill's white interior is ~890 px
  // wide and the 28 px text spills past the right edge if much longer). Fewer
  // than 5 lines auto-centre vertically, title included.
  recaps: z.array(z.string().min(1).max(32)).min(1).max(5),
  // The headline is fixed to "Lesson Summary" — intentionally not authorable.
  timings: lessonSummaryTimingsSchema.optional(),
});

export type LessonSummaryProps = z.infer<typeof lessonSummarySchema>;

export const lessonSummaryMeta = {
  description:
    'Closing screen for a lesson: Dodger Blue "Lesson Summary" headline above ' +
    'a column of 1 to 5 recap pills that slide up + fade in one-by-one. Fewer ' +
    'than 5 pills auto-centre vertically so the group stays balanced.',
  authoringNotes:
    'recaps is an array of 1 to 5 short recap lines — Arial 600 white at ' +
    '28 px inside coloured pills, ≤32 chars each. Aim for parallel structure ' +
    '(all noun phrases or all verb phrases). GOOD: "Define your audience", ' +
    '"Map the user journey". BAD: "It\'s important to define your audience" ' +
    '(too long, breaks parallel). With fewer than 5 recaps the title + pills ' +
    'auto-centre as a group, so a 3-line summary sits centred rather than ' +
    'clustered at the top. The headline is always "Lesson Summary" and is not ' +
    'authorable. Default duration 300 frames ' +
    '(10 s); with 5 pills the last finishes around 5.55 s. If you push ' +
    'pillStarts later than ~9 s, lengthen the composition so the last pill ' +
    'still lands.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BG_SRC   = staticFile('Template-Specific-Assets/lesson_summary_background.png');
const PILL_SRC = staticFile('Template-Specific-Assets/lesson_summary_pill.png');

// ─── Layout constants (lifted directly from the prototype) ────────────────────

// Lesson_Summary_Pill.png natural pill position (measured from the asset).
const PILL_NATURAL_TOP    = 329;
const PILL_NATURAL_HEIGHT = 93;
const PILL_NATURAL_LEFT   = 133;
const PILL_CENTRE_Y       = PILL_NATURAL_TOP + PILL_NATURAL_HEIGHT / 2;  // 375.5

// Title positioning (relative to the pill).
const TITLE_GAP = 110;  // pixels above PILL_NATURAL_TOP
const TITLE_TOP = PILL_NATURAL_TOP - TITLE_GAP;  // 219

// Pill row layout.
const MAX_PILLS       = 5;     // the 5-pill stack is the reference layout
const PILL_SPACING    = 118;   // vertical gap between pill tops
const PILL_TEXT_LEFT  = 242;   // x where pill text starts
const PILL_TEXT_SIZE  = 28;
const TITLE_SIZE      = 62;
const TITLE_COLOUR    = '#0496FF';

// Slide-up entry distance.
const PILL_SLIDE_DISTANCE = 130;
const TITLE_SLIDE_DISTANCE = 22;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  titleStart:    0.20,
  titleDuration: 0.45,
  pillStarts:    [1.00, 2.00, 3.00, 4.00, 5.00] as readonly number[],
  pillDuration:  0.55,
} as const;

const easeOutCubic = Easing.out(Easing.cubic);

// ─── Animated Pill ───────────────────────────────────────────────────────────
// Renders the full-canvas Pill PNG translated to the row's position. Slides up
// from +slideDistance below + opacity ramp.

function AnimatedPill({
  index,
  frame,
  text,
  startFrame,
  pillDur,
  offsetY,
}: {
  index: number;
  frame: number;
  text: string;
  startFrame: number;
  pillDur: number;
  offsetY: number;   // shared group offset for auto-centring fewer-than-5 pills
}) {
  if (frame < startFrame) return null;

  const yShift = offsetY + index * PILL_SPACING;
  const raw    = interpolate(frame, [startFrame, startFrame + pillDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const eased  = easeOutCubic(raw);
  const ty     = (1 - eased) * PILL_SLIDE_DISTANCE;
  // Opacity ramps to 1 in the first 25 % of the entry (the prototype's "raw * 4" curve).
  const opacity = Math.min(1, raw * 4);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width:  1920,
        height: 1080,
        opacity,
        transform: `translateY(${yShift + ty}px)`,
        pointerEvents: 'none',
      }}
    >
      <Img
        src={PILL_SRC}
        alt=""
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block' }}
      />
      {/* Text overlay — vertically centred on the pill */}
      <div
        style={{
          position: 'absolute',
          top:  PILL_CENTRE_Y,
          left: PILL_TEXT_LEFT,
          transform: 'translateY(-50%)',
          color: '#FFFFFF',
          fontFamily: 'Arial, system-ui, sans-serif',
          fontWeight: 600,
          fontSize: PILL_TEXT_SIZE,
          letterSpacing: '0.01em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {text}
      </div>
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

// The headline is locked — it is always "Lesson Summary" and not a prop.
const TITLE_TEXT = 'Lesson Summary';

export const LessonSummary: React.FC<LessonSummaryProps> = ({ recaps, timings }) => {
  const frame = useCurrentFrame();

  // Title fade + slide-up.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const TITLE_START   = f(t.titleStart);
  const TITLE_END     = TITLE_START + f(t.titleDuration);
  const PILL_DUR      = f(t.pillDuration);

  // One start frame per recap. Use the matching pillStarts entry when present,
  // else the default 1 s/pill cadence, else a 1 s/pill fallback for indices
  // beyond the default list.
  const N           = recaps.length;
  const PILL_STARTS = recaps.map((_, i) =>
    f(t.pillStarts[i] ?? DEFAULT_TIMINGS.pillStarts[i] ?? i + 1),
  );

  // Auto-centre: shift the whole group (title + pills) down by half the height
  // freed up by each missing pill, so N<5 stays centred where 5 pills sit.
  // 0 px at 5 pills, +236 px at 1 pill.
  const GROUP_OFFSET_Y = ((MAX_PILLS - N) * PILL_SPACING) / 2;

  const titleProg    = interpolate(frame, [TITLE_START, TITLE_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const titleOpacity = titleProg;
  const titleOffsetY = (1 - titleProg) * TITLE_SLIDE_DISTANCE;

  return (
    <AbsoluteFill style={{ background: '#040d18', overflow: 'hidden' }}>
      {/* Background */}
      <Img
        src={BG_SRC}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />

      {/* Animated title */}
      <div
        style={{
          position: 'absolute',
          top:  TITLE_TOP,
          left: PILL_NATURAL_LEFT,
          opacity: titleOpacity,
          transform: `translateY(${titleOffsetY + GROUP_OFFSET_Y}px)`,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            fontFamily: 'Arial Black, Arial, system-ui, sans-serif',
            fontWeight: 900,
            fontSize: TITLE_SIZE,
            color: TITLE_COLOUR,
            letterSpacing: '-0.5px',
            whiteSpace: 'nowrap',
          }}
        >
          {TITLE_TEXT}
        </span>
      </div>

      {/* 1–5 recap pills — slide up + fade in one-by-one, auto-centred */}
      {recaps.map((text, i) => (
        <AnimatedPill
          key={i}
          index={i}
          frame={frame}
          text={text}
          startFrame={PILL_STARTS[i]!}
          pillDur={PILL_DUR}
          offsetY={GROUP_OFFSET_Y}
        />
      ))}
    </AbsoluteFill>
  );
};
