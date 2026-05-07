// scene.jsx — Word Definition 10s screen
// Follows guidelines in uploads/Guidelines.pdf

const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "definitionTitle": "Serendipity",
  "definitionDescription": "The occurrence and development of events by chance in a happy or beneficial way.",
  "titleColor": "#0B1B2B",
  "descriptionColor": "#4A5864",
  "titleSizePx": 74,
  "descriptionSizePx": 55.5,
  "titleFont": "Inter",
  "descriptionFont": "Satoshi",
  "backgroundStyle": "gradient",
  "backgroundTintHue": 210,
  "bannerSettleTime": 1.47,
  "bannerEntryDirection": "top",
  "bannerEase": "easeOutCubic",
  "pillSettleTime": 1.47,
  "pillEntryDirection": "right",
  "pillEase": "easeOutCubic",
  "titleTypewriterStart": 0.0,
  "titleTypewriterEnd": 1.3,
  "titleLetterStagger": "ease",
  "titleLetterFadeDur": 0.25,
  "descFadeStart": 0.67,
  "descFadeEnd": 2.67,
  "descAnimationStyle": "fade",
  "bannerScale": 1.0,
  "pillScale": 1.0,
  "titleLeftPx": 120,
  "titleTopPx": 460,
  "showIconGlow": true,
  "holdDuration": 10
}/*EDITMODE-END*/;

