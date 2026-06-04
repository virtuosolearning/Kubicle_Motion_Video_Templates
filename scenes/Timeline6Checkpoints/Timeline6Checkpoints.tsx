import React, { useEffect, useState } from 'react';
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

// Timeline6Checkpoints — horizontal timeline with a playhead that fills
// the track and activates each checkpoint as it passes.
//   • Platinum-blue (#E6ECF2) canvas with an oxford-blue panel that scales up
//     over the first ~0.85 s (matches the other templates in the library).
//   • 1 to 6 checkpoints evenly spaced along a horizontal track at y=540
//     (canvas centre), at a FIXED spacing. With fewer than 6 the track + the
//     oxford-blue panel shrink and re-centre so there's no empty space — the
//     panel always wraps the content snugly.
//   • Above each checkpoint: date + title. Below: description. All three wrap
//     to stay inside the panel (long titles/dates go to a second line rather
//     than crossing onto the platinum background).
//   • The track starts grey/muted. A dodger-blue fill grows from the left edge;
//     its leading edge is the playhead. As the leading edge passes a
//     checkpoint, the circle pulses, recolors, drops in a check icon, and its
//     date/title/description cascade in.
//   • Default duration 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const timeline6CheckpointsCheckpointSchema = z.object({
  date:        z.string().min(1).max(14),
  title:       z.string().min(1).max(18),
  description: z.string().min(1).max(54),
});

export const timeline6CheckpointsTimingsSchema = z
  .object({
    bgDuration:         z.number().positive(),
    trackStart:         z.number().nonnegative(),
    trackDuration:      z.number().positive(),
    playheadStart:      z.number().nonnegative(),
    // Stepped pointer motion: pause at every milestone, then ease across
    // to the next. Total pointer time = N pauses + (N-1) moves.
    moveDuration:       z.number().positive(),
    pauseDuration:      z.number().positive(),
    activationDuration: z.number().positive(),
  })
  .partial();

export const timeline6CheckpointsSchema = z.object({
  // 1 to 6 checkpoints in chronological order. The panel + track shrink to fit
  // fewer than 6, staying centred with no empty space.
  checkpoints: z.array(timeline6CheckpointsCheckpointSchema).min(1).max(6),
  timings:     timeline6CheckpointsTimingsSchema.optional(),
});

export type Timeline6CheckpointsProps = z.infer<typeof timeline6CheckpointsSchema>;

export const timeline6CheckpointsMeta = {
  description:
    'Horizontal timeline with 1 to 6 checkpoints. A playhead fills the track ' +
    'left → right; each checkpoint pulses + recolors and its date/title/' +
    'description cascade in as the playhead arrives. Fewer than 6 checkpoints ' +
    'shrink the oxford-blue panel to fit (no empty space). Use for project ' +
    'timelines, launch plans, roadmaps.',
  authoringNotes:
    'Supply 1 to 6 checkpoints in chronological order; the panel + track shrink ' +
    'and re-centre to fit. date is the marker copy above each checkpoint ' +
    '(≤14 chars — "Q1 2025", "Day 3", "Apr 2026"). title is the bold checkpoint ' +
    'name (≤18 chars, Satoshi Bold 36 px). description is one supporting line ' +
    'below (≤54 chars). All three wrap to a second line if long, staying inside ' +
    'the panel — but keep them short for the cleanest look. Aim for parallel ' +
    'structure. GOOD title: "Kickoff", "Beta launch", "GA release". BAD title: ' +
    '"Project kickoff meeting with stakeholders" (too long — split detail into ' +
    'the description line). Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BLACK_SRC  = staticFile('fonts/Satoshi-Black.woff2');
const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (1920×1080 canvas) ─────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Oxford-blue rounded panel — vertical extent is fixed (centred on the canvas);
// the horizontal extent is derived per-render from the checkpoint count so it
// wraps the content snugly with no empty space.
const PANEL_TOP    = 360;
const PANEL_BOT    = 720;
const PANEL_H      = PANEL_BOT - PANEL_TOP;   // 360 — centred at canvas mid (y=540)
const PANEL_RADIUS = 28;

const MAX_CHECKPOINTS = 6;

// Fixed spacing between checkpoints (= the original 6-checkpoint spacing, so a
// full 6-up timeline reproduces the previous layout exactly). The panel adds
// PANEL_SIDE_MARGIN beyond the outer checkpoints on each side.
const CHECKPOINT_SPACING = 296;   // (1700 − 220) / (6 − 1)
const PANEL_SIDE_MARGIN  = 160;   // panel edge sits this far beyond outer checkpoints

const TRACK_Y         = 540;     // canvas centre
const TRACK_THICKNESS = 8;
const CHECKPOINT_R    = 38;

// Text positions (relative to each checkpoint's centre x).
const DATE_Y          = 376;                       // date top
const TITLE_BOTTOM_Y  = TRACK_Y - CHECKPOINT_R - 8; // 494 — title bottom sits just above the circle
const DESC_Y          = 620;                       // description top — wraps below
const TEXT_MAX_WIDTH  = 280;

// Per-render horizontal layout, derived from the checkpoint count.
function layoutFor(n: number): {
  trackLeft: number; trackRight: number;
  panelLeft: number; panelWidth: number;
} {
  const trackWidth = (n - 1) * CHECKPOINT_SPACING;
  const trackLeft  = CANVAS_W / 2 - trackWidth / 2;
  const trackRight = trackLeft + trackWidth;
  const panelLeft  = trackLeft - PANEL_SIDE_MARGIN;
  const panelRight = trackRight + PANEL_SIDE_MARGIN;
  return { trackLeft, trackRight, panelLeft, panelWidth: panelRight - panelLeft };
}

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  bgDuration:         0.85,
  trackStart:         0.70,
  trackDuration:      0.65,
  playheadStart:      1.30,
  moveDuration:       0.65,   // ease across to next milestone
  pauseDuration:      0.60,   // dwell at each milestone (incl. start + end)
  activationDuration: 0.55,   // content cascade window per milestone
} as const;

