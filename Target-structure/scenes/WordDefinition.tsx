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

// Ports the media team's "Word Definition" prototype (10s screen).
// Callers supply the word and its definition; every visual detail
// (background style, font choices, animation curves, layout positions)
// is frozen to the DEFAULT_TWEAKS values from scene.jsx.
// Optional per-render timing overrides. All values are in frames at 30 fps;
// any field omitted falls back to the corresponding entry in DEFAULT_TIMINGS.
export const wordDefinitionTimingsSchema = z
  .object({
    bannerSettle: z.number().positive(),
    pillSettle: z.number().positive(),
    titleTwStart: z.number().nonnegative(),
    titleTwEnd: z.number().positive(),
    letterFadeF: z.number().positive(),
    descFadeStart: z.number().nonnegative(),
    descFadeEnd: z.number().nonnegative(),
    outroDuration: z.number().nonnegative(),
  })
  .partial();

export const wordDefinitionSchema = z.object({
  // The word or term being defined. Rendered as a staggered letter-by-
  // letter typewriter at 74px Inter ExtraBold. Keep under ~30 chars so
  // the word lands on one line; wrapping is allowed but shifts the
  // description downward.
  definitionTitle: z.string().min(1).max(60),
  // The definition body. Rendered in Satoshi Medium 500 at 55.5px.
  // Wraps at 1200px (right-safe gutter around the icon pill). Aim for
  // 1-2 sentences; very long definitions push below the visible frame.
  definitionDescription: z.string().min(1).max(300),
  // Optional animation timing overrides (frames @ 30fps).
  timings: wordDefinitionTimingsSchema.optional(),
});

export type WordDefinitionProps = z.infer<typeof wordDefinitionSchema>;

