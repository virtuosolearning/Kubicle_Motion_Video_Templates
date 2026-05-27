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

// Ports the Yin Yang / 2 Points prototype:
//   • Phase 1 (0.20–3.20 s): left container slides up from below (+1080 → 0),
//     right container slides down from above (−1080 → 0), both easeOutCubic.
//     Each container is 3 stacked PNGs (base + title bar + boxes).
//   • Phase 2: titles fade in at 3.30 s (left) and 5.40 s (right) over 0.50 s.
//   • Phase 3 (paired reveals): each icon pulses (easeOutBack scale, 0.70 s)
//     + opacity ramp (0.35 s) and its box text fades (0.50 s):
//       3.80 s — icon 0 (left side)
//       4.60 s — icon 1 (left side)
//       5.95 s — icon 2 (right side)
//       6.75 s — icon 3 (right side)
//   • Default composition length is 300 frames (10 s @ 30 fps).
//
// Icons use Pattern B runtime recolour: the SVG ships with #33CCCC accents
// (Icon Library default), and at render time the SvgIcon swaps that to the
// per-side accent (left = Dodger Blue #0496FF, right = pink #F865B0) plus
// fills the root white so unstyled outlines read on the dark base.

// ─── Schema ──────────────────────────────────────────────────────────────────

const boxSchema = z.object({
  // Icon ID from icons/ (e.g. "rocket"). Body renders white, accents tinted
  // with the side's accent colour at render time.
  icon: z.string().min(1),
  // Box caption — Satoshi Bold 37 px black inside the white footer box. ≤22 chars.
  text: z.string().min(1).max(22),
});

// Optional per-render timing overrides. All values in SECONDS.
export const yinYang2PointsTimingsSchema = z
  .object({
    entryStart:       z.number().nonnegative(),
    entryEnd:         z.number().positive(),
    title1FadeStart:  z.number().nonnegative(),
    title2FadeStart:  z.number().nonnegative(),
    pairStarts:       z.array(z.number().nonnegative()).length(4),
    titleFadeDuration: z.number().positive(),
    pulseDuration:    z.number().positive(),
    boxFadeDuration:  z.number().positive(),
  })
  .partial();

export const yinYang2PointsSchema = z.object({
  // Title text for the left side (Inter ExtraBold 55.5 px, white).
  leftTitle: z.string().min(1).max(40),
  // Title text for the right side.
  rightTitle: z.string().min(1).max(40),
  // 2 boxes on the left side, ordered left → right.
  leftBoxes: z.array(boxSchema).length(2),
  // 2 boxes on the right side, ordered left → right.
  rightBoxes: z.array(boxSchema).length(2),
  // Per-side accent colours. Defaults: left Dodger Blue, right pink.
  leftAccent:  z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  rightAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  timings: yinYang2PointsTimingsSchema.optional(),
});

export type YinYang2PointsProps = z.infer<typeof yinYang2PointsSchema>;

