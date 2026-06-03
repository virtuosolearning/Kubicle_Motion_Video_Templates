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

// KubicleAIChat — two-phase AI chat scene styled to match the GroupChat
// template family. Phase 1 is a Gemini-style splash: a centred greeting
// floats over the oxford-blue gradient, the input bar sits at the bottom,
// and the user's prompt types in character-by-character with a blinking
// dodger-blue cursor. Phase 2 morphs the typed prompt into a right-aligned
// user bubble at the top of a chat feed, then the Kubicle AI response
// types in beneath it, structured as an intro paragraph followed by 2-4
// numbered sections (each with bold heading + body), mirroring the
// reference Gemini response layout.
//
// Animation principles used:
//   * Squash & stretch on the prompt-morph (the bubble squashes before
//     take-off, stretches in flight, settles with a small overshoot).
//   * easeOutBack pop-in for bubble + section landings (bouncy feel).
//   * easeInOutCubic for camera-style transitions (greeting fade, morph
//     flight path).
//   * Chat window slides up from off-canvas with a back-overshoot, same
//     intro device as the GroupChat template.
//   * Blinking dodger-blue text cursor while typing.
//
// All visuals drawn in CSS / inline SVG. No PNG dependencies. No em-dash
// punctuation used anywhere in the default copy.

// ─── Schema ──────────────────────────────────────────────────────────────────

export const kubicleAISectionSchema = z.object({
  heading: z.string().min(1).max(48),
  body:    z.string().min(1).max(220),
});

export const kubicleAIResponseSchema = z.object({
  intro:    z.string().min(1).max(200),
  sections: z.array(kubicleAISectionSchema).min(2).max(4),
});

export const kubicleAIChatTimingsSchema = z
  .object({
    introDuration:       z.number().positive(),   // chat window slides up
    greetingFadeIn:      z.number().positive(),
    inputFadeIn:         z.number().positive(),
    promptTypeStart:     z.number().nonnegative(),
    promptTypeDuration:  z.number().positive(),
    holdAfterType:       z.number().nonnegative(),
    morphDuration:       z.number().positive(),
    typingPulse:         z.number().positive(),
    introFadeIn:         z.number().positive(),
    sectionStagger:      z.number().positive(),
    sectionDuration:     z.number().positive(),
  })
  .partial();

export const kubicleAIChatSchema = z.object({
  // Top-left brand name. Defaults to "Kubicle AI".
  brand:     z.string().min(1).max(24).optional(),
  // The big centred greeting on the splash screen.
  greeting:  z.string().min(1).max(56),
  // Sub-greeting below the main greeting (smaller, dim).
  subline:   z.string().min(1).max(72).optional(),
  // Placeholder shown in the input bar before the user types.
  inputPlaceholder: z.string().min(1).max(40).optional(),
  // What "the user" types into the input bar.
  userPrompt: z.string().min(1).max(140),
  // The AI's structured response.
  response:  kubicleAIResponseSchema,
  timings:   kubicleAIChatTimingsSchema.optional(),
});

export type KubicleAIChatProps = z.infer<typeof kubicleAIChatSchema>;

export const kubicleAIChatMeta = {
  description:
    'Two-phase AI chat scene: a Gemini-style splash with a centred ' +
    'greeting and typewriter prompt input, then a bouncy morph into a ' +
    'right-aligned user bubble followed by a structured Kubicle AI ' +
    'response (intro paragraph + 2 to 4 numbered sections with bold ' +
    'headings). Matches the GroupChat aesthetic: oxford-blue window, ' +
    'platinum splash base, dodger-blue user bubble.',
  authoringNotes:
    'Greeting: short and warm (e.g. "Hey Matthew, what should we work ' +
    'on?"). userPrompt: a single realistic question, ideally how-to or ' +
    'advice-seeking, under 140 chars. response.intro: one or two ' +
    'sentences framing the answer. response.sections: 2 to 4 entries; ' +
    'headings should start with a number ("1. ", "2. ") for the Gemini ' +
    'list look. No em-dashes (use commas or "and" instead). Default ' +
    'duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');
const KUBICLE_LOGO_SRC   = staticFile('Template-Specific-Assets/kubicle-icon-white.png');

