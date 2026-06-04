import React, { useEffect, useState } from 'react';
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

// TreeDiagram4x2 — hero panel on the left → 2–5 caption pills → 1–3 leaves each.
//   • Platinum-blue (#E6ECF2) base, with an oxford-blue → near-black radial
//     gradient panel that scales 0 → 1 from center over the first ~0.85 s.
//   • Hero panel: large dodger-blue rectangle on the left. Inside: a large
//     hero icon (any library SVG, forced solid white via a CSS mask) and a dark
//     title pill at the bottom (title ≤3 words, wraps to stay inside the pill).
//   • Captions: dodger-blue gradient pills, Satoshi Medium white label.
//   • Leaves: smaller dodger spheres with a white icon + white body text to the
//     right. Each branch carries 1–3 leaves; point text may wrap to 2 lines.
//   • The number of branches (2–5) and leaves per branch (1–3) is variable —
//     row positions, the trunk extent, leaf size and spacing all scale to fit
//     the canvas with no overlap.
//   • Connector lines draw on with stroke-dashoffset.
//   • Default duration 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const treeDiagram4x2LeafSchema = z.object({
  icon: z.string().min(1),                  // icons/<id>.svg (bundled white set)
  text: z.string().min(1).max(60),          // Satoshi Medium, white — wraps to 2 lines
});

export const treeDiagram4x2BranchSchema = z.object({
  caption: z.string().min(1).max(22),       // pill label, Satoshi Medium white
  leaves:  z.array(treeDiagram4x2LeafSchema).min(1).max(3),  // 1–3 points per pill
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
  // Title shown in the dark pill at the bottom of the hero panel. At most THREE
  // words so it stays inside the pill (it wraps if needed).
  title:     z.string().min(1).max(30).refine(
    (s) => s.trim().split(/\s+/).filter(Boolean).length <= 3,
    { message: 'title must be at most 3 words' },
  ),
  // Icon id resolving to icons/<id>.svg — drawn large inside the panel and
  // forced to solid white (any library SVG works; it is masked, not tinted).
  heroIcon:  z.string().min(1),
  // 2 to 5 branches, each with a caption and 1–3 leaves.
  branches:  z.array(treeDiagram4x2BranchSchema).min(2).max(5),
  timings:   treeDiagram4x2TimingsSchema.optional(),
});

export type TreeDiagram4x2Props = z.infer<typeof treeDiagram4x2Schema>;

