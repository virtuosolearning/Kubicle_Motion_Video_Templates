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

// Ports the Splitscreen Points v1 prototype:
//   • The Oxford Blue right half pans in from off-canvas right over 0.0–0.6 s
//     (easeInOutCubic). The platinum-blue left half is part of the AbsoluteFill
//     background — the BG asset is transparent on the left.
//   • Two group titles fade + slide-up at 0.85 s. Left = #00B8EE, right = #FF3D8A.
//   • 1–4 pills per side (independent counts). Each pill scales 0 → 1 with
//     easeOutBack from its centre over 0.75 s, staggered: row 0 at 1.40 s,
//     row 1 at 2.40 s, etc. Pills are top-aligned from row 0 — a side with
//     fewer than 4 simply leaves the lower rows empty (no auto-centring).
//   • Pill text fades in at startTime + 0.55 over 0.30 s.
//   • Icons (optional) sit inside the pill's circle on the left edge.
//   • Default composition length is 300 frames (10 s @ 30 fps).
//
// Note: the prototype's BG was static. This port adds a 0.6 s pan-in so the
// scene establishes the splitscreen frame before the content animates in;
// title and pill timings are pushed back 0.6 s from the prototype to match.

// ─── Schema ──────────────────────────────────────────────────────────────────

const pillSchema = z.object({
  // Pill caption — Satoshi Medium (500) at 40 px. ≤22 chars to fit the pill body.
  text: z.string().min(1).max(22),
  // Optional Small-Icons id — resolves to small-icons/<id>.svg (the shared
  // Small-Icons/ folder, pre-coloured white). E.g. "arrow-trend-up",
  // "graduation-cap", "benefit-hand". Renders white inside the pill's circle
  // (blue on the left, pink on the right). Omit to leave the circle plain.
  icon: z.string().min(1).optional(),
});

const sectionSchema = z.object({
  // Group title — Satoshi 900 at 58 px. ≤40 chars to keep on one line.
  title: z.string().min(1).max(40),
  // 1 to 4 pills, top → bottom. Each side is independent (e.g. left 1, right 4).
  // Pills are top-aligned from row 0; fewer than 4 leave the lower rows empty.
  pills: z.array(pillSchema).min(1).max(4),
});

// Optional per-render timing overrides. All values in SECONDS.
export const splitscreenPointsV1TimingsSchema = z
  .object({
    bgPanStart:    z.number().nonnegative(),
    bgPanDuration: z.number().positive(),
    titleStart:    z.number().nonnegative(),
    titleDuration: z.number().positive(),
    rowStarts:     z.array(z.number().nonnegative()).min(1).max(4),
    pillScaleDuration: z.number().positive(),
    pillTextOffset: z.number().nonnegative(),
    pillTextDuration: z.number().positive(),
  })
  .partial();

export const splitscreenPointsV1Schema = z.object({
  // Left section — dark side, white text, blue accent.
  left:  sectionSchema,
  // Right section — light side, dark text, pink accent.
  right: sectionSchema,
  timings: splitscreenPointsV1TimingsSchema.optional(),
});

export type SplitscreenPointsV1Props = z.infer<typeof splitscreenPointsV1Schema>;

