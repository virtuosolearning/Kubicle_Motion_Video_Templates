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

// Ports the Lesson Title Screen prototype:
//   • Background covers the full canvas.
//   • Course logo row (top-left): optional course icon + course title text.
//     Logo opacity-fades + drops down (translateY −14 → 0) over 0.6 s.
//   • Lesson label (eyebrow): accent-coloured, slides in from the left
//     (translateX −28 → 0) at 0.85 s over 0.5 s.
//   • Lesson title (main heading): white, slides in from the left further
//     (translateX −36.4 → 0) at 1.1 s over 0.6 s.
//   • Brand badge (bottom-right): a 101×101 region of Logo.png scaled to
//     fit a 116×116 box with rounded corners. Pops in with easeOutBack
//     scale 0.65 → 1.0 + opacity ramp at 1.3 s over 0.5 s.
//   • Default composition length is 300 frames (10 s @ 30 fps).
//
// The course icon is a CSS mask tinted with the accent colour — supply a
// transparent PNG/SVG URL whose non-transparent region forms the icon
// silhouette. If the URL is absent or fails to load, the icon slot is
// skipped (course title still shows).

// ─── Schema ──────────────────────────────────────────────────────────────────

// Optional per-render timing overrides. All values in SECONDS.
export const lessonTitleTimingsSchema = z
  .object({
    logoInStart:    z.number().nonnegative(),
    logoInDuration: z.number().positive(),
    labelInStart:   z.number().nonnegative(),
    labelInDuration: z.number().positive(),
    titleInStart:   z.number().nonnegative(),
    titleInDuration: z.number().positive(),
    badgeInStart:   z.number().nonnegative(),
    badgeInDuration: z.number().positive(),
  })
  .partial();

export const lessonTitleSchema = z.object({
  // Course name rendered next to the course icon at top-left
  // (e.g. "Excel Fundamentals"). One line only.
  courseTitle: z.string().min(1).max(80),
  // Lesson number (1-99). The eyebrow ALWAYS renders as
  // "Lesson <word>" (e.g. 1 → "Lesson One", 7 → "Lesson Seven") to keep
  // the brand format consistent across courses. Authors only choose the
  // number — the word form is derived. Numbers above 20 render with
  // digits ("Lesson 27").
  lessonNumber: z.number().int().min(1).max(99),
  // The main headline. Allowed to wrap.
  lessonTitle: z.string().min(1).max(120),
  // Optional URL for the course icon. Rendered as a CSS mask tinted with
  // the brand accent. If the URL is absent or fails to load, the icon
  // slot is skipped — the course title text still shows.
  courseIconUrl: z.string().url().optional(),
  timings: lessonTitleTimingsSchema.optional(),
});

export type LessonTitleProps = z.infer<typeof lessonTitleSchema>;

