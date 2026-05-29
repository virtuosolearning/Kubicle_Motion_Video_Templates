import { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Easing,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { z } from 'zod';

// BulletList6Pills — six dark-navy pills with a dodger-blue chevron block on
// the left; pills slide in from off-canvas-left in sequence, then each pill's
// label types on character-by-character with a visible cursor.
//
//   • Phase A (0.00–~2.0 s): 6 pills scale up from 0 → 1 (from their own
//     centres), staggered every 0.25 s, each ~0.55 s easeOutCubic. Empty
//     pills (no text). Opacity fades in alongside so very-small scales
//     don't read as dust on the platinum background.
//   • Phase B (~2.3 s onward): each pill's label types on in turn, ~2.0 s per
//     pill (≈1.4 s of typing + ~0.6 s of hold). A vertical "|" cursor blinks
//     beside the typed substring while typing, then disappears when complete.
//   • Default composition length is 450 frames (15 s @ 30 fps).
//
// All visuals (background, pill body, chevron block, glyph, cursor) drawn in
// CSS / inline SVG — no PNG dependencies.

// ─── Schema ──────────────────────────────────────────────────────────────────

export const bulletList6PillsBulletSchema = z.object({
  // Bullet label — Satoshi Bold white inside the dark-navy pill. ≤40 chars
  // so it stays comfortably on one line at 60 px.
  label: z.string().min(1).max(40),
});

export const bulletList6PillsTimingsSchema = z
  .object({
    pillScaleStagger:  z.number().positive(),   // delay between pill scale-ins (s)
    pillScaleDuration: z.number().positive(),   // each pill's scale-up window (s)
    typingBase:        z.number().nonnegative(),// when pill 1 begins typing (s)
    typingPerPill:     z.number().positive(),   // window for each pill (s)
    typingDuration:    z.number().positive(),   // active typing time per pill (s)
  })
  .partial();

export const bulletList6PillsSchema = z.object({
  // 1 to 6 bullets. Fewer than 6 still reads as a centred stack — the whole
  // group is vertically centred on the canvas, not anchored to the top.
  bullets: z.array(bulletList6PillsBulletSchema).min(1).max(6),
  timings: bulletList6PillsTimingsSchema.optional(),
});

export type BulletList6PillsProps = z.infer<typeof bulletList6PillsSchema>;

export const bulletList6PillsMeta = {
  description:
    'A 6-row stack of dark-navy pills with a dodger-blue »-chevron block on ' +
    'the left of each. Pills slide in from off-canvas left in sequence, then ' +
    'each label types on character-by-character with a visible cursor. Best ' +
    'for content that should read as "here are the N things, said one at a ' +
    'time" — agendas, key takeaways, talking points, syllabus rows.',
  authoringNotes:
    'Supply 1 to 6 bullets — the stack is vertically centred on the canvas ' +
    'whatever the count, so 3 bullets sit centred rather than top-anchored. ' +
    'Labels ≤40 chars each (one line of ' +
    'Satoshi Bold 60 px in a 1600-px-wide pill). Aim for short, parallel ' +
    'phrasing — these read as a list, so consistent grammar across rows ' +
    'matters. GOOD: "Define the brief", "Sketch the structure". BAD: ' +
    '"Once you have defined the brief, sketch the structure" (too long). ' +
    'Default duration 450 frames (15 s @ 30 fps); first ~2 s for slide-in, ' +
    'remaining ~12 s for 6 × 2-s typewriter windows.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Pill placement — left-anchored with a small margin, spanning ~83% of the
// canvas width to match the reference proportions.
const PILL_LEFT = 160;
const PILL_W    = 1600;
const PILL_H    = 140;
const PILL_RADIUS = 28;
const PILL_GAP    = 28;
const PILL_PITCH  = PILL_H + PILL_GAP;

// Top edge of the first pill so the whole stack is vertically centred on the
// canvas, for any count of pills (1–6). 6 pills → 50; 3 pills → 326; etc.
const firstPillTopFor = (count: number) =>
  (CANVAS_H - (count * PILL_H + (count - 1) * PILL_GAP)) / 2;

// Chevron block — rounded square sitting inside the pill on the left.
const CHEVRON_SIZE   = 120;
const CHEVRON_INSET  = 14;                  // inset from pill's left/top edges
const CHEVRON_RADIUS = 22;

// Where the label text begins (just to the right of the chevron block).
const TEXT_INSET_LEFT = CHEVRON_INSET + CHEVRON_SIZE + 30;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  pillScaleStagger:  0.25,
  pillScaleDuration: 0.55,
  // Pill 5 (last) starts scaling at 5 * 0.25 = 1.25, finishes at 1.80.
  // Give a small breath then start typing at 2.10.
  typingBase:        2.10,
  // 6 × 2.0 = 12.0 s of typing windows → ends at 14.10, leaves 0.90 s hold.
  typingPerPill:     2.00,
  typingDuration:    1.40,
} as const;

const easeOutCubic = Easing.out(Easing.cubic);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG_COLOR = '#E6ECF2';                   // platinum blue background
const WHITE    = '#FFFFFF';

// Pill body: dark navy with a subtle top-to-bottom gradient (top brighter so
// the pill reads as having a soft inner light).
const PILL_BG =
  'linear-gradient(180deg, #0B2C44 0%, #062338 45%, #03182A 100%)';
const PILL_SHADOW =
  '0 8px 22px rgba(3, 24, 42, 0.30), ' +
  '0 2px 6px rgba(3, 24, 42, 0.20)';

// Chevron block: dodger-blue gradient — lighter on top, deeper on bottom.
const CHEVRON_BG =
  'linear-gradient(180deg, #5DBDFF 0%, #1A9CFE 55%, #0A8FEE 100%)';
const CHEVRON_GLYPH_COLOR = '#052438';        // oxford-blue glyph on the blue block

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
    const b = await bold.load();
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(b);
  })();
  return fontsPromise;
}

