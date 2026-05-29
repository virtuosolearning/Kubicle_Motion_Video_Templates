import { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Easing,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { z } from 'zod';

// Carousel7PillsHorizontalV1 — the "Horizontal Carousel Pan" template.
//
//   • Phase 1 (0.00–0.60 s): a platinum-blue full-screen panel slides off to
//     the LEFT, revealing the deep-oxford-blue world with pill 1 centred.
//   • Phase 2 (0.60–13.50 s): the world (a wide canvas holding all 7 pills)
//     translates right → left in 7 dwells + 6 pans. Each dwell parks the
//     camera on a pill while its stamp bobs and label fades in. Each pan
//     eases the world to the next pill's centre.
//   • Phase 3 (13.50–15.00 s): a platinum-blue panel slides in from the
//     RIGHT, masking the world out.
//
// All visuals are CSS / inline SVG — no PNG dependencies.
// Default duration 450 frames (15 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const carousel7PillsHorizontalV1PillSchema = z.object({
  // Pill caption — Satoshi Bold white, one line. ≤22 chars keeps the stadium
  // pill at its default width.
  label: z.string().min(1).max(22),
});

export const carousel7PillsHorizontalV1TimingsSchema = z
  .object({
    introDuration:    z.number().positive(),   // platinum panel slide-out (s)
    pillDwell:        z.number().positive(),   // hold on each pill (s)
    panTransition:    z.number().positive(),   // world pan per step (s)
    textFadeDuration: z.number().positive(),   // label fade-in window (s)
    stampRaise:       z.number().positive(),   // stamp moves from rest → raised (s)
    stampHold:        z.number().positive(),   // stamp held at raised position (s)
    stampLower:       z.number().positive(),   // stamp moves raised → rest (s)
    outroDuration:    z.number().positive(),   // platinum panel slide-in (s)
  })
  .partial();

export const carousel7PillsHorizontalV1Schema = z.object({
  // 1 to 7 pills. The camera pan / dwell math sizes itself to the pill count
  // (computeCameraIndex uses pills.length), so fewer pills just makes a shorter
  // conveyor — a single pill simply dwells with no pans.
  pills:   z.array(carousel7PillsHorizontalV1PillSchema).min(1).max(7),
  timings: carousel7PillsHorizontalV1TimingsSchema.optional(),
});

export type Carousel7PillsHorizontalV1Props = z.infer<
  typeof carousel7PillsHorizontalV1Schema
>;

export const carousel7PillsHorizontalV1Meta = {
  description:
    'A "horizontal conveyor": camera pans right→left across a wide oxford-blue ' +
    'canvas, stopping on each of 7 stadium-shaped pills. Each stop bobs a small ' +
    'STEP-N stamp above the pill and fades in the pill\'s white label. ' +
    'Platinum-blue panels frame the intro (exits left) and outro (enters right). ' +
    'Use for multi-step workflows, video module breakdowns, or roadmap timelines.',
  authoringNotes:
    'Supply 1 to 7 pills — the conveyor sizes to the count, so fewer pills just ' +
    'makes a shorter sweep (a single pill dwells with no pans). Labels ≤22 chars ' +
    'each (one line of Satoshi Bold ~64 px) — keep them short or summarise, as ' +
    'the label is clipped to the pill and will not spill past the end-cap. Use ' +
    'parallel phrasing — short noun phrases or step titles. ' +
    'Default duration 450 frames (15 s @ 30 fps); the camera dwells ~0.65 s on ' +
    'each pill and pans ~1.20 s between them. No icons inside the pills — each ' +
    'pill is preceded by a circular play-button signifier.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const CANVAS_CX = CANVAS_W / 2;
const CANVAS_CY = CANVAS_H / 2;

// Pill geometry — stadium (fully rounded ends). The play circle lives INSIDE
// the pill on the left; the pill's "shell" outline is the focal frame so it
// gets a thicker border.
const PILL_W = 1280;
const PILL_H = 180;
const PILL_RADIUS = PILL_H / 2;
const SHELL_BORDER_PX = 4;              // pill + stamp share the same outline weight

// Play-button circle — sits INSIDE the pill on the LEFT.
const PLAY_DIAM = 124;
const PLAY_INSET_LEFT = 28;             // gap between pill's inner edge and circle

// Stamp shell — large outlined rectangle directly below the pill. Same width
// as the pill; bobs up to "stamp" the pill on arrival and drops back to its
// rest position before the camera pans on (factory-conveyor stamper feel).
const STAMP_W = PILL_W;
const STAMP_H = 110;
const STAMP_RADIUS = 18;
const STAMP_REST_GAP   = 56;            // distance from pill bottom to stamp top at rest
const STAMP_RAISED_GAP = 3;             // distance when fully "stamped" against the pill
const STAMP_TRAVEL = STAMP_REST_GAP - STAMP_RAISED_GAP;

// World-space pitch between consecutive pill centres. Bumped a little wider
// to keep one (now-wider) pill cleanly framed in the 1920-px viewport.
const PILL_PITCH = 1700;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  introDuration:    0.60,
  // Dwell is now sized to cover the full stamp cycle (raise + hold + lower)
  // plus a brief rest before the camera pans on.
  pillDwell:        0.85,
  panTransition:    1.15,
  textFadeDuration: 0.25,
  stampRaise:       0.12,
  stampHold:        0.34,
  stampLower:       0.18,
  outroDuration:    1.50,
} as const;

