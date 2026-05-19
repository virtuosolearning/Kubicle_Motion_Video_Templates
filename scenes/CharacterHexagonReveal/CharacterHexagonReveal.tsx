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

// CharacterHexagonReveal — a centered character name-plate intro.
//
// The hex shape is the shipped `images/character-background.png` asset
// (the same artwork the reference video uses). The PNG plays a double
// role:
//   1. drawn directly as the visible dodger-blue hex behind the character;
//   2. used as a `mask-image` on the character layer so the portrait is
//      matted to the EXACT same outline — no CSS-polygon approximation.
//
// Animation:
//   • Phase A (0.00–0.55 s): hex (with character matted into it) scales
//     up from 0 with an easeOutBack overshoot, then settles.
//   • Phase B (0.55–1.40 s): hold.
//   • Phase C (1.40–1.95 s): the name pops in over the top-left edge of
//     the hex — tilted ~-12°, large Satoshi Bold dodger-blue, with the
//     same easeOutBack overshoot so the stamp feels deliberate.
//   • Phase D (1.95 s →): hold.

// ─── Schema ──────────────────────────────────────────────────────────────────

export const characterHexagonRevealTimingsSchema = z
  .object({
    hexInStart:     z.number().nonnegative(),
    hexInDuration:  z.number().positive(),
    nameInStart:    z.number().nonnegative(),
    nameInDuration: z.number().positive(),
  })
  .partial();

export const characterHexagonRevealSchema = z.object({
  // Character PNG id — resolves to characters/<id>.png. Ships with `anna`.
  characterId: z.string().min(1),
  // Display name — Satoshi Bold ~140 px, tilted -12° above the hex.
  // ≤14 chars so the rotated name doesn't run past the left edge.
  name: z.string().min(1).max(14),
  timings: characterHexagonRevealTimingsSchema.optional(),
});

export type CharacterHexagonRevealProps = z.infer<
  typeof characterHexagonRevealSchema
>;

export const characterHexagonRevealMeta = {
  description:
    'A centered character name-plate intro: a dodger-blue hex (the shared ' +
    '`character-background.png` artwork) scales up with an easeOutBack ' +
    'overshoot, the character PNG is matted to the same hex via CSS ' +
    'mask-image, then a tilted bold name stamps in over the top-left edge.',
  authoringNotes:
    'characterId is a PNG ID in characters/<id>.png (ships with `anna`). ' +
    'Pick portraits with the face in the upper half of the PNG — the hex ' +
    'crops to a head-and-shoulders framing. name ≤14 chars; longer names ' +
    'will overrun the left edge once tilted. Default duration 120 frames ' +
    '(4 s @ 30 fps).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');
const HEX_PNG_SRC      = staticFile('images/character-background.png');

// ─── Layout constants ────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const CANVAS_CX = CANVAS_W / 2;
const CANVAS_CY = CANVAS_H / 2;

// Hex display size on canvas. The source PNG is 508×500 (~1:0.98); we keep
// that aspect to avoid distorting the artwork.
const HEX_W = 720;
const HEX_H = 708;
const HEX_LEFT = CANVAS_CX - HEX_W / 2;
const HEX_TOP  = CANVAS_CY - HEX_H / 2;

// Character placement inside the hex matte. The source `anna.png` has the
// figure slightly off-centre to its right, so we nudge the bounding box
// left a touch to recover horizontal centring inside the matte.
const CHAR_W = 560;
const CHAR_H = 760;
const CHAR_X_NUDGE = -30;        // -ve shifts character left
const CHAR_Y_OFFSET = -30;       // -ve raises so hair fills the top of the hex

// Name plate.
const NAME_FONT_SIZE     = 150;
const NAME_ROTATION_DEG  = -12;
const NAME_CENTER_X      = 770;
const NAME_CENTER_Y      = 250;

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f   = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  hexInStart:     0.00,
  hexInDuration:  0.55,
  nameInStart:    1.40,
  nameInDuration: 0.55,
} as const;

