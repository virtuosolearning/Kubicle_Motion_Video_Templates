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

// CharacterTrioCards — three Pinterest-style profile cards side-by-side,
// each in its own accent colour. Introduces a team trio (panellists,
// instructors, perspectives).
//
// Per-character rendering is controlled by explicit `characterHeight` and
// `characterY` pixel values rather than scale transforms. This decouples
// "how big does the head appear" from "where does the head sit in the
// portrait", so authors can equalise head sizes across cards AND align
// hair-tops while always showing head + shoulders + chest framing.
//
// Animation (buttery-smooth, no overlapping):
//   • Each card pops in with a subtle easeOutBack(1.25) — just a hint of
//     overshoot, no asymmetric squash/stretch (so the bounce can't push
//     a card into its neighbour).
//   • Cards are staggered by the FULL card-in duration so card N fully
//     lands before card N+1 starts. No two cards overlap mid-animation.
//   • Inside each card, content (portrait settle, title slide, badge pop,
//     bio slide, stats stagger, Follow stamp) animates with smooth
//     easeOutCubic / very-subtle easeOutBack — no jolts.

// ─── Schema ──────────────────────────────────────────────────────────────────

const cardSchema = z.object({
  // Character PNG id — resolves to characters/<id>.png. Size + position are
  // FIXED for every card (CHARACTER_HEIGHT / CHARACTER_Y) so all heads match —
  // no per-card tuning. Use a consistently-framed presenter portrait from the
  // character library; do NOT use daniel.png or lena.png (framed differently).
  characterId:     z.string().min(1),
  // Workplace title (NOT a personal name) — bold dark, ≤22 chars to fit.
  title:           z.string().min(1).max(22),
  verified:        z.boolean().optional(),
  bio:             z.string().min(1).max(80),
  followersCount:  z.number().int().nonnegative(),
  postsCount:      z.number().int().nonnegative(),
  // Accent colour — one of the three brand colours only: dodger blue,
  // wild strawberry, or ocean green. Tints the portrait panel, verified
  // tick, and Follow button.
  accentColor:     z.enum(['#0496FF', '#F865B0', '#3AB795']),
});

export const characterTrioCardsTimingsSchema = z
  .object({
    cardInDuration:     z.number().positive(),
    cardStagger:        z.number().positive(),
    portraitInDuration: z.number().positive(),
    titleInOffset:      z.number().positive(),
    titleInDuration:    z.number().positive(),
    badgeInOffset:      z.number().positive(),
    badgeInDuration:    z.number().positive(),
    bioInOffset:        z.number().positive(),
    bioInDuration:      z.number().positive(),
    statsInOffset:      z.number().positive(),
    statsInDuration:    z.number().positive(),
    statsStagger:       z.number().positive(),
    followInOffset:     z.number().positive(),
    followInDuration:   z.number().positive(),
  })
  .partial();

export const characterTrioCardsSchema = z.object({
  cards:   z.array(cardSchema).length(3),
  timings: characterTrioCardsTimingsSchema.optional(),
});

export type CharacterTrioCardsProps = z.infer<typeof characterTrioCardsSchema>;
export type CharacterCardData = z.infer<typeof cardSchema>;