const easeInOutCubic = Easing.inOut(Easing.cubic);
const easeOutCubic   = Easing.out(Easing.cubic);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Palette ─────────────────────────────────────────────────────────────────

const OXFORD_GRADIENT =
  'linear-gradient(180deg, #052438 0%, #042033 50%, #03192A 100%)';
const PLATINUM_BLUE = '#E6ECF2';
const DODGER_BLUE   = '#0496FF';
const WHITE         = '#FFFFFF';

// ─── Font loading ────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold = new FontFace(
      'Satoshi',
      `url(${SATOSHI_BOLD_SRC}) format('woff2')`,
      { weight: '700', display: 'block' },
    );
    const b = await bold.load();
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(b);
  })();
  return fontsPromise;
}

// ─── Continuous camera index (0…6) across phase 2 ────────────────────────────
//
// Phase 2 alternates DWELL (flat) → PAN (eased) → DWELL → PAN … ending on a
// DWELL on pill 7. Returns a float in [0, 6] where integer values mean
// "parked on pill N" and non-integers are mid-pan.
function computeCameraIndex(
  frameInPhase2: number,
  dwellFrames: number,
  panFrames: number,
  pillCount: number,   // = 7
): number {
  if (frameInPhase2 <= 0) return 0;

  const cycle = dwellFrames + panFrames;        // dwell N → pan N → (dwell N+1)
  const totalActive = pillCount * dwellFrames + (pillCount - 1) * panFrames;
  if (frameInPhase2 >= totalActive) return pillCount - 1;

  // Which step are we in? Each full cycle (dwell + pan) advances the camera
  // by 1, except the LAST dwell has no following pan.
  const n     = Math.floor(frameInPhase2 / cycle);
  const local = frameInPhase2 - n * cycle;

  if (n >= pillCount - 1) {
    // Past the last pan — locked on the final pill.
    return pillCount - 1;
  }

  if (local < dwellFrames) {
    // DWELLING on pill n.
    return n;
  }
  // PANNING from pill n → pill n+1.
  const panProg = clamp01((local - dwellFrames) / panFrames);
  return n + easeInOutCubic(panProg);
}

// Dwell-start frame for pill `i` (in phase-2-local frames). Used to key the
// per-pill stamp bob + text fade.
function dwellStartFrame(i: number, dwellFrames: number, panFrames: number) {
  return i * (dwellFrames + panFrames);
}

// ─── Play-button glyph (white triangle inside a dodger-blue gradient disk) ───

function PlayCircle({ size }: { size: number }) {
  // Triangle proportions: a clean equilateral-ish glyph nudged right so its
  // visual centre lines up with the circle centre.
  const tri = size * 0.34;
  const offsetX = size * 0.04;
  return (
    <div
      style={{
        width:  size,
        height: size,
        borderRadius: '50%',
        // Vertical dodger-blue gradient: brighter at the top, deeper at the
        // bottom — gives the disk a subtle sense of dimension without glow.
        background:
          'linear-gradient(180deg, #38B0FF 0%, #0496FF 55%, #0072CC 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 0,
          height: 0,
          marginLeft: offsetX,
          borderTop:    `${tri * 0.62}px solid transparent`,
          borderBottom: `${tri * 0.62}px solid transparent`,
          borderLeft:   `${tri}px solid ${WHITE}`,
        }}
      />
    </div>
  );
}

