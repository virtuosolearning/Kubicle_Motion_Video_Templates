import React, { useEffect, useState } from 'react';
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

// TextThread2Characters — three balanced columns on a soft platinum-blue
// canvas: a colour-matched panel containing the LEFT character on the left,
// a clean white phone in the middle showing the SMS thread, and a colour-
// matched panel containing the RIGHT character on the right.
//
// Visual logic:
//   • Left character → wild-strawberry panel → wild-strawberry "received" bubbles.
//   • Right character → dodger-blue panel → dodger-blue "sent" bubbles.
//   • Phone is a clean white rounded card — no black bezel, no border.
//     Status bar + iMessage-style header + footer drawn directly inside.
//   • All three columns share a single matched drop shadow so they pop
//     uniformly off the soft canvas background.
//
// Animation (15 s @ 30 fps, 450 frames):
//   • 0.00–0.60 s — phone scales up + fades in.
//   • 0.30–0.85 s — both character panels fade in.
//   • 1.00 s onward — messages pop in one at a time (~0.30 s scale-up
//     easeOutBack + fade). Default cadence 1.85 s/message → 6 messages
//     read in ~11 s, then a comfortable 2 s tail hold.

// ─── Schema ──────────────────────────────────────────────────────────────────

export const textThread2CharactersMessageSchema = z.object({
  // Which character "sent" this message. Side maps to that character's
  // on-canvas position AND to the bubble's left/right alignment + colour.
  side: z.enum(['left', 'right']),
  // Message body. Satoshi Medium 22 px inside the bubble. ≤80 chars keeps
  // each message to one or two wrapped lines.
  text: z.string().min(1).max(80),
});

export const textThread2CharactersTimingsSchema = z
  .object({
    phoneInDuration:    z.number().positive(),
    panelsInDuration:   z.number().positive(),
    panelsInDelay:      z.number().nonnegative(),
    messageBase:        z.number().nonnegative(),
    messageWindow:      z.number().positive(),
    messagePopDuration: z.number().positive(),
  })
  .partial();

// Character library — every PNG in the shared CHARACTER LIBRARY (PNG) set.
// They are uniformly-framed waist-up portraits, so the scene renders all of
// them at one fixed framing (see FIXED_CHARACTER_ZOOM): pick any id and the
// two characters always sit at the same size and position. Swapping a
// character is just changing its id — no per-character tuning needed.
export const CHARACTER_IDS = [
  'Female_middleage_Asian',
  'female_earlycareer_black',
  'female_earlycareer_middleeastern',
  'female_earlycareer_white',
  'female_earlycareer_white2',
  'female_earlycareer_white3',
  'female_midcareer_white',
  'female_middleage_white',
  'female_middleage_white2',
  'female_middleage_white3',
  'male_earlycareer_black',
  'male_middleage_asian',
  'male_middleage_black',
  'male_middleage_white',
  'male_middleage_white2',
  'male_middleage_white3',
] as const;

export const characterIdSchema = z.enum(CHARACTER_IDS);

export const textThread2CharactersSchema = z.object({
  // Bold-black contact name in the phone's header.
  contactName:    z.string().min(1).max(22),
  // Pick any id from the character library — both render at identical framing.
  leftCharacter:  characterIdSchema,
  rightCharacter: characterIdSchema,
  // The text thread. Order matters — messages land in this order.
  messages:       z.array(textThread2CharactersMessageSchema).min(3).max(6),
  timings:        textThread2CharactersTimingsSchema.optional(),
});

export type TextThread2CharactersProps = z.infer<
  typeof textThread2CharactersSchema
>;

