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

// Pyramid5Tiers — left-side pyramid + right-side banner stack.
//   • Platinum-blue (#E6ECF2) canvas.
//   • Pyramid on the LEFT — 5 stacked dodger-blue trapezoid slabs, centred
//     on a vertical axis at x≈480. Tier widths grow toward the base so the
//     outline reads as a smooth triangle.
//   • Each slab carries a white lucide-style stroke icon.
//   • For every tier, an oxford-blue ROUNDED BANNER sits to the right of
//     the pyramid carrying a Title (dodger-blue Satoshi Bold) + Body
//     (white Satoshi Medium). Banners are widest at the top and narrowest
//     at the bottom (since they butt up against the pyramid's diagonal).
//   • Reveal pacing: tier-by-tier from TOP to BOTTOM. Each tier cascades
//     slab → icon → banner → title → body. Generous timing — the build is
//     deliberate, not snappy.
//   • Default duration 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

export const pyramid5TiersTierSchema = z.object({
  title: z.string().min(1).max(22),
  body:  z.string().min(1).max(180),     // wraps to 2–4 lines depending on banner width
  icon:  z.string().min(1),
});

export const pyramid5TiersTimingsSchema = z
  .object({
    introOffset:     z.number().nonnegative(),
    tierStagger:     z.number().positive(),
    slabDuration:    z.number().positive(),
    iconOffset:      z.number().nonnegative(),
    iconDuration:    z.number().positive(),
    bannerOffset:    z.number().nonnegative(),
    bannerDuration:  z.number().positive(),
    titleOffset:     z.number().nonnegative(),
    titleDuration:   z.number().positive(),
    bodyOffset:      z.number().nonnegative(),
    bodyDuration:    z.number().positive(),
    // After the intro completes, each tier highlights in sequence: the slab
    // recolours to oxford blue while its banner pulses. Tier finishes
    // before the next begins.
    highlightStart:    z.number().nonnegative(),
    highlightDuration: z.number().positive(),
    highlightGap:      z.number().nonnegative(),
  })
  .partial();

export const pyramid5TiersSchema = z.object({
  // 5 tiers, TOP → BOTTOM order. Top tier sits at the pyramid's apex.
  tiers:   z.array(pyramid5TiersTierSchema).length(5),
  timings: pyramid5TiersTimingsSchema.optional(),
});

export type Pyramid5TiersProps = z.infer<typeof pyramid5TiersSchema>;