export const wordDefinitionMeta = {
  description:
    'Vocabulary card that reveals a word via a letter-by-letter ' +
    'typewriter effect, then fades in its definition. A decorative ' +
    'banner slides down from the top-left and an icon pill slides in ' +
    'from the right.',
  authoringNotes:
    'Use to introduce technical terms or key concepts mid-lesson. ' +
    'definitionTitle is the word or term (keep under ~30 chars for a ' +
    'single-line reveal). definitionDescription is the definition body ' +
    '- aim for 1-2 short sentences (under ~150 chars) so it comfortably ' +
    'fits the left-hand panel beside the icon pill. Default composition ' +
    'length is 300 frames (10s at 30fps); the outro fade always hugs the ' +
    'last 0.67 seconds.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────
const BACKGROUND_SRC = staticFile('images/word_definition_background.png');
const BANNER_SRC = staticFile('images/banner.png');
const ICON_PILL_SRC = staticFile('images/icon_pill.png');
const INTER_EXTRABOLD_URL = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_MEDIUM_URL = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (from DEFAULT_TWEAKS) ───────────────────────────────────
const TITLE_X = 120;
const TITLE_Y = 460;
const TITLE_SIZE = 74;
const TITLE_COLOR = '#0B1B2B';

// Description sits below the title with a 40px gap.
const DESC_Y = TITLE_Y + TITLE_SIZE + 40; // 574
const DESC_SIZE = 55.5;
const DESC_COLOR = '#4A5864';

// Right-safe gutter: pill's left edge is around x≈1380; leave 60px breathing room.
const CONTENT_MAX_W = 1200;

// ─── Animation timeline (30fps) ───────────────────────────────────────────────
// Timecodes from scene.jsx comments and DEFAULT_TWEAKS:
//   0:00:01:14  = 1s + 14f = 44f  — banner & pill settle
//   0:00:01:09  = 1s + 9f  = 39f  — title typewriter end
//   0:00:00:20  = 20f       ≈ 0.667s — desc fade start
//   0:00:02:20  = 80f       ≈ 2.667s — desc fade end
const DEFAULT_TIMINGS = {
  bannerSettle: 44,
  pillSettle: 44,
  titleTwStart: 0,
  titleTwEnd: 39,
  letterFadeF: 7.5,    // 0.25s × 30fps
  descFadeStart: 20,   // frame 20  (0.667s)
  descFadeEnd: 80,     // frame 80  (2.667s)
  outroDuration: 20,
} as const;

// Layout-only constants (entry slide distances) stay fixed; the slide
// directions are part of the design, not the timing.
const BANNER_DIST = 520;    // px entry offset from top
const PILL_DIST = 700;      // px entry offset from right

const easeOutCubic = Easing.out(Easing.cubic);
const easeInOutQuad = Easing.inOut(Easing.quad);
const easeOutQuad = Easing.out(Easing.quad);
const outroEase = Easing.ease;

// ─── Font loading ─────────────────────────────────────────────────────────────
let fontsPromise: Promise<void> | null = null;

function loadWordDefinitionFonts(): Promise<void> {
  if (fontsPromise) {
    return fontsPromise;
  }
  fontsPromise = (async () => {
    const inter = new FontFace('Inter', `url(${INTER_EXTRABOLD_URL}) format('woff2')`, {
      weight: '800',
      style: 'normal',
      display: 'block',
    });
    const satoshi = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_URL}) format('woff2')`, {
      weight: '500',
      style: 'normal',
      display: 'block',
    });
    const [i, s] = await Promise.all([inter.load(), satoshi.load()]);
    const fonts = document.fonts as FontFaceSet & { add(font: FontFace): void };
    fonts.add(i);
    fonts.add(s);
  })();
  return fontsPromise;
}

// ─── TypewriterTitle ──────────────────────────────────────────────────────────
// Mirrors the prototype's staggered letter reveal. Letters are
// distributed across staggerSpanF frames using an easeInOutQuad
// curve so they cluster slightly in the middle, then each individual
// letter fades in over letterFadeF frames with easeOutQuad.
function TypewriterTitle({
  text,
  frame,
  titleTwStart,
  letterFadeF,
  staggerSpanF,
}: {
  text: string;
  frame: number;
  titleTwStart: number;
  letterFadeF: number;
  staggerSpanF: number;
}) {
  const chars = Array.from(text);
  const n = chars.length;

  return (
    <div
      style={{
        position: 'absolute',
        left: TITLE_X,
        top: TITLE_Y,
        fontFamily: "'Inter', system-ui, sans-serif",
        fontWeight: 800,
        fontSize: TITLE_SIZE,
        lineHeight: 1.05,
        color: TITLE_COLOR,
        letterSpacing: '-0.015em',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        maxWidth: CONTENT_MAX_W,
      }}
    >
      {chars.map((ch, i) => {
        const iNorm = n <= 1 ? 0 : i / (n - 1);
        // easeInOutQuad distributes letters: slow start, fast middle, slow end.
        const staggerOffset = easeInOutQuad(iNorm) * staggerSpanF;
        const letterStartF = titleTwStart + staggerOffset;
        const letterEndF = letterStartF + letterFadeF;
        const local = Math.max(0, Math.min(1, (frame - letterStartF) / letterFadeF));
        const opacity = letterEndF > letterStartF ? easeOutQuad(local) : frame >= letterStartF ? 1 : 0;

        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity,
              whiteSpace: 'pre',
            }}
          >
            {ch === ' ' ? '\u00A0' : ch}
          </span>
        );
      })}
    </div>
  );
}

// ─── Scene ────────────────────────────────────────────────────────────────────
export const WordDefinition: React.FC<WordDefinitionProps> = ({
  definitionTitle,
  definitionDescription,
  timings,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Merge caller-supplied timing overrides over the signed-off defaults.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BANNER_SETTLE = t.bannerSettle;
  const PILL_SETTLE = t.pillSettle;
  const TITLE_TW_START = t.titleTwStart;
  const TITLE_TW_END = t.titleTwEnd;
  const LETTER_FADE_F = t.letterFadeF;
  const STAGGER_SPAN_F = Math.max(0.001, TITLE_TW_END - TITLE_TW_START - LETTER_FADE_F);
  const DESC_FADE_START = t.descFadeStart;
  const DESC_FADE_END = t.descFadeEnd;
  const OUTRO_DURATION = t.outroDuration;

  const [fontHandle] = useState(() => delayRender('Loading WordDefinition fonts'));
  useEffect(() => {
    loadWordDefinitionFonts()
      .catch(() => {})
      .finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  // Banner slides down from above (entry direction: "top")
  const bannerProgress = interpolate(frame, [0, BANNER_SETTLE], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const bannerTy = -BANNER_DIST * (1 - bannerProgress);

  // Icon pill slides in from the right (entry direction: "right")
  const pillProgress = interpolate(frame, [0, PILL_SETTLE], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const pillTx = PILL_DIST * (1 - pillProgress);

  // Description — whole-block easeInOutQuad fade
  const descOpacity = interpolate(frame, [DESC_FADE_START, DESC_FADE_END], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutQuad,
  });

  // Outro
  const outroStart = Math.max(0, durationInFrames - OUTRO_DURATION);
  const outroOpacity = interpolate(frame, [outroStart, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: outroEase,
  });

  return (
    <AbsoluteFill style={{ overflow: 'hidden', opacity: outroOpacity }}>
      {/* Background — platinum-blue gradient matching DEFAULT_TWEAKS backgroundStyle:"gradient" */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(135deg, oklch(97% 0.012 210) 0%, oklch(92% 0.022 210) 100%)',
        }}
      />

      {/* Optional image background — kept available if a render supplies it.
          Rendered above the CSS gradient so swapping to image bg is just a
          future schema addition; for now the gradient is always on top and
          this Img is covered. Remove this comment if image bg is added. */}
      <AbsoluteFill style={{ opacity: 0 }}>
        <Img src={BACKGROUND_SRC} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
      </AbsoluteFill>

      {/* Banner — slides in from top */}
      <AbsoluteFill
        style={{
          transform: `translateY(${bannerTy}px)`,
          transformOrigin: '175px 175px',
        }}
      >
        <Img src={BANNER_SRC} style={{ width: '100%', height: '100%' }} alt="" />
      </AbsoluteFill>

      {/* Icon pill — slides in from right */}
      <AbsoluteFill
        style={{
          transform: `translateX(${pillTx}px)`,
          transformOrigin: '1630px 540px',
        }}
      >
        <Img src={ICON_PILL_SRC} style={{ width: '100%', height: '100%' }} alt="" />
      </AbsoluteFill>

      {/* Typewriter title */}
      <TypewriterTitle
        text={definitionTitle}
        frame={frame}
        titleTwStart={TITLE_TW_START}
        letterFadeF={LETTER_FADE_F}
        staggerSpanF={STAGGER_SPAN_F}
      />

      {/* Definition body */}
      <div
        style={{
          position: 'absolute',
          left: TITLE_X,
          top: DESC_Y,
          fontFamily: "'Satoshi', 'Inter', system-ui, sans-serif",
          fontWeight: 500,
          fontSize: DESC_SIZE,
          lineHeight: 1.25,
          color: DESC_COLOR,
          letterSpacing: '-0.005em',
          opacity: descOpacity,
          maxWidth: CONTENT_MAX_W,
        }}
      >
        {definitionDescription}
      </div>
    </AbsoluteFill>
  );
};
