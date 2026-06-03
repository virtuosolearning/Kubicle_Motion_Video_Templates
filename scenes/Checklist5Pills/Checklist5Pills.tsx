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

// Checklist5Pills — hero icon on the left + 5 dark pills with tick reveals on the right.
//   • Phase 1 (0.00–1.00 s): hero icon (520×520) fades in on the left.
//   • Phase 2 (1.20 s onward): 5 pills fade up + slide 60 px from below,
//     staggered every 0.15 s. Pill n's white circle rides up alongside,
//     parked inset 18 px from the pill's right edge.
//   • Phase 3 (each row at 2.70 + n×1.70 s): the white circle slides left
//     to its anchor (1.20 s easeOutCubic). At row_start + 0.85 s the tick
//     trim-path reveals (0.70 s easeOutCubic). At row_start + 1.20 s the
//     responsibility text fades in (0.50 s).
//   • Default composition length is 360 frames (12 s @ 30 fps).
//
// Hero icon (strategy.svg) is rendered with its native colours: Oxford Blue
// body + Dodger Blue accents (it sits on a light Platinum Blue background).

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
export const checklist5PillsTimingsSchema = z
  .object({
    heroFadeStart:    z.number().nonnegative(),
    heroFadeEnd:      z.number().positive(),
    pillFadeBase:     z.number().nonnegative(),
    pillFadeStagger:  z.number().nonnegative(),
    pillFadeDuration: z.number().positive(),
    rowBase:          z.number().nonnegative(),
    rowSpacing:       z.number().positive(),
    circleSlideDuration: z.number().positive(),
    tickTrimDuration:    z.number().positive(),
    tickStartOffset:     z.number().nonnegative(),
    textFadeDuration:    z.number().positive(),
  })
  .partial();

export const checklist5PillsSchema = z.object({
  // 1 to 6 responsibility lines, ordered top → bottom. The pill band auto-
  // centres vertically for the count. Bold white at 37 px inside the pill,
  // ≤30 chars (clipped to the pill if longer, so keep it short).
  responsibilities: z.array(z.string().min(1).max(30)).min(1).max(6),
  // Hero icon ID (e.g. "strategy"). Resolved to icons/<id>.svg.
  hero: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('icon'),      id: z.string().min(1) }),
    z.object({ kind: z.literal('character'), id: z.string().min(1) }),
  ]),
  timings: checklist5PillsTimingsSchema.optional(),
});

export type Checklist5PillsProps = z.infer<typeof checklist5PillsSchema>;

export const checklist5PillsMeta = {
  description:
    'Hero icon on the left + 5 dark-pill checklist items on the right. For each ' +
    'row in turn, a white circle slides from the pill\'s right edge to a left ' +
    'anchor, a tick trim-reveals, then the line of text fades in. Best for ' +
    'content that should read as items being ticked off — responsibilities, ' +
    'ownership lists, must-haves, compliance items, completed deliverables.',
  authoringNotes:
    'Supply 1 to 6 responsibilities — the pill band auto-centres vertically for ' +
    'the count (3 pills sit centred in the frame, etc.). Each is bold white at ' +
    '37 px inside a pill — 30-char max, single line, clipped to the pill so it ' +
    'never spills onto the background (keep it short / summarised). Aim for ' +
    'parallel imperative phrasing. GOOD: "Define project scope", "Lead daily ' +
    'stand-ups". BAD: "It\'s your responsibility to define project scope" (too long). ' +
    "hero is a discriminated union: { kind: 'icon', id } renders icons/<id>.svg " +
    "(520×520 line art on the left); { kind: 'character', id } renders " +
    'characters/<id>.png centred and scaled up to fill a dodger-blue gradient ' +
    'rounded panel on the left, matched to the 5-pill height. Default duration 360 frames (12 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const PILL_BASE_SRC   = staticFile('Template-Specific-Assets/pill_base.png');
const PILL_CIRCLE_SRC = staticFile('Template-Specific-Assets/pill_circle.png');
const TICK_SRC        = staticFile('Template-Specific-Assets/tick.png');
const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (lifted directly from the prototype) ────────────────────

// Pill_Base.png pill region.
const PILL_LEFT  = 845;
const PILL_RIGHT = 1738;
const PILL_TOP   = 217;

// Pill_Circle.png white circle region.
const CIRCLE_CX = 906;
const CIRCLE_R  = 45;

// Row layout — pills are ROW_PITCH apart; the band of `count` pills (1-6)
// auto-centres vertically on the canvas. PILL_HEIGHT is the pill's alpha-bbox
// height in pill_base.png (215..329 = 114).
const ROW_PITCH   = 142;
const PILL_HEIGHT = 114;
const CANVAS_CY   = 540;
// Top edge fed to the pill_base translate so the band is vertically centred for
// any count. (+2 reconciles PILL_TOP 217 vs the pill's actual alpha top 215.)
const firstPillTopFor = (count: number) =>
  CANVAS_CY - ((count - 1) * ROW_PITCH + PILL_HEIGHT) / 2 + (PILL_TOP - 215);
const rowOffsetY = (n: number, firstPillTop: number) =>
  (firstPillTop + n * ROW_PITCH) - PILL_TOP;

// Hero icon (left).
const HERO_SIZE = 520;
const HERO_CX   = 425;
const HERO_CY   = 540;

// Character hero — a dodger-blue gradient rounded rectangle on the left, a FIXED
// size centred vertically in the frame (does NOT follow the pill count), with
// the character centred horizontally and scaled up to FILL the panel
// (object-fit: cover), clipped to the rounded rect.
const CHAR_PANEL_W      = 560;
const CHAR_PANEL_HEIGHT = 682;
const CHAR_PANEL_TOP    = (1080 - CHAR_PANEL_HEIGHT) / 2;      // 199 — centred
const CHAR_PANEL_LEFT   = HERO_CX - CHAR_PANEL_W / 2;          // 145
const CHAR_PANEL_RADIUS = 44;
const CHAR_PANEL_GRADIENT =
  'linear-gradient(160deg, #2AACFF 0%, #0496FF 55%, #0A78D0 100%)';

// Responsibility text. Width-capped so it stays INSIDE the pill (clipped with an
// ellipsis rather than spilling past the rounded end) — keeps text contained.
const TEXT_LEFT = 985;
const TEXT_CY   = 273;
const TEXT_MAX_WIDTH = PILL_RIGHT - TEXT_LEFT - 56;   // 697

// Tick.png tick region.
const TICK_LEFT  = 884;
const TICK_WIDTH = 47;

// White circle parks 18 px inset from the pill's right edge before sliding.
const CIRCLE_RIGHT_INSET = 18;
const PILL_FADE_UP_PX    = 60;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  heroFadeStart:       0.00,
  heroFadeEnd:         1.00,
  pillFadeBase:        1.20,
  pillFadeStagger:     0.15,
  pillFadeDuration:    0.80,
  rowBase:             2.70,
  rowSpacing:          1.70,
  circleSlideDuration: 1.20,
  tickTrimDuration:    0.70,
  tickStartOffset:     0.85,  // relative to row start
  textFadeDuration:    0.50,
} as const;