export const treeDiagram4x2Meta = {
  description:
    'Tree diagram with a hero panel on the left (large white icon + dark title ' +
    'pill) that connects to 2–5 caption pills, each splitting into 1–3 ' +
    'icon-labelled leaves. Use to introduce a topic and map its decisions, ' +
    'taxonomy, or pros/cons.',
  authoringNotes:
    'title is the dark-pill copy at the bottom of the hero panel — at most 3 ' +
    'words, Satoshi Bold white (it wraps to stay inside the pill). heroIcon is ' +
    'the big illustration inside the panel: supply ANY icon id from the library ' +
    '(icons/<id>.svg) — it is rendered as a solid-white silhouette via a CSS ' +
    'mask, so colour/theme of the source SVG does not matter (use a ' +
    'transparent-background SVG). Supply 2 to 5 branches, each with a caption ' +
    '(≤22 chars, ideally ≤20 for headroom) plus 1 to 3 leaves. Leaf text may be ' +
    'longer and wraps to 2 lines; leaf icons should encode a fast read ' +
    '(check/x, arrow-up/down). Bundled leaf icons: check, x, arrow-up, ' +
    'arrow-down, plus, minus, info, alert-triangle, git-branch, diagram. ' +
    'Default duration 300 frames (10 s).',
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

// Hero icon inside panel
const HERO_ICON_SIZE = 440;
const HERO_ICON_CX   = PANEL_LEFT + PANEL_W / 2; // 370
const HERO_ICON_CY   = PANEL_TOP + 380;          // 450

// Title pill at the bottom of the panel
const TITLE_PILL_W   = 480;
const TITLE_PILL_H   = 130;
const TITLE_PILL_CX  = PANEL_LEFT + PANEL_W / 2;        // 370
const TITLE_PILL_CY  = PANEL_TOP + PANEL_H - 110;       // 900
const TITLE_PILL_RADIUS = 18;

// Vertical trunk + branch columns (x positions are fixed; y is computed).
const TRUNK_X    = 770;

// Vertical band the branches are distributed within.
const BAND_TOP = 120;
const BAND_BOT = 960;
const BAND_H   = BAND_BOT - BAND_TOP;

// Caption pill
const PILL_CX    = 1010;
const PILL_W     = 360;
const PILL_H     = 78;
const PILL_LEFT  = PILL_CX - PILL_W / 2;          // 830
const PILL_RIGHT = PILL_CX + PILL_W / 2;          // 1190

// Leaf column
const LEAF_CIRCLE_CX = 1330;
const JUNCTION_X     = 1235;
const LEAF_R_MAX     = 38;
const LEAF_GAP       = 12;   // vertical gap between leaves in a branch
const ROW_MARGIN     = 40;   // min gap between adjacent branch clusters

// Line lengths that don't depend on layout
const LEN_PANEL_TO_TRUNK = TRUNK_X - PANEL_RIGHT;                    // 90
const LEN_TRUNK_TO_PILL  = PILL_LEFT - TRUNK_X;                       // 60
const LEN_PILL_TO_JUNC   = JUNCTION_X - PILL_RIGHT;                   // 45

// Panel slides in from off-canvas left
const PANEL_SLIDE_FROM = -(PANEL_LEFT + PANEL_W + 20);

// ─── Dynamic layout ───────────────────────────────────────────────────────────
// Given the branch count + the densest branch, pick a leaf radius so the
// tallest cluster fits its row slot, then derive row centres + leaf offsets.

function computeLayout(branchCount: number, maxLeaves: number) {
  const rowSlot = BAND_H / branchCount;
  // Solve leaf radius R from: maxLeaves*(2R) + (maxLeaves-1)*GAP + MARGIN <= rowSlot
  const rawR = (rowSlot - (maxLeaves - 1) * LEAF_GAP - ROW_MARGIN) / (2 * maxLeaves);
  const leafR = Math.max(16, Math.min(LEAF_R_MAX, Math.floor(rawR)));
  const leafPitch = 2 * leafR + LEAF_GAP;
  const rowY = (i: number) => BAND_TOP + rowSlot * (i + 0.5);
  // Leaf font scales gently with radius (26 at full size, smaller when dense).
  const leafFont = Math.round(Math.max(17, Math.min(26, leafR * 0.5 + 7)));
  // Vertical offset of leaf j (0-based) within a branch of K leaves, centred.
  const leafOffset = (j: number, k: number) => (j - (k - 1) / 2) * leafPitch;
  return { rowSlot, leafR, leafPitch, rowY, leafFont, leafOffset };
}

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  bgDuration:    0.85,
  panelStart:    1.00,
  panelDuration: 1.20,
  trunkDuration: 0.85,
  branchStart:   4.10,
  branchStagger: 1.25,
} as const;

const easeOutCubic         = Easing.out(Easing.cubic);
const easeInOutCubic       = Easing.inOut(Easing.cubic);
const easeOutBackSubtle    = Easing.out(Easing.back(1.0));
const easeOutBackOvershoot = Easing.out(Easing.back(1.1));

// ─── Visual style fragments ──────────────────────────────────────────────────

const DODGER_BG =
  'linear-gradient(180deg, #5BB6FF 0%, #1A9CFE 38%, #0686EE 72%, #0075D8 100%)';
const DODGER_SHADOW =
  'inset 0 2px 4px rgba(255,255,255,0.45), inset 0 -3px 6px rgba(0,72,140,0.30)';
const PANEL_SHADOW =
  'inset 0 5px 10px rgba(255,255,255,0.30), inset 0 -6px 12px rgba(0,72,140,0.30)';

const SPHERE_BG =
  'radial-gradient(circle at 32% 28%, #7CC7FF 0%, #2EA3FE 32%, #0A8AEF 62%, #005EAA 100%)';
const SPHERE_SHADOW =
  'inset 0 -5px 10px rgba(0,42,92,0.35), inset 4px 4px 8px rgba(255,255,255,0.18)';

const TITLE_PILL_BG =
  'linear-gradient(180deg, #061b2b 0%, #000000 90%)';
const TITLE_PILL_SHADOW =
  'inset 0 1px 2px rgba(255,255,255,0.08), inset 0 -1px 3px rgba(0,0,0,0.60)';