// ─── Layout constants ────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Chat window panel (revealed in phase 2; phase 1 uses the same frame too).
// Margins match the GroupChat template so the two scenes feel like siblings.
const WIN_LEFT   = 60;
const WIN_TOP    = 50;
const WIN_RIGHT  = CANVAS_W - 60;       // 1860
const WIN_BOT    = CANVAS_H - 50;       // 1030
const WIN_W      = WIN_RIGHT - WIN_LEFT;
const WIN_H      = WIN_BOT - WIN_TOP;
const WIN_RADIUS = 32;

// Header strip (Kubicle AI brand)
const HEADER_H   = 100;

// Footer (input bar)
const FOOTER_H   = 110;
const FOOTER_TOP = WIN_BOT - FOOTER_H;

// Input bar geometry — centred horizontally inside the window
const INPUT_W   = 1200;
const INPUT_H   = 78;
const INPUT_CX  = (WIN_LEFT + WIN_RIGHT) / 2;     // 960
const INPUT_TOP = FOOTER_TOP + (FOOTER_H - INPUT_H) / 2;  // ≈ 926
const INPUT_LEFT = INPUT_CX - INPUT_W / 2;
const INPUT_RADIUS = INPUT_H / 2;                  // full-pill

// User bubble target (top-right of chat feed)
const BUBBLE_MAX_W = 760;
const BUBBLE_PAD_X = 28;
const BUBBLE_PAD_Y = 18;
const BUBBLE_RADIUS = 24;
const BUBBLE_RIGHT = WIN_RIGHT - 60;              // 1780
const BUBBLE_TOP   = WIN_TOP + HEADER_H + 30;     // ≈ 190

// AI response container (left-aligned, below user bubble)
const RESP_LEFT  = WIN_LEFT + 60;                 // 140
const RESP_RIGHT = WIN_RIGHT - 60;                // 1780
const RESP_W     = RESP_RIGHT - RESP_LEFT;        // 1640

// Splash greeting (phase 1) — centred
const GREETING_CY = WIN_TOP + (FOOTER_TOP - WIN_TOP) / 2 - 40;  // ≈ 480

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  introDuration:      1.00,   // chat window slides up from below
  greetingFadeIn:     0.55,
  inputFadeIn:        0.50,
  promptTypeStart:    1.95,
  promptTypeDuration: 2.10,
  holdAfterType:      0.30,
  morphDuration:      0.85,
  typingPulse:        0.80,
  introFadeIn:        0.50,
  sectionStagger:     0.80,
  sectionDuration:    0.55,
} as const;

const easeOutCubic   = Easing.out(Easing.cubic);
const easeInOutCubic = Easing.inOut(Easing.cubic);
const easeOutBack    = Easing.out(Easing.back(1.7));
const easeOutBackBig = Easing.out(Easing.back(2.4));
// Subtle settling back-overshoot for the chat-window slide-up. Matches the
// value used by GroupChat so the two scenes share the same intro feel.
const easeOutBackSettle = Easing.out(Easing.back(1.15));

// ─── Palette ─────────────────────────────────────────────────────────────────

// Solid platinum-blue base — same as GroupChat. The chat window panel sits
// on top in oxford-blue, so the canvas margin around it reads as light
// platinum (no black, no iris-in gradient).
const PLATINUM_BG = '#E6ECF2';

const WIN_BG     = 'linear-gradient(180deg, #0e2741 0%, #08172a 100%)';
const HEADER_BG  = 'linear-gradient(180deg, #0b2138 0%, #07172a 100%)';
const FOOTER_BG  = 'linear-gradient(180deg, #07172a 0%, #050f1c 100%)';
const INPUT_BG   = 'rgba(255,255,255,0.06)';
const INPUT_BORDER = '1px solid rgba(255,255,255,0.12)';

const ME_BUBBLE_BG     = 'linear-gradient(180deg, #1A9CFE 0%, #0686EE 100%)';
const ME_BUBBLE_BORDER = '1px solid rgba(255,255,255,0.10)';
// Plain dark drop shadow only — no blue halo / glow. Matches GroupChat.
const ME_BUBBLE_SHADOW = '0 4px 12px rgba(0,0,0,0.25)';

const TEXT_WHITE   = '#FFFFFF';
const TEXT_DIM     = 'rgba(255,255,255,0.65)';
const TEXT_VERYDIM = 'rgba(255,255,255,0.35)';

const DODGER       = '#0496FF';