export const lessonTitleMeta = {
  description:
    'Opening card announcing the lesson: brand-tinted course icon + course ' +
    'title (top-left), accent lesson label, big headline, and a brand badge ' +
    'in the bottom-right.',
  authoringNotes:
    'Use as the first scene of every lesson. Three editable fields: ' +
    'courseTitle (next to the course icon, top-left; keep under ~35 chars), ' +
    'lessonNumber (an integer 1-99 — the eyebrow ALWAYS renders as ' +
    '"Lesson <word>"; 1 → "Lesson One", 7 → "Lesson Seven", 27 → ' +
    '"Lesson 27"), and lessonTitle (the headline; aim for under 60 chars so ' +
    'it lands on one or two lines at 78 px). The accent colour (Dodger ' +
    'Blue) is locked. courseIconUrl is optional and points at a ' +
    'transparent PNG/SVG whose silhouette gets tinted with the accent at ' +
    'render time. Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BG_SRC   = staticFile('Template-Specific-Assets/lesson_title_background.png');
const LOGO_SRC = staticFile('Template-Specific-Assets/logo.png');
const INTER_SEMIBOLD_SRC = staticFile('fonts/Inter-SemiBold.woff2');
const INTER_BOLD_SRC     = staticFile('fonts/Inter-Bold.woff2');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');

// ─── Layout constants (lifted from the prototype's TWEAK_DEFAULTS) ────────────

const DEFAULT_ACCENT = '#0794FD';
const TITLE_COLOUR   = '#FFFFFF';

// "Lesson <word>" eyebrow — word form for 1-20, digits for 21+.
const LESSON_WORDS = [
  'One',     'Two',       'Three',    'Four',     'Five',
  'Six',     'Seven',     'Eight',    'Nine',     'Ten',
  'Eleven',  'Twelve',    'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
] as const;
function lessonLabelFor(n: number): string {
  return `Lesson ${LESSON_WORDS[n - 1] ?? String(n)}`;
}

// Logo row.
const LOGO_X = 77;
const LOGO_Y = 58;
const LOGO_ICON_SIZE = 52;
const LOGO_SCALE = 1.25;
const LOGO_ICON_DISPLAY = Math.round(LOGO_ICON_SIZE * LOGO_SCALE);  // 65
const LOGO_GAP = Math.round(11 * LOGO_SCALE);                       // 14
const COURSE_TITLE_SIZE = Math.round(22 * LOGO_SCALE);              // 28

// Lesson label.
const LABEL_X = 59;
const LABEL_Y = 390;
const LABEL_SIZE = 32;

// Lesson title (the main headline).
const TITLE_X = 58;
const TITLE_Y = 432;
const TITLE_SIZE = 78;

// Bottom-right badge.
const BADGE_RIGHT = 76;
const BADGE_BOTTOM = 80;
const BADGE_SIZE = 116;
const BADGE_RADIUS = Math.round(BADGE_SIZE * 0.14);                 // 16

// Badge is a 101×101 region at (1695, 854) inside the 1920×1080 logo.png.
// Scale the whole logo so 101 px maps to BADGE_SIZE px, then negative-offset
// it so the badge region lands at (0,0) of the wrapper.
const BADGE_IMG_NATURAL = 101;
const BADGE_IMG_WIDTH  = Math.round((1920 * BADGE_SIZE) / BADGE_IMG_NATURAL);
const BADGE_IMG_HEIGHT = Math.round((1080 * BADGE_SIZE) / BADGE_IMG_NATURAL);
const BADGE_IMG_TOP  = -Math.round((854  * BADGE_SIZE) / BADGE_IMG_NATURAL);
const BADGE_IMG_LEFT = -Math.round((1695 * BADGE_SIZE) / BADGE_IMG_NATURAL);

// Entry slide distances (matches the prototype's `entryDistance * k` formulas).
const ENTRY_DISTANCE = 28;
const LOGO_SLIDE_Y  = -ENTRY_DISTANCE * 0.5;   // logo drops down from above
const LABEL_SLIDE_X = -ENTRY_DISTANCE;          // label slides in from left
const TITLE_SLIDE_X = -ENTRY_DISTANCE * 1.3;    // title slides slightly further

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  // Mirrors the prototype's delays at animSpeed=1.
  logoInStart:    0.00,
  logoInDuration: 0.60,
  labelInStart:   0.85,
  labelInDuration: 0.50,
  titleInStart:   1.10,
  titleInDuration: 0.60,
  badgeInStart:   1.30,
  badgeInDuration: 0.50,
} as const;

const entryEase    = Easing.out(Easing.cubic);
const badgePopEase = Easing.out(Easing.back(1.7));

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const semi  = new FontFace('Inter', `url(${INTER_SEMIBOLD_SRC}) format('woff2')`,  { weight: '600', display: 'block' });
    const bold  = new FontFace('Inter', `url(${INTER_BOLD_SRC}) format('woff2')`,      { weight: '700', display: 'block' });
    const x     = new FontFace('Inter', `url(${INTER_EXTRABOLD_SRC}) format('woff2')`, { weight: '800', display: 'block' });
    const [s, b, e] = await Promise.all([semi.load(), bold.load(), x.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(s);
    fonts.add(b);
    fonts.add(e);
  })();
  return fontsPromise;
}