export const yinYang2PointsMeta = {
  description:
    'Two-pane dichotomy: a navy panel with a blue accent bar holding a title + ' +
    '2 icon-and-label boxes slides in from below, mirrored by a navy panel with ' +
    'a pink accent bar on the right sliding down from above. Icons pulse in ' +
    'pair-by-pair as their box text fades. Best for stark either/or contrasts ' +
    'where each side has its own internal pair of examples — manual vs ' +
    'automated, before vs after, problem vs solution, do this vs not that.',
  authoringNotes:
    'Always supply leftTitle, rightTitle (Inter ExtraBold 55.5 px Oxford Blue ' +
    'inside the coloured title bar — ≤40 chars). leftBoxes and rightBoxes are exactly ' +
    '2 items each — icon id from the catalog plus a short box caption (Satoshi ' +
    'Bold 37 px, ≤22 chars). Pair the two sides for contrast or comparison. ' +
    'GOOD: leftTitle "Manual" + rightTitle "Automated". BAD: titles too long ' +
    'to fit on one line. Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BASE_1_SRC          = staticFile('Template-Specific-Assets/base_1.png');
const BASE_2_SRC          = staticFile('Template-Specific-Assets/base_2.png');
const BASE_1_BOXES_SRC    = staticFile('Template-Specific-Assets/base_1_two_boxes.png');
const BASE_2_BOXES_SRC    = staticFile('Template-Specific-Assets/base_2_two_boxes.png');
const TITLE1_BOX_SRC      = staticFile('Template-Specific-Assets/title1_box.png');
const TITLE2_BOX_SRC      = staticFile('Template-Specific-Assets/title2_box.png');
const INTER_EXTRABOLD_SRC = staticFile('fonts/Inter-ExtraBold.woff2');
const SATOSHI_BOLD_SRC    = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (lifted directly from the prototype) ────────────────────

const ICON_SIZE = 300;
const ICON_CY   = 600;

const ICON_POS_L_CXS = [284, 673] as const;    // left side icon centres
const ICON_POS_R_CXS = [1256, 1644] as const;  // right side icon centres

const TITLE1_CX = 490;
const TITLE2_CX = 1445;
const TITLE_CY  = 348;
const TITLE_SIZE = 55.5;
const TITLE_MAX_WIDTH = 800;

const BOX_CY = 856;
const BOX_W  = 354;
const BOX_TEXT_SIZE = 37;

const DEFAULT_LEFT_ACCENT  = '#0496FF';
const DEFAULT_RIGHT_ACCENT = '#F865B0';

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  entryStart:        0.20,
  entryEnd:          3.20,
  title1FadeStart:   3.30,
  title2FadeStart:   5.40,
  pairStarts:        [3.80, 4.60, 5.95, 6.75] as readonly number[],
  titleFadeDuration: 0.50,
  pulseDuration:     0.70,
  boxFadeDuration:   0.50,
} as const;

const easeOutCubic = Easing.out(Easing.cubic);
const easeOutBack  = Easing.out(Easing.back(1.70158));

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const inter   = new FontFace('Inter',   `url(${INTER_EXTRABOLD_SRC}) format('woff2')`, { weight: '800', display: 'block' });
    const satoshi = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,    { weight: '700', display: 'block' });
    const [i, s]  = await Promise.all([inter.load(), satoshi.load()]);
    const fonts   = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(i);
    fonts.add(s);
  })();
  return fontsPromise;
}

// ─── SvgIcon (Pattern B runtime recolour) ─────────────────────────────────────
// Fetches the SVG, swaps the source `#33CCCC` accent with the per-side accent,
// and forces the root `<svg fill="white">` so unstyled outline paths render
// white on the dark base. Unknown icon names render nothing.

