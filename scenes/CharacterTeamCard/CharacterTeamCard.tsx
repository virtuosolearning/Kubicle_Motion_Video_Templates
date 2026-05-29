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

// CharacterTeamCard — ONE wider Pinterest-style profile card containing
// THREE characters arranged as a team:
//   • Front character (centred, larger, on top in z-order)
//   • Left back character (smaller, partially obscured by the front one)
//   • Right back character (smaller, partially obscured by the front one)
//
// Use to introduce a team — e.g. "Product Team", "Design Squad",
// "Founding Crew". The shipped default has the dodger-blue theme and
// the title "Product Team".
//
// Animation (buttery-smooth):
//   • 0.00–0.60 s — card pops in. The three characters are visible from
//     the very start of the card's entrance — no separate per-character
//     opacity fade. They scale subtly with the card (0.94 → 1.0) so the
//     entrance reads as a unified "team arrives together" rather than
//     three ghosts solidifying one after the other.
//   • 1.40 s onward — title / badge / bio / stats / Follow cascade in

// ─── Schema ──────────────────────────────────────────────────────────────────

const slotSchema = z.object({
  // Character PNG id only. Size + position are FIXED per slot (front vs side —
  // see FRONT_CHARACTER_* / SIDE_CHARACTER_*) so characters never vary in size;
  // the front/back depth comes from the fixed slot geometry, not author tuning.
  // Use consistently-framed library presenter portraits (NOT daniel/lena).
  characterId:     z.string().min(1),
});

export const characterTeamCardTimingsSchema = z
  .object({
    cardInDuration:    z.number().positive(),
    titleInStart:      z.number().nonnegative(),
    titleInDuration:   z.number().positive(),
    badgeInStart:      z.number().nonnegative(),
    badgeInDuration:   z.number().positive(),
    bioInStart:        z.number().nonnegative(),
    bioInDuration:     z.number().positive(),
    statsInStart:      z.number().nonnegative(),
    statsInDuration:   z.number().positive(),
    statsStagger:      z.number().positive(),
    followInStart:     z.number().nonnegative(),
    followInDuration:  z.number().positive(),
  })
  .partial();

export const characterTeamCardSchema = z.object({
  // The three characters. `front` renders on top; `leftBack` and
  // `rightBack` sit behind, partially obscured by the front one.
  front:     slotSchema,
  leftBack:  slotSchema,
  rightBack: slotSchema,
  // Team title (e.g. "Product Team"). ≤24 chars so verified badge fits.
  title:    z.string().min(1).max(24),
  verified: z.boolean().optional(),
  // Short blurb about the team — ≤95 chars, wraps to ~2 lines.
  bio:      z.string().min(1).max(95),
  followersCount: z.number().int().nonnegative(),
  postsCount:     z.number().int().nonnegative(),
  // Single accent colour for the whole card — one of three brand colours only:
  // dodger blue, wild strawberry, or ocean green. Tints the portrait BG, the
  // verified tick, and the Follow button.
  accentColor:    z.enum(['#0496FF', '#F865B0', '#3AB795']),
  timings:        characterTeamCardTimingsSchema.optional(),
});

export type CharacterTeamCardProps = z.infer<typeof characterTeamCardSchema>;
export type CharacterSlotData = z.infer<typeof slotSchema>;

