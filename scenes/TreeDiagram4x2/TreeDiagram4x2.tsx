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

// TreeDiagram4x2 — hero panel on the left → 4 caption pills → 2 A/B leaves.
//   • Platinum-blue (#E6ECF2) base, with an oxford-blue → near-black radial
//     gradient panel that scales 0 → 1 from center over the first ~0.85 s
//     (same staging idea as ComparativePoints2's BG zoom).
//   • Hero panel: large dodger-blue gradient rectangle (gradient matches the
//     caption pills) on the left. Inside: a large white hero icon up top and
//     a dark "title" pill at the bottom. Slides in from off-canvas left.
//   • Captions: dodger-blue gradient pills (gradient matches LessonSummary
//     pill), Satoshi Medium 33 px white label.
//   • A/B leaves: smaller dodger-blue spheres with a white interface icon
//     (lucide-derived stroke SVG) + white body text on the right.
//   • Connector lines: soft white strokes (~75 % opacity) that draw on with
//     stroke-dashoffset; lengths computed from geometry.
//   • Subtle animation: easeOutBack overshoot on circle scale-ins (gentle —
//     back(1.1)), easeOutCubic on fades, easeInOutCubic on every line draw
//     and on the bg + panel motion.
//   • Default duration 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const treeDiagram4x2LeafSchema = z.object({
  icon: z.string().min(1),                  // icons/<id>.svg
  text: z.string().min(1).max(34),          // Satoshi Medium 26 px, white
});

export const treeDiagram4x2BranchSchema = z.object({
  caption: z.string().min(1).max(22),       // pill label, Satoshi Medium 33 px white
  a: treeDiagram4x2LeafSchema,
  b: treeDiagram4x2LeafSchema,
});

export const treeDiagram4x2TimingsSchema = z
  .object({
    bgDuration:    z.number().positive(),   // oxford-blue panel scales up
    panelStart:    z.number().nonnegative(),// hero panel slide-in starts
    panelDuration: z.number().positive(),   // hero panel slide-in duration
    trunkDuration: z.number().positive(),   // vertical trunk draw
    branchStart:   z.number().nonnegative(),// first branch begins (absolute)
    branchStagger: z.number().positive(),   // gap between branches
  })
  .partial();

export const treeDiagram4x2Schema = z.object({
  // Title shown in the dark pill at the bottom of the hero panel.
  title:     z.string().min(1).max(18),
  // Icon id resolving to icons/<id>.svg — drawn very large inside the panel.
  heroIcon:  z.string().min(1),
  branches:  z.array(treeDiagram4x2BranchSchema).length(4),
  timings:   treeDiagram4x2TimingsSchema.optional(),
});

export type TreeDiagram4x2Props = z.infer<typeof treeDiagram4x2Schema>;