function SvgIcon({ name, size, accent }: { name: string; size: number; accent: string }) {
  const [html, setHtml] = useState('');
  const [handle] = useState(() => delayRender(`Loading icon: ${name}`));

  useEffect(() => {
    fetch(staticFile(`icons/${name}.svg`))
      .then(r => r.ok ? r.text() : Promise.reject())
      .then(raw => setHtml(
        raw
          .replace(/<\?xml[^>]*\?>\s*/g, '')
          .replace(/style="fill:#33CCCC;?"/gi, `style="fill:${accent};"`)
          .replace(/fill:#33CCCC/gi, `fill:${accent}`)
          .replace(/fill="#33CCCC"/gi, `fill="${accent}"`)
          .replace(/<svg [^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="white" width="${size}" height="${size}" style="display:block">`)
      ))
      .catch(() => setHtml(''))
      .finally(() => continueRender(handle));
  }, [name, size, accent, handle]);

  if (!html) return null;
  return <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Centred text helper ─────────────────────────────────────────────────────

function CentredText({
  cx,
  cy,
  text,
  size,
  weight,
  font,
  color,
  maxWidth,
  opacity,
}: {
  cx: number;
  cy: number;
  text: string;
  size: number;
  weight: number;
  font: string;
  color: string;
  maxWidth: number;
  opacity: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - maxWidth / 2,
        top:  cy,
        transform: 'translateY(-50%)',
        width: maxWidth,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: font,
        fontWeight: weight,
        fontSize: size,
        color,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
        textAlign: 'center',
        pointerEvents: 'none',
        opacity,
      }}
    >
      {text}
    </div>
  );
}

// ─── Container group (3 stacked PNGs that slide together) ────────────────────

function ContainerGroup({
  side,
  translateY,
}: {
  side: 'left' | 'right';
  translateY: number;
}) {
  const isLeft   = side === 'left';
  const baseSrc  = isLeft ? BASE_1_SRC          : BASE_2_SRC;
  const titleSrc = isLeft ? TITLE1_BOX_SRC      : TITLE2_BOX_SRC;
  const boxesSrc = isLeft ? BASE_1_BOXES_SRC    : BASE_2_BOXES_SRC;

  const fullAssetStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top:  0,
    width:  1920,
    height: 1080,
    pointerEvents: 'none',
    display: 'block',
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top:  0,
        width:  1920,
        height: 1080,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <Img src={baseSrc}  alt="" style={fullAssetStyle} />
      <Img src={titleSrc} alt="" style={fullAssetStyle} />
      <Img src={boxesSrc} alt="" style={fullAssetStyle} />
    </div>
  );
}

// ─── Icon pulse + box text pair ──────────────────────────────────────────────

function IconPulse({
  frame,
  cx,
  cy,
  iconName,
  accent,
  startFrame,
  pulseDur,
}: {
  frame: number;
  cx: number;
  cy: number;
  iconName: string;
  accent: string;
  startFrame: number;
  pulseDur: number;
}) {
  if (frame < startFrame) return null;

  const localFrame = frame - startFrame;
  const pulseProg  = Math.max(0, Math.min(1, localFrame / pulseDur));
  const scale      = easeOutBack(pulseProg);
  // Opacity ramp roughly 0.35 s — half the pulse duration.
  const opacityProg = Math.max(0, Math.min(1, localFrame / (pulseDur * 0.5)));

  return (
    <div
      style={{
        position: 'absolute',
        left: cx - ICON_SIZE / 2,
        top:  cy - ICON_SIZE / 2,
        width:  ICON_SIZE,
        height: ICON_SIZE,
        opacity: opacityProg,
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        pointerEvents: 'none',
      }}
    >
      <SvgIcon name={iconName} size={ICON_SIZE} accent={accent} />
    </div>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const YinYang2Points: React.FC<YinYang2PointsProps> = ({
  leftTitle,
  rightTitle,
  leftBoxes,
  rightBoxes,
  leftAccent,
  rightAccent,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading YinYang2Points fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const ENTRY_START      = f(t.entryStart);
  const ENTRY_END        = f(t.entryEnd);
  const TITLE1_START     = f(t.title1FadeStart);
  const TITLE2_START     = f(t.title2FadeStart);
  const PAIR_STARTS      = t.pairStarts.map(f);
  const TITLE_FADE_DUR   = f(t.titleFadeDuration);
  const PULSE_DUR        = f(t.pulseDuration);
  const BOX_FADE_DUR     = f(t.boxFadeDuration);

  const accentL = leftAccent  ?? DEFAULT_LEFT_ACCENT;
  const accentR = rightAccent ?? DEFAULT_RIGHT_ACCENT;

  // Container slide-ins: left from y=+1080, right from y=-1080.
  const leftTY  = interpolate(frame, [ENTRY_START, ENTRY_END], [1080, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });
  const rightTY = interpolate(frame, [ENTRY_START, ENTRY_END], [-1080, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutCubic,
  });

  // Title fades.
  const title1Op = interpolate(frame, [TITLE1_START, TITLE1_START + TITLE_FADE_DUR], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const title2Op = interpolate(frame, [TITLE2_START, TITLE2_START + TITLE_FADE_DUR], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  // Box text fade-in helper.
  const boxOp = (i: number) => interpolate(frame, [PAIR_STARTS[i]!, PAIR_STARTS[i]! + BOX_FADE_DUR], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  const titleFont = "'Inter', system-ui, sans-serif";
  const boxFont   = "'Satoshi', 'Inter', system-ui, sans-serif";

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Containers slide in from opposite edges */}
      <ContainerGroup side="left"  translateY={leftTY} />
      <ContainerGroup side="right" translateY={rightTY} />

      {/* Title 1 */}
      <CentredText
        cx={TITLE1_CX}
        cy={TITLE_CY}
        text={leftTitle}
        size={TITLE_SIZE}
        weight={800}
        font={titleFont}
        color="#052438"
        maxWidth={TITLE_MAX_WIDTH}
        opacity={title1Op}
      />

      {/* Pair 1 — left icon 0 + box 0 */}
      <IconPulse
        frame={frame}
        cx={ICON_POS_L_CXS[0]}
        cy={ICON_CY}
        iconName={leftBoxes[0]!.icon}
        accent={accentL}
        startFrame={PAIR_STARTS[0]!}
        pulseDur={PULSE_DUR}
      />
      <CentredText
        cx={ICON_POS_L_CXS[0]}
        cy={BOX_CY}
        text={leftBoxes[0]!.text}
        size={BOX_TEXT_SIZE}
        weight={700}
        font={boxFont}
        color="#000000"
        maxWidth={BOX_W}
        opacity={boxOp(0)}
      />

      {/* Pair 2 — left icon 1 + box 1 */}
      <IconPulse
        frame={frame}
        cx={ICON_POS_L_CXS[1]}
        cy={ICON_CY}
        iconName={leftBoxes[1]!.icon}
        accent={accentL}
        startFrame={PAIR_STARTS[1]!}
        pulseDur={PULSE_DUR}
      />
      <CentredText
        cx={ICON_POS_L_CXS[1]}
        cy={BOX_CY}
        text={leftBoxes[1]!.text}
        size={BOX_TEXT_SIZE}
        weight={700}
        font={boxFont}
        color="#000000"
        maxWidth={BOX_W}
        opacity={boxOp(1)}
      />

      {/* Title 2 */}
      <CentredText
        cx={TITLE2_CX}
        cy={TITLE_CY}
        text={rightTitle}
        size={TITLE_SIZE}
        weight={800}
        font={titleFont}
        color="#052438"
        maxWidth={TITLE_MAX_WIDTH}
        opacity={title2Op}
      />

      {/* Pair 3 — right icon 0 + box 2 */}
      <IconPulse
        frame={frame}
        cx={ICON_POS_R_CXS[0]}
        cy={ICON_CY}
        iconName={rightBoxes[0]!.icon}
        accent={accentR}
        startFrame={PAIR_STARTS[2]!}
        pulseDur={PULSE_DUR}
      />
      <CentredText
        cx={ICON_POS_R_CXS[0]}
        cy={BOX_CY}
        text={rightBoxes[0]!.text}
        size={BOX_TEXT_SIZE}
        weight={700}
        font={boxFont}
        color="#000000"
        maxWidth={BOX_W}
        opacity={boxOp(2)}
      />

      {/* Pair 4 — right icon 1 + box 3 */}
      <IconPulse
        frame={frame}
        cx={ICON_POS_R_CXS[1]}
        cy={ICON_CY}
        iconName={rightBoxes[1]!.icon}
        accent={accentR}
        startFrame={PAIR_STARTS[3]!}
        pulseDur={PULSE_DUR}
      />
      <CentredText
        cx={ICON_POS_R_CXS[1]}
        cy={BOX_CY}
        text={rightBoxes[1]!.text}
        size={BOX_TEXT_SIZE}
        weight={700}
        font={boxFont}
        color="#000000"
        maxWidth={BOX_W}
        opacity={boxOp(3)}
      />
    </AbsoluteFill>
  );
};
