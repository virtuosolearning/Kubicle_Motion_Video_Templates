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

// BigPoints3V2Character — character-only variant of BigPoints3V2.
//
// Same layout, animation, and three-card waterfall as the icon version.
// The only difference is the anchor inside each card: instead of a
// 400×400 line-art icon, each card hosts a CHARACTER PORTRAIT positioned
// so the face lands at the centre of the card body.
//
// The card itself (`base_container.png`) is already a dodger-blue
// gradient panel with rounded corners, so the character sits directly
// on that gradient — no separate background rectangle is needed. The
// character image is clipped to the card body via overflow: hidden so
// any lower-torso overflow disappears cleanly behind the pill-and-sphere
// asset at the bottom.
//
// Each of the three cards takes a DIFFERENT character so the trio reads
// as a team rather than three copies of the same person.

// ─── Schema ──────────────────────────────────────────────────────────────────

const characterSchema = z.object({
  // Only the character identity is authorable. Every card renders the portrait
  // at the SAME fixed size and vertical offset (CHARACTER_HEIGHT / CHARACTER_Y)
  // so the tops of all three heads line up across the trio. Swap the id to
  // change the person — never the framing.
  id: z.string().min(1),
});

const cardSchema = z.object({
  title:     z.string().min(1).max(25),
  subtopic:  z.string().min(1).max(30),
  character: characterSchema,
});

export const bigPoints3V2CharacterTimingsSchema = z
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

export const bigPoints3V2CharacterSchema = z.object({
  cards:   z.array(cardSchema).length(3),
  timings: bigPoints3V2CharacterTimingsSchema.optional(),
});

export type BigPoints3V2CharacterProps = z.infer<typeof bigPoints3V2CharacterSchema>;