const easeOutCubic         = Easing.out(Easing.cubic);
const easeInOutCubic       = Easing.inOut(Easing.cubic);
const easeOutBackOvershoot = Easing.out(Easing.back(1.35));

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG_COLOR = '#E6ECF2';

const PANEL_BG =
  'linear-gradient(180deg, #0e2741 0%, #08172a 100%)';
const PANEL_BORDER = '1px solid rgba(255,255,255,0.08)';
const PANEL_SHADOW = '0 24px 60px rgba(0,0,0,0.45)';

const TRACK_INACTIVE = 'rgba(255,255,255,0.15)';
const TRACK_ACTIVE   = '#1A9CFE';
const CHECKPOINT_INACTIVE_FILL   = '#1e3a55';
const CHECKPOINT_INACTIVE_STROKE = 'rgba(255,255,255,0.20)';
const CHECKPOINT_ACTIVE_FILL =
  'linear-gradient(180deg, #5EBBFF 0%, #1A9CFE 55%, #0A78D6 100%)';

const TEXT_WHITE       = '#FFFFFF';
const TEXT_DATE_BLUE   = '#7CC7FF';

// ─── Font loading ────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const black  = new FontFace('Satoshi', `url(${SATOSHI_BLACK_SRC}) format('woff2')`,  { weight: '900', display: 'block' });
    const bold   = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,   { weight: '700', display: 'block' });
    const medium = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`, { weight: '500', display: 'block' });
    const [k, b, m] = await Promise.all([black.load(), bold.load(), medium.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(k);
    fonts.add(b);
    fonts.add(m);
  })();
  return fontsPromise;
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// Per-checkpoint "activation progress" 0→1 based on the playhead's current x.
// Window begins ~32 px BEFORE the checkpoint and completes EXACTLY at its
// centre, then stays active so the final checkpoint reaches full activation.
function activationProgressForX(playheadX: number, cx: number): number {
  const RAMP = 32;
  return clamp01((playheadX - (cx - RAMP)) / RAMP);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Track({
  frame, startF, durF, playheadX, trackLeft, trackRight,
}: {
  frame: number; startF: number; durF: number;
  playheadX: number; trackLeft: number; trackRight: number;
}) {
  const local = frame - startF;
  const op = interpolate(local, [0, durF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  if (local < 0) return null;

  return (
    <>
      {/* Inactive (background) track */}
      <div
        style={{
          position: 'absolute',
          left:   trackLeft,
          top:    TRACK_Y - TRACK_THICKNESS / 2,
          width:  Math.max(0, trackRight - trackLeft),
          height: TRACK_THICKNESS,
          borderRadius: TRACK_THICKNESS / 2,
          background: TRACK_INACTIVE,
          opacity: op,
        }}
      />
      {/* Active fill */}
      <div
        style={{
          position: 'absolute',
          left:   trackLeft,
          top:    TRACK_Y - TRACK_THICKNESS / 2,
          width:  Math.max(0, playheadX - trackLeft),
          height: TRACK_THICKNESS,
          borderRadius: TRACK_THICKNESS / 2,
          background: TRACK_ACTIVE,
          opacity: op,
          boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.30)',
        }}
      />
    </>
  );
}

function Playhead({ x, visible }: { x: number; visible: boolean }) {
  if (!visible) return null;
  const SIZE = 18;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - SIZE / 2,
        top:  TRACK_Y - SIZE / 2,
        width:  SIZE,
        height: SIZE,
        borderRadius: '50%',
        background: '#FFFFFF',
      }}
    />
  );
}

function Checkpoint({
  cx, frame, trackStartF, trackDurF, activationProg,
}: {
  cx: number;
  frame: number;
  trackStartF: number;
  trackDurF: number;
  activationProg: number;
}) {
  const trackLocal = frame - trackStartF;
  const enterScale = interpolate(trackLocal, [0, trackDurF], [0.7, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const enterOp = interpolate(trackLocal, [0, trackDurF * 0.7], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  if (trackLocal < 0) return null;

  const pulseScale = 1 + 0.18 * Math.sin(activationProg * Math.PI);

  return (
    <div
      style={{
        position: 'absolute',
        left: cx - CHECKPOINT_R,
        top:  TRACK_Y - CHECKPOINT_R,
        width:  CHECKPOINT_R * 2,
        height: CHECKPOINT_R * 2,
        transform: `scale(${enterScale * pulseScale})`,
        transformOrigin: 'center center',
        opacity: enterOp,
      }}
    >
      {/* Inactive base circle */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: CHECKPOINT_INACTIVE_FILL,
          boxShadow: `inset 0 0 0 2px ${CHECKPOINT_INACTIVE_STROKE}`,
        }}
      />
      {/* Active overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: CHECKPOINT_ACTIVE_FILL,
          opacity: activationProg,
        }}
      />
      {/* Check icon */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: activationProg,
        }}
      >
        <Img
          src={staticFile('icons/check.svg')}
          alt=""
          style={{ width: CHECKPOINT_R * 1.05, height: CHECKPOINT_R * 1.05, display: 'block' }}
        />
      </div>
    </div>
  );
}

function CheckpointContent({
  cx, checkpoint, frame, activationStartF, activationDurF,
}: {
  cx: number;
  checkpoint: Timeline6CheckpointsProps['checkpoints'][number];
  frame: number;
  activationStartF: number;
  activationDurF: number;
}) {
  const dateLocal  = frame - activationStartF;
  const titleLocal = frame - (activationStartF + Math.round(activationDurF * 0.20));
  const descLocal  = frame - (activationStartF + Math.round(activationDurF * 0.45));

  const dateOp = interpolate(dateLocal, [0, activationDurF * 0.8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const dateDy = interpolate(dateLocal, [0, activationDurF], [-10, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  const titleOp = interpolate(titleLocal, [0, activationDurF * 0.8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const titleDy = interpolate(titleLocal, [0, activationDurF], [-12, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  const descOp = interpolate(descLocal, [0, activationDurF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const descDy = interpolate(descLocal, [0, activationDurF], [10, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  if (dateLocal < 0) return null;

  // Shared wrapping rules — text is capped at the column width and breaks to a
  // second line (and breaks long words) so it never spills onto the platinum bg.
  const wrap = {
    maxWidth: TEXT_MAX_WIDTH,
    whiteSpace: 'normal' as const,
    overflowWrap: 'break-word' as const,
    wordBreak: 'break-word' as const,
    textAlign: 'center' as const,
  };

  return (
    <>
      {/* Date — light dodger blue accent */}
      <div
        style={{
          position: 'absolute',
          left: cx,
          top:  DATE_Y,
          transform: `translateX(-50%) translateY(${dateDy}px)`,
          opacity: dateOp,
          color: TEXT_DATE_BLUE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 26,
          letterSpacing: '-0.005em',
          lineHeight: 1.1,
          ...wrap,
        }}
      >
        {checkpoint.date}
      </div>

      {/* Title — bold white. Bottom-anchored just above the circle so a long
          title wraps UPWARD (toward the date) instead of down into the circle.
          Capped at 2 lines. */}
      <div
        style={{
          position: 'absolute',
          left: cx,
          bottom: CANVAS_H - TITLE_BOTTOM_Y,
          transform: `translateX(-50%) translateY(${titleDy}px)`,
          opacity: titleOp,
          color: TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 900,
          fontSize: 36,
          letterSpacing: '-0.015em',
          lineHeight: 1.08,
          textShadow: '0 1px 4px rgba(0,40,80,0.30)',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          overflow: 'hidden',
          ...wrap,
        }}
      >
        {checkpoint.title}
      </div>

      {/* Description — medium dim, wraps below */}
      <div
        style={{
          position: 'absolute',
          left: cx,
          top:  DESC_Y,
          transform: `translateX(-50%) translateY(${descDy}px)`,
          opacity: descOp,
          color: 'rgba(255,255,255,0.78)',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500,
          fontSize: 22,
          letterSpacing: '-0.003em',
          lineHeight: 1.35,
          ...wrap,
        }}
      >
        {checkpoint.description}
      </div>
    </>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const Timeline6Checkpoints: React.FC<Timeline6CheckpointsProps> = ({
  checkpoints, timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Timeline6Checkpoints fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BG_DUR         = f(t.bgDuration);
  const TRACK_START    = f(t.trackStart);
  const TRACK_DUR      = f(t.trackDuration);
  const PLAYHEAD_START = f(t.playheadStart);
  const MOVE_DUR       = f(t.moveDuration);
  const PAUSE_DUR      = f(t.pauseDuration);
  const ACTIVATION_DUR = f(t.activationDuration);

  // ─── Layout derived from the checkpoint count (panel/track shrink to fit) ──
  const N = checkpoints.length;
  const { trackLeft, trackRight, panelLeft, panelWidth } = layoutFor(N);
  const cxs = checkpoints.map((_, i) => trackLeft + i * CHECKPOINT_SPACING);

  // BG scale-up
  const bgScale = interpolate(frame, [0, BG_DUR], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOutCubic,
  });

  // ─── Stepped pointer motion ───────────────────────────────────────────────
  // pause @ 0 → move 0→1 → pause @ 1 → … → pause @ N-1.
  function computePlayheadXAt(timeFrames: number): number {
    if (timeFrames < PLAYHEAD_START) return cxs[0]!;
    let rem = timeFrames - PLAYHEAD_START;
    for (let i = 0; i < N; i++) {
      if (rem < PAUSE_DUR) return cxs[i]!;
      rem -= PAUSE_DUR;
      if (i === N - 1) return cxs[i]!;
      if (rem < MOVE_DUR) {
        const eased = easeInOutCubic(rem / MOVE_DUR);
        return cxs[i]! + eased * (cxs[i + 1]! - cxs[i]!);
      }
      rem -= MOVE_DUR;
    }
    return cxs[N - 1]!;
  }
  const playheadX = computePlayheadXAt(frame);

  const sequenceEndFrame =
    PLAYHEAD_START + N * PAUSE_DUR + (N - 1) * MOVE_DUR;
  const playheadVisible = frame >= PLAYHEAD_START && frame < sequenceEndFrame;

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {/* Oxford-blue rounded panel — width wraps the content snugly. */}
      <div
        style={{
          position: 'absolute',
          left:   panelLeft,
          top:    PANEL_TOP,
          width:  panelWidth,
          height: PANEL_H,
          borderRadius: PANEL_RADIUS,
          background: PANEL_BG,
          border:     PANEL_BORDER,
          boxShadow:  PANEL_SHADOW,
          transform: `scale(${bgScale})`,
          transformOrigin: 'center center',
        }}
      />

      {/* Track + fill */}
      <Track
        frame={frame}
        startF={TRACK_START}
        durF={TRACK_DUR}
        playheadX={playheadX}
        trackLeft={trackLeft}
        trackRight={trackRight}
      />

      {/* Playhead marker — behind the checkpoints */}
      <Playhead x={playheadX} visible={playheadVisible} />

      {/* Checkpoints */}
      {checkpoints.map((_, i) => (
        <Checkpoint
          key={`chk-${i}`}
          cx={cxs[i]!}
          frame={frame}
          trackStartF={TRACK_START}
          trackDurF={TRACK_DUR}
          activationProg={activationProgressForX(playheadX, cxs[i]!)}
        />
      ))}

      {/* Per-checkpoint text content */}
      {checkpoints.map((checkpoint, i) => {
        const arrivalFrame = PLAYHEAD_START + i * (PAUSE_DUR + MOVE_DUR);
        return (
          <CheckpointContent
            key={`cnt-${i}`}
            cx={cxs[i]!}
            checkpoint={checkpoint}
            frame={frame}
            activationStartF={arrivalFrame}
            activationDurF={ACTIVATION_DUR}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const timeline6CheckpointsDefaultProps: Timeline6CheckpointsProps = {
  checkpoints: [
    { date: 'Jan 12', title: 'Research',  description: 'Identify model & user needs' },
    { date: 'Feb 28', title: 'Prototype', description: 'Build the first model + UX' },
    { date: 'Apr 15', title: 'Eval',      description: 'Run eval suite + red teaming' },
    { date: 'Jun 3',  title: 'Beta',      description: 'Release to early users' },
    { date: 'Aug 21', title: 'Launch',    description: 'General availability rollout' },
    { date: 'Oct 10', title: 'Scale',     description: 'Optimise cost and reliability' },
  ],
};
