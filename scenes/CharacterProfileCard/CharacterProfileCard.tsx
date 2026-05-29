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

// CharacterProfileCard — a Pinterest-style social-profile card used to
// introduce a person with a short bio. Single centred white card, top-half
// portrait, workplace title + verified tick below, bio, followers/posts
// a Follow pill on the right.
//
// Animation principles (in chronological order):
//   • Phase A (0.00–0.65 s): the card pops in with overshoot AND squash &
//     stretch — scale rides easeOutBack past 1.0; at the overshoot peak
//     scaleX briefly exceeds scaleY (chest-puff "stretch"), then both
//     settle to 1:1.
//   • Phase B (0.30–0.95 s): the portrait inside the card scales from
//     0.92 → 1.0 with easeOutCubic — feels like the photo is settling
//     into the frame.
//   • Phase C (0.85–1.35 s): the title slides up 32 px while fading in.
//     Easing: easeOutCubic.
//   • Phase D (1.00–1.30 s): the verified badge pops in with
//     easeOutBack (back constant 2.4) — a little tap of overshoot
//     beside the name.
//   • Phase E (1.30–1.75 s): the bio slides up + fades in.
//   • Phase F (1.70–2.20 s): the stats row reveals item-by-item with
//     a 0.10 s stagger.
//   • Phase G (2.15–2.65 s): the Follow button bounces in — scale 0 →
//     1.12 → 1.0 (easeOutBack 2.6) plus a half-cycle squash modulation
//     so it feels like a button being pressed and rebounding.
//
// Comp animations finish ~2.7 s in; the rest of the timeline holds.

// ─── Schema ──────────────────────────────────────────────────────────────────

export const characterProfileCardTimingsSchema = z
  .object({
    cardInDuration:     z.number().positive(),
    portraitInDuration: z.number().positive(),
    nameInStart:        z.number().nonnegative(),
    nameInDuration:     z.number().positive(),
    badgeInStart:       z.number().nonnegative(),
    badgeInDuration:    z.number().positive(),
    bioInStart:         z.number().nonnegative(),
    bioInDuration:      z.number().positive(),
    statsInStart:       z.number().nonnegative(),
    statsInDuration:    z.number().positive(),
    statsStagger:       z.number().positive(),
    followInStart:      z.number().nonnegative(),
    followInDuration:   z.number().positive(),
  })
  .partial();

export const characterProfileCardSchema = z.object({
  // Character PNG id — resolves to characters/<id>.png. Ships with `daniel`.
  characterId: z.string().min(1),
  // Workplace title / role — bold dark, ≤30 chars so the verified badge
  // sits beside it (e.g. "Product Strategist", "Founder & CEO").
  title:       z.string().min(1).max(30),
  // Shows a dodger-blue tick after the title when true. Default true.
  verified:    z.boolean().optional(),
  // Brief bio — medium grey, wraps to ~2 lines at ≤95 chars.
  bio:         z.string().min(1).max(95),
  // Followers count (any non-negative int — formatted with thousands separators).
  followersCount: z.number().int().nonnegative(),
  // A second stat — posts / projects / something countable. Format same.
  postsCount:     z.number().int().nonnegative(),
  // Accent colour — one of three brand colours only: dodger blue, wild
  // strawberry, or ocean green. Tints the portrait backing, the verified
  // tick, and the Follow button.
  accentColor:    z.enum(['#0496FF', '#F865B0', '#3AB795']),
  timings:        characterProfileCardTimingsSchema.optional(),
});

export type CharacterProfileCardProps = z.infer<
  typeof characterProfileCardSchema
>;