// Preload the course icon (PNG/SVG used as CSS mask). Resolves true on success,
// false on any error. The caller decides whether to render the icon based on
// the boolean — a broken URL degrades to "course title only" instead of a 404.
function preloadMaskImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const LessonTitle: React.FC<LessonTitleProps> = ({
  courseTitle,
  lessonNumber,
  lessonTitle,
  courseIconUrl,
  timings,
}) => {
  const frame = useCurrentFrame();
  const accent = DEFAULT_ACCENT;
  const lessonLabel = lessonLabelFor(lessonNumber);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const LOGO_IN_START   = f(t.logoInStart);
  const LOGO_IN_END     = LOGO_IN_START + f(t.logoInDuration);
  const LABEL_IN_START  = f(t.labelInStart);
  const LABEL_IN_END    = LABEL_IN_START + f(t.labelInDuration);
  const TITLE_IN_START  = f(t.titleInStart);
  const TITLE_IN_END    = TITLE_IN_START + f(t.titleInDuration);
  const BADGE_IN_START  = f(t.badgeInStart);
  const BADGE_IN_END    = BADGE_IN_START + f(t.badgeInDuration);

  // Font load.
  const [fontHandle] = useState(() => delayRender('Loading LessonTitle fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  // Optional course-icon preload.
  const [iconReady, setIconReady] = useState<boolean>(!courseIconUrl);
  const [iconHandle] = useState<number | null>(() =>
    courseIconUrl ? delayRender('Loading course icon') : null,
  );
  useEffect(() => {
    if (!courseIconUrl || iconHandle === null) return;
    let cancelled = false;
    preloadMaskImage(courseIconUrl)
      .then((ok) => { if (!cancelled) setIconReady(ok); })
      .finally(() => continueRender(iconHandle));
    return () => { cancelled = true; };
  }, [courseIconUrl, iconHandle]);

  // Animations.
  const logoOp  = interpolate(frame, [LOGO_IN_START, LOGO_IN_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: entryEase,
  });
  const logoOffsetY = (1 - logoOp) * LOGO_SLIDE_Y;

  const labelOp = interpolate(frame, [LABEL_IN_START, LABEL_IN_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: entryEase,
  });
  const labelOffsetX = (1 - labelOp) * LABEL_SLIDE_X;

  const titleOp = interpolate(frame, [TITLE_IN_START, TITLE_IN_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: entryEase,
  });
  const titleOffsetX = (1 - titleOp) * TITLE_SLIDE_X;

  const badgeRaw = interpolate(frame, [BADGE_IN_START, BADGE_IN_END], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const badgeOp    = entryEase(badgeRaw);
  const badgeScale = 0.65 + 0.35 * badgePopEase(badgeRaw);

  const renderIcon = Boolean(courseIconUrl && iconReady);

  return (
    <AbsoluteFill style={{ backgroundColor: '#020d18', overflow: 'hidden' }}>
      {/* Background image */}
      <AbsoluteFill>
        <Img
          src={BG_SRC}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </AbsoluteFill>

      {/* Course logo row — icon (optional) + course title */}
      <div
        style={{
          position: 'absolute',
          top: LOGO_Y,
          left: LOGO_X,
          display: 'flex',
          alignItems: 'center',
          gap: LOGO_GAP,
          opacity: logoOp,
          transform: `translateY(${logoOffsetY}px)`,
        }}
      >
        {renderIcon && courseIconUrl ? (
          <div
            style={{
              width: LOGO_ICON_DISPLAY,
              height: LOGO_ICON_DISPLAY,
              flexShrink: 0,
              WebkitMaskImage: `url(${courseIconUrl})`,
              WebkitMaskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskImage: `url(${courseIconUrl})`,
              maskSize: 'contain',
              maskRepeat: 'no-repeat',
              maskPosition: 'center',
              backgroundColor: accent,
            }}
          />
        ) : null}
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: COURSE_TITLE_SIZE,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
            color: TITLE_COLOUR,
          }}
        >
          {courseTitle}
        </span>
      </div>

      {/* Lesson label (eyebrow) */}
      <div
        style={{
          position: 'absolute',
          top: LABEL_Y,
          left: LABEL_X,
          opacity: labelOp,
          transform: `translateX(${labelOffsetX}px)`,
        }}
      >
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: LABEL_SIZE,
            fontWeight: 700,
            color: accent,
            letterSpacing: '0.01em',
          }}
        >
          {lessonLabel}
        </span>
      </div>

      {/* Lesson headline */}
      <div
        style={{
          position: 'absolute',
          top: TITLE_Y,
          left: TITLE_X,
          opacity: titleOp,
          transform: `translateX(${titleOffsetX}px)`,
          maxWidth: 1920 - TITLE_X - 160,  // cap width so a too-long string can't run off-screen
        }}
      >
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: TITLE_SIZE,
            fontWeight: 800,
            color: TITLE_COLOUR,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
            display: 'inline-block',
          }}
        >
          {lessonTitle}
        </span>
      </div>

      {/* Brand badge (bottom-right) */}
      <div
        style={{
          position: 'absolute',
          right: BADGE_RIGHT,
          bottom: BADGE_BOTTOM,
          width:  BADGE_SIZE,
          height: BADGE_SIZE,
          overflow: 'hidden',
          borderRadius: BADGE_RADIUS,
          opacity: badgeOp,
          transform: `scale(${badgeScale})`,
          transformOrigin: 'bottom right',
        }}
      >
        <Img
          src={LOGO_SRC}
          alt=""
          style={{
            position: 'absolute',
            width:  BADGE_IMG_WIDTH,
            height: BADGE_IMG_HEIGHT,
            top:  BADGE_IMG_TOP,
            left: BADGE_IMG_LEFT,
            display: 'block',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
