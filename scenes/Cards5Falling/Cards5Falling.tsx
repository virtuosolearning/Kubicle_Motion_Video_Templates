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

// Ports the Cards_5_falling prototype exactly:
//   • 5 stacked cards on a #E6ECF2 background, each using card_header.png
//     for its blue-gradient header + Oxford Blue body.
//   • Card 1 slides down from above the frame (easeOutCubic over 0.90 s).
//   • Cards 2–5 sit underneath at center, hidden until their predecessor
//     begins to drop, so they don't peek through during Card 1's entry.
//   • Each card drops out (easeInOutCubic over 2.00 s) at staggered times
//     3.00 / 5.50 / 8.00 / 10.50 / 13.00 s, leaving an empty frame at 15 s.
//   • Default composition length is 450 frames (15 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

const cardSchema = z.object({
  // Header title — bold white, single line, kept INSIDE the dodger-blue header
  // box. ~24-char ceiling so it fits on one line; the title is also width-capped
  // and clipped in the layout so it can never spill past the box onto the
  // platinum background.
  title: z.string().min(1).max(24),
  // Icon ID from the catalog's available_icons list (e.g. "edit").
  icon: z.string().min(1),
});

// Optional per-render timing overrides. All values are in SECONDS (the
// scene runs at 30 fps and converts internally). dropStarts should have at
// least as many entries as there are cards (1–5); only the first cards.length
// are used. Any field omitted falls back to the corresponding DEFAULT_TIMINGS
// entry (which supplies all 5 drop starts).
export const cards5FallingTimingsSchema = z
  .object({
    entryDuration: z.number().positive(),
    dropStarts: z.array(z.number().nonnegative()).min(1).max(5),
    dropDuration: z.number().positive(),
  })
  .partial();

export const cards5FallingSchema = z.object({
  // 1 to 5 cards — one per stacked card, ordered top-of-stack first. Each card
  // occupies the same centred position and falls in turn, so fewer cards simply
  // means a shorter sequence (no layout reflow needed).
  cards: z.array(cardSchema).min(1).max(5),
  // Optional animation timing overrides (seconds, internally converted to frames @ 30fps).
  timings: cards5FallingTimingsSchema.optional(),
});

export type Cards5FallingProps = z.infer<typeof cards5FallingSchema>;

