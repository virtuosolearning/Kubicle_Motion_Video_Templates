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

// Ports the "3 Big Points v4" prototype:
//   • Three pillar cards (Base_Container.png) appear sequentially: card 1 at
//     0.20 s, card 2 at 3.30 s, card 3 at 6.40 s — each runs the same beat.
//   • Per-card beat (relative to the card's start time):
//       0.00 – 0.70   easeOutBack (subtle, c1=0.9) scale-in + 0.40 s fade-in
//       0.45 – 1.05   title + icon fade in
//       1.05 – 1.50   pill + sphere fade in (asset rendered as-is, no clip)
//       1.55 – 2.40   subtopic types out character-by-character
//   • Default composition length is 300 frames (10 s @ 30 fps).
//
// Icons are rendered "Pure White line art" — Oxford Blue root AND Dodger Blue
// accents both forced to white. Patched at port time, see icons/ folder.

// ─── Schema ──────────────────────────────────────────────────────────────────

const cardSchema = z.object({
  // Header title — bold white, one line, ≤25 chars at 55 px.
  title:    z.string().min(1).max(25),
  // Body subtopic — types out beside the numbered sphere. ≤30 chars to fit.
  subtopic: z.string().min(1).max(30),
  // Icon ID from icons/ (e.g. "document-folder", "analytics", "success").
  // Renders pure white at 400×400 between title and pill.
  icon:     z.string().min(1),
});

// Optional per-render timing overrides. All values in SECONDS.
// cardStarts must contain exactly 3 entries (one per card).
export const threeBigPointsV4TimingsSchema = z
  .object({
    cardStarts:      z.array(z.number().nonnegative()).length(3),
    cardScaleDur:    z.number().positive(),
    cardFadeDur:     z.number().positive(),
    contentFadeIn:   z.number().nonnegative(),
    contentFadeEnd:  z.number().positive(),
    pillFadeIn:      z.number().nonnegative(),
    pillFadeOut:     z.number().positive(),
    typeStart:       z.number().nonnegative(),
    typeDur:         z.number().positive(),
  })
  .partial();

export const threeBigPointsV4Schema = z.object({
  // Exactly 3 cards, ordered left → right.
  cards: z.array(cardSchema).length(3),
  timings: threeBigPointsV4TimingsSchema.optional(),
});

export type ThreeBigPointsV4Props = z.infer<typeof threeBigPointsV4Schema>;