// ─── Chevron glyph (»» in oxford-blue) ───────────────────────────────────────

function ChevronGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ display: 'block' }}
    >
      <g
        stroke={CHEVRON_GLYPH_COLOR}
        strokeWidth={11}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <polyline points="28,28 50,50 28,72" />
        <polyline points="52,28 74,50 52,72" />
      </g>
    </svg>
  );
}

// ─── Single pill ─────────────────────────────────────────────────────────────

function Pill({
  rowIndex,
  firstPillTop,
  scale,
  opacity,
  typedText,
  showCursor,
}: {
  rowIndex: number;
  firstPillTop: number; // top edge of row 0 (depends on pill count)
  scale:   number;      // 0 → 1 scale-up at the pill's own centre
  opacity: number;      // 0 → 1 fade-in alongside scale
  typedText: string;    // substring currently revealed
  showCursor: boolean;
}) {
  const top = firstPillTop + rowIndex * PILL_PITCH;

  return (
    <div
      style={{
        position: 'absolute',
        left:   PILL_LEFT,
        top,
        width:  PILL_W,
        height: PILL_H,
        borderRadius: PILL_RADIUS,
        background: PILL_BG,
        boxShadow:  PILL_SHADOW,
        overflow: 'hidden',
        transform: `scale(${scale})`,
        transformOrigin: '50% 50%',
        opacity,
      }}
    >
      {/* Chevron block on the left. */}
      <div
        style={{
          position: 'absolute',
          left: CHEVRON_INSET,
          top:  (PILL_H - CHEVRON_SIZE) / 2,
          width:  CHEVRON_SIZE,
          height: CHEVRON_SIZE,
          borderRadius: CHEVRON_RADIUS,
          background: CHEVRON_BG,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ChevronGlyph size={CHEVRON_SIZE - 28} />
      </div>

      {/* Typed label + cursor. */}
      <div
        style={{
          position: 'absolute',
          left: TEXT_INSET_LEFT,
          top:  0,
          height: PILL_H,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <span
          style={{
            color: WHITE,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 60,
            letterSpacing: '-0.005em',
            lineHeight: 1,
            whiteSpace: 'pre',                 // preserve trailing spaces while typing
          }}
        >
          {typedText}
        </span>
        {showCursor && (
          <span
            style={{
              display: 'inline-block',
              width: 4,
              height: 60,
              marginLeft: 4,
              background: '#0496FF',
              // Subtle blink: 50% duty cycle at 2 Hz feels close to the reference.
              opacity: 0.95,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const BulletList6Pills: React.FC<BulletList6PillsProps> = ({
  bullets,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() =>
    delayRender('Loading BulletList6Pills fonts'),
  );
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const SCALE_STAGGER  = f(t.pillScaleStagger);
  const SCALE_DURATION = f(t.pillScaleDuration);
  const TYPING_BASE    = f(t.typingBase);
  const TYPING_WINDOW  = f(t.typingPerPill);
  const TYPING_DURATION = f(t.typingDuration);

  // Blink cadence: 2 Hz toggle (cursor on/off every 15 frames at 30 fps).
  const cursorVisible = Math.floor(frame / 15) % 2 === 0;

  // Centre the stack vertically for however many pills were supplied.
  const firstPillTop = firstPillTopFor(bullets.length);

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {bullets.map((bullet, i) => {
        // ── Scale-in ──
        // Pill i begins scaling at frame (i * SCALE_STAGGER) and eases from
        // scale 0 → 1 around its own centre over SCALE_DURATION frames.
        // Opacity rides the same window so very-small scales don't read as
        // dust on the platinum background.
        const scaleStart = i * SCALE_STAGGER;
        const scaleProg  = clamp01((frame - scaleStart) / SCALE_DURATION);
        const eased      = easeOutCubic(scaleProg);
        const scale      = eased;
        const opacity    = eased;

        // ── Typewriter ──
        // Pill i's typing window opens at TYPING_BASE + i * TYPING_WINDOW.
        // Within that window the label types over TYPING_DURATION frames,
        // then holds for the remainder of the window.
        const typeStart = TYPING_BASE + i * TYPING_WINDOW;
        const intoType  = frame - typeStart;
        let typedCount: number;
        let typing: boolean;
        if (intoType <= 0) {
          typedCount = 0;
          typing = false;
        } else if (intoType >= TYPING_DURATION) {
          typedCount = bullet.label.length;
          typing = false;
        } else {
          // Linear character reveal — feels mechanical/deliberate, like the
          // reference. easeOutCubic would feel too "soft" for typing.
          const charProg = intoType / TYPING_DURATION;
          typedCount = Math.floor(charProg * bullet.label.length);
          typing = true;
        }
        const typedText = bullet.label.slice(0, typedCount);

        // Cursor is visible only while THIS pill is mid-type, and blinks
        // during that window.
        const showCursor = typing && cursorVisible;

        return (
          <Pill
            key={i}
            rowIndex={i}
            firstPillTop={firstPillTop}
            scale={scale}
            opacity={opacity}
            typedText={typedText}
            showCursor={showCursor}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const bulletList6PillsDefaultProps: BulletList6PillsProps = {
  bullets: [
    { label: 'Define the brief' },
    { label: 'Research the audience' },
    { label: 'Sketch the structure' },
    { label: 'Draft the storyboard' },
    { label: 'Record the voiceover' },
    { label: 'Edit and publish' },
  ],
};