export const treeDiagram4x2Meta = {
  description:
    'Tree diagram with a hero panel on the left (big dodger-blue rectangle ' +
    'containing a large icon + dark title pill) that connects to 4 caption ' +
    'pills, each splitting into 2 icon-labelled leaves. Use to introduce a ' +
    'topic and map its decisions, taxonomy, or pros/cons.',
  authoringNotes:
    'title is the dark-pill copy at the bottom of the hero panel — ≤18 chars, ' +
    'Satoshi Bold white. heroIcon is the big illustration inside the panel ' +
    '(white, scaled large) — pick from the bundled set or supply your own ' +
    'patched SVG. Always supply exactly 4 branches, each with a caption (≤22 ' +
    'chars, Satoshi Medium 33 px white) plus two leaves a and b. Leaf text ' +
    '≤34 chars to stay on one line; leaf icons should encode a fast read ' +
    '(check/x for pros/cons, arrow-up/down for direction). Aim for parallel ' +
    'a/b semantics across all 4 branches. GOOD caption: "Cost", "Speed", ' +
    '"Reliability", "Scale"; leaf a "Lower upfront", leaf b "Higher long-term". ' +
    'Bundled icons: check, x, arrow-up, arrow-down, plus, minus, info, ' +
    'alert-triangle, git-branch, diagram. Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (px on a 1920×1080 canvas) ─────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Left hero panel
const PANEL_LEFT   = 60;
const PANEL_TOP    = 70;
const PANEL_W      = 620;
const PANEL_H      = 940;
const PANEL_RIGHT  = PANEL_LEFT + PANEL_W;       // 680
const PANEL_CY     = PANEL_TOP + PANEL_H / 2;    // 540
const PANEL_RADIUS = 36;

// Hero icon inside panel (centred horizontally, upper-middle vertically)
const HERO_ICON_SIZE = 440;
const HERO_ICON_CX   = PANEL_LEFT + PANEL_W / 2; // 370
const HERO_ICON_CY   = PANEL_TOP + 380;          // 450

// Title pill at the bottom of the panel
const TITLE_PILL_W   = 460;
const TITLE_PILL_H   = 110;
const TITLE_PILL_CX  = PANEL_LEFT + PANEL_W / 2;        // 370
const TITLE_PILL_CY  = PANEL_TOP + PANEL_H - 110;       // 900
const TITLE_PILL_RADIUS = 18;

// Vertical trunk (sits to the right of the panel)
const TRUNK_X    = 770;
const TRUNK_TOP  = 200;
const TRUNK_BOT  = 880;

// 4 rows
const ROW_YS = [200, 427, 653, 880] as const;

// Caption pill
const PILL_CX    = 1010;
const PILL_W     = 360;
const PILL_H     = 78;
const PILL_LEFT  = PILL_CX - PILL_W / 2;          // 830
const PILL_RIGHT = PILL_CX + PILL_W / 2;          // 1190

// A/B leaves
const LEAF_CIRCLE_CX = 1330;
const LEAF_OFFSET_Y  = 62;
const LEAF_R         = 38;
const LEAF_TEXT_X    = LEAF_CIRCLE_CX + LEAF_R + 24;   // 1392

// Junction (where pill's right edge splits up/down to A and B)
const JUNCTION_X = 1235;

// Line lengths (used for stroke-dasharray draw-on)
const LEN_PANEL_TO_TRUNK = TRUNK_X - PANEL_RIGHT;                    // 90
const LEN_TRUNK          = TRUNK_BOT - TRUNK_TOP;                     // 680
const LEN_TRUNK_TO_PILL  = PILL_LEFT - TRUNK_X;                       // 60
const LEN_PILL_TO_JUNC   = JUNCTION_X - PILL_RIGHT;                   // 45
const LEN_JUNC_VERT      = LEAF_OFFSET_Y * 2;                         // 124
const LEN_JUNC_TO_LEAF   = (LEAF_CIRCLE_CX - LEAF_R) - JUNCTION_X;    // 57

// Panel slides in from off-canvas left
const PANEL_SLIDE_FROM = -(PANEL_LEFT + PANEL_W + 20);

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  bgDuration:    0.85,    // oxford-blue gradient scales 0 → 1 from center
  panelStart:    1.00,    // hero panel waits for bg to settle (+0.15 s buffer)
  panelDuration: 1.20,    // hero panel slide-in — slower, more deliberate
  trunkDuration: 0.85,    // vertical trunk draw
  branchStart:   4.10,    // first branch begins (absolute time)
  branchStagger: 1.25,    // gap between branches
} as const;

const easeOutCubic         = Easing.out(Easing.cubic);
const easeInOutCubic       = Easing.inOut(Easing.cubic);
const easeOutBackSubtle    = Easing.out(Easing.back(1.0));
const easeOutBackOvershoot = Easing.out(Easing.back(1.1));

// ─── Visual style fragments ──────────────────────────────────────────────────

// Pill / hero-panel gradient — vertical, lighter top, deeper bottom.
const DODGER_BG =
  'linear-gradient(180deg, #5BB6FF 0%, #1A9CFE 38%, #0686EE 72%, #0075D8 100%)';
// Inset highlights only — no outer glow.
const DODGER_SHADOW =
  'inset 0 2px 4px rgba(255,255,255,0.45), ' +
  'inset 0 -3px 6px rgba(0,72,140,0.30)';
const PANEL_SHADOW =
  'inset 0 5px 10px rgba(255,255,255,0.30), ' +
  'inset 0 -6px 12px rgba(0,72,140,0.30)';

// Sphere gradient — radial highlight top-left — matches Timeline5Tiles ball.
const SPHERE_BG =
  'radial-gradient(circle at 32% 28%, #7CC7FF 0%, #2EA3FE 32%, #0A8AEF 62%, #005EAA 100%)';
const SPHERE_SHADOW =
  'inset 0 -5px 10px rgba(0,42,92,0.35), ' +
  'inset 4px 4px 8px rgba(255,255,255,0.18)';