const easeOutBackBig = Easing.out(Easing.back(1.9));
const easeOutCubic   = Easing.out(Easing.cubic);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG_COLOR    = '#E6ECF2';
const DODGER_BLUE = '#0496FF';

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

// ─── Main scene ──────────────────────────────────────────────────────────────

export const CharacterHexagonReveal: React.FC<
  CharacterHexagonRevealProps
> = ({ characterId, name, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() =>
    delayRender('Loading CharacterHexagonReveal fonts'),
  );
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const HEX_IN_START  = f(t.hexInStart);
  const HEX_IN_DUR    = f(t.hexInDuration);
  const NAME_IN_START = f(t.nameInStart);
  const NAME_IN_DUR   = f(t.nameInDuration);

  // ── Hex scale (easeOutBack overshoot) ──
  const hexProg    = clamp01((frame - HEX_IN_START) / HEX_IN_DUR);
  const hexScale   = easeOutBackBig(hexProg);
  const hexOpacity = easeOutCubic(hexProg);

  // ── Name scale + opacity (overshoot stamp) ──
  const nameProg    = clamp01((frame - NAME_IN_START) / NAME_IN_DUR);
  const nameScale   = easeOutBackBig(nameProg);
  const nameOpacity = easeOutCubic(clamp01(nameProg * 1.6));

  // Character image bounding box, relative to the hex container (which is
  // positioned at HEX_LEFT / HEX_TOP and sized HEX_W × HEX_H).
  const charLocalX = (HEX_W - CHAR_W) / 2 + CHAR_X_NUDGE;
  const charLocalY = CHAR_Y_OFFSET;

  // mask-image / -webkit-mask-image expects a CSS url(...) string. The
  // staticFile() helper resolves to a same-origin URL in both preview and
  // render.
  const maskUrl = `url(${HEX_PNG_SRC})`;

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {/* HEX + CHARACTER live in a single scaling/opacity wrapper. */}
      <div
        style={{
          position: 'absolute',
          left: HEX_LEFT,
          top:  HEX_TOP,
          width:  HEX_W,
          height: HEX_H,
          transform: `scale(${hexScale})`,
          transformOrigin: '50% 50%',
          opacity: hexOpacity,
        }}
      >
        {/* Hex background — the shared dodger-blue artwork. */}
        <Img
          src={HEX_PNG_SRC}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width:  '100%',
            height: '100%',
            display: 'block',
          }}
        />

        {/* Character — same hex PNG used as a CSS mask so the portrait is
            matted to the EXACT same outline as the visible artwork above.
            Where the character PNG is transparent, the hex below shows
            through (so the matte is filled with dodger blue around the
            figure). */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            WebkitMaskImage:    maskUrl,
            WebkitMaskRepeat:   'no-repeat',
            WebkitMaskSize:     '100% 100%',
            WebkitMaskPosition: 'center',
            maskImage:          maskUrl,
            maskRepeat:         'no-repeat',
            maskSize:           '100% 100%',
            maskPosition:       'center',
          }}
        >
          <Img
            src={staticFile(`characters/${characterId}.png`)}
            alt=""
            style={{
              position: 'absolute',
              left: charLocalX,
              top:  charLocalY,
              width:  CHAR_W,
              height: CHAR_H,
              objectFit: 'cover',
              objectPosition: 'center top',
              display: 'block',
            }}
          />
        </div>
      </div>

      {/* NAME — tilted dodger-blue text overlapping the top-left of the hex. */}
      <div
        style={{
          position: 'absolute',
          left: NAME_CENTER_X,
          top:  NAME_CENTER_Y,
          transform:
            `translate(-50%, -50%) ` +
            `rotate(${NAME_ROTATION_DEG}deg) ` +
            `scale(${nameScale})`,
          transformOrigin: '50% 50%',
          opacity: nameOpacity,
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: NAME_FONT_SIZE,
          color: DODGER_BLUE,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {name}
      </div>
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const characterHexagonRevealDefaultProps: CharacterHexagonRevealProps = {
  characterId: 'anna',
  name: 'Anna',
};