export const characterProfileCardMeta = {
  description:
    'A modern Pinterest-style social-profile card introducing a character: ' +
    'a centred white rounded card with a portrait on top, the workplace ' +
    'title + dodger-blue verified badge below, a short bio, two stats ' +
    '(followers + posts), and a Follow pill on the right. Use to introduce ' +
    'a course presenter, panellist, or any single character by their role.',
  authoringNotes:
    'characterId is a PNG ID in characters/<id>.png — use a consistently-' +
    'framed library presenter portrait; do NOT use daniel.png or lena.png. The ' +
    'portrait fills a fixed height, so size is uniform — just pick the id. ' +
    'title ≤30 chars — the character\'s workplace role (e.g. "Product ' +
    'Strategist", "Founder & CEO"), NOT their personal name. bio ≤95 chars ' +
    '(wraps to ~2 lines). followersCount + postsCount are ints; large values ' +
    'format with commas. accentColor is one of three brand colours only: ' +
    '#0496FF (dodger blue), #F865B0 (wild strawberry), or #3AB795 (ocean ' +
    'green) — tints the portrait backing, the verified tick, and the Follow ' +
    'button. Default duration 450 frames (15 s @ 30 fps).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const CANVAS_CX = CANVAS_W / 2;
const CANVAS_CY = CANVAS_H / 2;

// Card — vertical, phone-card proportion. Centred on canvas.
const CARD_W = 640;
const CARD_H = 1000;
const CARD_LEFT = CANVAS_CX - CARD_W / 2;            // 640
const CARD_TOP  = CANVAS_CY - CARD_H / 2;            // 40
const CARD_PAD  = 30;
const CARD_RADIUS = 40;

// Portrait area inside the card.
const PORTRAIT_W = CARD_W - 2 * CARD_PAD;            // 580
const PORTRAIT_H = 620;
const PORTRAIT_LEFT = CARD_PAD;                      // local to card
const PORTRAIT_TOP  = CARD_PAD;                      // local to card
const PORTRAIT_RADIUS = 28;

// Vertical layout below portrait (in card-local coords).
const NAME_Y       = PORTRAIT_TOP + PORTRAIT_H + 32; // 30 + 620 + 32 = 682
const BIO_Y        = NAME_Y + 70;                    // 752
const BOTTOM_ROW_Y = CARD_H - CARD_PAD - 56;         // 30 from bottom; 56 tall
const BOTTOM_ROW_H = 56;

// Follow button (right side of the bottom row).
const FOLLOW_W = 150;
const FOLLOW_H = 56;
const FOLLOW_LEFT = CARD_W - CARD_PAD - FOLLOW_W;    // pinned right

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  cardInDuration:     0.65,
  portraitInDuration: 0.65,
  nameInStart:        0.85,
  nameInDuration:     0.50,
  badgeInStart:       1.00,
  badgeInDuration:    0.40,
  bioInStart:         1.30,
  bioInDuration:      0.45,
  statsInStart:       1.70,
  statsInDuration:    0.40,
  statsStagger:       0.10,
  followInStart:      2.15,
  followInDuration:   0.50,
} as const;

const easeOutCubic       = Easing.out(Easing.cubic);
const easeOutBackCard    = Easing.out(Easing.back(1.8));
const easeOutBackBadge   = Easing.out(Easing.back(2.4));
const easeOutBackButton  = Easing.out(Easing.back(2.6));
const easeInOutCubic     = Easing.inOut(Easing.cubic);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Palette ─────────────────────────────────────────────────────────────────

const CANVAS_BG     = '#EDEFF3';                     // soft cool-grey backdrop
const CARD_BG       = '#FFFFFF';                     // crisp white card
const DARK_TEXT     = '#0A0F18';
const MUTED_TEXT    = '#6B7280';
const ICON_GREY     = '#9CA3AF';
const VERIFIED_FG   = '#FFFFFF';

const CARD_SHADOW =
  '0 30px 60px rgba(15, 25, 45, 0.10), ' +
  '0 10px 25px rgba(15, 25, 45, 0.06)';
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
  // Twitter/Instagram-style serrated badge in dodger blue, with a centred
  // white tick. Tick is sized so its visual centre sits at the badge's
  // centre (16, 16 on the 32-unit viewBox).
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path
        d="M16 1 L19.2 3.3 L23.2 2.8 L24.5 6.5 L28 8.3 L26.9 12.2 L28.5 16 L26 19.1 L26.5 23 L22.8 24.4 L20.8 27.8 L17 26.7 L13 27.8 L11 24.4 L7.3 23 L7.8 19.1 L5.3 16 L6.9 12.2 L5.8 8.3 L9.3 6.5 L10.6 2.8 L14.6 3.3 Z"
        fill={fill}
      />
      {/* Tick — sized at ~9×6 units inside the 32-unit badge so it
          comfortably fits inside the serrated edge. Centroid ≈ (15.5, 16),
          aligned with the badge centre. */}
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

