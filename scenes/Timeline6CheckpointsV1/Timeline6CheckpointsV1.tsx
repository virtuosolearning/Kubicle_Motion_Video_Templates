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

// Timeline6CheckpointsV1 — horizontal timeline with a playhead that fills
// the track and activates each checkpoint as it passes.
//   • Platinum-blue (#E6ECF2) canvas with an oxford-blue → near-black radial
//     gradient that scales up over the first ~0.85 s (matches the other
//     templates in the library).
//   • Six checkpoints evenly spaced along a horizontal track at y=540
//     (canvas centre). Above each: date + title. Below each: description.
//   • The track starts entirely grey/muted. A dodger-blue fill grows from
//     the left edge — its leading edge is the playhead. As the leading
//     edge passes a checkpoint, the circle pulses, recolors to dodger
//     blue, drops in a check icon, and its date/title/description cascade
//     in with a subtle slide + fade.
//   • Inspired by the Timeline5TilesV2 loading bar — fill grows linearly
//     left → right with easeInOutCubic.
//   • Default duration 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const timeline6CheckpointsV1CheckpointSchema = z.object({
  date:        z.string().min(1).max(14),
  title:       z.string().min(1).max(18),
  description: z.string().min(1).max(54),
});

export const timeline6CheckpointsV1TimingsSchema = z
  .object({
    bgDuration:         z.number().positive(),
    trackStart:         z.number().nonnegative(),
    trackDuration:      z.number().positive(),
    playheadStart:      z.number().nonnegative(),
    // Stepped pointer motion: pause at every milestone, then ease across
    // to the next. Total pointer time = 6 pauses + 5 moves.
    moveDuration:       z.number().positive(),
    pauseDuration:      z.number().positive(),
    activationDuration: z.number().positive(),
  })
  .partial();

export const timeline6CheckpointsV1Schema = z.object({
  checkpoints: z.array(timeline6CheckpointsV1CheckpointSchema).length(6),
  timings:     timeline6CheckpointsV1TimingsSchema.optional(),
});

export type Timeline6CheckpointsV1Props = z.infer<typeof timeline6CheckpointsV1Schema>;