const easeOutCubic = Easing.out(Easing.cubic);

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`, {
      weight: '700',
      display: 'block',
    });
    const loaded = await bold.load();
    (document.fonts as FontFaceSet & { add(f: FontFace): void }).add(loaded);
  })();
  return fontsPromise;
}

// ─── Pill row ────────────────────────────────────────────────────────────────

function PillRow({
  index,
  firstPillTop,
  frame,
  text,
  pillFadeStart,
  pillFadeDur,
  rowStart,
  circleSlideDur,
  tickTrimDur,
  tickStartOffset,
  textFadeDur,
}: {
  index: number;
  firstPillTop: number;
  frame: number;
  text: string;
  pillFadeStart: number;
  pillFadeDur: number;
  rowStart: number;
  circleSlideDur: number;
  tickTrimDur: number;
  tickStartOffset: number;
  textFadeDur: number;
}) {
  const oy = rowOffsetY(index, firstPillTop);

  // Phase 2 — pill fade-up from below.
  const fadeUpProg = interpolate(frame, [pillFadeStart, pillFadeStart + pillFadeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const pillTY      = (1 - fadeUpProg) * PILL_FADE_UP_PX;
  const pillOpacity = fadeUpProg;

  // Phase 3 — circle slide from right edge to left anchor.
  const startDx     = (PILL_RIGHT - CIRCLE_R - CIRCLE_RIGHT_INSET) - CIRCLE_CX;
  const slideProg   = interpolate(frame, [rowStart, rowStart + circleSlideDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const currentDx   = startDx * (1 - slideProg);
  const showCircle  = frame >= pillFadeStart;

  // Tick trim — reveal left → right.
  const tickStart   = rowStart + tickStartOffset;
  const tickProg    = interpolate(frame, [tickStart, tickStart + tickTrimDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const tickRightInset    = (1 - tickProg) * TICK_WIDTH;
  const tickCanvasRightBg = 1920 - (TICK_LEFT + TICK_WIDTH);
  const tickShow = tickProg > 0;

  // Text — fades in once circle has anchored.
  const textStart = rowStart + circleSlideDur;
  const textOp    = interpolate(frame, [textStart, textStart + textFadeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  const fullAssetStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top:  0,
    width:  1920,
    height: 1080,
    display: 'block',
    pointerEvents: 'none',
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top:  0,
        width:  1920,
        height: 1080,
        transform: `translateY(${oy}px)`,
        pointerEvents: 'none',
      }}
    >
      {/* Pill base — fades up from below */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateY(${pillTY}px)`,
          opacity: pillOpacity,
        }}
      >
        <Img src={PILL_BASE_SRC} alt="" style={fullAssetStyle} />
      </div>

      {/* White circle (+ tick) — fades up with its pill, then slides left */}
      {showCircle && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${currentDx}px, ${pillTY}px)`,
            opacity: pillOpacity,
          }}
        >
          <Img src={PILL_CIRCLE_SRC} alt="" style={fullAssetStyle} />
          {tickShow && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                clipPath: `inset(0 ${tickCanvasRightBg + tickRightInset}px 0 ${TICK_LEFT}px)`,
              }}
            >
              <Img src={TICK_SRC} alt="" style={fullAssetStyle} />
            </div>
          )}
        </div>
      )}

      {/* Responsibility text — fades in as the circle anchors */}
      <div
        style={{
          position: 'absolute',
          left: TEXT_LEFT,
          top:  TEXT_CY,
          transform: 'translateY(-50%)',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 37,
          color: '#FFFFFF',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          // Capped to the pill width and clipped with an ellipsis so a long line
          // never spills past the pill onto the background.
          maxWidth: TEXT_MAX_WIDTH,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: textOp,
          pointerEvents: 'none',
        }}
      >
        {text}
      </div>
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const Checklist5Pills: React.FC<Checklist5PillsProps> = ({
  responsibilities,
  hero,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Checklist5Pills fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const HERO_FADE_START = f(t.heroFadeStart);
  const HERO_FADE_END   = f(t.heroFadeEnd);
  const PILL_FADE_BASE  = f(t.pillFadeBase);
  const PILL_FADE_STAGGER = f(t.pillFadeStagger);
  const PILL_FADE_DUR   = f(t.pillFadeDuration);
  const ROW_BASE        = f(t.rowBase);
  const ROW_SPACING     = f(t.rowSpacing);
  const CIRCLE_SLIDE_DUR = f(t.circleSlideDuration);
  const TICK_TRIM_DUR   = f(t.tickTrimDuration);
  const TICK_START_OFFSET = f(t.tickStartOffset);
  const TEXT_FADE_DUR   = f(t.textFadeDuration);

  // Hero icon fade.
  const heroOpacity = interpolate(frame, [HERO_FADE_START, HERO_FADE_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  // Vertically centre the pill band for however many pills (1-6) were supplied.
  const firstPillTop = firstPillTopFor(responsibilities.length);

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Phase 1 — hero fades in (icon OR character) */}
      {hero.kind === 'icon' ? (
        <div
          style={{
            position: 'absolute',
            left: HERO_CX - HERO_SIZE / 2,
            top:  HERO_CY - HERO_SIZE / 2,
            width:  HERO_SIZE,
            height: HERO_SIZE,
            opacity: heroOpacity,
            pointerEvents: 'none',
          }}
        >
          <Img
            src={staticFile(`icons/${hero.id}.svg`)}
            alt=""
            style={{ width: HERO_SIZE, height: HERO_SIZE, display: 'block' }}
          />
        </div>
      ) : (
        <div
          style={{
            position: 'absolute',
            left: CHAR_PANEL_LEFT,
            top:  CHAR_PANEL_TOP,
            width:  CHAR_PANEL_W,
            height: CHAR_PANEL_HEIGHT,
            borderRadius: CHAR_PANEL_RADIUS,
            background: CHAR_PANEL_GRADIENT,
            overflow: 'hidden',
            opacity: heroOpacity,
            pointerEvents: 'none',
          }}
        >
          <Img
            src={staticFile(`characters/${hero.id}.png`)}
            alt=""
            style={{
              // Centred horizontally and scaled up to fill the dodger panel;
              // object-position favours the head, clipped to the rounded rect.
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: '50% 18%',
              display: 'block',
              // Drop shadow lifts the figure off the dodger-blue gradient.
              filter:
                'drop-shadow(0 16px 22px rgba(2, 18, 36, 0.40)) ' +
                'drop-shadow(0 4px 8px rgba(2, 18, 36, 0.30))',
            }}
          />
        </div>
      )}

      {/* Phases 2 + 3 — one pill row per responsibility (1-6) */}
      {responsibilities.map((text, i) => (
        <PillRow
          key={i}
          index={i}
          firstPillTop={firstPillTop}
          frame={frame}
          text={text}
          pillFadeStart={PILL_FADE_BASE + i * PILL_FADE_STAGGER}
          pillFadeDur={PILL_FADE_DUR}
          rowStart={ROW_BASE + i * ROW_SPACING}
          circleSlideDur={CIRCLE_SLIDE_DUR}
          tickTrimDur={TICK_TRIM_DUR}
          tickStartOffset={TICK_START_OFFSET}
          textFadeDur={TEXT_FADE_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ────────────────────────────────────────────────────────

export const checklist5PillsDefaultProps: Checklist5PillsProps = {
  responsibilities: [
    'Define project scope',
    'Lead daily stand-ups',
    'Review every pull request',
    'Track blockers in real time',
    'Share progress weekly',
  ],
  hero: { kind: 'icon', id: 'strategy' },
};

export const checklist5PillsCharacterDemoProps: Checklist5PillsProps = {
  ...checklist5PillsDefaultProps,
  hero: { kind: 'character', id: 'presenter-tie' },
};