const LINE_COLOR  = 'rgba(255,255,255,0.75)';
const LINE_WIDTH  = 2.5;
const TEXT_WHITE  = '#FFFFFF';

const OXFORD_BG =
  'radial-gradient(ellipse at 50% 50%, #0a3050 0%, #052438 38%, #02101c 72%, #000000 100%)';

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

// Probe which icon ids actually resolve to a file, so a missing/typo'd id can
// fall back to a placeholder glyph instead of rendering blank. delayRender holds
// the frame until the probes finish.
function useIconExistence(ids: string[]): Record<string, boolean> {
  const key = Array.from(new Set(ids)).sort().join('|');
  const [exists, setExists] = useState<Record<string, boolean>>({});
  const [handle] = useState(() => delayRender('Probing TreeDiagram4x2 icons'));
  useEffect(() => {
    let cancelled = false;
    const unique = Array.from(new Set(ids));
    Promise.all(
      unique.map(
        (id) =>
          new Promise<[string, boolean]>((resolve) => {
            const img = new Image();
            img.onload = () => resolve([id, true]);
            img.onerror = () => resolve([id, false]);
            img.src = staticFile(`icons/${id}.svg`);
          }),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        for (const [id, ok] of results) map[id] = ok;
        setExists(map);
      })
      .finally(() => continueRender(handle));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, key]);
  return exists;
}

// Neutral "unknown icon" placeholder (help-circle), white stroke — shown when
// an icon id doesn't resolve.
function PlaceholderIcon({ size, opacity }: { size: number; opacity: number }) {
  // strokeWidth is in viewBox units (0–24) — SVG scales it with `size`, so it
  // must be a constant, not pixel-scaled.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={TEXT_WHITE}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity, display: 'block' }}
    >
      <circle cx="12" cy="12" r="9.2" />
      <path d="M9.2 9.2a3 3 0 0 1 5.7 1c0 2-2.9 2.6-2.9 4" />
      <line x1="12" y1="17.4" x2="12.02" y2="17.4" />
    </svg>
  );
}