export const cards5FallingMeta = {
  description:
    'Five rectangular cards that fall through frame in sequence. Each card has ' +
    'a blue-gradient header (bookmark icon + bold title) above an Oxford Blue body ' +
    'panel showing a single large white-tinted icon.',
  authoringNotes:
    'Provide 1 to 5 cards — each falls in turn at the same centred position, so ' +
    'fewer cards just makes a shorter sequence. Each needs an icon id and a short ' +
    'title — strict 24-character max, bold white, kept inside the dodger-blue header ' +
    'box (width-capped and clipped, so it never spills onto the platinum background). ' +
    'Write tight noun phrases (2–4 words). Use DARK-MODE icons ' +
    '(the "-dark" suffix in the Library): these are platinum-white + dodger-blue and ' +
    'read clearly on the Oxford-Blue card body. "-light" icons have a dark element ' +
    'that disappears on the body. Give each card a DIFFERENT icon. Write tight noun ' +
    'phrases (2–4 words). GOOD: "Edit notes", "Watch lecture", "Track progress". ' +
    'BAD: "Edit your course notes" (too long). Cards land top-down in the order ' +
    'supplied — index 0 is the first to enter and the first to drop. Default ' +
    'duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const CARD_HEADER_SRC = staticFile('Template-Specific-Assets/card_header.png');
const INTER_BOLD_SRC  = staticFile('fonts/Inter-Bold.woff2');

// ─── Layout constants (measured directly from the supplied PNGs) ─────────────

// Card_header.png solid bbox: x=436..1494, y=206..913 (W=1059, H=708).
// Header (blue gradient): y=206..356; body (Oxford Blue): y=357..913.
const CARD_LEFT     = 436;
const CARD_RIGHT    = 1494;
const CARD_TOP      = 206;
const CARD_BOTTOM   = 913;
const CARD_CX       = (CARD_LEFT + CARD_RIGHT) / 2;     // 965
const HEADER_BOTTOM = 356;
const HEADER_CY     = (CARD_TOP + HEADER_BOTTOM) / 2;   // 281
const BODY_CY       = (HEADER_BOTTOM + CARD_BOTTOM) / 2; // 635

// Header layout — bookmark icon at left, title to its right.
const BOOKMARK_LEFT = 480;
const BOOKMARK_SIZE = 80;
const BOOKMARK_TOP  = HEADER_CY - BOOKMARK_SIZE / 2;
const TITLE_LEFT    = BOOKMARK_LEFT + BOOKMARK_SIZE + 32;
// Max width the title may occupy before the card's right edge — keeps the title
// INSIDE the dodger-blue header box (clipped, never spilling onto the platinum
// background). 44px right padding mirrors the bookmark's left inset.
const TITLE_MAX_WIDTH = CARD_RIGHT - TITLE_LEFT - 44;

// Body icon — large central placeholder.
const BODY_ICON_SIZE = 380;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

// Defaults expressed in SECONDS so the prototype's reference timeline is
// readable at a glance; conversion to frames happens inside the component
// once we've merged in any caller-supplied overrides.
const DEFAULT_TIMINGS = {
  // Card 1 entry — slide down from above the frame.
  entryDuration: 0.90,
  // Each card's drop start time. All five cards drop in turn; Card 5's
  // drop ends right at t=15 s so the loop restarts on a clean frame.
  dropStarts: [3.00, 5.50, 8.00, 10.50, 13.00] as readonly number[],
  // Slow, glassy fall — easeInOutCubic over 2 s.
  dropDuration: 2.00,
} as const;

// Travel distances (px). Entry starts above the frame, drop ends below it.
const ENTRY_TRAVEL = -1100;
const DROP_TRAVEL  =  1100;

const entryEase = Easing.out(Easing.cubic);
const dropEase  = Easing.inOut(Easing.cubic);

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadBrandFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold = new FontFace('Inter', `url(${INTER_BOLD_SRC}) format('woff2')`, {
      weight: '700',
      display: 'block',
    });
    const loaded = await bold.load();
    (document.fonts as FontFaceSet & { add(f: FontFace): void }).add(loaded);
  })();
  return fontsPromise;
}

// ─── Bookmark icon (header decoration, identical on every card) ──────────────

function BookmarkIcon({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="#FFFFFF"
    >
      <path d="m12 1c-7.71 0-11 3.29-11 11s3.29 11 11 11 11-3.29 11-11-3.29-11-11-11zm0 20c-6.561 0-9-2.439-9-9s2.439-9 9-9 9 2.439 9 9-2.439 9-9 9zm2.066-14.754c-.66-.161-1.354-.244-2.065-.246-.703.002-1.395.085-2.055.246-1.413.345-2.484 1.509-2.729 2.966-.32 1.913-.274 4.991.107 7.163.156.954 1.034 1.642 1.984 1.624.565 0 1.085-.232 1.497-.677.233-.251.844-.856 1.189-1.199.332.336 1.013 1.023 1.268 1.257.575.526 1.264.729 1.947.559.777-.193 1.343-.795 1.477-1.565.381-2.171.428-5.25.107-7.161-.244-1.457-1.315-2.621-2.729-2.966zm.686 9.751c-.348-.218-1.412-1.386-1.454-1.397-.608-.744-1.917-.767-2.553-.05-.184.181-1.104 1.091-1.45 1.478-.342-1.945-.388-4.794-.104-6.485.111-.667.595-1.197 1.23-1.353.507-.124 1.041-.188 1.58-.189.548.002 1.084.065 1.591.189.636.155 1.119.687 1.23 1.354.283 1.69.237 4.538-.07 6.454z" />
    </svg>
  );
}

// ─── Single card ──────────────────────────────────────────────────────────────

