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

// Points3Subtopics2 — split-screen with 3 colour sections, each carrying 2 detail shells.
//   • Phase 1 (0.00–1.40 s): Oxford Blue right panel pans in from the right;
//     left icon frame (Icon_Base.png + anchor icon) fades in.
//   • Phase 2 onward: three colour sections (Blue, Pink, Yellow) appear at
//     1.50 / 5.50 / 9.50 s. Each runs the same internal beat:
//       0.00–0.80   title pill scales in (easeOutBack, c1=0.9 — subtle overshoot)
//       0.50–1.05   title text fades in (with leading arrow)
//       1.00–1.65   detail shell 1 scales in (easeOutBack, c1=0.45 — tinier)
//       1.65–2.20   detail 1 typewriter
//       2.00–2.65   detail shell 2 scales in
//       2.65–3.20   detail 2 typewriter
//   • Default composition length is 450 frames (15 s @ 30 fps).
//
// Anchor icon (graphic.svg) recoloured at port time: #052438 → #E6ECF2 base,
// #0496FF Dodger Blue accents preserved.

// ─── Schema ──────────────────────────────────────────────────────────────────

const sectionSchema = z.object({
  // Title pill caption — bold ink, Satoshi Black 55 px. Capped at 3 WORDS
  // (and ≤30 chars) so the phrase fits the pill on one line without ever
  // being cut off mid-word.
  mainText: z
    .string()
    .min(1)
    .max(30)
    .refine(
      s => s.trim().split(/\s+/).length <= 3,
      { message: 'mainText must be 3 words or fewer (one tight phrase per pill)' },
    ),
  // Two supporting detail lines that type out in the shells. ≤45 chars each.
  detailTexts: z.array(z.string().min(1).max(45)).length(2),
});

// Optional per-render timing overrides. All values in SECONDS.
export const points3Subtopics2TimingsSchema = z
  .object({
    bgPanStart: z.number().nonnegative(),
    bgPanEnd:   z.number().positive(),
    frameFadeIn:  z.number().nonnegative(),
    frameFadeOut: z.number().positive(),
    sectionStarts: z.array(z.number().nonnegative()).length(3),
    titleScaleDur: z.number().positive(),
    titleTextIn:   z.number().nonnegative(),
    titleTextDur:  z.number().positive(),
    d1ScaleStart:  z.number().nonnegative(),
    d2ScaleStart:  z.number().nonnegative(),
    shellScaleDur: z.number().positive(),
    shellTextDur:  z.number().positive(),
  })
  .partial();

export const points3Subtopics2Schema = z.object({
  // Exactly 3 sections, in colour order: Dodger Blue → Wild Strawberry → Lemon Yellow.
  sections: z.array(sectionSchema).length(3),
  // Icon ID for the anchor on the left panel (e.g. "graphic"). Should be an
  // SVG patched to #E6ECF2 base + Dodger Blue accents.
  anchor: z.discriminatedUnion('kind', [
    // Icon anchor — locked to the -dark-suffix variant from the master
    // Icons/ catalogue. Those SVGs are platinum + Dodger-Blue line art and
    // read brightly on the Oxford-Blue panel; the -light variants disappear.
    z.object({
      kind: z.literal('icon'),
      id:   z.string().min(1).regex(/-dark$/, {
        message: 'Anchor icon must end with -dark (use a -dark-suffix id from the Icons/ catalogue)',
      }),
    }),
    z.object({ kind: z.literal('character'), id: z.string().min(1) }),
  ]),
  timings: points3Subtopics2TimingsSchema.optional(),
});

export type Points3Subtopics2Props = z.infer<typeof points3Subtopics2Schema>;