export const splitscreenPointsV1Meta = {
  description:
    'Two-column comparison: 4 blue pills on the dark left side, 4 pink pills ' +
    'on the light right side, each with a title above. Pills pop in row-by-row.',
  authoringNotes:
    'left and right each take a title (Satoshi Black 58 px, ≤40 chars) and ' +
    '1 to 4 pills (Satoshi Medium 40 px, ≤22 chars each). The two sides are ' +
    'independent — e.g. left 1 pill, right 4 — and pills are top-aligned from ' +
    'the first row (fewer pills leave the lower rows empty). Use when comparing ' +
    'two sets ' +
    '(pros vs cons, before vs after, etc.). Optional per-pill icon is a ' +
    'Small-Icons id (small-icons/<id>.svg, pre-coloured white) shown in the ' +
    'circle. Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BG_SRC          = staticFile('Template-Specific-Assets/oxfordblue_splitscreen_bg.png');
const PILL_LEFT_SRC   = staticFile('Template-Specific-Assets/pill_left_side.png');
const PILL_RIGHT_SRC  = staticFile('Template-Specific-Assets/pill_right_side.png');
const SATOSHI_BLACK_SRC  = staticFile('fonts/Satoshi-Black.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (lifted directly from the prototype) ────────────────────

// Pill geometry inside each pill PNG (1920×1080).
const PILL_W       = 693;
const PILL_H       = 111;
const CIRCLE_D     = 111;
const LEFT_PILL_X  = 156;
const RIGHT_PILL_X = 1032;
const PILL_Y       = 353;
const ROW_STEP     = 133;

// Section title position (above row 0).
const TITLE_Y      = 210;

// Section colours. Left swapped from the prototype's #00B8EE (lighter cyan)
// to #0496FF (Dodger Blue) per design correction.
const LEFT_BLUE  = '#0496FF';
const RIGHT_PINK = '#FF3D8A';

const TITLE_SLIDE_DISTANCE = 28;

// BG pan-in: the asset's dark right half (x=960..1920) starts off-canvas and
// slides into place. Translating the full-canvas image by +960 px pushes the
// dark half fully off the right edge.
const BG_PAN_TRAVEL = 960;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  // BG pan-in (Oxford Blue right half slides in from off-canvas right).
  bgPanStart:    0.00,
  bgPanDuration: 0.60,
  // Title + pills wait until BG has landed (+0.60 s offset from prototype).
  titleStart:    0.85,           // was 0.25 in the static prototype
  titleDuration: 0.55,           // covers both opacity (0.45) + slide (0.55)
  rowStarts:     [1.40, 2.40, 3.40, 4.40] as readonly number[],  // was [0.80…3.80]
  pillScaleDuration: 0.75,
  pillTextOffset:    0.55,       // relative to pill scale start
  pillTextDuration:  0.30,
} as const;

const easeInOutCubic = Easing.inOut(Easing.cubic);
const easeOutBack = Easing.out(Easing.back(1.70158));
const easeOutQuad = Easing.out(Easing.quad);
const easeOutExpo = Easing.out(Easing.exp);

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const black  = new FontFace('Satoshi', `url(${SATOSHI_BLACK_SRC}) format('woff2')`,  { weight: '900', display: 'block' });
    const medium = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`, { weight: '500', display: 'block' });
    const [k, m] = await Promise.all([black.load(), medium.load()]);
    const fonts  = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(k);
    fonts.add(m);
  })();
  return fontsPromise;
}

// ─── Group title (slides up + fades) ─────────────────────────────────────────

function GroupTitle({
  frame,
  text,
  color,
  x,
  titleStart,
  titleDur,
}: {
  frame: number;
  text: string;
  color: string;
  x: number;
  titleStart: number;
  titleDur: number;
}) {
  const opacity = interpolate(frame, [titleStart, titleStart + titleDur * 0.82], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutQuad,
  });
  const slideProg = interpolate(frame, [titleStart, titleStart + titleDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutExpo,
  });
  const ty = (1 - slideProg) * TITLE_SLIDE_DISTANCE;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top:  TITLE_Y,
        zIndex: 2,
        opacity,
        transform: `translateY(${ty}px)`,
      }}
    >
      <span
        style={{
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 900,
          fontSize: 58,
          color,
          letterSpacing: '-0.5px',
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </span>
    </div>
  );
}

// ─── Animated pill ───────────────────────────────────────────────────────────

function AnimPill({
  frame,
  side,
  rowIndex,
  text,
  icon,
  startFrame,
  scaleDur,
  textOffset,
  textDur,
}: {
  frame: number;
  side: 'left' | 'right';
  rowIndex: number;
  text: string;
  icon?: string;
  startFrame: number;
  scaleDur: number;
  textOffset: number;
  textDur: number;
}) {
  const isLeft = side === 'left';
  const textColor = isLeft ? '#FFFFFF' : '#0C1A28';
  const pillSrc   = isLeft ? PILL_LEFT_SRC : PILL_RIGHT_SRC;
  const pillOriginX = isLeft ? LEFT_PILL_X : RIGHT_PILL_X;

  // Scale from 0 → 1 with easeOutBack.
  const scale = interpolate(frame, [startFrame, startFrame + scaleDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutBack,
  });

  // Text fade-in starts after the pill has popped most of the way.
  const textStart = startFrame + textOffset;
  const textOp = interpolate(frame, [textStart, textStart + textDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutQuad,
  });

  if (scale <= 0) return null;

  const stageX = pillOriginX;
  const stageY = PILL_Y + rowIndex * ROW_STEP;

  return (
    <div
      style={{
        position: 'absolute',
        left: stageX,
        top:  stageY,
        width:  PILL_W,
        height: PILL_H,
        zIndex: 2,
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        pointerEvents: 'none',
      }}
    >
      {/* Pill PNG asset, shifted so the pill region fills this container */}
      <Img
        src={pillSrc}
        alt=""
        style={{
          position: 'absolute',
          top:  -PILL_Y,
          left: -pillOriginX,
          width:  1920,
          height: 1080,
          display: 'block',
          pointerEvents: 'none',
        }}
      />

      {/* Optional icon — sits centred inside the circle on the pill's left edge */}
      {icon && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top:  0,
            width:  CIRCLE_D,
            height: CIRCLE_D,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3,
            pointerEvents: 'none',
          }}
        >
          <Img
            src={staticFile(`small-icons/${icon}.svg`)}
            alt=""
            style={{
              width:  CIRCLE_D * 0.58,
              height: CIRCLE_D * 0.58,
              display: 'block',
            }}
          />
        </div>
      )}

      {/* Text — fades in after the pill has popped. Container is the full
          pill height with flex+center for line-box centring; the SPAN gets a
          small upward translate so the cap-height (visual centre) sits on
          the pill's mid-line instead of below it. No overflow clipping, so
          descenders (g, y, p) render fully. */}
      <div
        style={{
          position: 'absolute',
          left: CIRCLE_D + 18,
          top:  0,
          height: PILL_H,
          display: 'flex',
          alignItems: 'center',
          opacity: textOp,
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 40,
            color: textColor,
            whiteSpace: 'nowrap',
            letterSpacing: '-0.3px',
            // Optical centring nudge — flex centres the line-box, but the
            // glyph cap sits below the line-box centre by ~descender-height.
            // -5 px brings the cap-height visually onto the pill mid-line.
            transform: 'translateY(-5px)',
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const SplitscreenPointsV1: React.FC<SplitscreenPointsV1Props> = ({
  left,
  right,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading SplitscreenPointsV1 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BG_PAN_START     = f(t.bgPanStart);
  const BG_PAN_END       = BG_PAN_START + f(t.bgPanDuration);
  const TITLE_START      = f(t.titleStart);
  const TITLE_DUR        = f(t.titleDuration);
  const PILL_SCALE_DUR   = f(t.pillScaleDuration);
  const PILL_TEXT_OFFSET = f(t.pillTextOffset);
  const PILL_TEXT_DUR    = f(t.pillTextDuration);

  // One start frame per pill row. Use the matching rowStarts entry when present,
  // else the default cadence, else a 1 s/row fallback beyond the default list.
  const rowStartF = (i: number) =>
    f(t.rowStarts[i] ?? DEFAULT_TIMINGS.rowStarts[i] ?? 1.4 + i * 1.0);

  // BG pan-in — Oxford Blue half slides in from off-canvas right.
  const bgX = interpolate(frame, [BG_PAN_START, BG_PAN_END], [BG_PAN_TRAVEL, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Background — splitscreen BG asset has a TRANSPARENT left half;
          the platinum-blue AbsoluteFill shows through on the left while the
          asset's dark navy fills the right. The asset pans in from the right
          before the rest of the animation begins. */}
      <Img
        src={BG_SRC}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width:  '100%',
          height: '100%',
          objectFit: 'fill',
          display: 'block',
          transform: `translateX(${bgX}px)`,
        }}
      />

      {/* Left section title */}
      <GroupTitle
        frame={frame}
        text={left.title}
        color={LEFT_BLUE}
        x={LEFT_PILL_X}
        titleStart={TITLE_START}
        titleDur={TITLE_DUR}
      />

      {/* Right section title */}
      <GroupTitle
        frame={frame}
        text={right.title}
        color={RIGHT_PINK}
        x={RIGHT_PILL_X}
        titleStart={TITLE_START}
        titleDur={TITLE_DUR}
      />

      {/* Left pills (1–4, top-aligned from row 0) */}
      {left.pills.map((pill, i) => (
        <AnimPill
          key={`l${i}`}
          frame={frame}
          side="left"
          rowIndex={i}
          text={pill.text}
          icon={pill.icon}
          startFrame={rowStartF(i)}
          scaleDur={PILL_SCALE_DUR}
          textOffset={PILL_TEXT_OFFSET}
          textDur={PILL_TEXT_DUR}
        />
      ))}

      {/* Right pills (1–4, top-aligned from row 0) */}
      {right.pills.map((pill, i) => (
        <AnimPill
          key={`r${i}`}
          frame={frame}
          side="right"
          rowIndex={i}
          text={pill.text}
          icon={pill.icon}
          startFrame={rowStartF(i)}
          scaleDur={PILL_SCALE_DUR}
          textOffset={PILL_TEXT_OFFSET}
          textDur={PILL_TEXT_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};