export const pyramid5TiersMeta = {
  description:
    'Five-tier pyramid: dodger-blue trapezoid slabs on the left, each with ' +
    'an icon, connected to an oxford-blue banner on the right carrying a ' +
    'Title and Body. Use for hierarchies, product stacks, layered concepts.',
  authoringNotes:
    'Supply exactly 5 tiers in top-to-bottom order. title ≤22 chars ' +
    '(dodger-blue Satoshi Bold inside the banner). body ≤180 chars — wraps ' +
    'to multiple lines; allow longer copy on top tiers (wider banner) and ' +
    'shorter on the bottom (narrowest slab). icon is the lucide-style SVG id ' +
    'shown inside the slab. Aim for a tier hierarchy that reads from broadest ' +
    'at top to most specific at bottom (or reverse, depending on framing). ' +
    'GOOD title: "Strategy", "Tools", "Code", "Data", "Infra". BAD title: ' +
    '"Strategic planning layer that governs everything" (too long). Bundled ' +
    'icons: trophy, monitor, cpu, settings, database. Recommended duration ' +
    '~13 s (390 frames) to let the full highlight cycle play out — at 10 s ' +
    'only the first ~3 tiers highlight.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BLACK_SRC   = staticFile('fonts/Satoshi-Black.woff2');
const SATOSHI_BOLD_SRC    = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC  = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (1920×1080 canvas) ─────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Pyramid geometry — 5 tiers, each 195 px tall. Apex sits at the top of
// the canvas; base half-width = 430 → smooth wide pyramid.
const APEX_X            = 480;
const APEX_Y            = 50;
const TIER_HEIGHT       = 195;
const BASE_HALF_WIDTH   = 430;
const PYRAMID_HEIGHT    = TIER_HEIGHT * 5;             // 975
const BASE_Y            = APEX_Y + PYRAMID_HEIGHT;     // 1025
const PYRAMID_SLOPE     = BASE_HALF_WIDTH / PYRAMID_HEIGHT;  // ≈ 0.441

// Tier geometry helpers (i = 0..4, top → bottom)
function tierTopY(i: number):     number { return APEX_Y + i * TIER_HEIGHT; }
function tierBottomY(i: number):  number { return APEX_Y + (i + 1) * TIER_HEIGHT; }
function tierCenterY(i: number):  number { return APEX_Y + (i + 0.5) * TIER_HEIGHT; }
function halfWidthAtY(y: number): number { return (y - APEX_Y) * PYRAMID_SLOPE; }

// Icon position inside each tier — slightly below the centre of the
// trapezoid so the wider lower section gives it horizontal room (tier 1 is
// almost a triangle).
const ICON_SIZE = 60;
function iconPosFor(i: number): { x: number; y: number } {
  return { x: APEX_X, y: tierTopY(i) + TIER_HEIGHT * 0.62 };
}

// Banner geometry — sits to the right of the pyramid, separated by a small
// gap at the tier's BOTTOM y (so it never overlaps the diagonal).
const BANNER_GAP        = 24;       // gap between pyramid right edge (at tier bottom) and banner left
const BANNER_RIGHT_PAD  = 40;       // gap from banner right edge to canvas right
const BANNER_RIGHT_X    = CANVAS_W - BANNER_RIGHT_PAD;  // 1880
const BANNER_INSET_Y    = 12;       // vertical inset within tier
const BANNER_RADIUS     = 18;
const BANNER_PAD_X      = 32;       // horizontal padding inside the banner
const TITLE_BLOCK_WIDTH = 200;      // reserved width for title on the left of body
const TITLE_BODY_GAP    = 28;

function bannerLeftXFor(i: number): number {
  return APEX_X + halfWidthAtY(tierBottomY(i)) + BANNER_GAP;
}
function bannerTopYFor(i: number):  number { return tierTopY(i) + BANNER_INSET_Y; }
function bannerBotYFor(i: number):  number { return tierBottomY(i) - BANNER_INSET_Y; }
function bannerWidthFor(i: number): number { return BANNER_RIGHT_X - bannerLeftXFor(i); }
function bannerHeightFor():         number { return TIER_HEIGHT - 2 * BANNER_INSET_Y; }

// SVG path for one trapezoid slab.
function slabPath(i: number): string {
  const ty = tierTopY(i);
  const by = tierBottomY(i);
  const th = halfWidthAtY(ty);
  const bh = halfWidthAtY(by);
  return [
    `M ${(APEX_X - th).toFixed(2)} ${ty.toFixed(2)}`,
    `L ${(APEX_X + th).toFixed(2)} ${ty.toFixed(2)}`,
    `L ${(APEX_X + bh).toFixed(2)} ${by.toFixed(2)}`,
    `L ${(APEX_X - bh).toFixed(2)} ${by.toFixed(2)}`,
    'Z',
  ].join(' ');
}

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  introOffset:    0.20,   // delay before tier 1 begins
  tierStagger:    0.75,   // gap between successive tier starts
  slabDuration:   0.70,   // slab fade + slight scale-down to settle
  iconOffset:     0.20,   // delay after slab start
  iconDuration:   0.55,
  bannerOffset:   0.30,
  bannerDuration: 0.70,
  titleOffset:    0.55,
  titleDuration:  0.50,
  bodyOffset:     0.65,
  bodyDuration:   0.60,
  // Intro completes ~4.4 s; highlight cycle kicks off shortly after.
  // Each tier's highlight is deliberate (~1.6 s) so the pulse and colour
  // change breathe rather than flash. Full cycle runs ~8 s — the 15 s
  // render is sized to show the full pass.
  highlightStart:    4.70,
  highlightDuration: 1.55,
  highlightGap:      0.10,
} as const;