export const points3Subtopics2Meta = {
  description:
    'Split-screen layout: Oxford Blue right panel pans in with a large anchor ' +
    'icon on the left. Three colour sections (Blue / Pink / Yellow) appear ' +
    'sequentially on the right, each with a title pill and 2 detail shells ' +
    'that scale in + type out. Best for 3 main ideas with 2 supporting points each.',
  authoringNotes:
    'Always supply exactly 3 sections. mainText is the title pill caption — bold ' +
    'ink at 55 px, 3 WORDS OR FEWER and ≤30 chars so the phrase fits the pill on ' +
    'one line without being cut off mid-word. detailTexts[0] and [1] type out ' +
    'underneath — Satoshi Bold white at 33 px, ≤45 chars each. Keep parallel ' +
    'structure across sections (e.g. all noun phrases). GOOD mainText: ' +
    '"Plan", "Build", "Ship", "Measure Outcomes". GOOD detailTexts: ' +
    '"Define entities and goals", "Map data flows". BAD: long sentences — ' +
    "strip to noun phrases. anchor is a discriminated union: " +
    "{ kind: 'icon', id } MUST use a -dark-suffix id from the master Icons/ " +
    "catalogue (e.g. 'business-success-path-dark') — those SVGs are platinum + " +
    'Dodger Blue and read on the Oxford-Blue panel. ' +
    "{ kind: 'character', id } picks a PNG from the character library. " +
    'Default duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BG_SRC        = staticFile('Template-Specific-Assets/oxford_blue_splitscreen.png');
const ICON_BASE_SRC = staticFile('Template-Specific-Assets/icon_base.png');

const TITLE_PILL_SRCS = {
  blue:   staticFile('Template-Specific-Assets/title_pill_dodger_blue.png'),
  pink:   staticFile('Template-Specific-Assets/title_pill_wild_strawberry.png'),
  yellow: staticFile('Template-Specific-Assets/title_pill_lemon_yellow.png'),
} as const;
const SHELL_SRCS = {
  blue:   staticFile('Template-Specific-Assets/pill_shell_dodger_blue.png'),
  pink:   staticFile('Template-Specific-Assets/pill_shell_wild_strawberry.png'),
  yellow: staticFile('Template-Specific-Assets/pill_shell_lemon_yellow.png'),
} as const;

const SATOSHI_BLACK_SRC = staticFile('fonts/Satoshi-Black.woff2');
const SATOSHI_BOLD_SRC  = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants (lifted from the prototype) ─────────────────────────────

// BG slide travel — Oxford_Blue_Splitscreen.png covers the right 1078 px.
const SPLIT_TRAVEL = 1078;

// Left icon panel — Icon_Base.png solid bbox (71..777, 52..1040), centre (424, 546).
const PANEL_CX = 424;
const PANEL_CY = 546;
const PANEL_ICON_SIZE = 480;

// Character bbox — fills the dark panel (slight inset from the 71..777 × 52..1040
// solid bbox so the subject sits inside the rounded corners).
const CHAR_LEFT   = 75;
const CHAR_TOP    = 70;
const CHAR_WIDTH  = 700;
const CHAR_HEIGHT = 960;
const CHAR_RADIUS = 40;

// Right-side pill geometry (same x range for all three colours).
const TITLE_LEFT  = 942;
const TITLE_RIGHT = 1840;
const SHELL_LEFT  = 949;
const SHELL_RIGHT = 1835;
const TITLE_CX = (TITLE_LEFT + TITLE_RIGHT) / 2;
const SHELL_CX = (SHELL_LEFT + SHELL_RIGHT) / 2;

// Source-y centres for each colour band (verbatim from the assets).
const TITLE_SRC_CY = { blue: 98,  pink: 436, yellow: 779 } as const;
const SHELL_SRC_CY = { blue: 211, pink: 551, yellow: 887 } as const;

// Detail row 2 sits +110 px below row 1.
const SHELL_ROW_GAP = 110;

// Text positioning inside the right-side pills.
const TEXT_LEFT_PAD  = 1040;
const TEXT_RIGHT_PAD = 1820;

// Title arrow sits left of the title text.
const ARROW_LEFT = 985;
const ARROW_SIZE = 56;

// Colours (constant across sections per the HTML).
const TITLE_TEXT_COLOUR  = '#0B1E33';
const DETAIL_TEXT_COLOUR = '#FFFFFF';

type ColourKey = 'blue' | 'pink' | 'yellow';
const COLOURS: readonly ColourKey[] = ['blue', 'pink', 'yellow'] as const;

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  bgPanStart:    0.00,
  bgPanEnd:      0.80,
  frameFadeIn:   0.55,
  frameFadeOut:  1.40,
  sectionStarts: [1.50, 5.50, 9.50] as readonly number[],
  // All section-internal values are in seconds, relative to the section's start.
  titleScaleDur: 0.80,
  titleTextIn:   0.50,
  titleTextDur:  0.55,
  d1ScaleStart:  1.00,
  d2ScaleStart:  2.00,
  shellScaleDur: 0.65,
  shellTextDur:  0.55,
} as const;

const easeInOutCubic    = Easing.inOut(Easing.cubic);
const easeOutBackSubtle = Easing.out(Easing.back(0.9));   // title pills
const easeOutBackTiny   = Easing.out(Easing.back(0.45));  // detail shells

// ─── Font loading ─────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const black = new FontFace('Satoshi', `url(${SATOSHI_BLACK_SRC}) format('woff2')`, { weight: '900', display: 'block' });
    const bold  = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,   { weight: '700', display: 'block' });
    const [k, b] = await Promise.all([black.load(), bold.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(k);
    fonts.add(b);
  })();
  return fontsPromise;
}