// ─── Stamp shell (the single, screen-fixed conveyor-belt stamper) ────────────
//
// Lives in SCREEN space — it does NOT travel with the panning world. Sits
// centred on the canvas, just below where any pill lands, and lifts up each
// time a new pill arrives. `liftPx` is the current vertical lift in pixels
// (0 at rest, +STAMP_TRAVEL when fully stamped). Outline weight matches the
// pill so the two shapes read as a matched pair.
function StampShell({ liftPx }: { liftPx: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: CANVAS_CX - STAMP_W / 2,
        top:  CANVAS_CY + PILL_H / 2 + STAMP_REST_GAP - liftPx,
        width:  STAMP_W,
        height: STAMP_H,
        borderRadius: STAMP_RADIUS,
        border: `${SHELL_BORDER_PX}px solid ${DODGER_BLUE}`,
        background: 'transparent',
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    />
  );
}

// ─── A single stage: pill containing play circle + label ─────────────────────
//
// Positioned in WORLD space — its container places it at (centerX, CANVAS_CY).
// The pill rectangle is centred on that point.
function Stage({
  label,
  textOpacity,
}: {
  label: string;
  textOpacity: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: -PILL_W / 2,
        top:  -PILL_H / 2,
        width:  PILL_W,
        height: PILL_H,
        borderRadius: PILL_RADIUS,
        border: `${SHELL_BORDER_PX}px solid ${DODGER_BLUE}`,
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        // Left padding hugs the play circle; right padding gives the label
        // breathing room before the rounded end-cap.
        padding: `0 64px 0 ${PLAY_INSET_LEFT}px`,
        gap: 36,
        boxSizing: 'border-box',
      }}
    >
      <PlayCircle size={PLAY_DIAM} />
      <span
        style={{
          color: WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 68,
          letterSpacing: '-0.01em',
          // lineHeight > 1 so the clip box has room for descenders (g, y, p) —
          // overflow:hidden (below) clips vertically too, and lineHeight:1 would
          // shave the bottoms off. The pill centres the text, so it stays centred.
          lineHeight: 1.25,
          whiteSpace: 'nowrap',
          // Stay inside the pill: take the remaining flex space and clip with an
          // ellipsis rather than spilling past the rounded end-cap. The ≤22-char
          // schema cap keeps real labels well within this; this is the safety net.
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: textOpacity,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const Carousel7PillsHorizontalV1: React.FC<
  Carousel7PillsHorizontalV1Props
> = ({ pills, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() =>
    delayRender('Loading Carousel7PillsHorizontalV1 fonts'),
  );
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const INTRO_FRAMES = f(t.introDuration);
  const DWELL_FRAMES = f(t.pillDwell);
  const PAN_FRAMES   = f(t.panTransition);
  const FADE_FRAMES  = f(t.textFadeDuration);
  const STAMP_RAISE_FRAMES = f(t.stampRaise);
  const STAMP_HOLD_FRAMES  = f(t.stampHold);
  const STAMP_LOWER_FRAMES = f(t.stampLower);
  const OUTRO_FRAMES = f(t.outroDuration);

  const phase2Start = INTRO_FRAMES;
  const frameInPhase2 = frame - phase2Start;

  // ── Camera index across phase 2 ──
  const cameraIdx = computeCameraIndex(
    frameInPhase2,
    DWELL_FRAMES,
    PAN_FRAMES,
    pills.length,
  );

  // World translateX: world is laid out with pill i at worldX = i * PILL_PITCH,
  // and we keep the camera (canvas centre) over cameraIdx * PILL_PITCH.
  const worldOffsetX = -cameraIdx * PILL_PITCH;

  // ── Shared stamp lift across all pills ──
  //
  // The stamp is a single, screen-fixed shell. Each phase-2 cycle is one
  // (dwell + pan). During the dwell portion the stamp runs through
  // raise → hold → lower → rest; during the pan portion it stays at rest.
  // (The final pill has no following pan, but the same cycle math gives it
  // its dwell-window stamp before the comp ends.)
  const stampLiftPx = (() => {
    if (frameInPhase2 < 0) return 0;
    const cycle = DWELL_FRAMES + PAN_FRAMES;
    const n = Math.floor(frameInPhase2 / cycle);
    if (n >= pills.length) return 0;             // past the last dwell
    const intoCycle = frameInPhase2 - n * cycle;
    if (intoCycle >= DWELL_FRAMES) return 0;     // in the pan portion → at rest

    const raiseEnd = STAMP_RAISE_FRAMES;
    const holdEnd  = raiseEnd + STAMP_HOLD_FRAMES;
    const lowerEnd = holdEnd  + STAMP_LOWER_FRAMES;
    if (intoCycle < raiseEnd) {
      return easeInOutCubic(intoCycle / STAMP_RAISE_FRAMES) * STAMP_TRAVEL;
    }
    if (intoCycle < holdEnd) {
      return STAMP_TRAVEL;
    }
    if (intoCycle < lowerEnd) {
      const p = (intoCycle - holdEnd) / STAMP_LOWER_FRAMES;
      return (1 - easeInOutCubic(p)) * STAMP_TRAVEL;
    }
    return 0;
  })();

  // ── Intro panel (slides off LEFT during phase 1) ──
  // panelX = 0 means fully covering the viewport; panelX = -CANVAS_W means
  // fully off-canvas to the left.
  const introPanelProg = clamp01(frame / INTRO_FRAMES);
  const introPanelX = interpolate(
    easeInOutCubic(introPanelProg),
    [0, 1],
    [0, -CANVAS_W],
  );

  // ── Outro panel (slides in from RIGHT during phase 3) ──
  const outroStart = phase2Start + (pills.length - 1) * (DWELL_FRAMES + PAN_FRAMES) + DWELL_FRAMES;
  // Anchor the outro to the end of the comp rather than the end of phase 2 so
  // the platinum sweep always finishes exactly at frame 450 (15.0 s).
  const compEnd = 450;
  const outroBegin = compEnd - OUTRO_FRAMES;
  const outroProg = clamp01((frame - outroBegin) / OUTRO_FRAMES);
  const outroPanelX = interpolate(
    easeInOutCubic(outroProg),
    [0, 1],
    [CANVAS_W, 0],
  );

  void outroStart;  // kept for clarity / future tweaks; outro is comp-anchored.

  return (
    <AbsoluteFill style={{ background: OXFORD_GRADIENT, overflow: 'hidden' }}>
      {/* WORLD — a wide container holding all 7 stages. The world's origin
          (0, 0) is the canvas centre; pills sit at worldX = i * PILL_PITCH.
          We translate the whole world by worldOffsetX to perform the pan. */}
      <div
        style={{
          position: 'absolute',
          left: CANVAS_CX,
          top:  CANVAS_CY,
          transform: `translateX(${worldOffsetX}px)`,
          willChange: 'transform',
        }}
      >
        {pills.map((p, i) => {
          // Per-pill arrival timing (relative to phase 2 start). Used only
          // to gate the per-pill TEXT fade-in — the stamp is computed once
          // below, outside this loop, since it's a single screen-fixed shell.
          const dwellStart = dwellStartFrame(i, DWELL_FRAMES, PAN_FRAMES);
          const localDwellFrame = frameInPhase2 - dwellStart;

          // Text fade in starts when the stamp meets the pill (raise complete).
          // Reads as "the stamper hits → ink appears on the pill".
          const textOpacity = (() => {
            const localTextFrame = localDwellFrame - STAMP_RAISE_FRAMES;
            if (localTextFrame <= 0) return 0;
            const p = clamp01(localTextFrame / FADE_FRAMES);
            return easeOutCubic(p);
          })();

          return (
            <div
              key={`stage-${i}`}
              style={{
                position: 'absolute',
                left: i * PILL_PITCH,
                top:  0,
              }}
            >
              <Stage label={p.label} textOpacity={textOpacity} />
            </div>
          );
        })}
      </div>

      {/* STAMP SHELL — single, screen-fixed; bobs up on each pill arrival. */}
      <StampShell liftPx={stampLiftPx} />

      {/* INTRO PANEL — platinum-blue full-screen, slides off LEFT. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top:  0,
          width:  CANVAS_W,
          height: CANVAS_H,
          background: PLATINUM_BLUE,
          transform: `translateX(${introPanelX}px)`,
          pointerEvents: 'none',
        }}
      />

      {/* OUTRO PANEL — platinum-blue full-screen, slides in from RIGHT. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top:  0,
          width:  CANVAS_W,
          height: CANVAS_H,
          background: PLATINUM_BLUE,
          transform: `translateX(${outroPanelX}px)`,
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const carousel7PillsHorizontalV1DefaultProps: Carousel7PillsHorizontalV1Props = {
  pills: [
    { label: 'Topic 1' },
    { label: 'Topic 2' },
    { label: 'Topic 3' },
    { label: 'Topic 4' },
    { label: 'Topic 5' },
    { label: 'Topic 6' },
    { label: 'Topic 7' },
  ],
};
