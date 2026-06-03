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

// CirclePoints4Character — same layout + animation as CirclePoints4 but
// each circle is filled with a CHARACTER PORTRAIT instead of a line-art
// icon. The character image is clipped to the circular disc (border-
// radius 50 % on the wrapper), with the face positioned at the disc's
// vertical centre and a drop shadow following the figure's silhouette
// against the dodger-blue disc.
//
// Animation is identical to V1:
//   • Pass 1: each circle pops in (easeOutBack scale 0→1 over 0.70 s)
//     staggered at 0.30 / 0.80 / 1.30 / 1.80 s.
//   • Pass 2: each circle pulses (sine bump, +15 % peak over 0.60 s)
//     and its label fades in alongside, staggered at 2.70 / 3.50 /
//     4.30 / 5.10 s.
//
// Default composition length is 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

const pointSchema = z.object({
  // Character PNG id — resolves to characters/<id>.png. Pick PNGs with
  // proper alpha (no baked-in background) so the dodger-blue disc shows
  // through where the figure is transparent.
  characterId:     z.string().min(1),
  // Rendered height of the character image inside the circle, in px.
  // Default 480 fills the 382-diameter disc with comfortable cropping
  // around the head.
  characterHeight: z.number().min(200).max(900).optional(),
  // Top offset of the character image from the wrapper top, in px.
  // Tune so the face lands at the circle's vertical centre (~191 px).
  characterY:      z.number().optional(),
  // Pill caption — bold black under the circle. ≤20 chars at 37 px.
  label:           z.string().min(1).max(20),
});

export const circlePoints4CharacterTimingsSchema = z
  .object({
    pass1Starts:  z.array(z.number().nonnegative()).length(4),
    pass1Duration: z.number().positive(),
    pass2Starts:  z.array(z.number().nonnegative()).length(4),
    pass2Duration: z.number().positive(),
    textFade:     z.number().positive(),
  })
  .partial();

export const circlePoints4CharacterSchema = z.object({
  // 1 to 4 items — the circle row auto-centres horizontally for the count.
  points:  z.array(pointSchema).min(1).max(4),
  timings: circlePoints4CharacterTimingsSchema.optional(),
});

export type CirclePoints4CharacterProps = z.infer<typeof circlePoints4CharacterSchema>;

export const circlePoints4CharacterMeta = {
  description:
    'Four character-portrait circles in a row on a light-blue background. ' +
    'Each circle holds a head-and-shoulders portrait masked to a dodger-' +
    'blue disc, with a bold black label beneath it. Same pop-in + pulse + ' +
    'label-fade animation as the icon variant (CirclePoints4); only the ' +
    'circle contents differ.',
  authoringNotes:
    'Provide 1 to 4 items — the circle row auto-centres horizontally for the ' +
    'count (2 circles sit centred, etc.). Each needs a characterId (PNG in ' +
    'characters/<id>.png with proper alpha), optional characterHeight + ' +
    'characterY for face-centring, and a label (≤20 chars). Tune ' +
    'characterHeight (default 480) and characterY (default 61) per PNG ' +
    "so the face's centre lands at the disc's vertical centrepoint " +
    '(~191 px). Default duration 300 frames (10 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const BASE_CIRCLE_SRC  = staticFile('Template-Specific-Assets/base_circle.png');
const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants ─────────────────────────────────────────────────────────

// Circle row — auto-centred horizontally for 1-4 circles (matches CirclePoints4).
// Pitch (440) is the spacing from the prototype's centres [315,755,1196,1637].
const CANVAS_CX    = 960;
const CIRCLE_PITCH = 440;
const circleCxFor = (count: number, i: number) =>
  CANVAS_CX - ((count - 1) * CIRCLE_PITCH) / 2 + i * CIRCLE_PITCH;
const CIRCLE_CY  = 533;
const CIRCLE_D   = 382;

const SRC_CIRCLE_CX = 315;
const SRC_CIRCLE_CY = 533;

const TEXT_Y    = 830;

// Sine-pulse amplitude (peak overshoot above scale 1).
const PULSE_AMP = 0.15;

// Default character framing — face lands at the disc centre when the PNG
// has the face ~27 % from its top (typical presenter framing).
const DEFAULT_CHARACTER_HEIGHT = 480;
const DEFAULT_CHARACTER_Y      = 61;   // ≈ CIRCLE_D/2 − 0.27 × 480

// ─── Animation timings ────────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  pass1Starts:   [0.30, 0.80, 1.30, 1.80] as readonly number[],
  pass1Duration: 0.70,
  pass2Starts:   [2.70, 3.50, 4.30, 5.10] as readonly number[],
  pass2Duration: 0.60,
  textFade:      0.60,
} as const;

const easeOutBack = Easing.out(Easing.back(1.70158));

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

// ─── Single circle ────────────────────────────────────────────────────────────