// ──────────────────────────────────────────────────────────────
// Timing: guideline timestamps are in NDF timecode (frames at 30fps)
//  0:00:01:14  = 1 + 14/30 ≈ 1.467s  — banner & pill settle
//  0:00:01:09  = 1 + 9/30  ≈ 1.30s   — title typewriter end
//  0:00:00:20  = 20/30     ≈ 0.667s  — desc fade start
//  0:00:02:20  = 2 + 20/30 ≈ 2.667s  — desc fade end
// ──────────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// ── Background ────────────────────────────────────────────────
function Background({ style, hue }) {
  if (style === 'image') {
    return (
      <img
        src="assets/Background.png"
        alt=""
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
        }}
      />
    );
  }
  if (style === 'solid') {
    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: `oklch(94% 0.018 ${hue})`,
      }} />
    );
  }
  if (style === 'dark') {
    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse at 30% 20%, oklch(22% 0.04 ${hue}) 0%, oklch(14% 0.03 ${hue}) 60%, oklch(10% 0.02 ${hue}) 100%)`,
      }} />
    );
  }
  // 'gradient' — default platinum blue
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: `linear-gradient(135deg, oklch(97% 0.012 ${hue}) 0%, oklch(92% 0.022 ${hue}) 100%)`,
    }} />
  );
}

// ── Banner ────────────────────────────────────────────────────
function Banner({ t, settleTime, direction, ease, scale }) {
  const easeFn = Easing[ease] || Easing.easeOutCubic;
  // Banner sits at top-left. Measured from original screenshot:
  // banner in PNG occupies ~x:62 y:62, size ~230x230 at 1920x1080? Actually
  // the banner image is the full 1920x1080 canvas with transparency, so we
  // overlay it at same size; we animate a translate on the container.
  const progress = easeFn(clamp(t / settleTime, 0, 1));
  let tx = 0, ty = 0;
  const dist = 520;
  switch (direction) {
    case 'top':   ty = -dist * (1 - progress); break;
    case 'bottom':ty =  dist * (1 - progress); break;
    case 'left':  tx = -dist * (1 - progress); break;
    case 'right': tx =  dist * (1 - progress); break;
  }
  return (
    <div style={{
      position: 'absolute', inset: 0,
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      transformOrigin: '175px 175px', // roughly centered on banner graphic
      willChange: 'transform',
    }}>
      <img
        src="assets/Word_Definition_Banner.png"
        alt=""
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

// ── Icon Pill ─────────────────────────────────────────────────
function IconPill({ t, settleTime, direction, ease, scale, showGlow }) {
  const easeFn = Easing[ease] || Easing.easeOutCubic;
  const progress = easeFn(clamp(t / settleTime, 0, 1));
  let tx = 0, ty = 0;
  const dist = 700;
  switch (direction) {
    case 'top':   ty = -dist * (1 - progress); break;
    case 'bottom':ty =  dist * (1 - progress); break;
    case 'left':  tx = -dist * (1 - progress); break;
    case 'right': tx =  dist * (1 - progress); break;
  }
  return (
    <div style={{
      position: 'absolute', inset: 0,
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      transformOrigin: '1630px 540px',
      opacity: showGlow ? 1 : 0.95,
      filter: showGlow ? 'none' : 'drop-shadow(0 0 0 transparent)',
      willChange: 'transform',
    }}>
      <img
        src="assets/Icon_Pill.png"
        alt=""
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

// ── Staggered typewriter title ────────────────────────────────
function TypewriterTitle({
  text, x, y, size, color, font, startTime, endTime, fadeDur,
  staggerCurve, currentT,
}) {
  const chars = Array.from(text);
  const n = chars.length;
  const total = Math.max(0.001, endTime - startTime);
  // each letter starts at startTime + f(i)*(total - fadeDur)
  const curve = staggerCurve === 'easeIn'
    ? (i) => Math.pow(i, 1.6)
    : staggerCurve === 'easeOut'
      ? (i) => 1 - Math.pow(1 - i, 1.6)
      : staggerCurve === 'ease'
        ? (i) => Easing.easeInOutQuad(i)
        : (i) => i;

  const spanRange = Math.max(0.001, total - fadeDur);

  const fontFamily = font === 'Inter'
    ? '"Inter", system-ui, sans-serif'
    : font === 'Satoshi'
      ? '"Satoshi", "Inter", system-ui, sans-serif'
      : font === 'Manrope'
        ? '"Manrope", "Inter", system-ui, sans-serif'
        : font === 'Fraunces'
          ? '"Fraunces", Georgia, serif'
          : font;

  // Pill's left edge sits around x≈1380 in 1920px canvas; leave a gutter.
  const RIGHT_SAFE_X = 1320;
  const maxWidth = Math.max(200, RIGHT_SAFE_X - x);

  return (
    <div style={{
      position: 'absolute',
      left: x, top: y,
      fontFamily,
      fontWeight: 800,
      fontSize: size,
      lineHeight: 1.05,
      color,
      letterSpacing: '-0.015em',
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      maxWidth,
    }}>
      {chars.map((ch, i) => {
        const iNorm = n <= 1 ? 0 : i / (n - 1);
        const letterStart = startTime + curve(iNorm) * spanRange;
        const letterEnd = letterStart + fadeDur;
        const local = clamp((currentT - letterStart) / (letterEnd - letterStart), 0, 1);
        const op = Easing.easeOutQuad(local);
        return (
          <span key={i} style={{
            display: 'inline-block',
            opacity: op,
            whiteSpace: 'pre',
          }}>
            {ch === ' ' ? '\u00A0' : ch}
          </span>
        );
      })}
    </div>
  );
}

// ── Description ───────────────────────────────────────────────
function Description({
  text, x, y, size, color, font, fadeStart, fadeEnd, animStyle, currentT,
}) {
  const local = clamp((currentT - fadeStart) / Math.max(0.001, fadeEnd - fadeStart), 0, 1);
  let opacity = 1;
  let ty = 0;
  let blur = 0;
  if (animStyle === 'fade') {
    opacity = Easing.easeInOutQuad(local);
  } else if (animStyle === 'slideUp') {
    opacity = Easing.easeOutQuad(local);
    ty = (1 - Easing.easeOutCubic(local)) * 20;
  } else if (animStyle === 'blur') {
    opacity = Easing.easeOutQuad(local);
    blur = (1 - local) * 6;
  } else if (animStyle === 'typewriter-word') {
    opacity = 1;
    // handled below
  }

  const fontFamily = font === 'Satoshi'
    ? '"Satoshi", "Inter", system-ui, sans-serif'
    : font === 'Inter'
      ? '"Inter", system-ui, sans-serif'
      : font === 'Manrope'
        ? '"Manrope", "Inter", system-ui, sans-serif'
        : font === 'Fraunces'
          ? '"Fraunces", Georgia, serif'
          : font;

  if (animStyle === 'typewriter-word') {
    const words = text.split(' ');
    const n = words.length;
    const perWord = Math.max(0.001, (fadeEnd - fadeStart) / n);
    return (
      <div style={{
        position: 'absolute',
        left: x, top: y,
        fontFamily,
        fontWeight: 500,
        fontSize: size,
        lineHeight: 1.25,
        color,
        letterSpacing: '-0.005em',
        maxWidth: Math.max(200, 1320 - x),
      }}>
        {words.map((w, i) => {
          const ws = fadeStart + i * perWord;
          const we = ws + perWord * 1.8;
          const lp = clamp((currentT - ws) / (we - ws), 0, 1);
          return (
            <React.Fragment key={i}>
              <span style={{ opacity: Easing.easeOutQuad(lp) }}>{w}</span>
              {i < words.length - 1 ? ' ' : ''}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute',
      left: x, top: y,
      fontFamily,
      fontWeight: 500,
      fontSize: size,
      lineHeight: 1.25,
      color,
      letterSpacing: '-0.005em',
      opacity,
      transform: `translateY(${ty}px)`,
      filter: blur > 0 ? `blur(${blur}px)` : 'none',
      maxWidth: Math.max(200, 1320 - x),
      willChange: 'transform, opacity, filter',
    }}>
      {text}
    </div>
  );
}

// ── Scene ─────────────────────────────────────────────────────
function WordDefinitionScene({ tweaks }) {
  const t = useTime();
  return (
    <>
      <Background style={tweaks.backgroundStyle} hue={tweaks.backgroundTintHue} />
      <Banner
        t={t}
        settleTime={tweaks.bannerSettleTime}
        direction={tweaks.bannerEntryDirection}
        ease={tweaks.bannerEase}
        scale={tweaks.bannerScale}
      />
      <IconPill
        t={t}
        settleTime={tweaks.pillSettleTime}
        direction={tweaks.pillEntryDirection}
        ease={tweaks.pillEase}
        scale={tweaks.pillScale}
        showGlow={tweaks.showIconGlow}
      />
      <TypewriterTitle
        text={tweaks.definitionTitle}
        x={tweaks.titleLeftPx}
        y={tweaks.titleTopPx}
        size={tweaks.titleSizePx}
        color={tweaks.titleColor}
        font={tweaks.titleFont}
        startTime={tweaks.titleTypewriterStart}
        endTime={tweaks.titleTypewriterEnd}
        fadeDur={tweaks.titleLetterFadeDur}
        staggerCurve={tweaks.titleLetterStagger}
        currentT={t}
      />
      <Description
        text={tweaks.definitionDescription}
        x={tweaks.titleLeftPx}
        y={tweaks.titleTopPx + tweaks.titleSizePx + 40}
        size={tweaks.descriptionSizePx}
        color={tweaks.descriptionColor}
        font={tweaks.descriptionFont}
        fadeStart={tweaks.descFadeStart}
        fadeEnd={tweaks.descFadeEnd}
        animStyle={tweaks.descAnimationStyle}
        currentT={t}
      />
    </>
  );
}

Object.assign(window, { WordDefinitionScene, DEFAULT_TWEAKS });