// ─── Arrow icon (fixed inline JSX — leading icon on each title) ──────────────

function ArrowIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size}>
      <path
        d="M18,12h0a2,2,0,0,0-.59-1.4l-4.29-4.3a1,1,0,0,0-1.41,0,1,1,0,0,0,0,1.42L15,11H5a1,1,0,0,0,0,2H15l-3.29,3.29a1,1,0,0,0,1.41,1.42l4.29-4.3A2,2,0,0,0,18,12Z"
        fill={color}
      />
    </svg>
  );
}

// ─── Section (one colour band: title + 2 detail pills) ───────────────────────

function Section({
  frame,
  colour,
  sectionStartFrame,
  mainText,
  detailTexts,
  titleScaleDur,
  titleTextIn,
  titleTextDur,
  d1ScaleStart,
  d2ScaleStart,
  shellScaleDur,
  shellTextDur,
}: {
  frame: number;
  colour: ColourKey;
  sectionStartFrame: number;
  mainText: string;
  detailTexts: readonly string[];
  titleScaleDur: number;
  titleTextIn: number;
  titleTextDur: number;
  d1ScaleStart: number;
  d2ScaleStart: number;
  shellScaleDur: number;
  shellTextDur: number;
}) {
  const localFrame = frame - sectionStartFrame;
  if (localFrame < 0) return null;

  const titleSrcCY = TITLE_SRC_CY[colour];
  const shellSrcCY = SHELL_SRC_CY[colour];

  // Title pill scale-in.
  const titleScaleProg = interpolate(localFrame, [0, titleScaleDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const titleSettled = localFrame >= titleScaleDur;
  const titleScale   = titleSettled ? 1 : (titleScaleProg > 0 ? easeOutBackSubtle(titleScaleProg) : 0);

  // Title text fade.
  const titleTextOp = interpolate(localFrame, [titleTextIn, titleTextIn + titleTextDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  return (
    <>
      {/* Title pill graphic — full-frame asset scaled around the pill's source centre */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${titleScale})`,
          transformOrigin: `${TITLE_CX}px ${titleSrcCY}px`,
          opacity: titleScaleProg > 0 ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        <Img
          src={TITLE_PILL_SRCS[colour]}
          alt=""
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      {/* Title arrow + text — scaled with the pill so they pop in together */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${titleScale})`,
          transformOrigin: `${TITLE_CX}px ${titleSrcCY}px`,
          opacity: titleScaleProg > 0 ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: ARROW_LEFT,
            top:  titleSrcCY - ARROW_SIZE / 2,
            width:  ARROW_SIZE,
            height: ARROW_SIZE,
            opacity: titleTextOp,
          }}
        >
          <ArrowIcon size={ARROW_SIZE} color={TITLE_TEXT_COLOUR} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: TEXT_LEFT_PAD + 20,
            top:  titleSrcCY,
            transform: 'translateY(-50%)',
            width: TEXT_RIGHT_PAD - (TEXT_LEFT_PAD + 20),
            color: TITLE_TEXT_COLOUR,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 900,
            fontSize: 55,
            letterSpacing: '-0.005em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            opacity: titleTextOp,
          }}
        >
          {mainText}
        </div>
      </div>

      {/* Two detail shells */}
      {([
        { rowOffset: 0,             scaleStart: d1ScaleStart, text: detailTexts[0]! },
        { rowOffset: SHELL_ROW_GAP, scaleStart: d2ScaleStart, text: detailTexts[1]! },
      ] as const).map((s, i) => {
        const sp = interpolate(localFrame, [s.scaleStart, s.scaleStart + shellScaleDur], [0, 1], {
          extrapolateLeft:  'clamp',
          extrapolateRight: 'clamp',
        });
        const settled = localFrame >= s.scaleStart + shellScaleDur;
        const drawScale = settled ? 1 : (sp > 0 ? easeOutBackTiny(sp) : 0);

        // Typewriter — kicks off after the shell settles.
        const typeStart = s.scaleStart + shellScaleDur;
        const typeProg  = interpolate(localFrame, [typeStart, typeStart + shellTextDur], [0, 1], {
          extrapolateLeft:  'clamp',
          extrapolateRight: 'clamp',
        });
        const charsShow = Math.floor(s.text.length * typeProg);
        const visible   = s.text.slice(0, charsShow);

        const targetCY = shellSrcCY + s.rowOffset;
        return (
          <div key={i} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                transform: `translateY(${s.rowOffset}px) scale(${drawScale})`,
                transformOrigin: `${SHELL_CX}px ${shellSrcCY}px`,
                opacity: sp > 0 ? 1 : 0,
              }}
            >
              <Img
                src={SHELL_SRCS[colour]}
                alt=""
                style={{ width: '100%', height: '100%', display: 'block' }}
              />
            </div>
            <div
              style={{
                position: 'absolute',
                left: TEXT_LEFT_PAD,
                top:  targetCY,
                width: TEXT_RIGHT_PAD - TEXT_LEFT_PAD,
                transform: 'translateY(-50%)',
                color: DETAIL_TEXT_COLOUR,
                fontFamily: "'Satoshi', system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 33,
                letterSpacing: '-0.005em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                opacity: settled ? 1 : 0,
              }}
            >
              {visible}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const Points3Subtopics2: React.FC<Points3Subtopics2Props> = ({
  sections,
  anchor,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading Points3Subtopics2 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BG_PAN_START   = f(t.bgPanStart);
  const BG_PAN_END     = f(t.bgPanEnd);
  const FRAME_FADE_IN  = f(t.frameFadeIn);
  const FRAME_FADE_OUT = f(t.frameFadeOut);
  const SECTION_STARTS = t.sectionStarts.map(f);
  const TITLE_SCALE_DUR = f(t.titleScaleDur);
  const TITLE_TEXT_IN   = f(t.titleTextIn);
  const TITLE_TEXT_DUR  = f(t.titleTextDur);
  const D1_SCALE_START  = f(t.d1ScaleStart);
  const D2_SCALE_START  = f(t.d2ScaleStart);
  const SHELL_SCALE_DUR = f(t.shellScaleDur);
  const SHELL_TEXT_DUR  = f(t.shellTextDur);

  // BG slide.
  const bgX = interpolate(frame, [BG_PAN_START, BG_PAN_END], [SPLIT_TRAVEL, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  // Left icon frame fade.
  const frameOp = interpolate(frame, [FRAME_FADE_IN, FRAME_FADE_OUT], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {/* Oxford Blue right panel — pans in from the right */}
      <Img
        src={BG_SRC}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width:  '100%',
          height: '100%',
          display: 'block',
          transform: `translateX(${bgX}px)`,
        }}
      />

      {/* Left icon frame (Icon_Base + anchor) */}
      <div style={{ position: 'absolute', inset: 0, opacity: frameOp, pointerEvents: 'none' }}>
        <Img
          src={ICON_BASE_SRC}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
        {anchor.kind === 'icon' ? (
          <div
            style={{
              position: 'absolute',
              left: PANEL_CX - PANEL_ICON_SIZE / 2,
              top:  PANEL_CY - PANEL_ICON_SIZE / 2,
              width:  PANEL_ICON_SIZE,
              height: PANEL_ICON_SIZE,
            }}
          >
            <Img
              src={staticFile(`icons/${anchor.id}.svg`)}
              alt=""
              style={{ width: PANEL_ICON_SIZE, height: PANEL_ICON_SIZE }}
            />
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              left: CHAR_LEFT,
              top:  CHAR_TOP,
              width:  CHAR_WIDTH,
              height: CHAR_HEIGHT,
              borderRadius: CHAR_RADIUS,
              overflow: 'hidden',
            }}
          >
            <Img
              src={staticFile(`characters/${anchor.id}.png`)}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                objectPosition: '50% 100%',
                display: 'block',
              }}
            />
          </div>
        )}
      </div>

      {/* Three colour sections */}
      {COLOURS.map((c, i) => (
        <Section
          key={c}
          frame={frame}
          colour={c}
          sectionStartFrame={SECTION_STARTS[i]!}
          mainText={sections[i]!.mainText}
          detailTexts={sections[i]!.detailTexts}
          titleScaleDur={TITLE_SCALE_DUR}
          titleTextIn={TITLE_TEXT_IN}
          titleTextDur={TITLE_TEXT_DUR}
          d1ScaleStart={D1_SCALE_START}
          d2ScaleStart={D2_SCALE_START}
          shellScaleDur={SHELL_SCALE_DUR}
          shellTextDur={SHELL_TEXT_DUR}
        />
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ────────────────────────────────────────────────────────

export const points3Subtopics2DefaultProps: Points3Subtopics2Props = {
  sections: [
    {
      mainText:     'Plan',
      detailTexts: ['Define the project scope', 'List the major risks early'],
    },
    {
      mainText:     'Build',
      detailTexts: ['Ship the first version fast', 'Iterate with real feedback'],
    },
    {
      mainText:     'Launch',
      detailTexts: ['Roll out to all users', 'Track adoption and outcomes'],
    },
  ],
  anchor: { kind: 'icon', id: 'business-success-path-dark' },
};

export const points3Subtopics2CharacterDemoProps: Points3Subtopics2Props = {
  ...points3Subtopics2DefaultProps,
  anchor: { kind: 'character', id: 'presenter-green' },
};