function CircleCharacter({
  cx,
  frame,
  characterId,
  characterHeight,
  characterY,
  label,
  p1Start,
  p1Dur,
  p2Start,
  p2Dur,
  textFadeDur,
}: {
  cx: number;
  frame: number;
  characterId: string;
  characterHeight: number;
  characterY: number;
  label: string;
  p1Start: number;
  p1Dur: number;
  p2Start: number;
  p2Dur: number;
  textFadeDur: number;
}) {

  // Pass 1: easeOutBack scale 0 → 1.
  const p1Prog = interpolate(frame, [p1Start, p1Start + p1Dur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const base = p1Prog > 0 ? easeOutBack(p1Prog) : 0;

  // Pass 2: sine bump while p2Prog ∈ (0, 1).
  const p2Prog = interpolate(frame, [p2Start, p2Start + p2Dur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });
  const bump = p2Prog > 0 && p2Prog < 1 ? PULSE_AMP * Math.sin(Math.PI * p2Prog) : 0;

  const scale = Math.max(0, base + bump);

  // Label fades in alongside the pulse.
  const textOpacity = interpolate(frame, [p2Start, p2Start + textFadeDur], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <>
      {/* Wrapper sized to the circle, with border-radius:50% so all
          content inside (the blue disc + the character) is clipped to a
          perfect circle. Scaled by pass1 + pass2 together. */}
      <div
        style={{
          position: 'absolute',
          left: cx - CIRCLE_D / 2,
          top:  CIRCLE_CY - CIRCLE_D / 2,
          width:  CIRCLE_D,
          height: CIRCLE_D,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          overflow: 'hidden',
          borderRadius: '50%',
          pointerEvents: 'none',
        }}
      >
        {/* Dodger-blue disc backdrop (from Base_Circle.png). */}
        <Img
          src={BASE_CIRCLE_SRC}
          alt=""
          style={{
            position: 'absolute',
            left: -(SRC_CIRCLE_CX - CIRCLE_D / 2),
            top:  -(SRC_CIRCLE_CY - CIRCLE_D / 2),
            width:  1920,
            height: 1080,
            display: 'block',
          }}
        />

        {/* Character portrait — clipped to the circular wrapper, with a
            silhouette drop shadow that hugs the figure against the disc. */}
        <Img
          src={staticFile(`characters/${characterId}.png`)}
          alt=""
          style={{
            position: 'absolute',
            left: '50%',
            top:  characterY,
            height: characterHeight,
            width:  'auto',
            transform: 'translateX(-50%)',
            display: 'block',
            filter:
              'drop-shadow(0 12px 18px rgba(2, 18, 36, 0.40)) ' +
              'drop-shadow(0 3px 6px rgba(2, 18, 36, 0.30))',
          }}
        />
      </div>

      {/* Label — outside the scaled wrapper so the text stays put. */}
      <div
        style={{
          position: 'absolute',
          left: cx,
          top:  TEXT_Y,
          transform: 'translate(-50%, 0)',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 37,
          color: '#000000',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          opacity: textOpacity,
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
    </>
  );
}

// ─── Main scene ───────────────────────────────────────────────────────────────

export const CirclePoints4Character: React.FC<CirclePoints4CharacterProps> = ({
  points,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading CirclePoints4Character fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const P1_STARTS = t.pass1Starts.map(f);
  const P1_DUR    = f(t.pass1Duration);
  const P2_STARTS = t.pass2Starts.map(f);
  const P2_DUR    = f(t.pass2Duration);
  const TEXT_FADE = f(t.textFade);

  return (
    <AbsoluteFill style={{ background: '#E6ECF2', overflow: 'hidden' }}>
      {points.map((p, i) => (
        <CircleCharacter
          key={i}
          cx={circleCxFor(points.length, i)}
          frame={frame}
          characterId={p.characterId}
          characterHeight={p.characterHeight ?? DEFAULT_CHARACTER_HEIGHT}
          characterY={p.characterY ?? DEFAULT_CHARACTER_Y}
          label={p.label}
          p1Start={P1_STARTS[i]!}
          p1Dur={P1_DUR}
          p2Start={P2_STARTS[i]!}
          p2Dur={P2_DUR}
          textFadeDur={TEXT_FADE}
        />
      ))}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ────────────────────────────────────────────────────────

export const circlePoints4CharacterDefaultProps: CirclePoints4CharacterProps = {
  // Four diverse team members, head-and-shoulders portraits masked to
  // circular discs. characterHeight + characterY tuned per PNG so each
  // face lands at the disc centrepoint.
  points: [
    {
      characterId: 'amelia',
      characterHeight: 480,
      characterY:      30,
      label: 'Strategy',
    },
    {
      characterId: 'ken',
      characterHeight: 480,
      characterY:      30,
      label: 'Engineering',
    },
    {
      characterId: 'sarah',
      characterHeight: 480,
      characterY:      30,
      label: 'Design',
    },
    {
      characterId: 'robert',
      characterHeight: 480,
      characterY:      30,
      label: 'Operations',
    },
  ],
};