function Card({
  index,
  title,
  icon,
  entryDur,
  dropStarts,
  dropDur,
}: {
  index: number;        // 0-based position in the stack (0 = first to enter/drop)
  title: string;
  icon: string;
  entryDur: number;
  dropStarts: readonly number[];
  dropDur: number;
}) {
  const frame = useCurrentFrame();

  // ── Visibility ────────────────────────────────────────────────────────────
  // Card 1 is visible from frame 0 (it animates in from above). Cards 2–5
  // stay hidden until ~1.5 frames before their predecessor begins to drop,
  // so they don't peek out during Card 1's entry.
  const visibleFrom = index === 0 ? 0 : dropStarts[index - 1]! - 1.5;
  if (frame < visibleFrom) return null;

  // ── Y translation ─────────────────────────────────────────────────────────
  // Default to "settled at centre". Card 1 overrides this with its entry
  // slide; each card overrides it with its drop once dropStart fires.
  let translateY = 0;

  if (index === 0 && frame < entryDur) {
    translateY = interpolate(frame, [0, entryDur], [ENTRY_TRAVEL, 0], {
      extrapolateLeft:  'clamp',
      extrapolateRight: 'clamp',
      easing: entryEase,
    });
  }

  const dStart = dropStarts[index]!;
  if (frame >= dStart) {
    translateY = interpolate(frame, [dStart, dStart + dropDur], [0, DROP_TRAVEL], {
      extrapolateLeft:  'clamp',
      extrapolateRight: 'clamp',
      easing: dropEase,
    });
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translateY(${translateY}px)`,
        willChange: 'transform',
        pointerEvents: 'none',
      }}
    >
      {/* Card asset (header gradient + Oxford Blue body) */}
      <Img
        src={CARD_HEADER_SRC}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />

      {/* Header: bookmark icon */}
      <div
        style={{
          position: 'absolute',
          left: BOOKMARK_LEFT,
          top:  BOOKMARK_TOP,
          width:  BOOKMARK_SIZE,
          height: BOOKMARK_SIZE,
        }}
      >
        <BookmarkIcon size={BOOKMARK_SIZE} />
      </div>

      {/* Header: title */}
      <div
        style={{
          position: 'absolute',
          left: TITLE_LEFT,
          top:  HEADER_CY,
          transform: 'translateY(-50%)',
          color: '#FFFFFF',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 55,
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          // Stay inside the header box — clip rather than spill onto the platinum bg.
          maxWidth: TITLE_MAX_WIDTH,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </div>

      {/* Body: large central icon — SVGs carry their own white+Dodger Blue colors */}
      <div
        style={{
          position: 'absolute',
          left: CARD_CX - BODY_ICON_SIZE / 2,
          top:  BODY_CY - BODY_ICON_SIZE / 2,
          width:  BODY_ICON_SIZE,
          height: BODY_ICON_SIZE,
        }}
      >
        <Img
          src={staticFile(`icons/${icon}.svg`)}
          alt=""
          style={{
            width:  BODY_ICON_SIZE,
            height: BODY_ICON_SIZE,
          }}
        />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const Cards5Falling: React.FC<Cards5FallingProps> = ({ cards, timings }) => {
  const [handle] = useState(() => delayRender('Loading Cards5Falling fonts'));
  useEffect(() => {
    loadBrandFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  // Merge caller-supplied timing overrides over the signed-off defaults,
  // then convert from seconds to frames once.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const ENTRY_DUR  = f(t.entryDuration);
  const DROP_STARTS = t.dropStarts.map(f);
  const DROP_DUR   = f(t.dropDuration);

  // Render last → first so card 0 is the LAST DOM child and naturally sits on
  // top of the others (matching the "stack of cards" semantics — later cards
  // are physically underneath, hidden until needed). Derived from the actual
  // card count so 1–5 cards all stack correctly.
  const renderOrder = Array.from({ length: cards.length }, (_, i) => i).reverse();

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {renderOrder.map(i => (
        <Card
          key={i}
          index={i}
          title={cards[i]!.title}
          icon={cards[i]!.icon}
          entryDur={ENTRY_DUR}
          dropStarts={DROP_STARTS}
          dropDur={DROP_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};