// ─── Font loading ────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const bold   = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,   { weight: '700', display: 'block' });
    const medium = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`, { weight: '500', display: 'block' });
    const [b, m] = await Promise.all([bold.load(), medium.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(b);
    fonts.add(m);
  })();
  return fontsPromise;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp    = (a: number, b: number, t: number) => a + (b - a) * t;

// Estimate the end-state user-bubble box from the prompt text. Width follows
// the same char-count heuristic as before; HEIGHT now fits the wrapped lines
// (rather than a fixed 88px guess) so a long, multi-line prompt gets a
// comfortably sized bubble instead of being crammed and overflowing the box.
// The main scene calls this too, to push the AI response below a tall bubble
// so the two never overlap. 0.52em is the approx average glyph width at the
// bubble's font/weight; 1.35 is the bubble line-height.
const USER_BUBBLE_FONT = 26;
function estimateUserBubble(fullText: string): { w: number; h: number; fontSize: number } {
  const w = Math.min(BUBBLE_MAX_W, Math.max(360, fullText.length * 14 + BUBBLE_PAD_X * 2));
  const lineH        = USER_BUBBLE_FONT * 1.35;
  const charsPerLine = Math.max(1, Math.floor((w - BUBBLE_PAD_X * 2) / (USER_BUBBLE_FONT * 0.52)));
  const lines        = Math.max(1, Math.ceil(fullText.length / charsPerLine));
  const h            = Math.max(88, Math.ceil(lines * lineH + BUBBLE_PAD_Y * 2));
  return { w, h, fontSize: USER_BUBBLE_FONT };
}

// ─── Kubicle AI brand mark (white PNG logo on alpha) ─────────────────────────

function SparkleIcon({ size = 36 }: { size?: number }) {
  return (
    <Img
      src={KUBICLE_LOGO_SRC}
      alt="Kubicle AI"
      style={{
        width: size,
        height: size,
        display: 'block',
        objectFit: 'contain',
      }}
    />
  );
}

// ─── Blinking cursor (dodger blue) ───────────────────────────────────────────

function Cursor({ frame, height = 30 }: { frame: number; height?: number }) {
  // 30-frame breathing — visible 0..15, faded 15..30.
  const phase = frame % 30;
  const op = phase < 15 ? 1 : 0.15;
  return (
    <span
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        width: 3,
        height,
        background: DODGER,
        marginLeft: 4,
        borderRadius: 1,
        opacity: op,
      }}
    />
  );
}

// ─── Splash greeting (phase 1) ───────────────────────────────────────────────

function SplashGreeting({
  greeting, subline, opacity, lift,
}: {
  greeting: string;
  subline?: string;
  opacity: number;
  lift: number;     // 0 = at position, >0 = drifts up & fades for phase 2
}) {
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: WIN_LEFT,
        top:  GREETING_CY - 80,
        width: WIN_W,
        textAlign: 'center',
        opacity,
        transform: `translateY(${-lift}px)`,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          color: TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 72,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          textShadow: '0 4px 14px rgba(0,0,0,0.40)',
        }}
      >
        {greeting}
      </div>
      {subline && (
        <div
          style={{
            marginTop: 20,
            color: TEXT_DIM,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500,
            fontSize: 28,
            letterSpacing: '-0.01em',
          }}
        >
          {subline}
        </div>
      )}
    </div>
  );
}

// ─── Morphing prompt: typed into input, then flies to user bubble ────────────

function MorphingPrompt({
  frame, fullText, placeholder, typeProgress, morphProgress,
}: {
  frame: number;
  fullText: string;
  placeholder: string;
  typeProgress: number;     // 0..1
  morphProgress: number;    // 0..1
}) {
  // Number of characters revealed
  const chars = Math.floor(fullText.length * typeProgress);
  const visible = fullText.slice(0, chars);
  const isTyping = typeProgress > 0 && typeProgress < 1 && morphProgress < 0.01;

  // ─── Position interpolation ────────────────────────────────────────────────
  // Start: pill-shaped input bar (full INPUT_W) sitting at INPUT_TOP.
  // End: right-aligned bubble (auto-width up to BUBBLE_MAX_W) at top-right.
  const mp = clamp01(morphProgress);
  const ease = easeInOutCubic(mp);

  const startLeft = INPUT_LEFT;
  const startTop  = INPUT_TOP;
  const startW    = INPUT_W;
  const startH    = INPUT_H;
  const startRad  = INPUT_RADIUS;
  const startPadX = 32;
  const startPadY = 0; // input uses align-items center, no vertical pad needed
  const startFontSize = 28;
  const startTextAlign: 'left' | 'right' = 'left';

  // End bubble — width AND height sized to fit the wrapped text, so long
  // prompts get a roomy bubble instead of overflowing a fixed 88px box.
  const endBox  = estimateUserBubble(fullText);
  const endW    = endBox.w;
  const endLeft = BUBBLE_RIGHT - endW;
  const endTop  = BUBBLE_TOP;
  const endH    = endBox.h;
  const endRad  = BUBBLE_RADIUS;
  const endPadX = BUBBLE_PAD_X;
  const endPadY = BUBBLE_PAD_Y;
  const endFontSize = endBox.fontSize;
  const endTextAlign: 'left' | 'right' = 'left';

  const left = lerp(startLeft, endLeft, ease);
  const top  = lerp(startTop,  endTop,  ease);
  const w    = lerp(startW,    endW,    ease);
  const h    = lerp(startH,    endH,    ease);
  const rad  = lerp(startRad,  endRad,  ease);
  const padX = lerp(startPadX, endPadX, ease);
  const padY = lerp(startPadY, endPadY, ease);
  const fontSize = lerp(startFontSize, endFontSize, ease);

  // ─── Squash & stretch ──────────────────────────────────────────────────────
  // Phase A (0.00-0.18): squash before take-off (anticipation)
  // Phase B (0.18-0.78): stretch in the direction of travel
  // Phase C (0.78-1.00): settle with a small bounce
  let scaleX = 1;
  let scaleY = 1;
  if (mp > 0) {
    if (mp < 0.18) {
      const a = mp / 0.18;
      scaleX = 1 + 0.10 * easeInOutCubic(a);
      scaleY = 1 - 0.12 * easeInOutCubic(a);
    } else if (mp < 0.78) {
      // Stretch towards motion direction (mostly leftwards into upper-right —
      // give it a slight Y stretch since the path is more vertical than
      // horizontal at this canvas size).
      const a = (mp - 0.18) / 0.60;
      const t = Math.sin(Math.PI * a);
      scaleX = 1 - 0.04 * t;
      scaleY = 1 + 0.08 * t;
    } else {
      const a = (mp - 0.78) / 0.22;
      // Overshoot then settle
      const bounce = easeOutBack(a);
      scaleX = lerp(1.04, 1.00, bounce);
      scaleY = lerp(0.94, 1.00, bounce);
    }
  }

  // ─── Background crossfade ──────────────────────────────────────────────────
  // Input bar surface fades out during morph; bubble surface fades in.
  const inputOp  = 1 - clamp01(mp / 0.35);
  const bubbleOp = clamp01((mp - 0.20) / 0.40);

  // Text colour stays white in both; alignment changes to match end-state late
  const textAlign: 'left' | 'right' = mp < 0.7 ? startTextAlign : endTextAlign;

  // Placeholder shown only when nothing has been typed yet
  const showPlaceholder = chars === 0 && mp === 0;

  return (
    <div
      style={{
        position: 'absolute',
        left, top,
        width: w,
        height: h,
        transform: `scale(${scaleX}, ${scaleY})`,
        transformOrigin: 'center center',
        pointerEvents: 'none',
      }}
    >
      {/* Input-bar surface */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: INPUT_BG,
          border: INPUT_BORDER,
          borderRadius: lerp(startRad, endRad, ease),
          opacity: inputOp,
        }}
      />
      {/* Bubble surface */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: ME_BUBBLE_BG,
          border: ME_BUBBLE_BORDER,
          borderRadius: rad,
          opacity: bubbleOp,
          boxShadow: bubbleOp > 0 ? ME_BUBBLE_SHADOW : 'none',
        }}
      />
      {/* + button (only visible in phase 1 input mode) */}
      <div
        style={{
          position: 'absolute',
          left: 24,
          top:  '50%',
          transform: 'translateY(-50%)',
          width: 32, height: 32,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.10)',
          color: TEXT_DIM,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500, fontSize: 22,
          opacity: inputOp,
        }}
      >
        +
      </div>
      {/* Send chip (right side, input mode) */}
      <div
        style={{
          position: 'absolute',
          right: 24,
          top:  '50%',
          transform: 'translateY(-50%)',
          color: TEXT_VERYDIM,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500, fontSize: 18,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          opacity: inputOp,
        }}
      >
        Flash ▾
      </div>

      {/* Text content */}
      <div
        style={{
          position: 'absolute',
          left:  padX + (inputOp > 0 ? 44 : 0),
          right: padX + (inputOp > 0 ? 80 : 0),
          top:   '50%',
          transform: 'translateY(-50%)',
          color: showPlaceholder ? TEXT_VERYDIM : TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500,
          fontSize,
          letterSpacing: '-0.005em',
          lineHeight: 1.35,
          textAlign,
          whiteSpace: 'normal',
          overflow: 'hidden',
        }}
      >
        {showPlaceholder ? placeholder : visible}
        {isTyping && <Cursor frame={frame} height={fontSize * 1.1} />}
      </div>
    </div>
  );
}

// ─── AI typing pulse ─────────────────────────────────────────────────────────

function AITypingPulse({ frame, startF, opacity, top }: {
  frame: number; startF: number; opacity: number; top: number;
}) {
  if (opacity <= 0) return null;
  const local = frame - startF;
  return (
    <div
      style={{
        position: 'absolute',
        left: RESP_LEFT,
        top,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        opacity,
      }}
    >
      <div
        style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'rgba(4,150,255,0.18)',
          border: '1px solid rgba(127,201,255,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <SparkleIcon size={26} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {[0, 1, 2].map(i => {
          const phase = ((local - i * 5) % 30 + 30) % 30;
          const a = phase < 15
            ? 0.30 + 0.70 * (phase / 15)
            : 0.30 + 0.70 * (1 - (phase - 15) / 15);
          return (
            <div
              key={i}
              style={{
                width: 12, height: 12, borderRadius: '50%',
                background: '#FFFFFF', opacity: a,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── AI response (intro paragraph + numbered sections) ───────────────────────

function AIResponse({
  intro, sections, frame,
  introStart, sectionStartFrames, sectionDurF, introDurF, responseTop,
}: {
  intro: string;
  sections: { heading: string; body: string }[];
  frame: number;
  introStart: number;
  sectionStartFrames: number[];
  sectionDurF: number;
  introDurF: number;
  responseTop: number;     // top of the response block, below the user bubble
}) {

  // Intro paragraph fade
  const introOp = easeOutCubic(interpolate(frame, [introStart, introStart + introDurF], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));
  const introLift = interpolate(frame, [introStart, introStart + introDurF], [16, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: RESP_LEFT,
        top:  responseTop,
        width: RESP_W,
        pointerEvents: 'none',
      }}
    >
      {/* Brand badge above intro */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          opacity: introOp, transform: `translateY(${-introLift}px)`,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(4,150,255,0.18)',
            border: '1px solid rgba(127,201,255,0.30)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <SparkleIcon size={26} />
        </div>
        <div
          style={{
            color: TEXT_DIM,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500, fontSize: 18,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          Kubicle AI
        </div>
      </div>

      {/* Intro paragraph */}
      <div
        style={{
          color: TEXT_WHITE,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 500, fontSize: 28,
          letterSpacing: '-0.005em',
          lineHeight: 1.5,
          opacity: introOp,
          transform: `translateY(${introLift}px)`,
          marginBottom: 32,
        }}
      >
        {intro}
      </div>

      {/* Sections */}
      {sections.map((s, i) => {
        const start = sectionStartFrames[i]!;
        const p = clamp01(interpolate(frame, [start, start + sectionDurF], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        }));
        const eased = easeOutBack(p);
        const lift  = lerp(28, 0, eased);
        const scale = lerp(0.96, 1.0, eased);
        const op = clamp01(p * 1.3);

        return (
          <div
            key={i}
            style={{
              marginBottom: 24,
              opacity: op,
              transform: `translateY(${lift}px) scale(${scale})`,
              transformOrigin: 'left center',
            }}
          >
            <div
              style={{
                color: TEXT_WHITE,
                fontFamily: "'Satoshi', system-ui, sans-serif",
                fontWeight: 700, fontSize: 30,
                letterSpacing: '-0.01em',
                lineHeight: 1.25,
                marginBottom: 8,
              }}
            >
              {s.heading}
            </div>
            <div
              style={{
                color: TEXT_DIM,
                fontFamily: "'Satoshi', system-ui, sans-serif",
                fontWeight: 500, fontSize: 24,
                letterSpacing: '-0.005em',
                lineHeight: 1.45,
              }}
            >
              {s.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Window chrome (header + footer + panel) ─────────────────────────────────

function ChatWindowFrame({
  brand, frame, frameOpacity, headerOpacity, chatBgOpacity,
}: {
  brand: string;
  frame: number;
  frameOpacity: number;
  headerOpacity: number;
  chatBgOpacity: number;     // 0 in splash → 1 in chat (lightens header divider)
}) {
  return (
    <>
      {/* Window panel */}
      <div
        style={{
          position: 'absolute',
          left: WIN_LEFT,
          top:  WIN_TOP,
          width: WIN_W,
          height: WIN_H,
          borderRadius: WIN_RADIUS,
          background: WIN_BG,
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          opacity: frameOpacity,
        }}
      />

      {/* Header strip (brand mark + name) */}
      <div
        style={{
          position: 'absolute',
          left: WIN_LEFT,
          top:  WIN_TOP,
          width: WIN_W,
          height: HEADER_H,
          background: HEADER_BG,
          borderTopLeftRadius:  WIN_RADIUS,
          borderTopRightRadius: WIN_RADIUS,
          borderBottom: `1px solid rgba(255,255,255,${0.04 + 0.06 * chatBgOpacity})`,
          display: 'flex', alignItems: 'center',
          padding: '0 36px',
          gap: 16,
          opacity: headerOpacity,
        }}
      >
        <SparkleIcon size={36} />
        <div
          style={{
            color: TEXT_WHITE,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 700, fontSize: 28,
            letterSpacing: '-0.01em',
          }}
        >
          {brand}
        </div>
        {/* Tiny dim sub-label, mimicking Gemini's "Flash" model chip */}
        <div
          style={{
            marginLeft: 4,
            color: TEXT_VERYDIM,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 500, fontSize: 18,
            letterSpacing: '0.02em',
            padding: '4px 10px',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 999,
          }}
        >
          Flash
        </div>
      </div>

      {/* Footer plate (the input bar floats over this) */}
      <div
        style={{
          position: 'absolute',
          left: WIN_LEFT,
          top:  FOOTER_TOP,
          width: WIN_W,
          height: FOOTER_H,
          background: FOOTER_BG,
          borderBottomLeftRadius:  WIN_RADIUS,
          borderBottomRightRadius: WIN_RADIUS,
          borderTop: '1px solid rgba(255,255,255,0.05)',
          opacity: frameOpacity,
        }}
      />
    </>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const KubicleAIChat: React.FC<KubicleAIChatProps> = ({
  brand = 'Kubicle AI',
  greeting,
  subline,
  inputPlaceholder = 'Ask Kubicle AI',
  userPrompt,
  response,
  timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading KubicleAIChat fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const INTRO_SLIDE_DUR = f(t.introDuration);
  const GREET_DUR   = f(t.greetingFadeIn);
  const INPUT_DUR   = f(t.inputFadeIn);
  const TYPE_START  = f(t.promptTypeStart);
  const TYPE_DUR    = f(t.promptTypeDuration);
  const HOLD        = f(t.holdAfterType);
  const MORPH_DUR   = f(t.morphDuration);
  const TYPING_DUR  = f(t.typingPulse);
  const INTRO_DUR   = f(t.introFadeIn);
  const SEC_STAGGER = f(t.sectionStagger);
  const SEC_DUR     = f(t.sectionDuration);

  // Timeline anchors (in frames). All UI starts after the chat window has
  // landed; the splash greeting then fades in immediately afterwards.
  const greetStart  = INTRO_SLIDE_DUR;
  const greetEnd    = greetStart + GREET_DUR;
  const typeStart   = Math.max(INTRO_SLIDE_DUR, f(t.promptTypeStart));
  const typeEnd     = typeStart + TYPE_DUR;
  const morphStart  = typeEnd + HOLD;
  const morphEnd    = morphStart + MORPH_DUR;
  const typingStart = morphEnd;
  const typingEnd   = typingStart + TYPING_DUR;
  const introStart  = typingEnd;
  const sectionBase = introStart + INTRO_DUR - 4;  // first section overlaps intro tail

  // Chat container slides up from below the canvas. Same easing as GroupChat
  // so both scenes feel like part of the same intro family.
  const containerDy = interpolate(frame, [0, INTRO_SLIDE_DUR], [CANVAS_H, 0], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutBackSettle,
  });

  // Frame/header opacities are 1 from frame 0 — the slide-up reveals the
  // whole window in one piece (no extra fade needed).
  const frameOp = 1;
  const headerOp = 1;
  // Header divider gets a touch darker once the morph completes (chat view).
  const chatBgOp = clamp01(interpolate(frame, [morphStart, morphEnd], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));

  // Splash greeting fade in then fade out during morph
  const greetIn = easeOutCubic(interpolate(frame, [greetStart, greetEnd], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));
  const greetOut = easeInOutCubic(interpolate(frame, [morphStart - 8, morphStart + 18], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));
  const greetOp = greetIn * (1 - greetOut);
  const greetLift = greetOut * 40;

  // Prompt typing progress
  const typeProgress = clamp01(interpolate(frame, [typeStart, typeEnd], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  }));
  const morphProgress = clamp01(interpolate(frame, [morphStart, morphEnd], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));

  // AI typing pulse: fade in after morph completes, fade out as response intro starts
  const typingOp = clamp01(interpolate(frame, [typingStart, typingStart + 6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })) * (1 - clamp01(interpolate(frame, [introStart - 6, introStart + 4], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })));

  // Section start frames
  const sectionStarts = response.sections.map((_, i) => sectionBase + i * SEC_STAGGER);

  // The user bubble grows to fit the prompt; start the AI response below it so
  // a tall (multi-line) bubble never overlaps the answer. The 42px gap matches
  // the original single-line spacing (88px bubble + 42 = the old +130 offset).
  const userBubble  = estimateUserBubble(userPrompt);
  const responseTop = BUBBLE_TOP + userBubble.h + 42;

  return (
    <AbsoluteFill style={{ background: PLATINUM_BG, overflow: 'hidden' }}>
      {/* Everything below moves as one unit: the entire chat scene slides up
          from below the canvas during the intro, then sits still. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateY(${containerDy}px)`,
        }}
      >
        {/* Chat-window frame (panel + header + footer) */}
        <ChatWindowFrame
          brand={brand}
          frame={frame}
          frameOpacity={frameOp}
          headerOpacity={headerOp}
          chatBgOpacity={chatBgOp}
        />

        {/* Splash greeting (phase 1) */}
        <SplashGreeting
          greeting={greeting}
          subline={subline}
          opacity={greetOp}
          lift={greetLift}
        />

        {/* Morphing prompt (lives in input bar in phase 1, becomes bubble in phase 2) */}
        <MorphingPrompt
          frame={frame}
          fullText={userPrompt}
          placeholder={inputPlaceholder}
          typeProgress={typeProgress}
          morphProgress={morphProgress}
        />

        {/* AI typing pulse (between morph and response) */}
        <AITypingPulse frame={frame} startF={typingStart} opacity={typingOp} top={responseTop} />

        {/* AI response (intro + sections) */}
        {frame >= introStart - 4 && (
          <AIResponse
            intro={response.intro}
            sections={response.sections}
            frame={frame}
            introStart={introStart}
            sectionStartFrames={sectionStarts}
            sectionDurF={SEC_DUR}
            introDurF={INTRO_DUR}
            responseTop={responseTop}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const kubicleAIChatDefaultProps: KubicleAIChatProps = {
  brand: 'Kubicle AI',
  greeting: "Hey User, what's on your mind?",
  subline: 'Ask anything about your lesson, deck, or script.',
  inputPlaceholder: 'Ask Kubicle AI',
  userPrompt: 'How do I write a clear lesson script?',
  response: {
    intro:
      'Writing a clear lesson script comes down to three things: a strong ' +
      'opening, tight structure, and reading it aloud before you record.',
    sections: [
      {
        heading: '1. Open with the why',
        body:
          'Start with a single sentence that tells the learner what they ' +
          'will be able to do after the lesson. This sets expectations and ' +
          'earns their attention.',
      },
      {
        heading: '2. Chunk into three to five beats',
        body:
          'Break the body into a small number of clear sections. Each ' +
          'section should make a single point and finish with a quick ' +
          'summary line.',
      },
      {
        heading: '3. Read it aloud before recording',
        body:
          'Speak the script through once. Anywhere you stumble is a ' +
          'sentence that needs rewriting. Plain words beat clever ones ' +
          'every time.',
      },
    ],
  },
};