export const timeline6CheckpointsV1Meta = {
  description:
    'Horizontal timeline with 6 checkpoints. A playhead fills the track ' +
    'left → right; each checkpoint pulses + recolors and its date/title/' +
    'description cascade in as the playhead arrives. Use for project ' +
    'timelines, launch plans, roadmaps.',
  authoringNotes:
    'Supply exactly 6 checkpoints in chronological order. date ≤14 chars, ' +
    'title ≤18 chars (Satoshi Bold 36 px), description ≤54 chars (wraps to ' +
    '2 lines, Satoshi Medium 22 px). Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BLACK_SRC  = staticFile('fonts/Satoshi-Black.woff2');
const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (1920×1080 canvas, action-safe-friendly) ───────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Oxford-blue rounded panel — sized to wrap the timeline content snugly,
// centred vertically on the canvas. Tight wrapper around the date/title +
// track + 2-line description, with ~40 px of breathing room top + bottom.
const PANEL_LEFT   = 60;
const PANEL_TOP    = 360;
const PANEL_RIGHT  = CANVAS_W - 60;     // 1860
const PANEL_BOT    = 720;
const PANEL_W      = PANEL_RIGHT - PANEL_LEFT;
const PANEL_H      = PANEL_BOT - PANEL_TOP;   // 360 — centred at canvas mid (y=540)
const PANEL_RADIUS = 28;

const NUM_CHECKPOINTS = 6;

// Track horizontal extent + position. Pulled inward from the panel edges
// (panel is 60–1860) so per-checkpoint description text doesn't bleed
// outside the panel.
const TRACK_LEFT      = 220;
const TRACK_RIGHT     = 1700;
const TRACK_Y         = 540;     // canvas centre
const TRACK_THICKNESS = 8;

const CHECKPOINT_R    = 38;
const CHECKPOINT_SPACING = (TRACK_RIGHT - TRACK_LEFT) / (NUM_CHECKPOINTS - 1); // 320

function checkpointX(i: number): number {
  return TRACK_LEFT + i * CHECKPOINT_SPACING;
}

// Text positions (relative to each checkpoint's centre x). Tightened so
// everything fits inside the shorter ~360 px panel.
const DATE_Y         = 400;
const TITLE_Y        = 445;
const DESC_Y         = 620;       // body top — wraps below
const TEXT_MAX_WIDTH = 280;

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

// Oxford-blue panel gradient — matches GroupChatV1's chat window so the
// timeline reads as a contained "card" sitting on the platinum base.
const PANEL_BG =
  'linear-gradient(180deg, #0e2741 0%, #08172a 100%)';
const PANEL_BORDER = '1px solid rgba(255,255,255,0.08)';
const PANEL_SHADOW = '0 24px 60px rgba(0,0,0,0.45)';

// Track / checkpoint colours — no outer glows, just clean fills + rings.
const TRACK_INACTIVE = 'rgba(255,255,255,0.15)';    // grey track on dark panel
const TRACK_ACTIVE   = '#1A9CFE';                   // dodger blue fill
const CHECKPOINT_INACTIVE_FILL   = '#1e3a55';       // muted oxford-tinted
const CHECKPOINT_INACTIVE_STROKE = 'rgba(255,255,255,0.20)';
// Active circle uses a soft top-light dodger gradient — lighter at the top
// (toward the viewer), deepening to a richer dodger at the bottom.
const CHECKPOINT_ACTIVE_FILL =
  'linear-gradient(180deg, #5EBBFF 0%, #1A9CFE 55%, #0A78D6 100%)';

const TEXT_WHITE       = '#FFFFFF';
const TEXT_WHITE_DIM   = 'rgba(255,255,255,0.55)';
const TEXT_DATE_BLUE   = '#7CC7FF';   // light dodger for date (when active)

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
// Window begins ~32 px BEFORE the checkpoint and completes EXACTLY at the
// checkpoint centre. After the playhead passes, the checkpoint stays fully
// active. This ensures the final checkpoint reaches full activation even
// though the playhead stops at its position.
function activationProgressFor(playheadX: number, i: number): number {
  const cx = checkpointX(i);
  const RAMP = 32;
  return clamp01((playheadX - (cx - RAMP)) / RAMP);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Track({
  frame, startF, durF, playheadX,
}: { frame: number; startF: number; durF: number; playheadX: number }) {
  const local = frame - startF;
  const op = interpolate(local, [0, durF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  if (local < 0) return null;

  return (
    <>
      {/* Inactive (background) track — full length, faint grey. */}
      <div
        style={{
          position: 'absolute',
          left:   TRACK_LEFT,
          top:    TRACK_Y - TRACK_THICKNESS / 2,
          width:  TRACK_RIGHT - TRACK_LEFT,
          height: TRACK_THICKNESS,
          borderRadius: TRACK_THICKNESS / 2,
          background: TRACK_INACTIVE,
          opacity: op,
        }}
      />
      {/* Active fill — grows behind the playhead. */}
      <div
        style={{
          position: 'absolute',
          left:   TRACK_LEFT,
          top:    TRACK_Y - TRACK_THICKNESS / 2,
          width:  Math.max(0, playheadX - TRACK_LEFT),
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

function Playhead({
  x, visible,
}: { x: number; visible: boolean }) {
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
  i, frame, trackStartF, trackDurF, activationProg,
}: {
  i: number;
  frame: number;
  trackStartF: number;
  trackDurF: number;
  activationProg: number;
}) {
  const cx = checkpointX(i);
  const trackLocal = frame - trackStartF;
  // Initial appearance — circle scales in with the track.
  const enterScale = interpolate(trackLocal, [0, trackDurF], [0.7, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const enterOp = interpolate(trackLocal, [0, trackDurF * 0.7], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  if (trackLocal < 0) return null;

  // Pulse — peaks at 50 % of activation, settles to 1.0 at 100 %.
  // sin curve → 0 at endpoints, 1 at midpoint.
  const pulseScale = 1 + 0.18 * Math.sin(activationProg * Math.PI);

  // Color blend: gray → dodger as activationProg goes 0 → 1.
  // We render two circles stacked: inactive base + active overlay with opacity = activationProg.
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
      {/* Active overlay — dodger-blue vertical gradient, opacity tracks
          activation. No white ring, no outer glow. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: CHECKPOINT_ACTIVE_FILL,
          opacity: activationProg,
        }}
      />
      {/* Check icon — fades in with activation */}
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
  i, checkpoint, frame, activationStartF, activationDurF,
}: {
  i: number;
  checkpoint: Timeline6CheckpointsV1Props['checkpoints'][number];
  frame: number;
  activationStartF: number;
  activationDurF: number;
}) {
  const cx = checkpointX(i);

  // Cascade: date → title → description, each with a small offset.
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

  // Don't render until activation starts.
  if (dateLocal < 0) return null;

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
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {checkpoint.date}
      </div>

      {/* Title — bold white */}
      <div
        style={{
          position: 'absolute',
          left: cx,
          top:  TITLE_Y,
          transform: `translateX(-50%) translateY(${titleDy}px)`,
          opacity: titleOp,
          color: TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 900,
          fontSize: 36,
          letterSpacing: '-0.015em',
          lineHeight: 1.05,
          textAlign: 'center',
          maxWidth: TEXT_MAX_WIDTH,
          whiteSpace: 'nowrap',
          textShadow: '0 1px 4px rgba(0,40,80,0.30)',
        }}
      >
        {checkpoint.title}
      </div>

      {/* Description — medium dim */}
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
          textAlign: 'center',
          maxWidth: TEXT_MAX_WIDTH,
        }}
      >
        {checkpoint.description}
      </div>
    </>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const Timeline6CheckpointsV1: React.FC<Timeline6CheckpointsV1Props> = ({
  checkpoints, timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Timeline6CheckpointsV1 fonts'));
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

  // BG scale-up
  const bgScale = interpolate(frame, [0, BG_DUR], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOutCubic,
  });

  // ─── Stepped pointer motion ───────────────────────────────────────────────
  // Sequence: pause @ milestone 0 → move 0→1 → pause @ 1 → move 1→2 → ... →
  // pause @ 5. Each MOVE eases (slow in/slow out) so the pointer settles
  // into each milestone. Total time = NUM*PAUSE_DUR + (NUM-1)*MOVE_DUR.
  function computePlayheadXAt(timeFrames: number): number {
    if (timeFrames < PLAYHEAD_START) return checkpointX(0);
    let rem = timeFrames - PLAYHEAD_START;
    for (let i = 0; i < NUM_CHECKPOINTS; i++) {
      // Pause at milestone i
      if (rem < PAUSE_DUR) return checkpointX(i);
      rem -= PAUSE_DUR;
      // Last milestone has no outgoing move
      if (i === NUM_CHECKPOINTS - 1) return checkpointX(i);
      // Move from milestone i to i+1
      if (rem < MOVE_DUR) {
        const local = rem / MOVE_DUR;
        const eased = easeInOutCubic(local);
        return checkpointX(i) + eased * (checkpointX(i + 1) - checkpointX(i));
      }
      rem -= MOVE_DUR;
    }
    return checkpointX(NUM_CHECKPOINTS - 1);
  }
  const playheadX = computePlayheadXAt(frame);

  // Total sequence end frame (last pause finishes here). Used to fade the
  // pointer marker out after the timeline has fully revealed.
  const sequenceEndFrame =
    PLAYHEAD_START + NUM_CHECKPOINTS * PAUSE_DUR + (NUM_CHECKPOINTS - 1) * MOVE_DUR;
  const playheadVisible = frame >= PLAYHEAD_START && frame < sequenceEndFrame;

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {/* Oxford-blue rounded panel — contains the whole timeline. Scales
          up from the canvas centre, same staging idea as TreeDiagram4x2V1
          but bounded inside a rounded card (à la GroupChatV1's chat
          window). */}
      <div
        style={{
          position: 'absolute',
          left:   PANEL_LEFT,
          top:    PANEL_TOP,
          width:  PANEL_W,
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
      />

      {/* Playhead marker — rendered BEHIND the checkpoints so the white
          dot disappears under each dodger-blue circle as it passes. */}
      <Playhead x={playheadX} visible={playheadVisible} />

      {/* Checkpoints — circles on the track that activate as the playhead
          crosses each one. */}
      {checkpoints.map((_, i) => (
        <Checkpoint
          key={`chk-${i}`}
          i={i}
          frame={frame}
          trackStartF={TRACK_START}
          trackDurF={TRACK_DUR}
          activationProg={activationProgressFor(playheadX, i)}
        />
      ))}

      {/* Per-checkpoint text content — date, title, description.
          activationStartF is the moment the pointer arrives at this
          milestone (start of its pause), so the cascade matches the dot
          lighting up. */}
      {checkpoints.map((checkpoint, i) => {
        // Arrival = i pauses already done + i moves already done.
        // (Milestone 0 arrives at PLAYHEAD_START with no prior pauses/moves.)
        const arrivalFrame = PLAYHEAD_START + i * (PAUSE_DUR + MOVE_DUR);
        return (
          <CheckpointContent
            key={`cnt-${i}`}
            i={i}
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

export const timeline6CheckpointsV1DefaultProps: Timeline6CheckpointsV1Props = {
  checkpoints: [
    { date: 'Jan 12', title: 'Research',  description: 'Identify model & user needs' },
    { date: 'Feb 28', title: 'Prototype', description: 'Build the first model + UX' },
    { date: 'Apr 15', title: 'Eval',      description: 'Run eval suite + red teaming' },
    { date: 'Jun 3',  title: 'Beta',      description: 'Release to early users' },
    { date: 'Aug 21', title: 'Launch',    description: 'General availability rollout' },
    { date: 'Oct 10', title: 'Scale',     description: 'Optimise cost and reliability' },
  ],
};