export const characterTrioCardsMeta = {
  description:
    'Three Pinterest-style profile cards side-by-side, each in its own ' +
    'accent colour. Cards pop in left-to-right one at a time (no ' +
    'overlapping), with a subtle overshoot. Inside each card the title, ' +
    'bio, stats and Follow button cascade in smoothly. Use to introduce ' +
    'a trio of characters by workplace role.',
  authoringNotes:
    'Always supply exactly 3 cards. Per-card: characterId (PNG in ' +
    'characters/<id>.png) — use a consistently-framed presenter portrait from ' +
    'the character library; do NOT use daniel.png or lena.png (different ' +
    'framing/scale). Character size + position are FIXED for every card so all ' +
    'heads match — just pick the id, nothing to tune. title (≤22 chars — ' +
    'workplace role, NOT name). bio ≤80 chars (wraps onto the next line, kept ' +
    'inside the card). accentColor is one of three brand colours only: #0496FF ' +
    '(dodger blue), #F865B0 (wild strawberry), or #3AB795 (ocean green) — it ' +
    'tints the portrait panel, the verified tick, and the Follow button. ' +
    'Default duration 450 frames; cards land sequentially over ~1.8 s.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Three columns: 60 [margin] + 580 + 30 [gap] + 580 + 30 [gap] + 580 +
// 60 [margin] = 1920.
const CARD_W      = 580;
const CARD_H      = 920;
const CARD_TOP    = (CANVAS_H - CARD_H) / 2;   // 80
const CARD_LEFTS  = [60, 670, 1280] as const;
const CARD_PAD    = 28;
const CARD_RADIUS = 36;

// Portrait area inside each card.
const PORTRAIT_W = CARD_W - 2 * CARD_PAD;      // 524
const PORTRAIT_H = 520;
const PORTRAIT_RADIUS = 24;

// Fixed character framing for EVERY card — not authorable — so all heads match.
// Use consistently-framed library presenter portraits (NOT daniel/lena).
const CHARACTER_HEIGHT = 760;
const CHARACTER_Y      = -10;

// Bottom row + Follow button.
const BOTTOM_ROW_Y = CARD_H - CARD_PAD - 48;
const BOTTOM_ROW_H = 48;
const FOLLOW_W = 132;
const FOLLOW_H = 48;
const FOLLOW_LEFT = CARD_W - CARD_PAD - FOLLOW_W;

// Vertical start of the title + bio text column (card-local). The bio flows
// below the title, so its position follows the title's height automatically.
const TITLE_Y = CARD_PAD + PORTRAIT_H + 24;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  cardInDuration:     0.60,
  // Longer stagger — each card gets a clear breath after landing AND its
  // content largely finishes animating before the next card starts.
  cardStagger:        1.50,
  portraitInDuration: 0.50,
  titleInOffset:      0.30,
  titleInDuration:    0.50,
  badgeInOffset:      0.45,
  badgeInDuration:    0.40,
  bioInOffset:        0.55,
  bioInDuration:      0.45,
  statsInOffset:      0.85,
  statsInDuration:    0.45,
  statsStagger:       0.08,
  followInOffset:     1.20,
  followInDuration:   0.55,
} as const;

// All easings are smooth-tail. easeOutBack uses a tiny back constant so
// the overshoot is just a hint — never enough to push neighbouring cards
// into each other.
const easeOutCubic       = Easing.out(Easing.cubic);
const easeOutBackCard    = Easing.out(Easing.back(1.25));
const easeOutBackBadge   = Easing.out(Easing.back(1.8));
const easeOutBackButton  = Easing.out(Easing.back(2.0));

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Palette ─────────────────────────────────────────────────────────────────

const CANVAS_BG  = '#EDEFF3';
const CARD_BG    = '#FFFFFF';
const DARK_TEXT  = '#0A0F18';
const MUTED_TEXT = '#6B7280';
const ICON_GREY  = '#9CA3AF';
const VERIFIED_FG = '#FFFFFF';

const CARD_SHADOW =
  '0 24px 50px rgba(15, 25, 45, 0.10), ' +
  '0 8px 18px rgba(15, 25, 45, 0.06)';
const BUTTON_SHADOW =
  '0 6px 14px rgba(15, 25, 45, 0.08), ' +
  '0 2px 4px rgba(15, 25, 45, 0.06)';

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
    const medium = new FontFace(
      'Satoshi',
      `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`,
      { weight: '500', display: 'block' },
    );
    const [b, m] = await Promise.all([bold.load(), medium.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(b);
    fonts.add(m);
  })();
  return fontsPromise;
}

// ─── Inline glyphs ───────────────────────────────────────────────────────────

function VerifiedBadge({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path
        d="M16 1 L19.2 3.3 L23.2 2.8 L24.5 6.5 L28 8.3 L26.9 12.2 L28.5 16 L26 19.1 L26.5 23 L22.8 24.4 L20.8 27.8 L17 26.7 L13 27.8 L11 24.4 L7.3 23 L7.8 19.1 L5.3 16 L6.9 12.2 L5.8 8.3 L9.3 6.5 L10.6 2.8 L14.6 3.3 Z"
        fill={fill}
      />
      <path
        d="M11.5 16 L14.7 19 L20.5 13"
        stroke={VERIFIED_FG}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function PersonIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx={12} cy={8} r={4} stroke={color} strokeWidth={1.8} />
      <path
        d="M4 21 C4 16.5 7.5 13.5 12 13.5 C16.5 13.5 20 16.5 20 21"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function GridIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x={4} y={4} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <rect x={13} y={4} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <rect x={4} y={13} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <rect x={13} y={13} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
    </svg>
  );
}

function PlusIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 5 V19 M5 12 H19"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatCount = (n: number) => n.toLocaleString('en-US');

function slideUp(localFrame: number, dur: number, travel = 24) {
  const p = clamp01(localFrame / dur);
  const eased = easeOutCubic(p);
  return {
    translateY: (1 - eased) * travel,
    opacity:    eased,
  };
}

// ─── Single card ─────────────────────────────────────────────────────────────