// Solid-white icon via CSS mask — works for ANY source SVG (colour/theme
// irrelevant) and never crashes the render on a missing file. A missing id
// (missing=true) renders the placeholder glyph instead.
function WhiteIcon({
  id, size, opacity, missing,
}: { id: string; size: number; opacity: number; missing?: boolean }) {
  if (missing) return <PlaceholderIcon size={size} opacity={opacity} />;
  const url = `url(${staticFile(`icons/${id}.svg`)})`;
  return (
    <div
      style={{
        width: size,
        height: size,
        opacity,
        backgroundColor: TEXT_WHITE,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function HeroPanel({
  frame, title, heroIcon, heroMissing, startF, durF,
}: {
  frame: number; title: string; heroIcon: string; heroMissing: boolean;
  startF: number; durF: number;
}) {
  const local = frame - startF;
  const slideP = interpolate(local, [0, durF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOutCubic,
  });
  const tx = PANEL_SLIDE_FROM + (0 - PANEL_SLIDE_FROM) * slideP;

  const iconOp = interpolate(local, [durF * 0.55, durF + 6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const titleLocal = local - durF;
  const titleScale = interpolate(titleLocal, [0, f(0.55)], [0.92, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const titleOp = interpolate(titleLocal, [0, f(0.45)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  if (local < 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0, top: 0, width: CANVAS_W, height: CANVAS_H,
        transform: `translateX(${tx}px)`,
        pointerEvents: 'none',
      }}
    >
      {/* Panel rectangle */}
      <div
        style={{
          position: 'absolute',
          left: PANEL_LEFT, top: PANEL_TOP, width: PANEL_W, height: PANEL_H,
          borderRadius: PANEL_RADIUS,
          background: DODGER_BG,
          boxShadow: PANEL_SHADOW,
        }}
      />

      {/* Hero icon — solid white silhouette of any library SVG */}
      <div
        style={{
          position: 'absolute',
          left: HERO_ICON_CX - HERO_ICON_SIZE / 2,
          top:  HERO_ICON_CY - HERO_ICON_SIZE / 2,
        }}
      >
        <WhiteIcon id={heroIcon} size={HERO_ICON_SIZE} opacity={iconOp} missing={heroMissing} />
      </div>

      {/* Title pill (dark) — title wraps to stay inside the pill */}
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
            fontSize: 46,
            letterSpacing: '-0.015em',
            lineHeight: 1.05,
            padding: '0 26px',
            textAlign: 'center',
            whiteSpace: 'normal',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
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
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const dx = interpolate(local, [0, durF], [-18, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackSubtle,
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
          position: 'absolute', inset: 0,
          borderRadius: 999,
          background: DODGER_BG,
          boxShadow: DODGER_SHADOW,
        }}
      />
      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
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
  cx, cy, r, font, textX, icon, iconMissing, text,
  frame, circleStartF, circleDurF, textStartF, textDurF,
}: {
  cx: number; cy: number; r: number; font: number; textX: number;
  icon: string; iconMissing: boolean; text: string;
  frame: number;
  circleStartF: number; circleDurF: number;
  textStartF: number;  textDurF: number;
}) {
  const localC = frame - circleStartF;
  const localT = frame - textStartF;

  const scale = interpolate(localC, [0, circleDurF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const iconOp = interpolate(localC, [circleDurF * 0.4, circleDurF + 2], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const textOp = interpolate(localT, [0, textDurF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const textDx = interpolate(localT, [0, textDurF], [-10, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  if (scale <= 0 && textOp <= 0) return null;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: cx - r, top: cy - r,
          width: r * 2, height: r * 2,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          opacity: scale > 0 ? 1 : 0,
        }}
      >
        <div
          style={{
            position: 'absolute', inset: 0,
            borderRadius: '50%',
            background: SPHERE_BG,
            boxShadow: SPHERE_SHADOW,
          }}
        />
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: r * 0.36,
          }}
        >
          <WhiteIcon id={icon} size={r * 1.28} opacity={iconOp} missing={iconMissing} />
        </div>
      </div>

      {/* Point text — may be longer; wraps to up to 2 lines. */}
      <div
        style={{
          position: 'absolute',
          left: textX,
          top:  cy,
          width: CANVAS_W - textX - 40,
          transform: `translate(${textDx}px, -50%)`,
          color: TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500,
          fontSize: font,
          lineHeight: 1.22,
          letterSpacing: '-0.005em',
          opacity: textOp,
          whiteSpace: 'normal',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          overflow: 'hidden',
        }}
      >
        {text}
      </div>
    </>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const TreeDiagram4x2: React.FC<TreeDiagram4x2Props> = ({
  title, heroIcon, branches, timings,
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

  // ─── Dynamic geometry ──────────────────────────────────────────────────────
  // Resolve which icon ids exist so missing/typo'd ones fall back to a
  // placeholder glyph (only flagged missing once a probe confirms it).
  const allIconIds = [heroIcon, ...branches.flatMap((b) => b.leaves.map((l) => l.icon))];
  const iconExists = useIconExistence(allIconIds);
  const isMissing = (id: string) => iconExists[id] === false;

  const N = branches.length;
  const maxLeaves = Math.max(...branches.map((b) => b.leaves.length));
  const { leafR, leafPitch, rowY, leafFont, leafOffset } = computeLayout(N, maxLeaves);
  const leafTextX = LEAF_CIRCLE_CX + leafR + 24;
  const rowYs = branches.map((_, i) => rowY(i));
  const TRUNK_TOP = rowYs[0]!;
  const TRUNK_BOT = rowYs[N - 1]!;
  const LEN_TRUNK = TRUNK_BOT - TRUNK_TOP;
  const LEN_JUNC_TO_LEAF = (LEAF_CIRCLE_CX - leafR) - JUNCTION_X;

  const bgScale = interpolate(frame, [0, BG_DUR], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOutCubic,
  });
  const stubP  = win(frame, STUB_START, STUB_DUR);
  const trunkP = win(frame, TRUNK_START, TRUNK_DUR);

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Oxford-blue gradient */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: OXFORD_BG,
          transform: `scale(${bgScale})`,
          transformOrigin: 'center center',
        }}
      />

      {/* Connector lines */}
      <svg
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {/* Panel → trunk horizontal stub */}
        <AnimLine
          x1={PANEL_RIGHT} y1={PANEL_CY}
          x2={TRUNK_X}     y2={PANEL_CY}
          length={LEN_PANEL_TO_TRUNK}
          progress={easeInOutCubic(stubP)}
        />
        {/* Vertical trunk */}
        {LEN_TRUNK > 0 && (
          <line
            x1={TRUNK_X} y1={TRUNK_TOP}
            x2={TRUNK_X} y2={TRUNK_BOT}
            stroke={LINE_COLOR}
            strokeWidth={LINE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={LEN_TRUNK}
            strokeDashoffset={LEN_TRUNK * (1 - easeInOutCubic(trunkP))}
          />
        )}

        {/* Per-branch connectors */}
        {branches.map((branch, n) => {
          const ry = rowYs[n]!;
          const start = BRANCH_0 + n * BRANCH_GAP;
          const K = branch.leaves.length;
          const pTrunkPill = win(frame, start,           f(0.45));
          const pPillJunc  = win(frame, start + f(0.55), f(0.45));
          const pJuncVert  = win(frame, start + f(0.78), f(0.45));
          const topOff = leafOffset(0, K);
          const botOff = leafOffset(K - 1, K);
          return (
            <g key={`lines-${n}`}>
              <AnimLine
                x1={TRUNK_X}   y1={ry}
                x2={PILL_LEFT} y2={ry}
                length={LEN_TRUNK_TO_PILL}
                progress={easeInOutCubic(pTrunkPill)}
              />
              <AnimLine
                x1={PILL_RIGHT} y1={ry}
                x2={JUNCTION_X} y2={ry}
                length={LEN_PILL_TO_JUNC}
                progress={easeInOutCubic(pPillJunc)}
              />
              {/* Vertical junction spanning the leaves (only if >1 leaf) */}
              {K > 1 && (
                <AnimLine
                  x1={JUNCTION_X} y1={ry + topOff}
                  x2={JUNCTION_X} y2={ry + botOff}
                  length={botOff - topOff}
                  progress={easeInOutCubic(pJuncVert)}
                />
              )}
              {/* Horizontal stub to each leaf */}
              {branch.leaves.map((_, j) => {
                const off = leafOffset(j, K);
                const pJunc = win(frame, start + f(0.98) + j * f(0.10), f(0.38));
                return (
                  <AnimLine
                    key={`leafline-${n}-${j}`}
                    x1={JUNCTION_X}              y1={ry + off}
                    x2={LEAF_CIRCLE_CX - leafR}  y2={ry + off}
                    length={LEN_JUNC_TO_LEAF}
                    progress={easeInOutCubic(pJunc)}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Hero panel */}
      <HeroPanel
        frame={frame}
        title={title}
        heroIcon={heroIcon}
        heroMissing={isMissing(heroIcon)}
        startF={PANEL_START}
        durF={PANEL_DUR}
      />

      {/* Branches */}
      {branches.map((branch, n) => {
        const ry = rowYs[n]!;
        const start = BRANCH_0 + n * BRANCH_GAP;
        const K = branch.leaves.length;
        return (
          <React.Fragment key={`branch-${n}`}>
            <CaptionPill
              rowY={ry}
              caption={branch.caption}
              frame={frame}
              startF={start + f(0.18)}
              durF={f(0.65)}
            />
            {branch.leaves.map((leaf, j) => (
              <Leaf
                key={`leaf-${n}-${j}`}
                cx={LEAF_CIRCLE_CX}
                cy={ry + leafOffset(j, K)}
                r={leafR}
                font={leafFont}
                textX={leafTextX}
                icon={leaf.icon}
                iconMissing={isMissing(leaf.icon)}
                text={leaf.text}
                frame={frame}
                circleStartF={start + f(1.28) + j * f(0.12)}
                circleDurF={f(0.60)}
                textStartF={start + f(1.48) + j * f(0.12)}
                textDurF={f(0.50)}
              />
            ))}
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
    { caption: 'Prompts', leaves: [
      { icon: 'check', text: 'Show, don’t just describe' },
      { icon: 'x',     text: 'Avoid vague instructions' },
    ] },
    { caption: 'Context', leaves: [
      { icon: 'plus',  text: 'Pin relevant docs first' },
      { icon: 'minus', text: 'Cut stale, off-topic data' },
    ] },
    { caption: 'Evals', leaves: [
      { icon: 'arrow-up',   text: 'Test on real edge cases' },
      { icon: 'arrow-down', text: 'Don’t trust vibes alone' },
    ] },
    { caption: 'Safety', leaves: [
      { icon: 'info',           text: 'Add limits before launch' },
      { icon: 'alert-triangle', text: 'Watch for prompt injection' },
    ] },
  ],
};
