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
  useVideoConfig,
} from 'remotion';
import { z } from 'zod';

// Mirrors the media-team's Lesson Title Screen prototype. Callers
// supply course + lesson copy and optionally a per-course accent color
// and brand icon; everything visual else (layout, sizing, animation
// beats) is fixed to the approved design and lives as constants in
// this file.
// Optional per-render timing overrides. All values are in frames at 30 fps;
// any field omitted falls back to the corresponding entry in DEFAULT_TIMINGS.
export const lessonTitleTimingsSchema = z
  .object({
    logoInStart: z.number().nonnegative(),
    logoInDuration: z.number().positive(),
    labelInStart: z.number().nonnegative(),
    labelInDuration: z.number().positive(),
    titleInStart: z.number().nonnegative(),
    titleInDuration: z.number().positive(),
    badgeInStart: z.number().nonnegative(),
    badgeInDuration: z.number().positive(),
    outroDuration: z.number().nonnegative(),
  })
  .partial();

export const lessonTitleSchema = z.object({
  // Course name rendered next to the course icon at top-left (e.g.
  // "Excel Fundamentals"). One-line only; wrapping is not supported.
  courseTitle: z.string().min(1).max(80),
  // Short eyebrow above the main title (e.g. "Lesson One"). Rendered
  // in the accent color to establish position in the course.
  lessonLabel: z.string().min(1).max(40),
  // The big headline. Allowed to wrap - the design accommodates two
  // lines at the default size; longer strings should be trimmed
  // upstream by the caller.
  lessonTitle: z.string().min(1).max(120),
  // Optional per-course brand override. Validated as a 6-digit hex
  // triple; the "#" is required. Falls back to DEFAULT_ACCENT when
  // absent so brand-less renders still pick up the house color.
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Optional URL for the course icon. Rendered as a CSS mask tinted
  // with accentColor (mirrors the prototype's ImageDropZone → mask
  // behavior). If the URL is absent or fails to load the icon simply
  // doesn't render - the course title text still shows.
  courseIconUrl: z.string().url().optional(),
  // Optional animation timing overrides (frames @ 30fps). See
  // lessonTitleTimingsSchema for the available knobs.
  timings: lessonTitleTimingsSchema.optional(),
});

export type LessonTitleProps = z.infer<typeof lessonTitleSchema>;

export const lessonTitleMeta = {
  description:
    'Opening card announcing the lesson: brand-tinted course icon + ' +
    'course title, accent lesson label, big headline, and a Kubicle ' +
    'brand badge in the bottom-right.',
  authoringNotes:
    'Use as the first scene of every lesson. courseTitle sits next to ' +
    'the course icon (top-left); keep it under ~35 characters. ' +
    'lessonLabel is the eyebrow ("Lesson One", "Chapter 3", etc.). ' +
    'lessonTitle is the headline; aim for under 60 characters so it ' +
    'lands on one or two lines at the default 78px size. ' +
    'accentColor (6-digit hex, # required) overrides the house ' +
    'Dodger Blue per-course; courseIconUrl should point at a ' +
    'mostly-transparent PNG/SVG whose non-transparent region forms ' +
    'the icon silhouette - it gets tinted with accentColor at render ' +
    'time. Default composition length is 300 frames (10s at 30fps); ' +
    'the outro fade always hugs the last 1.1 seconds of whatever ' +
    'duration the caller asks for.',
} as const;

// Brand palette defaults. DEFAULT_ACCENT matches the prototype's
// TWEAK_DEFAULTS.accentColor; TITLE_COLOR is locked because the
// headline is always white-on-dark in the signed-off design.
const DEFAULT_ACCENT = '#0794FD';
const TITLE_COLOR = '#FFFFFF';

const BACKGROUND_SRC = staticFile('images/lesson_title_background.png');
const LOGO_SRC = staticFile('images/logo.png');
const INTER_SEMIBOLD_URL = staticFile('fonts/Inter-SemiBold.woff2');
const INTER_BOLD_URL = staticFile('fonts/Inter-Bold.woff2');
const INTER_EXTRABOLD_URL = staticFile('fonts/Inter-ExtraBold.woff2');

// Layout constants lifted from TWEAK_DEFAULTS. The tweak sliders in
// the prototype exist for the media team to dial the design; they are
// not per-render inputs. Keeping them here named and grouped means a
// future design refresh only has to edit this block.
const LOGO_X = 77;
const LOGO_Y = 58;
const LOGO_ICON_SIZE = 52;
const LOGO_SCALE = 1.25;
const LOGO_ICON_DISPLAY = Math.round(LOGO_ICON_SIZE * LOGO_SCALE);
const LOGO_GAP = Math.round(11 * LOGO_SCALE);
const COURSE_TITLE_SIZE = Math.round(22 * LOGO_SCALE);