export const characterTeamCardMeta = {
  description:
    'A single wider profile card with three characters arranged as a team: ' +
    'one in front (centred, on top), two behind on either side. Use to ' +
    'introduce a team unit — Product Team, Design Squad, etc. Front ' +
    'character steps forward with a stronger overshoot so the layering ' +
    'reads as deliberate depth.',
  authoringNotes:
    'Supply front, leftBack, and rightBack — each is just a characterId ' +
    '(PNG in characters/<id>.png). Use consistently-framed library presenter ' +
    'portraits; do NOT use daniel.png or lena.png. Character size + position ' +
    'are FIXED per slot (front a touch larger to read as forward; the two ' +
    'backs equal and slightly smaller) so characters never vary in size — ' +
    'just pick ids. title ≤24 chars (e.g. "Product Team"). bio ≤95 chars ' +
    '(wraps onto the next line, kept inside the card). accentColor is one of ' +
    'three brand colours only: #0496FF (dodger blue), #F865B0 (wild ' +
    'strawberry), or #3AB795 (ocean green) — tints the portrait BG, the ' +
    'verified tick, and the Follow button. Default duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Single wide card centred horizontally and vertically.
const CARD_W      = 1100;
const CARD_H      = 920;
const CARD_LEFT   = (CANVAS_W - CARD_W) / 2;     // 410
const CARD_TOP    = (CANVAS_H - CARD_H) / 2;     // 80
const CARD_PAD    = 30;
const CARD_RADIUS = 36;

// Portrait area inside the card.
const PORTRAIT_W = CARD_W - 2 * CARD_PAD;        // 1040
const PORTRAIT_H = 600;
const PORTRAIT_RADIUS = 24;

// Slot dimensions for the three characters. Slots are positioned so
// the front slot overlaps with each side slot by ~100 px, creating the
// layered "team photo" composition.
const SIDE_SLOT_W  = 380;
const SIDE_SLOT_H  = PORTRAIT_H;
const FRONT_SLOT_W = 460;
const FRONT_SLOT_H = PORTRAIT_H;

// Slot positions inside the portrait area (local x).
const LEFT_SLOT_X  = 30;
const RIGHT_SLOT_X = PORTRAIT_W - SIDE_SLOT_W - 30;  // 630
const FRONT_SLOT_X = (PORTRAIT_W - FRONT_SLOT_W) / 2; // 290

// Fixed character framing per slot — NOT authorable. Sized for consistently-
// framed library presenter portraits (square). Scaled up to a head-and-
// shoulders crop: the figure is large enough that the narrow slot clips past
// the arms (no mid-arm cut) and the portrait-bottom cut lands on the upper
// chest. Front renders a touch larger so it reads as stepping forward.
const FRONT_CHARACTER_HEIGHT = 700;
const FRONT_CHARACTER_Y      = -12;
const SIDE_CHARACTER_HEIGHT  = 640;
const SIDE_CHARACTER_Y       = 4;

// Vertical positions of title + bio + bottom row (card-local).
const TITLE_Y      = CARD_PAD + PORTRAIT_H + 26;  // 30 + 600 + 26 = 656
const BIO_Y        = TITLE_Y + 56;                // 712
const BOTTOM_ROW_Y = CARD_H - CARD_PAD - 48;      // 842
const BOTTOM_ROW_H = 48;

const FOLLOW_W = 132;
const FOLLOW_H = 48;
const FOLLOW_LEFT = CARD_W - CARD_PAD - FOLLOW_W;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  cardInDuration:    0.60,
  titleInStart:      0.80,
  titleInDuration:   0.50,
  badgeInStart:      0.95,
  badgeInDuration:   0.40,
  bioInStart:        1.05,
  bioInDuration:     0.45,
  statsInStart:      1.35,
  statsInDuration:   0.45,
  statsStagger:      0.08,
  followInStart:     1.70,
  followInDuration:  0.55,
} as const;

const easeOutCubic        = Easing.out(Easing.cubic);
const easeOutBackCard     = Easing.out(Easing.back(1.25));
const easeOutBackBadge    = Easing.out(Easing.back(1.8));
const easeOutBackButton   = Easing.out(Easing.back(2.0));

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Palette ─────────────────────────────────────────────────────────────────