const easeOutCubic         = Easing.out(Easing.cubic);
const easeInOutCubic       = Easing.inOut(Easing.cubic);
const easeOutBackSubtle    = Easing.out(Easing.back(1.1));
const easeOutBackOvershoot = Easing.out(Easing.back(1.4));

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG_COLOR = '#E6ECF2';

// Five subtle shades of dodger blue, lightest at the apex, deepest at the base.
const SLAB_GRADIENTS = [
  ['#7CC7FF', '#1A9CFE'],  // tier 0 (apex) — lightest
  ['#5BB6FF', '#0F95FB'],
  ['#3FA8FB', '#0686EE'],
  ['#1A9CFE', '#0075D8'],
  ['#0686EE', '#0560A8'],  // tier 4 (base) — deepest
] as const;

// Banner — oxford-blue rounded rectangle on the right.
const BANNER_BG =
  'linear-gradient(180deg, #0a3050 0%, #052438 60%, #02101c 100%)';
const BANNER_BORDER = '1px solid rgba(255,255,255,0.06)';
const BANNER_SHADOW = '0 10px 28px rgba(5,36,56,0.22)';

const TEXT_WHITE       = '#FFFFFF';
const TEXT_WHITE_DIM   = 'rgba(255,255,255,0.82)';
const TEXT_ACCENT_BLUE = '#0794FD';

// Subtle inner divider lines between slabs.
const SLAB_DIVIDER = 'rgba(255,255,255,0.20)';

// Oxford-blue highlight gradient — drawn as an overlay on top of the
// slab's dodger fill during each tier's highlight window.
const HIGHLIGHT_TOP    = '#0a3050';
const HIGHLIGHT_BOTTOM = '#000000';

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

// ─── Sub-components ──────────────────────────────────────────────────────────