export const threeBigPointsV4Meta = {
  description:
    'Three pillar cards on a light blue background, appearing one-by-one. Each ' +
    'shows a title, a large white icon, a numbered sphere, and a subtopic that ' +
    'types out below. Best for three sequential takeaways or steps.',
  authoringNotes:
    'Always supply exactly 3 cards. title is the bold white headline (Inter ' +
    'ExtraBold, 55 px) — strict 25-char max. GOOD: "Plan", "Build", "Ship". ' +
    'BAD: "Plan the project carefully" (too long). subtopic is the typewriter ' +
    'body line beside the sphere (Satoshi Medium, 33 px) — strict 30-char max. ' +
    'GOOD: "Define entities and relationships". BAD: long sentences with ' +
    'commas — keep noun phrases. icon is an id from the catalog (e.g. ' +
    '"document-folder", "analytics", "success"). Default duration 300 frames ' +
    '(10 s); the third card finishes around 8.5 s.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BASE_CONTAINER_SRC  = staticFile('images/base_container.png');
const PILL_AND_SPHERE_SRC = staticFile('images/pill_and_sphere.png');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_MEDIUM_SRC  = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (lifted directly from the HTML) ─────────────────────────

// Base_Container.png solid bbox: x=82..651 (centre 366), y=226..1027 (centre 626).
const CARD_SRC_CX = 366;
const CARD_SRC_CY = 626;

// Final card centre x positions in the 1920×1080 frame, plus a uniform Y shift.
const CARD_FINAL_CXS = [356, 961, 1566] as const;
const CARD_OFFSET_Y  = -80;

// Sphere bbox inside the card asset (centre of the numbered disc).
const SPHERE_LEFT = 124;
const SPHERE_TOP  = 913;
const SPHERE_W    = 84;
const SPHERE_H    = 81;

// Title position inside the card (centred horizontally on CARD_SRC_CX).
const TITLE_TOP = 296;
// Icon: 400×400, centred at (CARD_SRC_CX, 625).
const ICON_SIZE = 400;
const ICON_TOP  = 425;
// Subtopic position: right of the sphere, vertically centred on it.
const SUBTOPIC_LEFT  = 232;
const SUBTOPIC_WIDTH = 380;
const SUBTOPIC_CY    = SPHERE_TOP + SPHERE_H / 2;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

// Defaults expressed in SECONDS — readable at a glance.
const DEFAULT_TIMINGS = {
  // Card start offsets (absolute, scene timeline).
  cardStarts:     [0.20, 3.30, 6.40] as readonly number[],
  // Per-card beat (relative to card start).
  cardScaleDur:   0.70,
  cardFadeDur:    0.40,
  contentFadeIn:  0.45,
  contentFadeEnd: 1.05,
  pillFadeIn:     1.05,
  pillFadeOut:    1.50,
  typeStart:      1.55,
  typeDur:        0.85,
} as const;

// Subtle easeOutBack with c1=0.9 (gentle overshoot, no bounce).
const subtleBackEase = Easing.out(Easing.back(0.9));
const cubicInOut     = Easing.inOut(Easing.cubic);

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

// ─── A single card ────────────────────────────────────────────────────────────

function Card({
  index,
  frame,
  card,
  cardStartFrame,
  cardScaleDur,
  cardFadeDur,
  contentFadeIn,
  contentFadeEnd,
  pillFadeIn,
  pillFadeOut,
  typeStart,
  typeDur,
}: {
  index: number;
  frame: number;
  card: { title: string; subtopic: string; icon: string };
  cardStartFrame: number;
  cardScaleDur: number;
  cardFadeDur: number;
  contentFadeIn: number;
  contentFadeEnd: number;
  pillFadeIn: number;
  pillFadeOut: number;
  typeStart: number;
  typeDur: number;
}) {
  const localFrame = frame - cardStartFrame;
  if (localFrame < 0) return null;

  // Card scale + fade (settles to 1 once cardScaleDur passes).
  const scaleProg    = interpolate(localFrame, [0, cardScaleDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const settled      = localFrame >= cardScaleDur;
  const cardScale    = settled ? 1 : (scaleProg > 0 ? subtleBackEase(scaleProg) : 0);
  const cardOpacity  = interpolate(localFrame, [0, cardFadeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  // Title + icon fade together once the card has mostly arrived.
  const contentOp = interpolate(localFrame, [contentFadeIn, contentFadeEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: cubicInOut,
  });

  // Pill + sphere fade in as a single asset.
  const pillOp = interpolate(localFrame, [pillFadeIn, pillFadeOut], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: cubicInOut,
  });

  // Subtopic typewriter — kicks off after the pill expansion.
  const typeProg = interpolate(localFrame, [typeStart, typeStart + typeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const charsShow = Math.floor(card.subtopic.length * typeProg);
  const visibleSub = card.subtopic.slice(0, charsShow);

  // Position offset to land this card at its final-comp centre.
  const offsetX = CARD_FINAL_CXS[index]! - CARD_SRC_CX;
  const offsetY = CARD_OFFSET_Y;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translate(${offsetX}px, ${offsetY}px) scale(${cardScale})`,
        transformOrigin: `${CARD_SRC_CX}px ${CARD_SRC_CY}px`,
        opacity: cardOpacity,
        pointerEvents: 'none',
      }}
    >
      {/* Blue gradient card */}
      <Img
        src={BASE_CONTAINER_SRC}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* Title */}
      <div
        style={{
          position: 'absolute',
          left: CARD_SRC_CX,
          top:  TITLE_TOP,
          transform: 'translateX(-50%)',
          color: '#FFFFFF',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 55,
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          opacity: contentOp,
        }}
      >
        {card.title}
      </div>

      {/* Icon — large white line art, centred between title and pill */}
      <div
        style={{
          position: 'absolute',
          left: CARD_SRC_CX - ICON_SIZE / 2,
          top:  ICON_TOP,
          width:  ICON_SIZE,
          height: ICON_SIZE,
          opacity: contentOp,
        }}
      >
        <Img
          src={staticFile(`icons/${card.icon}.svg`)}
          alt=""
          style={{ width: ICON_SIZE, height: ICON_SIZE }}
        />
      </div>

      {/* Pill + sphere asset (rendered as-is, drop shadow baked in) */}
      <Img
        src={PILL_AND_SPHERE_SRC}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width:  '100%',
          height: '100%',
          display: 'block',
          opacity: pillOp,
        }}
      />

      {/* Number inside the sphere — flex-centred to the sphere's bbox */}
      <div
        style={{
          position: 'absolute',
          left: SPHERE_LEFT,
          top:  SPHERE_TOP,
          width:  SPHERE_W,
          height: SPHERE_H,
          display: 'flex',
          alignItems:     'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 38,
          lineHeight: 1,
          opacity: pillOp,
        }}
      >
        {index + 1}
      </div>

      {/* Subtopic typewriter — right of the sphere */}
      <div
        style={{
          position: 'absolute',
          left: SUBTOPIC_LEFT,
          top:  SUBTOPIC_CY,
          transform: 'translateY(-50%)',
          width: SUBTOPIC_WIDTH,
          color: '#0B1E33',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500,
          fontSize: 33,
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap',
          opacity: localFrame >= typeStart ? 1 : 0,
        }}
      >
        {visibleSub}
      </div>
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const ThreeBigPointsV4: React.FC<ThreeBigPointsV4Props> = ({ cards, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading ThreeBigPointsV4 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const CARD_STARTS    = t.cardStarts.map(f);
  const CARD_SCALE_DUR = f(t.cardScaleDur);
  const CARD_FADE_DUR  = f(t.cardFadeDur);
  const CONTENT_FADE_IN  = f(t.contentFadeIn);
  const CONTENT_FADE_END = f(t.contentFadeEnd);
  const PILL_FADE_IN   = f(t.pillFadeIn);
  const PILL_FADE_OUT  = f(t.pillFadeOut);
  const TYPE_START     = f(t.typeStart);
  const TYPE_DUR       = f(t.typeDur);

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {([0, 1, 2] as const).map(i => (
        <Card
          key={i}
          index={i}
          frame={frame}
          card={cards[i]!}
          cardStartFrame={CARD_STARTS[i]!}
          cardScaleDur={CARD_SCALE_DUR}
          cardFadeDur={CARD_FADE_DUR}
          contentFadeIn={CONTENT_FADE_IN}
          contentFadeEnd={CONTENT_FADE_END}
          pillFadeIn={PILL_FADE_IN}
          pillFadeOut={PILL_FADE_OUT}
          typeStart={TYPE_START}
          typeDur={TYPE_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};