type CardTimings = {
  cardStartFrame:   number;
  cardDuration:     number;
  portraitDuration: number;
  titleStart:       number;
  titleDuration:    number;
  badgeStart:       number;
  badgeDuration:    number;
  bioStart:         number;
  bioDuration:      number;
  statsStart:       number;
  statsDuration:    number;
  statsStagger:     number;
  followStart:      number;
  followDuration:   number;
};

function Card({
  card,
  leftX,
  frame,
  timings,
}: {
  card: CharacterCardData;
  leftX: number;
  frame: number;
  timings: CardTimings;
}) {
  // ── Card pop — subtle overshoot, NO asymmetric squash/stretch ──
  const cardLocal = frame - timings.cardStartFrame;
  const cardProg  = clamp01(cardLocal / timings.cardDuration);
  const cardScale = easeOutBackCard(cardProg);
  const cardOpacity = easeOutCubic(cardProg);

  // ── Portrait settle ──
  const portraitProg    = clamp01(cardLocal / timings.portraitDuration);
  const portraitScale   = interpolate(easeOutCubic(portraitProg), [0, 1], [0.96, 1]);
  const portraitOpacity = easeOutCubic(portraitProg);

  // ── Text / badge / stats / button reveals ──
  const titleAnim = slideUp(frame - timings.titleStart, timings.titleDuration, 22);
  const bioAnim   = slideUp(frame - timings.bioStart,   timings.bioDuration,   20);

  const badgeProg    = clamp01((frame - timings.badgeStart) / timings.badgeDuration);
  const badgeScale   = easeOutBackBadge(badgeProg);
  const badgeOpacity = easeOutCubic(badgeProg);

  const stat1 = slideUp(frame - timings.statsStart,                       timings.statsDuration, 16);
  const stat2 = slideUp(frame - (timings.statsStart + timings.statsStagger), timings.statsDuration, 16);

  const followProg  = clamp01((frame - timings.followStart) / timings.followDuration);
  const followScale = easeOutBackButton(followProg);
  const followOpacity = easeOutCubic(followProg);

  return (
    <div
      style={{
        position: 'absolute',
        left: leftX,
        top:  CARD_TOP,
        width:  CARD_W,
        height: CARD_H,
        borderRadius: CARD_RADIUS,
        background: CARD_BG,
        boxShadow:  CARD_SHADOW,
        transform: `scale(${cardScale})`,
        transformOrigin: '50% 50%',
        opacity: cardOpacity,
        overflow: 'hidden',
      }}
    >
      {/* PORTRAIT — fixed-size clipped box with the character image sized
          explicitly so head sizes can be equalised across cards. */}
      <div
        style={{
          position: 'absolute',
          left: CARD_PAD,
          top:  CARD_PAD,
          width:  PORTRAIT_W,
          height: PORTRAIT_H,
          borderRadius: PORTRAIT_RADIUS,
          background: card.accentColor,
          overflow: 'hidden',
          transform: `scale(${portraitScale})`,
          transformOrigin: '50% 100%',
          opacity: portraitOpacity,
        }}
      >
        <Img
          src={staticFile(`characters/${card.characterId}.png`)}
          alt=""
          style={{
            position: 'absolute',
            left: '50%',
            top:  CHARACTER_Y,
            height: CHARACTER_HEIGHT,
            width: 'auto',
            transform: 'translateX(-50%)',
            // Drop shadow follows the cut-out's alpha so the figure casts
            // a real silhouette shadow against the accent backing.
            filter:
              'drop-shadow(0 16px 22px rgba(2, 18, 36, 0.40)) ' +
              'drop-shadow(0 4px 8px rgba(2, 18, 36, 0.30))',
          }}
        />
      </div>

      {/* TITLE + BIO — a flowing column. Long text wraps onto the next line and
          the bio is pushed down (no fixed-position overlap). The card's
          overflow:hidden is the final guard against spilling onto the canvas. */}
      <div
        style={{
          position: 'absolute',
          left: CARD_PAD,
          top:  TITLE_Y,
          width: CARD_W - 2 * CARD_PAD,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {/* TITLE ROW */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            transform: `translateY(${titleAnim.translateY}px)`,
            opacity: titleAnim.opacity,
          }}
        >
          <span
            style={{
              color: DARK_TEXT,
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 32,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
            }}
          >
            {card.title}
          </span>
          {card.verified !== false && (
            <div
              style={{
                transform: `scale(${badgeScale})`,
                transformOrigin: '50% 50%',
                opacity: badgeOpacity,
                display: 'flex',
              }}
            >
              <VerifiedBadge size={26} fill={card.accentColor} />
            </div>
          )}
        </div>

        {/* BIO */}
        <div
          style={{
            width: '100%',
            color: MUTED_TEXT,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 20,
            lineHeight: 1.35,
            letterSpacing: '-0.005em',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            transform: `translateY(${bioAnim.translateY}px)`,
            opacity: bioAnim.opacity,
          }}
        >
          {card.bio}
        </div>
      </div>

      {/* BOTTOM ROW */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top:  BOTTOM_ROW_Y,
          width:  CARD_W,
          height: BOTTOM_ROW_H,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: CARD_PAD,
            top:  0,
            height: BOTTOM_ROW_H,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            transform: `translateY(${stat1.translateY}px)`,
            opacity: stat1.opacity,
          }}
        >
          <PersonIcon size={22} color={ICON_GREY} />
          <span
            style={{
              color: DARK_TEXT,
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 20,
              letterSpacing: '-0.01em',
            }}
          >
            {formatCount(card.followersCount)}
          </span>
        </div>
        <div
          style={{
            position: 'absolute',
            left: CARD_PAD + 120,
            top:  0,
            height: BOTTOM_ROW_H,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            transform: `translateY(${stat2.translateY}px)`,
            opacity: stat2.opacity,
          }}
        >
          <GridIcon size={20} color={ICON_GREY} />
          <span
            style={{
              color: DARK_TEXT,
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 20,
              letterSpacing: '-0.01em',
            }}
          >
            {formatCount(card.postsCount)}
          </span>
        </div>

        <div
          style={{
            position: 'absolute',
            left: FOLLOW_LEFT,
            top:  0,
            width:  FOLLOW_W,
            height: FOLLOW_H,
            borderRadius: FOLLOW_H / 2,
            // Filled with the card's accent colour to match the verified tick.
            background: card.accentColor,
            border: 'none',
            boxShadow: BUTTON_SHADOW,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            transform: `scale(${followScale})`,
            transformOrigin: '50% 50%',
            opacity: followOpacity,
          }}
        >
          <span
            style={{
              color: '#FFFFFF',
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 19,
              letterSpacing: '-0.01em',
            }}
          >
            Follow
          </span>
          <PlusIcon size={18} color="#FFFFFF" />
        </div>
      </div>
    </div>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const CharacterTrioCards: React.FC<CharacterTrioCardsProps> = ({
  cards,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() =>
    delayRender('Loading CharacterTrioCards fonts'),
  );
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };

  return (
    <AbsoluteFill style={{ background: CANVAS_BG, overflow: 'hidden' }}>
      {cards.map((card, i) => {
        const cardStart = f(i * t.cardStagger);
        const cardTimings: CardTimings = {
          cardStartFrame:   cardStart,
          cardDuration:     f(t.cardInDuration),
          portraitDuration: f(t.portraitInDuration),
          titleStart:       cardStart + f(t.titleInOffset),
          titleDuration:    f(t.titleInDuration),
          badgeStart:       cardStart + f(t.badgeInOffset),
          badgeDuration:    f(t.badgeInDuration),
          bioStart:         cardStart + f(t.bioInOffset),
          bioDuration:      f(t.bioInDuration),
          statsStart:       cardStart + f(t.statsInOffset),
          statsDuration:    f(t.statsInDuration),
          statsStagger:     f(t.statsStagger),
          followStart:      cardStart + f(t.followInOffset),
          followDuration:   f(t.followInDuration),
        };
        return (
          <Card
            key={i}
            card={card}
            leftX={CARD_LEFTS[i]}
            frame={frame}
            timings={cardTimings}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const characterTrioCardsDefaultProps: CharacterTrioCardsProps = {
  // Library presenter portraits only (NOT daniel/lena). Size + position are
  // fixed for every card, so just pick an id — no per-card tuning.
  cards: [
    {
      characterId:    'male_middleage_white',
      title:           'Product Strategist',
      verified:        true,
      bio:             'Helping early-stage teams ship faster and sharper.',
      followersCount:  1248,
      postsCount:      86,
      accentColor:     '#0496FF',   // dodger blue
    },
    {
      characterId:    'female_earlycareer_black',
      title:           'Head of Design',
      verified:        true,
      bio:             'Building product systems people actually love to use.',
      followersCount:  982,
      postsCount:      54,
      accentColor:     '#F865B0',   // wild strawberry
    },
    {
      characterId:    'male_middleage_black',
      title:           'Engineering Lead',
      verified:        true,
      bio:             'Shipping reliable, well-tested code without the drama.',
      followersCount:  1567,
      postsCount:      128,
      accentColor:     '#3AB795',   // ocean green
    },
  ],
};