export const textThread2CharactersMeta = {
  description:
    'Three balanced columns: a wild-strawberry panel containing the left ' +
    'character, a clean white iMessage-style phone in the middle, and a ' +
    'dodger-blue panel containing the right character. Each character\'s ' +
    'panel matches their bubble colour for a tight visual link between who ' +
    'is speaking and which side of the thread their message lands on.',
  authoringNotes:
    'Supply 3–6 messages. Each is { side: "left" | "right", text: ≤80 chars }. ' +
    'side maps to which on-canvas character "sent" it AND to that bubble\'s ' +
    'colour: left ⇒ wild-strawberry received bubble, right ⇒ dodger-blue sent ' +
    'bubble. contactName ≤22 chars shows bold-black at the top of the phone. ' +
    'leftCharacter / rightCharacter are ids from the character library (e.g. ' +
    'female_earlycareer_white, male_middleage_black). Both always render at the ' +
    'same fixed framing, so swapping a character is just changing its id — they ' +
    'never differ in size or position. Default ' +
    'duration 450 frames (15 s); first message at ~1.0 s, ~1.85 s between.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Three columns sum to the canvas width:
//   60 [margin] + 580 [left panel] + 20 [gap] + 600 [phone] + 20 [gap]
//   + 580 [right panel] + 60 [margin] = 1920
const COLUMN_TOP = 60;
const COLUMN_H   = 960;
const COLUMN_RADIUS = 36;

const LEFT_PANEL_LEFT  = 60;
const PANEL_W          = 580;
const PHONE_LEFT       = LEFT_PANEL_LEFT + PANEL_W + 20;     // 660
const PHONE_W          = 600;
const RIGHT_PANEL_LEFT = PHONE_LEFT + PHONE_W + 20;          // 1280

// Phone internals.
const STATUS_BAR_H = 42;
const HEADER_H     = 92;
const FOOTER_H     = 82;
const FEED_TOP     = STATUS_BAR_H + HEADER_H;                // 134
const FEED_BOTTOM  = COLUMN_H - FOOTER_H;                    // 878
const FEED_PAD_X   = 22;
const FEED_PAD_TOP = 22;

// Bubble sizing.
const BUBBLE_MAX_W  = PHONE_W - 2 * FEED_PAD_X - 90;         // ~466
const BUBBLE_PAD_X  = 20;
const BUBBLE_PAD_Y  = 14;
const BUBBLE_RADIUS = 24;
const BUBBLE_GAP    = 16;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  phoneInDuration:    0.60,
  panelsInDuration:   0.55,
  panelsInDelay:      0.30,
  messageBase:        1.00,
  messageWindow:      1.85,
  messagePopDuration: 0.30,
} as const;

const easeOutCubic   = Easing.out(Easing.cubic);
const easeOutBackPop = Easing.out(Easing.back(1.6));

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Palette ─────────────────────────────────────────────────────────────────

// Soft cool-white canvas — gives both the pink and the blue panels room to
// breathe without competing.
const CANVAS_BG       = '#F4F7FB';
const WILD_STRAWBERRY = '#F865B0';                           // received side
const DODGER_BLUE     = '#0496FF';                           // sent side
const WHITE           = '#FFFFFF';
const DARK_TEXT       = '#0A0F18';
const HEADER_NAME     = '#0A0F18';
const HEADER_LINK     = '#0496FF';
const SOFT_DIVIDER    = '#E2E6EC';
const INPUT_BORDER    = '#DDE2E8';
const PLACEHOLDER     = '#9CA3AF';

// Soft inner gradients on the character panels give them depth.
const WILD_STRAWBERRY_PANEL_BG =
  'linear-gradient(180deg, #FB85C2 0%, #F865B0 52%, #DC4C97 100%)';
const DODGER_PANEL_BG =
  'linear-gradient(180deg, #36AEFF 0%, #0496FF 50%, #027ED9 100%)';

// One shared drop shadow so all three columns (left panel, phone, right
// panel) lift off the canvas with the same visual weight.
const COLUMN_SHADOW =
  '0 24px 50px rgba(5, 36, 56, 0.18), ' +
  '0 6px 16px rgba(5, 36, 56, 0.10)';

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

// ─── Inline glyphs (status bar + header chevron + camera) ────────────────────

function ChevronLeft({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M15 5 L8 12 L15 19"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SignalDots({ color }: { color: string }) {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: i === 0 ? color : 'transparent',
            border: `1.5px solid ${color}`,
          }}
        />
      ))}
    </div>
  );
}

function BatteryIcon({ color }: { color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <div
        style={{
          width: 22,
          height: 11,
          border: `1.5px solid ${color}`,
          borderRadius: 2,
          padding: 1,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: '100%', height: '100%', background: color }} />
      </div>
      <div style={{ width: 2, height: 5, background: color, borderRadius: 1 }} />
    </div>
  );
}

function CameraIcon({ color }: { color: string }) {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
      <rect
        x={2.5}
        y={6}
        width={19}
        height={13}
        rx={2.5}
        stroke={color}
        strokeWidth={1.8}
      />
      <path
        d="M8 6 L9.5 4 H14.5 L16 6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx={12} cy={12.5} r={3.5} stroke={color} strokeWidth={1.8} />
    </svg>
  );
}

// ─── Character panel (colour-matched card containing a portrait PNG) ─────────

// One fixed framing for every character so the two sides always match in size
// and position. The library PNGs are uniformly-framed waist-up portraits; this
// scale crops them to a consistent head-and-shoulders shot inside the panel.
const FIXED_CHARACTER_ZOOM = 1.1;

