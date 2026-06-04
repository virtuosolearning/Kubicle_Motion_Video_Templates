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

// Ports the Word Definition prototype:
//   • Banner (top-left graphic) slides down from off-canvas top over 0.0–1.47 s
//     (easeOutCubic, 520 px travel).
//   • Icon pill (top-right) slides in from off-canvas right over 0.0–1.47 s
//     (easeOutCubic, 700 px travel).
//   • Title typewriter — characters reveal staggered (easeInOutQuad curve) from
//     0.0 to 1.3 s; each letter fades in over 0.25 s.
//   • Description fades in 0.67–2.67 s (easeInOutQuad).
//   • Default composition length is 300 frames (10 s @ 30 fps).
//
// The prototype supports four background styles + four entry directions per
// element. This port locks to the persisted defaults: gradient platinum-blue
// background, banner from top, pill from right, description fade-in.

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
export const wordDefinitionTimingsSchema = z
  .object({
    bannerSettle:    z.number().positive(),
    pillSettle:      z.number().positive(),
    titleTypeStart:  z.number().nonnegative(),
    titleTypeEnd:    z.number().positive(),
    titleLetterFade: z.number().positive(),
    descFadeStart:   z.number().nonnegative(),
    descFadeEnd:     z.number().positive(),
  })
  .partial();

export const wordDefinitionSchema = z.object({
  // The word being defined (e.g. "Serendipity"). Inter ExtraBold 74 px,
  // ALWAYS near-black ink (locked to the brand palette).
  title: z.string().min(1).max(40),
  // The definition text. Satoshi Medium 55.5 px, warm-grey, wraps.
  description: z.string().min(1).max(200),
  timings: wordDefinitionTimingsSchema.optional(),
});

export type WordDefinitionProps = z.infer<typeof wordDefinitionSchema>;

export const wordDefinitionMeta = {
  description:
    'Vocabulary card: the word types out letter-by-letter top-left, the ' +
    'definition fades in below it, a banner drops from the top and an icon ' +
    'pill slides in from the right.',
  authoringNotes:
    'Two editable fields: title (the word being defined; Inter ExtraBold 74 px, ' +
    'near-black ink — colour locked) and description (Satoshi Medium 55.5 px, ' +
    'warm-grey, wraps to multiple lines). The platinum-blue gradient ' +
    'background, the title-text colour, and the description-text colour are ' +
    'all LOCKED to the brand palette — no per-render overrides. GOOD title: ' +
    '"Serendipity", "Ephemeral". GOOD description: "The occurrence of events ' +
    'by chance in a happy way." Aim for definitions under 120 chars so they ' +
    'fit 2–3 lines. Default duration 300 frames (10 s); hold time after ' +
    'animation completes is ~7 s.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BANNER_SRC = staticFile('Template-Specific-Assets/word_definition_banner.png');
const ICON_PILL_SRC = staticFile('Template-Specific-Assets/icon_pill.png');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_MEDIUM_SRC  = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (lifted directly from the prototype's defaults) ─────────

// Title position.
const TITLE_LEFT = 120;
const TITLE_TOP  = 460;
const TITLE_SIZE = 74;
const TITLE_LINE_HEIGHT = 1.05;

// Description position (below title with 40 px gap).
const DESC_TOP_OFFSET = 40;  // gap below title baseline
const DESC_SIZE = 55.5;
const DESC_LINE_HEIGHT = 1.25;

// Right-safe boundary so title/description don't run into the icon pill.
const RIGHT_SAFE_X = 1320;

// Brand-locked colours + background tint. NOT overridable per render.
const TITLE_COLOUR       = '#0B1B2B';   // near-black ink
const DESC_COLOUR        = '#4A5864';   // warm grey
const BACKGROUND_HUE     = 210;          // cool platinum blue
const BACKGROUND_GRADIENT =
  `linear-gradient(135deg, oklch(97% 0.012 ${BACKGROUND_HUE}) 0%, ` +
  `oklch(92% 0.022 ${BACKGROUND_HUE}) 100%)`;

// Banner + pill entry distances.
const BANNER_SLIDE_DISTANCE = 520;  // banner enters from top
const PILL_SLIDE_DISTANCE   = 700;  // pill enters from right

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  bannerSettle:    1.47,
  pillSettle:      1.47,
  titleTypeStart:  0.00,
  titleTypeEnd:    1.30,
  titleLetterFade: 0.25,
  descFadeStart:   0.67,
  descFadeEnd:     2.67,
} as const;

const easeOutCubic    = Easing.out(Easing.cubic);
const easeInOutQuad   = Easing.inOut(Easing.quad);
const easeOutQuad     = Easing.out(Easing.quad);

// Easing curve for letter stagger (ease — both ends slow, middle fast).
const staggerCurve = (i: number) => easeInOutQuad(i);

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

// ─── Banner (top-left, slides in from above) ─────────────────────────────────

function Banner({ frame, settleFrames }: { frame: number; settleFrames: number }) {
  const prog = interpolate(frame, [0, settleFrames], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const ty = -BANNER_SLIDE_DISTANCE * (1 - prog);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateY(${ty}px)`,
        transformOrigin: '175px 175px',
        pointerEvents: 'none',
      }}
    >
      <Img
        src={BANNER_SRC}
        alt=""
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

// ─── Icon pill (top-right, slides in from off-canvas right) ──────────────────

function IconPill({ frame, settleFrames }: { frame: number; settleFrames: number }) {
  const prog = interpolate(frame, [0, settleFrames], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const tx = PILL_SLIDE_DISTANCE * (1 - prog);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateX(${tx}px)`,
        transformOrigin: '1630px 540px',
        pointerEvents: 'none',
      }}
    >
      <Img
        src={ICON_PILL_SRC}
        alt=""
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

// ─── Typewriter title ────────────────────────────────────────────────────────
// Characters reveal one-by-one using a staggered fade-in. The whole word
// finishes by titleTypeEnd seconds.

function TypewriterTitle({
  frame,
  text,
  color,
  startFrame,
  endFrame,
  letterFadeFrames,
}: {
  frame: number;
  text: string;
  color: string;
  startFrame: number;
  endFrame: number;
  letterFadeFrames: number;
}) {
  const chars = Array.from(text);
  const n = chars.length;
  const total = Math.max(0.001, endFrame - startFrame);
  const spanRange = Math.max(0.001, total - letterFadeFrames);

  return (
    <div
      style={{
        position: 'absolute',
        left: TITLE_LEFT,
        top:  TITLE_TOP,
        fontFamily: "'Inter', system-ui, sans-serif",
        fontWeight: 800,
        fontSize: TITLE_SIZE,
        lineHeight: TITLE_LINE_HEIGHT,
        color,
        letterSpacing: '-0.015em',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        maxWidth: Math.max(200, RIGHT_SAFE_X - TITLE_LEFT),
      }}
    >
      {chars.map((ch, i) => {
        const iNorm = n <= 1 ? 0 : i / (n - 1);
        const letterStart = startFrame + staggerCurve(iNorm) * spanRange;
        const letterEnd   = letterStart + letterFadeFrames;
        const local = Math.max(0, Math.min(1, (frame - letterStart) / Math.max(0.001, letterEnd - letterStart)));
        const op = easeOutQuad(local);
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: op,
              whiteSpace: 'pre',
            }}
          >
            {ch === ' ' ? ' ' : ch}
          </span>
        );
      })}
    </div>
  );
}