// Slide-up + fade-in helper. Returns { transform, opacity } given a local
// frame and duration, with an offset travel in pixels.
function slideUp(localFrame: number, dur: number, travel = 32) {
  const p = clamp01(localFrame / dur);
  const eased = easeOutCubic(p);
  return {
    translateY: (1 - eased) * travel,
    opacity:    eased,
  };
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const CharacterProfileCard: React.FC<CharacterProfileCardProps> = ({
  characterId,
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
    delayRender('Loading CharacterProfileCard fonts'),
  );
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const CARD_DUR     = f(t.cardInDuration);
  const PORTRAIT_DUR = f(t.portraitInDuration);
  const NAME_START   = f(t.nameInStart);
  const NAME_DUR     = f(t.nameInDuration);
  const BADGE_START  = f(t.badgeInStart);
  const BADGE_DUR    = f(t.badgeInDuration);
  const BIO_START    = f(t.bioInStart);
  const BIO_DUR      = f(t.bioInDuration);
  const STATS_START  = f(t.statsInStart);
  const STATS_DUR    = f(t.statsInDuration);
  const STATS_STAGGER = f(t.statsStagger);
  const FOLLOW_START = f(t.followInStart);
  const FOLLOW_DUR   = f(t.followInDuration);

  // ── Card pop-in with squash & stretch ──
  //
  // easeOutBack carries the overshoot. We add a sine-driven asymmetric
  // squash that's only active during the overshoot phase (when the base
  // scale is past 1.0), so during the bounce-up the card briefly stretches
  // horizontally and squashes vertically, then settles to 1:1.
  const cardProg = clamp01(frame / CARD_DUR);
  const cardBase = easeOutBackCard(cardProg);
  const overshoot = Math.max(0, cardBase - 1) / 0.15;          // 0–1 during overshoot
  const stretch   = clamp01(overshoot) * 0.06;                 // up to ±6%
  const cardScaleX = cardBase * (1 + stretch);
  const cardScaleY = cardBase * (1 - stretch);
  const cardOpacity = easeOutCubic(cardProg);

  // ── Portrait reveal (settles into its slot) ──
  const portraitProg = clamp01(frame / PORTRAIT_DUR);
  const portraitScale = interpolate(easeOutCubic(portraitProg), [0, 1], [0.92, 1]);
  const portraitOpacity = easeOutCubic(portraitProg);

  // ── Text reveals ──
  const nameAnim = slideUp(frame - NAME_START, NAME_DUR, 32);
  const bioAnim  = slideUp(frame - BIO_START,  BIO_DUR,  28);

  // ── Verified badge pop-in ──
  const badgeProg  = clamp01((frame - BADGE_START) / BADGE_DUR);
  const badgeScale = easeOutBackBadge(badgeProg);
  const badgeOpacity = easeOutCubic(badgeProg);

  // ── Stats stagger (2 items) ──
  const stat1 = slideUp(frame - STATS_START,                  STATS_DUR, 20);
  const stat2 = slideUp(frame - (STATS_START + STATS_STAGGER), STATS_DUR, 20);

  // ── Follow button bounce with squash modulation ──
  //
  // Same pattern as the card: easeOutBack drives the scale, plus a half-sine
  // squash that fires during the overshoot peak so the button feels
  // bouncy/tactile rather than purely linear.
  const followProg = clamp01((frame - FOLLOW_START) / FOLLOW_DUR);
  const followBase = easeOutBackButton(followProg);
  const followOvershoot = Math.max(0, followBase - 1) / 0.18;
  const followStretch = clamp01(followOvershoot) * 0.08;
  const followScaleX = followBase * (1 + followStretch);
  const followScaleY = followBase * (1 - followStretch);
  const followOpacity = easeOutCubic(followProg);

  return (
    <AbsoluteFill style={{ background: CANVAS_BG, overflow: 'hidden' }}>
      {/* CARD */}
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
          transform: `scale(${cardScaleX}, ${cardScaleY})`,
          transformOrigin: '50% 50%',
          opacity: cardOpacity,
          overflow: 'hidden',
        }}
      >
        {/* PORTRAIT */}
        <div
          style={{
            position: 'absolute',
            left: PORTRAIT_LEFT,
            top:  PORTRAIT_TOP,
            width:  PORTRAIT_W,
            height: PORTRAIT_H,
            borderRadius: PORTRAIT_RADIUS,
            background: accentColor,
            overflow: 'hidden',
            transform: `scale(${portraitScale})`,
            transformOrigin: '50% 100%',
            opacity: portraitOpacity,
          }}
        >
          <Img
            src={staticFile(`characters/${characterId}.png`)}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width:  '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center top',
              // Drop shadow follows the cut-out's alpha so the figure casts
              // a real silhouette shadow on the dodger-blue backing. Two
              // layers: a wide, soft ambient shadow + a tighter contact
              // shadow at the figure's edges.
              filter:
                'drop-shadow(0 18px 24px rgba(2, 18, 36, 0.45)) ' +
                'drop-shadow(0 4px 8px rgba(2, 18, 36, 0.35))',
            }}
          />
        </div>

        {/* TITLE ROW (workplace role + verified badge) */}
        <div
          style={{
            position: 'absolute',
            left: CARD_PAD,
            top:  NAME_Y,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            transform: `translateY(${nameAnim.translateY}px)`,
            opacity: nameAnim.opacity,
          }}
        >
          <span
            style={{
              color: DARK_TEXT,
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 42,
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
              <VerifiedBadge size={32} fill={accentColor} />
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
            fontSize: 24,
            lineHeight: 1.35,
            letterSpacing: '-0.005em',
            transform: `translateY(${bioAnim.translateY}px)`,
            opacity: bioAnim.opacity,
          }}
        >
          {bio}
        </div>

        {/* BOTTOM ROW (stats + Follow button) */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top:  BOTTOM_ROW_Y,
            width:  CARD_W,
            height: BOTTOM_ROW_H,
          }}
        >
          {/* Followers stat */}
          <div
            style={{
              position: 'absolute',
              left: CARD_PAD,
              top:  0,
              height: BOTTOM_ROW_H,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transform: `translateY(${stat1.translateY}px)`,
              opacity: stat1.opacity,
            }}
          >
            <PersonIcon size={26} color={ICON_GREY} />
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

          {/* Posts stat */}
          <div
            style={{
              position: 'absolute',
              left: CARD_PAD + 140,
              top:  0,
              height: BOTTOM_ROW_H,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transform: `translateY(${stat2.translateY}px)`,
              opacity: stat2.opacity,
            }}
          >
            <GridIcon size={24} color={ICON_GREY} />
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

          {/* Follow button */}
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
              gap: 6,
              transform: `scale(${followScaleX}, ${followScaleY})`,
              transformOrigin: '50% 50%',
              opacity: followOpacity,
            }}
          >
            <span
              style={{
                color: '#FFFFFF',
                fontFamily: "'Satoshi', system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: '-0.01em',
              }}
            >
              Follow
            </span>
            <PlusIcon size={20} color="#FFFFFF" />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const characterProfileCardDefaultProps: CharacterProfileCardProps = {
  // Library presenter portrait (NOT daniel/lena). The portrait fills a fixed
  // height, so any consistently-framed square portrait reads at the same size.
  characterId: 'male_middleage_white',
  title: 'Product Strategist',
  verified: true,
  bio: 'Helping early-stage teams ship faster, sharper, and with confidence.',
  followersCount: 1248,
  postsCount: 86,
  accentColor: '#0496FF',   // dodger blue
};