function CharacterPanel({
  id,
  side,
  background,
  opacity,
}: {
  id: string;
  side: 'left' | 'right';
  background: string;
  opacity: number;
}) {
  // Scale every character up from the top of the panel by the same factor; the
  // bottom spills out of the (overflow: hidden) panel, leaving a uniform crop.
  const transform = `scale(${FIXED_CHARACTER_ZOOM})`;
  return (
    <div
      style={{
        position: 'absolute',
        left: side === 'left' ? LEFT_PANEL_LEFT : RIGHT_PANEL_LEFT,
        top:  COLUMN_TOP,
        width:  PANEL_W,
        height: COLUMN_H,
        borderRadius: COLUMN_RADIUS,
        background,
        boxShadow: COLUMN_SHADOW,
        overflow: 'hidden',
        opacity,
      }}
    >
      <Img
        src={staticFile(`characters/${id}.png`)}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center top',
          transform,
          transformOrigin: 'center top',
          // Subtle drop shadow that follows the PNG's alpha mask, so the
          // figure (not its bounding box) casts a soft shadow against the
          // coloured panel behind it.
          filter:
            'drop-shadow(0 12px 18px rgba(5, 36, 56, 0.28)) ' +
            'drop-shadow(0 3px 6px rgba(5, 36, 56, 0.18))',
        }}
      />
    </div>
  );
}

// ─── Phone card (white rounded rectangle, no bezel) ──────────────────────────