// ─── Description (fades in below title) ──────────────────────────────────────

function Description({
  frame,
  text,
  color,
  fadeStart,
  fadeEnd,
}: {
  frame: number;
  text: string;
  color: string;
  fadeStart: number;
  fadeEnd: number;
}) {
  const opacity = interpolate(frame, [fadeStart, fadeEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutQuad,
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: TITLE_LEFT,
        top:  TITLE_TOP + TITLE_SIZE + DESC_TOP_OFFSET,
        fontFamily: "'Satoshi', 'Inter', system-ui, sans-serif",
        fontWeight: 500,
        fontSize: DESC_SIZE,
        lineHeight: DESC_LINE_HEIGHT,
        color,
        letterSpacing: '-0.005em',
        opacity,
        maxWidth: Math.max(200, RIGHT_SAFE_X - TITLE_LEFT),
      }}
    >
      {text}
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const WordDefinition: React.FC<WordDefinitionProps> = ({
  title,
  description,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading WordDefinition fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BANNER_SETTLE  = f(t.bannerSettle);
  const PILL_SETTLE    = f(t.pillSettle);
  const TITLE_START    = f(t.titleTypeStart);
  const TITLE_END      = f(t.titleTypeEnd);
  const LETTER_FADE    = f(t.titleLetterFade);
  const DESC_START     = f(t.descFadeStart);
  const DESC_END       = f(t.descFadeEnd);

  return (
    <AbsoluteFill style={{ background: BACKGROUND_GRADIENT, overflow: 'hidden' }}>
      <Banner frame={frame} settleFrames={BANNER_SETTLE} />
      <IconPill frame={frame} settleFrames={PILL_SETTLE} />
      <TypewriterTitle
        frame={frame}
        text={title}
        color={TITLE_COLOUR}
        startFrame={TITLE_START}
        endFrame={TITLE_END}
        letterFadeFrames={LETTER_FADE}
      />
      <Description
        frame={frame}
        text={description}
        color={DESC_COLOUR}
        fadeStart={DESC_START}
        fadeEnd={DESC_END}
      />
    </AbsoluteFill>
  );
};