const LABEL_X = 59;
const LABEL_Y = 390;
const LABEL_SIZE = 32;

const TITLE_X = 58;
const TITLE_Y = 432;
const TITLE_SIZE = 78;

const BADGE_RIGHT = 76;
const BADGE_BOTTOM = 80;
const BADGE_SIZE = 116;
const BADGE_RADIUS = Math.round(BADGE_SIZE * 0.14);

// Badge is a 101x101 region located at (1695, 854) within the
// 1920x1080 logo.png canvas. We scale the whole logo up so that
// 101px maps to BADGE_SIZE px, then negatively offset it so the
// badge region lands in the 0,0 corner of the overflow-hidden
// wrapper. Numbers match the prototype verbatim.
const BADGE_IMG_NATURAL = 101;
const BADGE_IMG_WIDTH = Math.round((1920 * BADGE_SIZE) / BADGE_IMG_NATURAL);
const BADGE_IMG_HEIGHT = Math.round((1080 * BADGE_SIZE) / BADGE_IMG_NATURAL);
const BADGE_IMG_TOP = -Math.round((854 * BADGE_SIZE) / BADGE_IMG_NATURAL);
const BADGE_IMG_LEFT = -Math.round((1695 * BADGE_SIZE) / BADGE_IMG_NATURAL);

// Entry slide magnitudes - matches the prototype's entryDistance * k
// formulas. Logo drops down from above (negative Y), label and title
// slide in from the left; title slides slightly further than label so
// the headline "arrives" last.
const ENTRY_DISTANCE = 28;
const LOGO_SLIDE_Y = -ENTRY_DISTANCE * 0.5;
const LABEL_SLIDE_X = -ENTRY_DISTANCE;
const TITLE_SLIDE_X = -ENTRY_DISTANCE * 1.3;

// Animation timeline (30 fps). Mirrors the prototype's delays at 1x
// speed, converted to integer frames for determinism.
//
//   t (s)   frame   event          duration
//   0.00      0     logo fade+drop  0.60s / 18f
//   0.85     26     label slide-in  0.50s / 15f
//   1.10     33     title slide-in  0.60s / 18f
//   1.30     39     badge pop-in    0.50s / 15f
//   tail    -33     whole-scene outro fade (1.10s / 33f from end)
const DEFAULT_TIMINGS = {
  logoInStart: 0,
  logoInDuration: 18,
  labelInStart: 26,
  labelInDuration: 15,
  titleInStart: 33,
  titleInDuration: 18,
  badgeInStart: 39,
  badgeInDuration: 15,
  outroDuration: 33,
} as const;

const entryEase = Easing.out(Easing.cubic);
const badgePopEase = Easing.out(Easing.back(1.7));
const outroEase = Easing.ease;

// Module-level font promise so repeated scene mounts share the same
// delayRender cycle. document.fonts is global - second call is a no-op
// once the woff2 have registered.
let fontsPromise: Promise<void> | null = null;

function loadLessonTitleFonts(): Promise<void> {
  if (fontsPromise) {
    return fontsPromise;
  }
  fontsPromise = (async () => {
    const semiBold = new FontFace('Inter', `url(${INTER_SEMIBOLD_URL}) format('woff2')`, {
      weight: '600',
      style: 'normal',
      display: 'block',
    });
    const bold = new FontFace('Inter', `url(${INTER_BOLD_URL}) format('woff2')`, {
      weight: '700',
      style: 'normal',
      display: 'block',
    });
    const extraBold = new FontFace('Inter', `url(${INTER_EXTRABOLD_URL}) format('woff2')`, {
      weight: '800',
      style: 'normal',
      display: 'block',
    });
    const [s, b, x] = await Promise.all([semiBold.load(), bold.load(), extraBold.load()]);
    const fonts = document.fonts as FontFaceSet & { add(font: FontFace): void };
    fonts.add(s);
    fonts.add(b);
    fonts.add(x);
  })();
  return fontsPromise;
}