function PhoneCard({
  contactName,
  scale,
  opacity,
  children,
}: {
  contactName: string;
  scale: number;
  opacity: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: PHONE_LEFT,
        top:  COLUMN_TOP,
        width:  PHONE_W,
        height: COLUMN_H,
        borderRadius: COLUMN_RADIUS,
        background: WHITE,
        boxShadow: COLUMN_SHADOW,
        overflow: 'hidden',
        transform: `scale(${scale})`,
        transformOrigin: '50% 50%',
        opacity,
      }}
    >
      {/* Status bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top:  0,
          width:  PHONE_W,
          height: STATUS_BAR_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 22px',
          boxSizing: 'border-box',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 15,
          color: DARK_TEXT,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SignalDots color={DARK_TEXT} />
          <span>Sprint</span>
        </div>
        <span>9:41 AM</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>100%</span>
          <BatteryIcon color={DARK_TEXT} />
        </div>
      </div>

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top:  STATUS_BAR_H,
          width:  PHONE_W,
          height: HEADER_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 18px',
          boxSizing: 'border-box',
          borderBottom: `1px solid ${SOFT_DIVIDER}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={24} color={HEADER_LINK} />
          <span
            style={{
              fontFamily: "'Satoshi', system-ui, sans-serif",
              fontWeight: 500,
              fontSize: 19,
              color: HEADER_LINK,
            }}
          >
            Messages
          </span>
        </div>
        <span
          style={{
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 22,
            color: HEADER_NAME,
          }}
        >
          {contactName}
        </span>
        <span
          style={{
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 19,
            color: HEADER_LINK,
          }}
        >
          Contact
        </span>
      </div>

      {/* Feed slot — children render inside this clipped region */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top:  FEED_TOP,
          width:  PHONE_W,
          height: FEED_BOTTOM - FEED_TOP,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>

      {/* Footer */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top:  COLUMN_H - FOOTER_H,
          width:  PHONE_W,
          height: FOOTER_H,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 18px',
          boxSizing: 'border-box',
          borderTop: `1px solid ${SOFT_DIVIDER}`,
          background: WHITE,
        }}
      >
        <CameraIcon color={DARK_TEXT} />
        <div
          style={{
            flex: 1,
            height: 44,
            borderRadius: 22,
            border: `1px solid ${INPUT_BORDER}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 18px',
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 18,
            color: PLACEHOLDER,
          }}
        >
          iMessage
        </div>
        <span
          style={{
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 19,
            color: HEADER_LINK,
          }}
        >
          Send
        </span>
      </div>
    </div>
  );
}

// ─── Message bubble ──────────────────────────────────────────────────────────

function Bubble({
  side,
  text,
  top,
  scale,
  opacity,
}: {
  side: 'left' | 'right';
  text: string;
  top:  number;
  scale: number;
  opacity: number;
}) {
  const isLeft = side === 'left';
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top,
        width: PHONE_W,
        display: 'flex',
        justifyContent: isLeft ? 'flex-start' : 'flex-end',
        padding: `0 ${FEED_PAD_X}px`,
        boxSizing: 'border-box',
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: isLeft ? '0% 100%' : '100% 100%',
      }}
    >
      <div
        style={{
          maxWidth: BUBBLE_MAX_W,
          padding: `${BUBBLE_PAD_Y}px ${BUBBLE_PAD_X}px`,
          borderRadius: BUBBLE_RADIUS,
          background: isLeft ? WILD_STRAWBERRY : DODGER_BLUE,
          color:      WHITE,
          // Break long unbroken tokens (URLs, hashes) so they wrap inside the
          // bubble instead of overflowing past BUBBLE_MAX_W and clipping at the
          // feed edge.
          overflowWrap: 'break-word',
          wordBreak:    'break-word',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500,
          fontSize: 22,
          lineHeight: 1.28,
          letterSpacing: '-0.005em',
        }}
      >
        {text}
      </div>
    </div>
  );
}

// Rough text-measurement for vertical stacking of bubbles.
function estimateBubbleHeight(text: string): number {
  const charsPerLine = Math.floor((BUBBLE_MAX_W - 2 * BUBBLE_PAD_X) / 12);
  const words = text.split(/\s+/);
  let lines = 1;
  let cur = 0;
  for (const w of words) {
    const wl = w.length + 1;
    if (cur + wl > charsPerLine && cur > 0) {
      lines++;
      cur = wl;
    } else {
      cur += wl;
    }
  }
  const lineH = 30;
  return BUBBLE_PAD_Y * 2 + lines * lineH;
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const TextThread2Characters: React.FC<TextThread2CharactersProps> = ({
  contactName,
  leftCharacter,
  rightCharacter,
  messages,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() =>
    delayRender('Loading TextThread2Characters fonts'),
  );
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const PHONE_IN_FRAMES  = f(t.phoneInDuration);
  const PANEL_IN_FRAMES  = f(t.panelsInDuration);
  const PANEL_DELAY      = f(t.panelsInDelay);
  const MSG_BASE         = f(t.messageBase);
  const MSG_WINDOW       = f(t.messageWindow);
  const MSG_POP_FRAMES   = f(t.messagePopDuration);

  // Phone scale + fade.
  const phoneProg  = clamp01(frame / PHONE_IN_FRAMES);
  const phoneEased = easeOutCubic(phoneProg);
  const phoneScale = interpolate(phoneEased, [0, 1], [0.92, 1]);
  const phoneOpacity = phoneEased;

  // Character panels fade.
  const panelProg  = clamp01((frame - PANEL_DELAY) / PANEL_IN_FRAMES);
  const panelOpacity = easeOutCubic(panelProg);

  // Pre-compute message slot heights.
  const heights = messages.map((m) => estimateBubbleHeight(m.text));
  const tops: number[] = [];
  let cursor = FEED_PAD_TOP;
  for (let i = 0; i < messages.length; i++) {
    tops.push(cursor);
    cursor += heights[i] + BUBBLE_GAP;
  }

  return (
    <AbsoluteFill style={{ background: CANVAS_BG, overflow: 'hidden' }}>
      <CharacterPanel
        id={leftCharacter}
        side="left"
        background={WILD_STRAWBERRY_PANEL_BG}
        opacity={panelOpacity}
      />
      <CharacterPanel
        id={rightCharacter}
        side="right"
        background={DODGER_PANEL_BG}
        opacity={panelOpacity}
      />

      <PhoneCard
        contactName={contactName}
        scale={phoneScale}
        opacity={phoneOpacity}
      >
        {messages.map((m, i) => {
          const landFrame = MSG_BASE + i * MSG_WINDOW;
          const local = frame - landFrame;
          let scale: number, opacity: number;
          if (local <= 0) {
            scale = 0.85;
            opacity = 0;
          } else if (local >= MSG_POP_FRAMES) {
            scale = 1;
            opacity = 1;
          } else {
            const p = local / MSG_POP_FRAMES;
            scale   = interpolate(easeOutBackPop(p), [0, 1], [0.85, 1]);
            opacity = clamp01(p * 2);
          }
          return (
            <Bubble
              key={i}
              side={m.side}
              text={m.text}
              top={tops[i]}
              scale={scale}
              opacity={opacity}
            />
          );
        })}
      </PhoneCard>
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const textThread2CharactersDefaultProps: TextThread2CharactersProps = {
  contactName: 'Maya',
  leftCharacter: 'female_earlycareer_white',
  rightCharacter: 'male_middleage_black',
  messages: [
    { side: 'left',  text: 'Quick check, are we still on track for sprint demo Friday?' },
    { side: 'right', text: 'Yep. Two stories left, both in QA.' },
    { side: 'left',  text: 'Nice. Need anything from me before then?' },
    { side: 'right', text: 'Sign-off on the new dashboard mockups would help.' },
    { side: 'left',  text: 'On it tonight. Feedback by EOD tomorrow.' },
    { side: 'right', text: 'Perfect, thanks Maya.' },
  ],
};
