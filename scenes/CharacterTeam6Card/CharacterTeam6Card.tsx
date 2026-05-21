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

// CharacterTeam6Card — ONE extra-wide Pinterest-style profile card with
// SIX characters arranged in a single row, evenly spaced. Each character
// sits in their own clipped "slot" so the cropping is identical across
// the team and the card reads as one team portrait.
//
// Use to introduce a larger team — a squad, founding crew, advisory
// board, etc. Default ships with a six-person diverse mix and the
// dodger-blue theme.
//
// Animation (buttery-smooth):
//   • 0.00–0.60 s — card pops in. The six characters are visible from
//     the very start of the card's entrance — no per-character opacity
//     fade. They scale subtly with the card (0.94 → 1.0) so the team
//     arrives as a single unit.
//   • 0.80 s onward — title / badge / bio / stats / Follow cascade in.

// ─── Schema ──────────────────────────────────────────────────────────────────

const slotSchema = z.object({
  characterId:     z.string().min(1),
  // Rendered height of the character image in px.
  characterHeight: z.number().min(200).max(1500),
  // Top offset inside the slot (px). Negative crops the top of the image.
  characterY:      z.number(),
  // Per-character title (e.g. "Designer", "Engineer", "PM"). Rendered as
  // subtle light-grey text directly below each character's portrait slot.
  // ≤18 chars to fit the 290 px slot.
  characterTitle:  z.string().min(1).max(18),
});

export const characterTeam6CardTimingsSchema = z
  .object({
    cardInDuration:        z.number().positive(),
    perCharTitleInStart:   z.number().nonnegative(),
    perCharTitleInDuration: z.number().positive(),
    titleInStart:          z.number().nonnegative(),
    titleInDuration:       z.number().positive(),
    badgeInStart:          z.number().nonnegative(),
    badgeInDuration:       z.number().positive(),
    bioInStart:            z.number().nonnegative(),
    bioInDuration:         z.number().positive(),
    statsInStart:          z.number().nonnegative(),
    statsInDuration:       z.number().positive(),
    statsStagger:          z.number().positive(),
    followInStart:         z.number().nonnegative(),
    followInDuration:      z.number().positive(),
  })
  .partial();

export const characterTeam6CardSchema = z.object({
  characters: z.array(slotSchema).length(6),
  title:      z.string().min(1).max(24),
  verified:   z.boolean().optional(),
  bio:        z.string().min(1).max(95),
  followersCount: z.number().int().nonnegative(),
  postsCount:     z.number().int().nonnegative(),
  accentColor:    z.string().regex(/^#[0-9a-fA-F]{6}$/),
  timings:        characterTeam6CardTimingsSchema.optional(),
});

export type CharacterTeam6CardProps = z.infer<typeof characterTeam6CardSchema>;
export type CharacterSlotData = z.infer<typeof slotSchema>;

export const characterTeam6CardMeta = {
  description:
    'An extra-wide profile card with SIX characters in a single evenly-' +
    'spaced row. Use to introduce a larger team — squad, founding crew, ' +
    'advisory board. The whole team arrives together as the card pops in.',
  authoringNotes:
    'Supply exactly 6 characters. Each is { characterId (PNG in ' +
    'characters/<id>.png), characterHeight (rendered px), characterY ' +
    '(top offset in px, often near 0) }. title ≤24 chars (e.g. "Founding ' +
    'Team"). bio ≤95 chars. accentColor is a single hex applied to the ' +
    'portrait BG and the verified badge. Default duration 450 frames.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Extra-wide card to comfortably fit 6 characters in a row.
const CARD_W      = 1800;
const CARD_H      = 920;
const CARD_LEFT   = (CANVAS_W - CARD_W) / 2;     // 60
const CARD_TOP    = (CANVAS_H - CARD_H) / 2;     // 80
const CARD_PAD    = 30;
const CARD_RADIUS = 36;

// Portrait area inside the card.
const PORTRAIT_W = CARD_W - 2 * CARD_PAD;        // 1740
const PORTRAIT_H = 600;
const PORTRAIT_RADIUS = 24;

// Six equal slots in a row, no gaps — characters sit shoulder-to-shoulder.
const SLOT_COUNT = 6;
const SLOT_W     = PORTRAIT_W / SLOT_COUNT;      // 290

// Per-character title row sits directly below the portrait — subtle,
// light-grey labels (one per character, centred on each slot).
const PER_CHAR_TITLE_Y = CARD_PAD + PORTRAIT_H + 14;  // 644
const PER_CHAR_TITLE_H = 28;

// Main title + bio shifted down to make room for the per-character labels.
const TITLE_Y      = PER_CHAR_TITLE_Y + PER_CHAR_TITLE_H + 22;  // 694
const BIO_Y        = TITLE_Y + 56;                              // 750
const BOTTOM_ROW_Y = CARD_H - CARD_PAD - 48;                    // 842
const BOTTOM_ROW_H = 48;

const FOLLOW_W = 132;
const FOLLOW_H = 48;
const FOLLOW_LEFT = CARD_W - CARD_PAD - FOLLOW_W;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  cardInDuration:        0.60,
  // Per-character labels fade in just before the main title so the eye
  // reads them as part of the portrait, not as part of the bio block.
  perCharTitleInStart:    0.70,
  perCharTitleInDuration: 0.50,
  titleInStart:          0.95,
  titleInDuration:       0.50,
  badgeInStart:          1.10,
  badgeInDuration:       0.40,
  bioInStart:            1.20,
  bioInDuration:         0.45,
  statsInStart:          1.50,
  statsInDuration:       0.45,
  statsStagger:          0.08,
  followInStart:         1.85,
  followInDuration:      0.55,
} as const;

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
const FOLLOW_BORDER = '#E5E7EB';

const CARD_SHADOW =
  '0 30px 60px rgba(15, 25, 45, 0.12), ' +
  '0 10px 24px rgba(15, 25, 45, 0.07)';
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
      <rect x={4}  y={4}  width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <rect x={13} y={4}  width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
      <rect x={4}  y={13} width={7} height={7} rx={1.5} stroke={color} strokeWidth={1.8} />
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
  return { translateY: (1 - eased) * travel, opacity: eased };
}