export const bigPoints3V2CharacterMeta = {
  description:
    'Three pillar cards arriving one-by-one on a platinum-blue base. Same ' +
    'layout + animation as BigPoints3V2 (icon variant), but each card now ' +
    'hosts a CHARACTER PORTRAIT clipped to the dodger-blue card body, ' +
    'with the face landing at the card centre. Use exactly three different ' +
    'characters so the trio reads as a team.',
  authoringNotes:
    'Always supply exactly 3 cards. title ≤25 chars (Inter ExtraBold 55 px). ' +
    'subtopic ≤30 chars (Satoshi Medium 33 px, typewriter). character.id ' +
    'is a PNG ID in characters/<id>.png — the ONLY authorable field. Size ' +
    'and position are fixed for every card so the tops of all three heads ' +
    'line up; you cannot (and should not) resize or reposition a character. ' +
    'Just swap the id to change the person. IMPORTANT: use consistently-framed ' +
    'presenter HEAD-SHOTS (roughly square, face ~27% from the top). Full-body ' +
    'shots or wide/landscape images will NOT align — heads end up different ' +
    'sizes and positions. Use a different character per card for the team ' +
    'feel. Default duration 300 frames.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BASE_CONTAINER_SRC  = staticFile('Template-Specific-Assets/base_container.png');
const PILL_AND_SPHERE_SRC = staticFile('Template-Specific-Assets/pill_and_sphere.png');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_MEDIUM_SRC  = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (lifted directly from BigPoints3V2) ─────────────────────

const CARD_SRC_CX = 366;
const CARD_SRC_CY = 626;

const CARD_FINAL_CXS = [356, 961, 1566] as const;
const CARD_OFFSET_Y  = -80;

const SPHERE_LEFT = 124;
const SPHERE_TOP  = 913;
const SPHERE_W    = 84;
const SPHERE_H    = 81;

// Width capped below the 569 px card body so long titles wrap onto a second
// line instead of bleeding out over the platinum background.
const TITLE_TOP   = 296;
const TITLE_WIDTH = 500;

const SUBTOPIC_LEFT  = 232;
const SUBTOPIC_WIDTH = 380;
const SUBTOPIC_CY    = SPHERE_TOP + SPHERE_H / 2;

// Character container — sized to MATCH THE CARD BODY exactly, with
// rounded corners that follow the card outline. This way:
//   • Any character pixels that extend past the container clip at the
//     same curved shape as the card itself (no straight-line shoulder
//     cut-off — clipping happens on the card edge).
//   • Nothing appears outside the visible blue card.
const CHAR_CONTAINER_LEFT   = 82;
const CHAR_CONTAINER_TOP    = 226;
const CHAR_CONTAINER_WIDTH  = 569;
const CHAR_CONTAINER_HEIGHT = 801;
const CHAR_CONTAINER_RADIUS = 40;

// Fixed for EVERY character — not authorable. Height/Y are identical for all
// three cards so the heads line up across the trio. This ONLY holds for
// consistently-framed presenter head-shots (face ~27% from the PNG top, roughly
// square canvas) — the intended input for this template. Full-body shots or
// non-portrait images won't match in head size/position; no fixed transform can
// reconcile different shot types. Height extends below the 801px container so
// the figure clips at the rounded card edge (image bottom = 130+780 = 910),
// with the pill graphic overlapping the mid-torso.
const CHARACTER_HEIGHT = 780;
const CHARACTER_Y      = 130;   // face lands ~y=567 in card source

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  cardStarts:     [0.20, 3.30, 6.40] as readonly number[],
  cardScaleDur:   0.70,
  cardFadeDur:    0.40,
  contentFadeIn:  0.45,
  contentFadeEnd: 1.05,
  pillFadeIn:     1.05,
  pillFadeOut:    1.50,
  typeStart:      1.55,
  typeDur:        0.85,
} as const;

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
  card: z.infer<typeof cardSchema>;
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

  const contentOp = interpolate(localFrame, [contentFadeIn, contentFadeEnd], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: cubicInOut,
  });

  const pillOp = interpolate(localFrame, [pillFadeIn, pillFadeOut], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: cubicInOut,
  });

  const typeProg = interpolate(localFrame, [typeStart, typeStart + typeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const charsShow = Math.floor(card.subtopic.length * typeProg);
  const visibleSub = card.subtopic.slice(0, charsShow);

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
      {/* Dodger-blue gradient card backdrop */}
      <Img
        src={BASE_CONTAINER_SRC}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* Character portrait — rendered FIRST so title + pill+sphere sit
          ON TOP of the figure. The container fills nearly the full card
          body; the figure is sized so the chest extends down past the
          pill area where it's hidden by the pill graphic. Drop shadow
          lifts the figure off the dodger-blue gradient. */}
      <div
        style={{
          position: 'absolute',
          left:   CHAR_CONTAINER_LEFT,
          top:    CHAR_CONTAINER_TOP,
          width:  CHAR_CONTAINER_WIDTH,
          height: CHAR_CONTAINER_HEIGHT,
          borderRadius: CHAR_CONTAINER_RADIUS,
          overflow: 'hidden',
          opacity: contentOp,
        }}
      >
        <Img
          src={staticFile(`characters/${card.character.id}.png`)}
          alt=""
          style={{
            position: 'absolute',
            left: '50%',
            top:  CHARACTER_Y,
            height: CHARACTER_HEIGHT,
            width:  'auto',
            transform: 'translateX(-50%)',
            display: 'block',
            filter:
              'drop-shadow(0 14px 20px rgba(2, 18, 36, 0.42)) ' +
              'drop-shadow(0 4px 6px rgba(2, 18, 36, 0.32))',
          }}
        />
      </div>

      {/* Title — rendered AFTER character so it always sits on top. */}
      <div
        style={{
          position: 'absolute',
          left: CARD_SRC_CX,
          top:  TITLE_TOP,
          transform: 'translateX(-50%)',
          width: TITLE_WIDTH,
          textAlign: 'center',
          color: '#FFFFFF',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 55,
          lineHeight: 1.05,
          letterSpacing: '-0.01em',
          overflowWrap: 'break-word',
          opacity: contentOp,
        }}
      >
        {card.title}
      </div>

      {/* Pill + sphere asset overlays the bottom of the card — covers the
          character's chest cleanly so there's no visible cut-off line. */}
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

      {/* Number inside the sphere */}
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

      {/* Subtopic typewriter */}
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
          lineHeight: 1.15,
          letterSpacing: '-0.005em',
          overflowWrap: 'break-word',
          opacity: localFrame >= typeStart ? 1 : 0,
        }}
      >
        {visibleSub}
      </div>
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const BigPoints3V2Character: React.FC<BigPoints3V2CharacterProps> = ({ cards, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading BigPoints3V2Character fonts'));
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

// ─── Demo / test props ────────────────────────────────────────────────────────

// character.id values are PNG filenames (sans extension) from the character
// library. Any consistently-framed presenter head-shot works — i.e. every
// library character EXCEPT the non-portrait outliers (daniel = full-body,
// lena = landscape scene), which won't align under the fixed framing.
export const bigPoints3V2CharacterDefaultProps: BigPoints3V2CharacterProps = {
  cards: [
    { title: 'Plan',  subtopic: 'Map the project scope',   character: { id: 'male_middleage_white' } },
    { title: 'Build', subtopic: 'Ship a working first cut', character: { id: 'female_earlycareer_black' } },
    { title: 'Ship',  subtopic: 'Tell the world it exists', character: { id: 'female_middleage_asian' } },
  ],
};