// Preload the course icon URL as a raw <img> so the CSS mask is ready
// before the frame is painted. Mask images don't go through Remotion's
// <Img> (they're set via a style prop), so we have to cover this
// ourselves. Resolves true on success, false on any error - the caller
// uses the boolean to decide whether to render the icon at all, so a
// broken URL degrades to "course title without icon" instead of
// failing the render.
function preloadMaskImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export const LessonTitle: React.FC<LessonTitleProps> = ({
  courseTitle,
  lessonLabel,
  lessonTitle,
  accentColor,
  courseIconUrl,
  timings,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const accent = accentColor ?? DEFAULT_ACCENT;

  // Merge caller-supplied timing overrides over the signed-off defaults.
  const t = { ...DEFAULT_TIMINGS, ...timings };
  const LOGO_IN_START = t.logoInStart;
  const LOGO_IN_DURATION = t.logoInDuration;
  const LABEL_IN_START = t.labelInStart;
  const LABEL_IN_DURATION = t.labelInDuration;
  const TITLE_IN_START = t.titleInStart;
  const TITLE_IN_DURATION = t.titleInDuration;
  const BADGE_IN_START = t.badgeInStart;
  const BADGE_IN_DURATION = t.badgeInDuration;
  const OUTRO_DURATION = t.outroDuration;

  const [fontHandle] = useState(() => delayRender('Loading LessonTitle fonts'));
  useEffect(() => {
    loadLessonTitleFonts()
      .catch(() => {
        // Swallow - if the font fetch fails headless Chromium will
        // fall back to system fonts rather than block the render.
      })
      .finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  // Icon preload. Only delay a frame if the caller actually supplied a
  // URL - otherwise we skip the round-trip entirely.
  const [iconReady, setIconReady] = useState<boolean>(!courseIconUrl);
  const [iconHandle] = useState<number | null>(() =>
    courseIconUrl ? delayRender('Loading course icon') : null,
  );
  useEffect(() => {
    if (!courseIconUrl || iconHandle === null) {
      return;
    }
    let cancelled = false;
    preloadMaskImage(courseIconUrl)
      .then((ok) => {
        if (!cancelled) {
          setIconReady(ok);
        }
      })
      .finally(() => continueRender(iconHandle));
    return () => {
      cancelled = true;
    };
  }, [courseIconUrl, iconHandle]);

  const logoOp = interpolate(
    frame,
    [LOGO_IN_START, LOGO_IN_START + LOGO_IN_DURATION],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: entryEase },
  );
  const logoOffY = (1 - logoOp) * LOGO_SLIDE_Y;

  const labelOp = interpolate(
    frame,
    [LABEL_IN_START, LABEL_IN_START + LABEL_IN_DURATION],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: entryEase },
  );
  const labelOffX = (1 - labelOp) * LABEL_SLIDE_X;

  const titleOp = interpolate(
    frame,
    [TITLE_IN_START, TITLE_IN_START + TITLE_IN_DURATION],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: entryEase },
  );
  const titleOffX = (1 - titleOp) * TITLE_SLIDE_X;

  const badgeRaw = interpolate(
    frame,
    [BADGE_IN_START, BADGE_IN_START + BADGE_IN_DURATION],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const badgeOp = entryEase(badgeRaw);
  // 0.65 -> 1.0 scale with a tiny overshoot via easeOutBack, same shape
  // as the prototype.
  const badgeScale = 0.65 + 0.35 * badgePopEase(badgeRaw);

  const outroStart = Math.max(0, durationInFrames - OUTRO_DURATION);
  const outroOpacity = interpolate(
    frame,
    [outroStart, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: outroEase },
  );

  const renderIcon = Boolean(courseIconUrl && iconReady);

  return (
    <AbsoluteFill style={{ backgroundColor: '#020d18', overflow: 'hidden', opacity: outroOpacity }}>
      <AbsoluteFill>
        <Img
          src={BACKGROUND_SRC}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          alt=""
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
          transform: `translateY(${logoOffY}px)`,
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
            color: TITLE_COLOR,
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
          transform: `translateX(${labelOffX}px)`,
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
          transform: `translateX(${titleOffX}px)`,
          // Cap the headline box so the design's two-line ceiling is
          // respected even if an overly long string slips through the
          // 120-char schema limit.
          maxWidth: 1920 - TITLE_X - 160,
        }}
      >
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: TITLE_SIZE,
            fontWeight: 800,
            color: TITLE_COLOR,
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
          width: BADGE_SIZE,
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
            width: BADGE_IMG_WIDTH,
            height: BADGE_IMG_HEIGHT,
            top: BADGE_IMG_TOP,
            left: BADGE_IMG_LEFT,
            display: 'block',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