// ─── Character slot ──────────────────────────────────────────────────────────

function CharacterSlot({
  slot,
  slotX,
  slotW,
  slotH,
  scale,
}: {
  slot:  CharacterSlotData;
  slotX: number;
  slotW: number;
  slotH: number;
  scale: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: slotX,
        top:  0,
        width:  slotW,
        height: slotH,
        overflow: 'hidden',
        transform: `scale(${scale})`,
        transformOrigin: '50% 100%',
      }}
    >
      <Img
        src={staticFile(`characters/${slot.characterId}.png`)}
        alt=""
        style={{
          position: 'absolute',
          left: '50%',
          top:  slot.characterY,
          height: slot.characterHeight,
          width: 'auto',
          transform: 'translateX(-50%)',
          filter:
            'drop-shadow(0 16px 22px rgba(2, 18, 36, 0.40)) ' +
            'drop-shadow(0 4px 8px rgba(2, 18, 36, 0.30))',
        }}
      />
    </div>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const CharacterTeam6Card: React.FC<CharacterTeam6CardProps> = ({
  characters,
  title,
  verified = true,
  bio,
  followersCount,
  postsCount,
  accentColor,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() =>
    delayRender('Loading CharacterTeam6Card fonts'),
  );
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };

  // Card pop.
  const cardProg    = clamp01(frame / f(t.cardInDuration));
  const cardScale   = easeOutBackCard(cardProg);
  const cardOpacity = easeOutCubic(cardProg);

  // Single character scale tied to card entrance.
  const charScale = interpolate(easeOutCubic(cardProg), [0, 1], [0.94, 1]);

  // Text reveals.
  const perCharTitleAnim = slideUp(
    frame - f(t.perCharTitleInStart),
    f(t.perCharTitleInDuration),
    14,
  );
  const titleAnim = slideUp(frame - f(t.titleInStart), f(t.titleInDuration), 24);
  const bioAnim   = slideUp(frame - f(t.bioInStart),   f(t.bioInDuration),   22);

  const badgeProg    = clamp01((frame - f(t.badgeInStart)) / f(t.badgeInDuration));
  const badgeScale   = easeOutBackBadge(badgeProg);
  const badgeOpacity = easeOutCubic(badgeProg);

  const stat1 = slideUp(frame - f(t.statsInStart),                            f(t.statsInDuration), 18);
  const stat2 = slideUp(frame - (f(t.statsInStart) + f(t.statsStagger)),      f(t.statsInDuration), 18);

  const followProg    = clamp01((frame - f(t.followInStart)) / f(t.followInDuration));
  const followScale   = easeOutBackButton(followProg);
  const followOpacity = easeOutCubic(followProg);

  return (
    <AbsoluteFill style={{ background: CANVAS_BG, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: CARD_LEFT,
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
        {/* PORTRAIT */}
        <div
          style={{
            position: 'absolute',
            left: CARD_PAD,
            top:  CARD_PAD,
            width:  PORTRAIT_W,
            height: PORTRAIT_H,
            borderRadius: PORTRAIT_RADIUS,
            background: accentColor,
            overflow: 'hidden',
          }}
        >
          {characters.map((slot, i) => (
            <CharacterSlot
              key={i}
              slot={slot}
              slotX={i * SLOT_W}
              slotW={SLOT_W}
              slotH={PORTRAIT_H}
              scale={charScale}
            />
          ))}
        </div>

        {/* PER-CHARACTER TITLES — subtle, light-grey labels centred on
            each character's slot. Fade in just before the main title. */}
        <div
          style={{
            position: 'absolute',
            left: CARD_PAD,
            top:  PER_CHAR_TITLE_Y,
            width: PORTRAIT_W,
            height: PER_CHAR_TITLE_H,
            transform: `translateY(${perCharTitleAnim.translateY}px)`,
            opacity: perCharTitleAnim.opacity,
            pointerEvents: 'none',
          }}
        >
          {characters.map((slot, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: i * SLOT_W,
                top:  0,
                width: SLOT_W,
                height: PER_CHAR_TITLE_H,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Satoshi', system-ui, sans-serif",
                fontWeight: 500,
                fontSize: 18,
                color: ICON_GREY,
                letterSpacing: '0.02em',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {slot.characterTitle}
            </div>
          ))}
        </div>

        {/* TITLE ROW */}
        <div
          style={{
            position: 'absolute',
            left: CARD_PAD,
            top:  TITLE_Y,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            transform: `translateY(${titleAnim.translateY}px)`,
            opacity: titleAnim.opacity,
          }}
        >
          <span
            style={{
              color: DARK_TEXT,
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 40,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {title}
          </span>
          {verified && (
            <div
              style={{
                transform: `scale(${badgeScale})`,
                transformOrigin: '50% 50%',
                opacity: badgeOpacity,
                display: 'flex',
              }}
            >
              <VerifiedBadge size={30} fill={accentColor} />
            </div>
          )}
        </div>

        {/* BIO */}
        <div
          style={{
            position: 'absolute',
            left: CARD_PAD,
            top:  BIO_Y,
            width:  CARD_W - 2 * CARD_PAD,
            color: MUTED_TEXT,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 22,
            lineHeight: 1.35,
            letterSpacing: '-0.005em',
            transform: `translateY(${bioAnim.translateY}px)`,
            opacity: bioAnim.opacity,
          }}
        >
          {bio}
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
            <PersonIcon size={24} color={ICON_GREY} />
            <span
              style={{
                color: DARK_TEXT,
                fontFamily: "'Satoshi', system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: '-0.01em',
              }}
            >
              {formatCount(followersCount)}
            </span>
          </div>
          <div
            style={{
              position: 'absolute',
              left: CARD_PAD + 140,
              top:  0,
              height: BOTTOM_ROW_H,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              transform: `translateY(${stat2.translateY}px)`,
              opacity: stat2.opacity,
            }}
          >
            <GridIcon size={22} color={ICON_GREY} />
            <span
              style={{
                color: DARK_TEXT,
                fontFamily: "'Satoshi', system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: '-0.01em',
              }}
            >
              {formatCount(postsCount)}
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
              background: CARD_BG,
              border: `1px solid ${FOLLOW_BORDER}`,
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
                color: DARK_TEXT,
                fontFamily: "'Satoshi', system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 20,
                letterSpacing: '-0.01em',
              }}
            >
              Follow
            </span>
            <PlusIcon size={18} color={DARK_TEXT} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const characterTeam6CardDefaultProps: CharacterTeam6CardProps = {
  // 6 characters in a single row, alternating gender + diverse mix.
  // All PNGs are square (1024 or 1254), so a single characterHeight
  // (~620) gives consistent head sizes across the team.
  characters: [
    { characterId: 'amelia', characterHeight: 620, characterY: 0, characterTitle: 'Product Lead' },
    { characterId: 'ken',    characterHeight: 620, characterY: 0, characterTitle: 'Engineer' },
    { characterId: 'sarah',  characterHeight: 620, characterY: 0, characterTitle: 'Designer' },
    { characterId: 'robert', characterHeight: 620, characterY: 0, characterTitle: 'Founder' },
    { characterId: 'claire', characterHeight: 620, characterY: 0, characterTitle: 'Researcher' },
    { characterId: 'rebecca', characterHeight: 620, characterY: 0, characterTitle: 'Operations' },
  ],
  title:    'Founding Team',
  verified: true,
  bio:      'Six of us, building the product, shipping the roadmap, owning the outcome.',
  followersCount: 8214,
  postsCount:     541,
  accentColor:    '#0496FF',   // dodger blue
};