const CANVAS_BG  = '#EDEFF3';
const CARD_BG    = '#FFFFFF';
const DARK_TEXT  = '#0A0F18';
const MUTED_TEXT = '#6B7280';
const ICON_GREY  = '#9CA3AF';
const VERIFIED_FG = '#FFFFFF';

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
  slotY,
  slotW,
  slotH,
  zIndex,
  scale,
  charHeight,
  charY,
}: {
  slot:    CharacterSlotData;
  slotX:   number;
  slotY:   number;
  slotW:   number;
  slotH:   number;
  zIndex:  number;
  scale:   number;
  charHeight: number;
  charY:      number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: slotX,
        top:  slotY,
        width:  slotW,
        height: slotH,
        overflow: 'hidden',
        zIndex,
        transform: `scale(${scale})`,
        transformOrigin: '50% 100%',     // grow from feet — feels like stepping into place
      }}
    >
      <Img
        src={staticFile(`characters/${slot.characterId}.png`)}
        alt=""
        style={{
          position: 'absolute',
          left: '50%',
          top:  charY,
          height: charHeight,
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

export const CharacterTeamCard: React.FC<CharacterTeamCardProps> = ({
  front,
  leftBack,
  rightBack,
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
    delayRender('Loading CharacterTeamCard fonts'),
  );
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };

  // ── Card pop ──
  const cardProg    = clamp01(frame / f(t.cardInDuration));
  const cardScale   = easeOutBackCard(cardProg);
  const cardOpacity = easeOutCubic(cardProg);

  // ── Characters scale subtly along with the card's entrance. They're
  //    visible from the very start of the card's appearance (no separate
  //    per-character opacity fade) — the whole team arrives together. ──
  const charScale = interpolate(easeOutCubic(cardProg), [0, 1], [0.94, 1]);

  // ── Text / badge / stats / follow ──
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
        {/* PORTRAIT — single dodger-blue area holding all three characters. */}
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
          {/* LEFT BACK */}
          <CharacterSlot
            slot={leftBack}
            slotX={LEFT_SLOT_X}
            slotY={0}
            slotW={SIDE_SLOT_W}
            slotH={SIDE_SLOT_H}
            zIndex={1}
            scale={charScale}
            charHeight={SIDE_CHARACTER_HEIGHT}
            charY={SIDE_CHARACTER_Y}
          />
          {/* RIGHT BACK */}
          <CharacterSlot
            slot={rightBack}
            slotX={RIGHT_SLOT_X}
            slotY={0}
            slotW={SIDE_SLOT_W}
            slotH={SIDE_SLOT_H}
            zIndex={1}
            scale={charScale}
            charHeight={SIDE_CHARACTER_HEIGHT}
            charY={SIDE_CHARACTER_Y}
          />
          {/* FRONT — on top */}
          <CharacterSlot
            slot={front}
            slotX={FRONT_SLOT_X}
            slotY={0}
            slotW={FRONT_SLOT_W}
            slotH={FRONT_SLOT_H}
            zIndex={2}
            scale={charScale}
            charHeight={FRONT_CHARACTER_HEIGHT}
            charY={FRONT_CHARACTER_Y}
          />
        </div>

        {/* TITLE + BIO — flowing column. Long text wraps onto the next line and
            the bio is pushed down (no fixed-position overlap); the card's
            overflow:hidden keeps everything off the canvas background. */}
        <div
          style={{
            position: 'absolute',
            left: CARD_PAD,
            top:  TITLE_Y,
            width: CARD_W - 2 * CARD_PAD,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
        {/* TITLE ROW */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
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
              lineHeight: 1.1,
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
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
            width:  '100%',
            color: MUTED_TEXT,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 22,
            lineHeight: 1.35,
            letterSpacing: '-0.005em',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            transform: `translateY(${bioAnim.translateY}px)`,
            opacity: bioAnim.opacity,
          }}
        >
          {bio}
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
              // Filled with the accent colour to match the verified tick.
              background: accentColor,
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
                fontSize: 20,
                letterSpacing: '-0.01em',
              }}
            >
              Follow
            </span>
            <PlusIcon size={18} color="#FFFFFF" />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const characterTeamCardDefaultProps: CharacterTeamCardProps = {
  // Library presenter portraits only (NOT daniel/lena). Size + position are
  // fixed per slot (front a touch larger, two backs equal), so just pick ids.
  front:     { characterId: 'male_middleage_white' },
  leftBack:  { characterId: 'female_earlycareer_black' },
  rightBack: { characterId: 'male_middleage_black' },
  title:    'Product Team',
  verified: true,
  bio:      'Three of us, shipping the product roadmap end-to-end every sprint.',
  followersCount: 3897,
  postsCount:     268,
  accentColor:    '#0496FF',   // dodger blue
};