// Title pill — very dark, subtle gradient.
const TITLE_PILL_BG =
  'linear-gradient(180deg, #061b2b 0%, #000000 90%)';
const TITLE_PILL_SHADOW =
  'inset 0 1px 2px rgba(255,255,255,0.08), ' +
  'inset 0 -1px 3px rgba(0,0,0,0.60)';

const LINE_COLOR  = 'rgba(255,255,255,0.75)';
const LINE_WIDTH  = 2.5;

const TEXT_WHITE  = '#FFFFFF';

// Oxford-blue → near-black radial gradient that scales up over the platinum
// base. Same palette family as Carousel5Tiles tiles.
const OXFORD_BG =
  'radial-gradient(ellipse at 50% 50%, ' +
  '#0a3050 0%, #052438 38%, #02101c 72%, #000000 100%)';

// ─── Font loading ────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold   = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,   { weight: '700', display: 'block' });
    const medium = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`, { weight: '500', display: 'block' });
    const [b, m] = await Promise.all([bold.load(), medium.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(b);
    fonts.add(m);
  })();
  return fontsPromise;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function win(frame: number, startF: number, durF: number): number {
  return Math.max(0, Math.min(1, (frame - startF) / durF));
}

function AnimLine({
  x1, y1, x2, y2, length, progress,
}: {
  x1: number; y1: number; x2: number; y2: number;
  length: number; progress: number;
}) {
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={LINE_COLOR}
      strokeWidth={LINE_WIDTH}
      strokeLinecap="round"
      strokeDasharray={length}
      strokeDashoffset={length * (1 - progress)}
    />
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function HeroPanel({
  frame, title, heroIcon, startF, durF,
}: {
  frame: number; title: string; heroIcon: string; startF: number; durF: number;
}) {
  const local = frame - startF;
  // Panel slides in from off-canvas left.
  const slideP = interpolate(local, [0, durF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const tx = PANEL_SLIDE_FROM + (0 - PANEL_SLIDE_FROM) * slideP;

  // Hero icon fades in during the last 35 % of the panel slide.
  const iconOp = interpolate(local, [durF * 0.55, durF + 6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  // Title pill scales in just after panel lands.
  const titleLocal = local - durF;
  const titleScale = interpolate(titleLocal, [0, f(0.55)], [0.92, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeOutBackOvershoot,
  });
  const titleOp = interpolate(titleLocal, [0, f(0.45)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });

  if (local < 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top:  0,
        width:  CANVAS_W,
        height: CANVAS_H,
        transform: `translateX(${tx}px)`,
        pointerEvents: 'none',
      }}
    >
      {/* Panel rectangle */}
      <div
        style={{
          position: 'absolute',
          left:   PANEL_LEFT,
          top:    PANEL_TOP,
          width:  PANEL_W,
          height: PANEL_H,
          borderRadius: PANEL_RADIUS,
          background: DODGER_BG,
          boxShadow: PANEL_SHADOW,
        }}
      />

      {/* Hero icon */}
      <div
        style={{
          position: 'absolute',
          left: HERO_ICON_CX - HERO_ICON_SIZE / 2,
          top:  HERO_ICON_CY - HERO_ICON_SIZE / 2,
          width:  HERO_ICON_SIZE,
          height: HERO_ICON_SIZE,
          opacity: iconOp,
        }}
      >
        <Img
          src={staticFile(`icons/${heroIcon}.svg`)}
          alt=""
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      {/* Title pill (dark) */}
      <div
        style={{
          position: 'absolute',
          left: TITLE_PILL_CX - TITLE_PILL_W / 2,
          top:  TITLE_PILL_CY - TITLE_PILL_H / 2,
          width:  TITLE_PILL_W,
          height: TITLE_PILL_H,
          transform: `scale(${titleScale})`,
          transformOrigin: 'center center',
          opacity: titleOp,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: TITLE_PILL_RADIUS,
            background: TITLE_PILL_BG,
            boxShadow: TITLE_PILL_SHADOW,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: TEXT_WHITE,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 50,
            letterSpacing: '-0.015em',
            lineHeight: 1,
            padding: '0 28px',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
      </div>
    </div>
  );
}

function CaptionPill({
  rowY, caption, frame, startF, durF,
}: {
  rowY: number; caption: string; frame: number; startF: number; durF: number;
}) {
  const local = frame - startF;
  if (local < 0) return null;

  const op = interpolate(local, [0, durF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const dx = interpolate(local, [0, durF], [-18, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeOutBackSubtle,
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: PILL_LEFT,
        top:  rowY - PILL_H / 2,
        width: PILL_W,
        height: PILL_H,
        transform: `translateX(${dx}px)`,
        opacity: op,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 999,
          background: DODGER_BG,
          boxShadow: DODGER_SHADOW,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500,
          fontSize: 33,
          letterSpacing: '-0.01em',
          textShadow: '0 1px 2px rgba(0,50,100,0.25)',
          padding: '0 24px',
          whiteSpace: 'nowrap',
        }}
      >
        {caption}
      </div>
    </div>
  );
}

function Leaf({
  cx, cy, icon, text, frame, circleStartF, circleDurF, textStartF, textDurF,
}: {
  cx: number; cy: number; icon: string; text: string;
  frame: number;
  circleStartF: number; circleDurF: number;
  textStartF: number;  textDurF: number;
}) {
  const localC = frame - circleStartF;
  const localT = frame - textStartF;

  const scale = interpolate(localC, [0, circleDurF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeOutBackOvershoot,
  });
  const iconOp = interpolate(localC, [circleDurF * 0.4, circleDurF + 2], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const textOp = interpolate(localT, [0, textDurF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const textDx = interpolate(localT, [0, textDurF], [-10, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });

  if (scale <= 0 && textOp <= 0) return null;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: cx - LEAF_R,
          top:  cy - LEAF_R,
          width:  LEAF_R * 2,
          height: LEAF_R * 2,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          opacity: scale > 0 ? 1 : 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: SPHERE_BG,
            boxShadow: SPHERE_SHADOW,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: iconOp,
            padding: 14,
          }}
        >
          <Img
            src={staticFile(`icons/${icon}.svg`)}
            alt=""
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: LEAF_TEXT_X,
          top:  cy,
          maxWidth: CANVAS_W - LEAF_TEXT_X - 40,
          transform: `translate(${textDx}px, -50%)`,
          color: TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500,
          fontSize: 26,
          lineHeight: 1.25,
          letterSpacing: '-0.005em',
          opacity: textOp,
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    </>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const TreeDiagram4x2: React.FC<TreeDiagram4x2Props> = ({
  title,
  heroIcon,
  branches,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading TreeDiagram4x2 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BG_DUR        = f(t.bgDuration);
  const PANEL_START   = f(t.panelStart);
  const PANEL_DUR     = f(t.panelDuration);
  const PANEL_END     = PANEL_START + PANEL_DUR;
  const TITLE_END     = PANEL_END + f(0.55);
  const STUB_START    = TITLE_END + f(0.15);
  const STUB_DUR      = f(0.40);
  const STUB_END      = STUB_START + STUB_DUR;
  const TRUNK_START   = STUB_END + 3;
  const TRUNK_DUR     = f(t.trunkDuration);
  const BRANCH_0      = f(t.branchStart);
  const BRANCH_GAP    = f(t.branchStagger);

  const bgScale = interpolate(frame, [0, BG_DUR], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const stubP  = win(frame, STUB_START, STUB_DUR);
  const trunkP = win(frame, TRUNK_START, TRUNK_DUR);

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Oxford-blue gradient — scales 0 → 1 from center over platinum. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: OXFORD_BG,
          transform: `scale(${bgScale})`,
          transformOrigin: 'center center',
        }}
      />

      {/* Connector lines — single SVG covers the whole canvas. */}
      <svg
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {/* Panel → trunk horizontal stub */}
        <AnimLine
          x1={PANEL_RIGHT} y1={PANEL_CY}
          x2={TRUNK_X}      y2={PANEL_CY}
          length={LEN_PANEL_TO_TRUNK}
          progress={easeInOutCubic(stubP)}
        />
        {/* Vertical trunk — top → bottom */}
        <line
          x1={TRUNK_X} y1={TRUNK_TOP}
          x2={TRUNK_X} y2={TRUNK_BOT}
          stroke={LINE_COLOR}
          strokeWidth={LINE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={LEN_TRUNK}
          strokeDashoffset={LEN_TRUNK * (1 - easeInOutCubic(trunkP))}
        />

        {/* Per-branch connectors */}
        {ROW_YS.map((rowY, n) => {
          const start = BRANCH_0 + n * BRANCH_GAP;
          const pTrunkPill = win(frame, start,            f(0.45));
          const pPillJunc  = win(frame, start + f(0.55),  f(0.45));
          const pJuncVert  = win(frame, start + f(0.78),  f(0.45));
          const pJuncA     = win(frame, start + f(0.98),  f(0.38));
          const pJuncB     = win(frame, start + f(1.10),  f(0.38));

          return (
            <g key={`lines-${n}`}>
              <AnimLine
                x1={TRUNK_X}  y1={rowY}
                x2={PILL_LEFT} y2={rowY}
                length={LEN_TRUNK_TO_PILL}
                progress={easeInOutCubic(pTrunkPill)}
              />
              <AnimLine
                x1={PILL_RIGHT} y1={rowY}
                x2={JUNCTION_X} y2={rowY}
                length={LEN_PILL_TO_JUNC}
                progress={easeInOutCubic(pPillJunc)}
              />
              <AnimLine
                x1={JUNCTION_X} y1={rowY - LEAF_OFFSET_Y}
                x2={JUNCTION_X} y2={rowY + LEAF_OFFSET_Y}
                length={LEN_JUNC_VERT}
                progress={easeInOutCubic(pJuncVert)}
              />
              <AnimLine
                x1={JUNCTION_X}              y1={rowY - LEAF_OFFSET_Y}
                x2={LEAF_CIRCLE_CX - LEAF_R} y2={rowY - LEAF_OFFSET_Y}
                length={LEN_JUNC_TO_LEAF}
                progress={easeInOutCubic(pJuncA)}
              />
              <AnimLine
                x1={JUNCTION_X}              y1={rowY + LEAF_OFFSET_Y}
                x2={LEAF_CIRCLE_CX - LEAF_R} y2={rowY + LEAF_OFFSET_Y}
                length={LEN_JUNC_TO_LEAF}
                progress={easeInOutCubic(pJuncB)}
              />
            </g>
          );
        })}
      </svg>

      {/* Hero panel (left side) */}
      <HeroPanel
        frame={frame}
        title={title}
        heroIcon={heroIcon}
        startF={PANEL_START}
        durF={PANEL_DUR}
      />

      {/* Branches */}
      {branches.map((branch, n) => {
        const rowY  = ROW_YS[n]!;
        const start = BRANCH_0 + n * BRANCH_GAP;
        return (
          <React.Fragment key={`branch-${n}`}>
            <CaptionPill
              rowY={rowY}
              caption={branch.caption}
              frame={frame}
              startF={start + f(0.18)}
              durF={f(0.65)}
            />
            <Leaf
              cx={LEAF_CIRCLE_CX} cy={rowY - LEAF_OFFSET_Y}
              icon={branch.a.icon}
              text={branch.a.text}
              frame={frame}
              circleStartF={start + f(1.28)} circleDurF={f(0.60)}
              textStartF={start + f(1.48)}   textDurF={f(0.50)}
            />
            <Leaf
              cx={LEAF_CIRCLE_CX} cy={rowY + LEAF_OFFSET_Y}
              icon={branch.b.icon}
              text={branch.b.text}
              frame={frame}
              circleStartF={start + f(1.40)} circleDurF={f(0.60)}
              textStartF={start + f(1.60)}   textDurF={f(0.50)}
            />
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const treeDiagram4x2DefaultProps: TreeDiagram4x2Props = {
  title:    'AI Engineering',
  heroIcon: 'diagram',
  branches: [
    {
      caption: 'Prompts',
      a: { icon: 'check', text: 'Show, don’t just describe' },
      b: { icon: 'x',     text: 'Avoid vague instructions' },
    },
    {
      caption: 'Context',
      a: { icon: 'plus',  text: 'Pin relevant docs first' },
      b: { icon: 'minus', text: 'Cut stale, off-topic data' },
    },
    {
      caption: 'Evals',
      a: { icon: 'arrow-up',   text: 'Test on real edge cases' },
      b: { icon: 'arrow-down', text: 'Don’t trust vibes alone' },
    },
    {
      caption: 'Safety',
      a: { icon: 'info',           text: 'Add limits before launch' },
      b: { icon: 'alert-triangle', text: 'Watch for prompt injection' },
    },
  ],
};