function Slab({
  i, frame, startF, durF, highlightStartF, highlightDurF,
}: {
  i: number; frame: number; startF: number; durF: number;
  highlightStartF: number; highlightDurF: number;
}) {
  const local = frame - startF;
  const op = interpolate(local, [0, durF * 0.7], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  // Subtle settle: slab arrives slightly under-scaled from the centre.
  const scale = interpolate(local, [0, durF], [0.92, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackSubtle,
  });
  if (local < 0) return null;

  const [topColor, bottomColor] = SLAB_GRADIENTS[i]!;
  const gradId      = `slab-grad-${i}`;
  const highlightId = `slab-highlight-${i}`;
  const path        = slabPath(i);

  // Pivot the scale around the slab's own centre so each tier appears to
  // expand in place rather than slide from the apex.
  const cx = APEX_X;
  const cy = tierCenterY(i);

  // ─── Highlight overlay ───────────────────────────────────────────────
  // Three-stage curve: ease-in 0→1 over the first 20 %, hold at 1 for the
  // middle 60 %, ease-out 1→0 for the last 20 %.
  const hLocal = frame - highlightStartF;
  let highlightOp = 0;
  if (hLocal >= 0 && hLocal <= highlightDurF) {
    const hProg = hLocal / highlightDurF;
    if (hProg < 0.20)      highlightOp = hProg / 0.20;
    else if (hProg < 0.80) highlightOp = 1;
    else                   highlightOp = (1 - hProg) / 0.20;
  }

  return (
    <g
      style={{
        transformOrigin: `${cx}px ${cy}px`,
        transform: `scale(${scale})`,
        opacity: op,
      }}
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={cx} y1={tierTopY(i)}
          x2={cx} y2={tierBottomY(i)}
        >
          <stop offset="0%"   stopColor={topColor} />
          <stop offset="100%" stopColor={bottomColor} />
        </linearGradient>
        <linearGradient
          id={highlightId}
          gradientUnits="userSpaceOnUse"
          x1={cx} y1={tierTopY(i)}
          x2={cx} y2={tierBottomY(i)}
        >
          <stop offset="0%"   stopColor={HIGHLIGHT_TOP} />
          <stop offset="100%" stopColor={HIGHLIGHT_BOTTOM} />
        </linearGradient>
      </defs>
      {/* Base dodger fill */}
      <path d={path} fill={`url(#${gradId})`} />
      {/* Oxford highlight overlay — drawn on top with animated opacity */}
      {highlightOp > 0 && (
        <path d={path} fill={`url(#${highlightId})`} opacity={highlightOp} />
      )}
      {/* Bottom divider — thin lighter line at the bottom edge of each slab
          for the stacked-tier read. Skipped on the last tier (no slab below). */}
      {i < 4 && (
        <line
          x1={APEX_X - halfWidthAtY(tierBottomY(i))}
          y1={tierBottomY(i)}
          x2={APEX_X + halfWidthAtY(tierBottomY(i))}
          y2={tierBottomY(i)}
          stroke={SLAB_DIVIDER}
          strokeWidth={1.5}
        />
      )}
    </g>
  );
}

function SlabIcon({
  i, icon, frame, startF, durF,
}: { i: number; icon: string; frame: number; startF: number; durF: number }) {
  const local = frame - startF;
  const scale = interpolate(local, [0, durF], [0.5, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const op = interpolate(local, [0, durF * 0.55], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  if (local < 0) return null;

  const pos = iconPosFor(i);
  return (
    <div
      style={{
        position: 'absolute',
        left: pos.x - ICON_SIZE / 2,
        top:  pos.y - ICON_SIZE / 2,
        width:  ICON_SIZE,
        height: ICON_SIZE,
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        opacity: op,
      }}
    >
      <Img
        src={staticFile(`icons/${icon}.svg`)}
        alt=""
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

function Banner({
  i, title, body, frame,
  bannerStartF, bannerDurF,
  titleStartF, titleDurF,
  bodyStartF, bodyDurF,
  highlightStartF, highlightDurF,
}: {
  i: number; title: string; body: string;
  frame: number;
  bannerStartF: number; bannerDurF: number;
  titleStartF: number;  titleDurF: number;
  bodyStartF: number;   bodyDurF: number;
  highlightStartF: number; highlightDurF: number;
}) {
  // Banner slides in from the right + fade.
  const bLocal = frame - bannerStartF;
  if (bLocal < 0) return null;
  const bannerOp = interpolate(bLocal, [0, bannerDurF * 0.6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const bannerDx = interpolate(bLocal, [0, bannerDurF], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackSubtle,
  });

  // Title fade.
  const tLocal = frame - titleStartF;
  const titleOp = interpolate(tLocal, [0, titleDurF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const titleDx = interpolate(tLocal, [0, titleDurF], [-12, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  // Body fade.
  const bdLocal = frame - bodyStartF;
  const bodyOp = interpolate(bdLocal, [0, bodyDurF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const bodyDx = interpolate(bdLocal, [0, bodyDurF], [-8, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  const left   = bannerLeftXFor(i);
  const top    = bannerTopYFor(i);
  const width  = bannerWidthFor(i);
  const height = bannerHeightFor();

  // ─── Pulse during the highlight window ──────────────────────────────
  // Subtle scale curve (sin) peaking at the midpoint of the highlight.
  const hLocal = frame - highlightStartF;
  let pulseScale = 1;
  if (hLocal >= 0 && hLocal <= highlightDurF) {
    const hProg = hLocal / highlightDurF;
    pulseScale = 1 + 0.030 * Math.sin(hProg * Math.PI);
  }

  return (
    <div
      style={{
        position: 'absolute',
        left, top, width, height,
        transform: `scale(${pulseScale})`,
        transformOrigin: 'center center',
      }}
    >
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateX(${bannerDx}px)`,
        opacity: bannerOp,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: BANNER_RADIUS,
          background: BANNER_BG,
          border:     BANNER_BORDER,
          boxShadow:  BANNER_SHADOW,
        }}
      />
      {/* Inner content: title + body, horizontally arranged, vertically centred */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${BANNER_PAD_X}px`,
          gap: TITLE_BODY_GAP,
        }}
      >
        <div
          style={{
            flex: `0 0 ${TITLE_BLOCK_WIDTH}px`,
            transform: `translateX(${titleDx}px)`,
            opacity: titleOp,
            color: TEXT_ACCENT_BLUE,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 900,
            fontSize: 32,
            letterSpacing: '-0.015em',
            lineHeight: 1.05,
          }}
        >
          {title}
        </div>
        <div
          style={{
            flex: 1,
            transform: `translateX(${bodyDx}px)`,
            opacity: bodyOp,
            color: TEXT_WHITE_DIM,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 20,
            letterSpacing: '-0.003em',
            lineHeight: 1.40,
            maxHeight: height - 12,
            overflow: 'hidden',
          }}
        >
          {body}
        </div>
      </div>
    </div>
    </div>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const Pyramid5Tiers: React.FC<Pyramid5TiersProps> = ({ tiers, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Pyramid5Tiers fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const INTRO_OFFSET = f(t.introOffset);
  const TIER_STAG    = f(t.tierStagger);
  const SLAB_DUR     = f(t.slabDuration);
  const ICON_OFF     = f(t.iconOffset);
  const ICON_DUR     = f(t.iconDuration);
  const BANNER_OFF   = f(t.bannerOffset);
  const BANNER_DUR   = f(t.bannerDuration);
  const TITLE_OFF    = f(t.titleOffset);
  const TITLE_DUR    = f(t.titleDuration);
  const BODY_OFF     = f(t.bodyOffset);
  const BODY_DUR     = f(t.bodyDuration);
  const HIGHLIGHT_START = f(t.highlightStart);
  const HIGHLIGHT_DUR   = f(t.highlightDuration);
  const HIGHLIGHT_GAP   = f(t.highlightGap);
  const HIGHLIGHT_STEP  = HIGHLIGHT_DUR + HIGHLIGHT_GAP;

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {/* SVG pyramid slabs */}
      <svg
        width={CANVAS_W}
        height={CANVAS_H}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        {[0, 1, 2, 3, 4].map(i => (
          <Slab
            key={`slab-${i}`}
            i={i}
            frame={frame}
            startF={INTRO_OFFSET + i * TIER_STAG}
            durF={SLAB_DUR}
            highlightStartF={HIGHLIGHT_START + i * HIGHLIGHT_STEP}
            highlightDurF={HIGHLIGHT_DUR}
          />
        ))}
      </svg>

      {/* Slab icons */}
      {tiers.map((tier, i) => (
        <SlabIcon
          key={`icon-${i}`}
          i={i}
          icon={tier.icon}
          frame={frame}
          startF={INTRO_OFFSET + i * TIER_STAG + ICON_OFF}
          durF={ICON_DUR}
        />
      ))}

      {/* Banners (title + body) */}
      {tiers.map((tier, i) => {
        const base = INTRO_OFFSET + i * TIER_STAG;
        return (
          <Banner
            key={`banner-${i}`}
            i={i}
            title={tier.title}
            body={tier.body}
            frame={frame}
            bannerStartF={base + BANNER_OFF}
            bannerDurF={BANNER_DUR}
            titleStartF={base + TITLE_OFF}
            titleDurF={TITLE_DUR}
            bodyStartF={base + BODY_OFF}
            bodyDurF={BODY_DUR}
            highlightStartF={HIGHLIGHT_START + i * HIGHLIGHT_STEP}
            highlightDurF={HIGHLIGHT_DUR}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const pyramid5TiersDefaultProps: Pyramid5TiersProps = {
  tiers: [
    {
      title: 'Outcomes',
      body:  'What the user actually receives. Value, results, the feeling of progress. Everything below is in service of this.',
      icon:  'trophy',
    },
    {
      title: 'UX',
      body:  'Interface and interaction patterns. Where humans meet the machine and decide whether they trust it.',
      icon:  'monitor',
    },
    {
      title: 'Reasoning',
      body:  'Models, prompts, and chains of thought. The cognitive layer that turns inputs into useful outputs.',
      icon:  'cpu',
    },
    {
      title: 'Tools',
      body:  'APIs, functions, retrieval. The machinery the model reaches for.',
      icon:  'settings',
    },
    {
      title: 'Data',
      body:  'Documents, training sets, embeddings. The foundation everything is built on.',
      icon:  'database',
    },
  ],
};
