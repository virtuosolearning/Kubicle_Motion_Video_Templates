import React, { useEffect, useState } from 'react';
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

// OrgChart — configurable hierarchy / structure chart.
//   • Platinum-blue (#E6ECF2) canvas.
//   • 1 fixed box at the top, then 1–5 rows below it, each holding 1–4 boxes
//     (e.g. a 1-4-3-4 structure). Rows can be uneven widths.
//   • Each box carries a single text label (no people / names / avatars).
//   • A central vertical "spine" runs down the middle; each row hangs off the
//     spine via a horizontal bar with a short drop to every box. This keeps the
//     connectors sensible even when adjacent rows have different box counts.
//   • Top box is deep oxford; every lower box is dodger blue — monochrome,
//     on-palette. Connectors are soft slate-blue lines drawn on with
//     stroke-dashoffset.
//   • Reveal is top-down: the top box scales in, then each row's spine segment
//     + bar + drops draw and its boxes pop in, row by row.
//   • The whole chart auto-centres vertically and each row auto-centres
//     horizontally, so any 1→N→… shape stays balanced on the canvas.
//   • Default duration 300 frames (10 s @ 30 fps).

// ─── Schema ──────────────────────────────────────────────────────────────────

// A single box label. Kept short — boxes get narrow at 4-per-row.
export const orgChartLabelSchema = z.string().min(1).max(40);

// One row of the chart: 1 to 4 box labels.
export const orgChartRowSchema = z.array(orgChartLabelSchema).min(1).max(4);

export const orgChartTimingsSchema = z
  .object({
    topStart:          z.number().nonnegative(),  // when the top box scales in
    topDuration:       z.number().positive(),
    rowsStart:         z.number().nonnegative(),   // when the first row begins
    rowStagger:        z.number().positive(),      // gap between successive rows
    connectorDuration: z.number().positive(),      // spine+bar+drops draw per row
    boxStagger:        z.number().positive(),      // gap between boxes in a row
    boxDuration:       z.number().positive(),
  })
  .partial();

export const orgChartSchema = z.object({
  // The single box at the very top (always exactly one).
  top:    orgChartLabelSchema,
  // 1 to 5 rows below the top, each holding 1 to 4 boxes. Uneven widths are
  // fine — e.g. [[4 boxes], [3 boxes], [4 boxes]] renders a 1-4-3-4 chart.
  rows:   z.array(orgChartRowSchema).min(1).max(5),
  timings: orgChartTimingsSchema.optional(),
});

export type OrgChartProps = z.infer<typeof orgChartSchema>;

export const orgChartMeta = {
  description:
    'Configurable structure chart: one fixed box at the top, then 1–5 rows ' +
    'below it of 1–4 boxes each (e.g. 1-4-3-4). Each box is a single text ' +
    'label — no people or avatars. A central spine links the rows, the chart ' +
    'auto-centres, and it reveals top-down row by row.',
  authoringNotes:
    'Supply top (one label for the top box) and rows (1 to 5 rows, each an ' +
    'array of 1 to 4 short labels). Rows may be different widths — a 1-4-3-4 ' +
    'shape is rows: [[..4..],[..3..],[..4..]]. Labels are ≤40 chars and wrap ' +
    'to two lines; keep them short (a team, function, or stage — "Engineering", ' +
    '"AI Lab", "Q3 Launch") since boxes get narrow at 4-per-row. The top box ' +
    'is oxford; every lower box is dodger blue. Default duration 300 frames ' +
    '(10 s); add rows/boxes and the reveal simply takes a little longer.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BLACK_SRC  = staticFile('fonts/Satoshi-Black.woff2');
const SATOSHI_BOLD_SRC   = staticFile('fonts/Satoshi-Bold.woff2');
const SATOSHI_MEDIUM_SRC = staticFile('fonts/Satoshi-Medium.woff2');

// ─── Layout constants (1920×1080 canvas) ─────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Uniform box size across all rows (sized so 4 fit comfortably per row).
const BOX_W = 400;
const BOX_H = 104;
const H_GAP = 44;     // horizontal gap between boxes in a row
const TOP_BOX_W = 440; // the single top box is a touch wider for emphasis

// Vertical layout — the whole stack is centred in the canvas; the per-row
// pitch adapts to the row count (roomier for few rows, tighter for many).
const V_MARGIN   = 72;
const PITCH_MIN  = 142;
const PITCH_MAX  = 232;
const DROP_ABOVE = 28; // distance from a row's connector bar to its box tops

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  topStart:          0.10,
  topDuration:       0.60,
  rowsStart:         0.90,
  rowStagger:        0.90,
  connectorDuration: 0.60,
  boxStagger:        0.10,
  boxDuration:       0.55,
} as const;

const easeOutCubic         = Easing.out(Easing.cubic);
const easeInOutCubic       = Easing.inOut(Easing.cubic);
const easeOutBackOvershoot = Easing.out(Easing.back(1.3));

// ─── Palette ─────────────────────────────────────────────────────────────────

const BG_COLOR = '#E6ECF2';

// Top — deep oxford → near-black
const TOP_BG =
  'linear-gradient(135deg, #0a3050 0%, #052438 50%, #02101c 100%)';
// Lower boxes — dodger blue
const BOX_BG =
  'linear-gradient(135deg, #38AEFF 0%, #1A9CFE 50%, #0686EE 100%)';

const CARD_BORDER = '1px solid rgba(255,255,255,0.08)';
const CARD_SHADOW = '0 10px 26px rgba(5,36,56,0.20)';

const TEXT_WHITE = '#FFFFFF';

const CONNECTOR_COLOR = 'rgba(11,30,51,0.30)';
const CONNECTOR_WIDTH = 2.5;

// ─── Font loading ────────────────────────────────────────────────────────────

let fontsPromise: Promise<void> | null = null;

function loadFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const black  = new FontFace('Satoshi', `url(${SATOSHI_BLACK_SRC}) format('woff2')`,  { weight: '900', display: 'block' });
    const bold   = new FontFace('Satoshi', `url(${SATOSHI_BOLD_SRC}) format('woff2')`,   { weight: '700', display: 'block' });
    const medium = new FontFace('Satoshi', `url(${SATOSHI_MEDIUM_SRC}) format('woff2')`, { weight: '500', display: 'block' });
    const [k, b, m] = await Promise.all([black.load(), bold.load(), medium.load()]);
    const fonts = document.fonts as FontFaceSet & { add(fc: FontFace): void };
    fonts.add(k);
    fonts.add(b);
    fonts.add(m);
  })();
  return fontsPromise;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Box (single label, scale-in entry) ──────────────────────────────────────

function LabelBox({
  isTop, cx, top, width, height, label, frame, startF, durF,
}: {
  isTop: boolean;
  cx: number;       // horizontal centre
  top: number;      // top Y
  width: number;
  height: number;
  label: string;
  frame: number;
  startF: number;
  durF: number;
}) {
  const local = frame - startF;
  if (local < 0) return null;

  const scale = interpolate(local, [0, durF], [0.88, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutBackOvershoot,
  });
  const op = interpolate(local, [0, durF * 0.6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });
  const dy = interpolate(local, [0, durF], [-10, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic,
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: cx - width / 2,
        top,
        width,
        height,
        transform: `translateY(${dy}px) scale(${scale})`,
        transformOrigin: 'center center',
        opacity: op,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: isTop ? 20 : 18,
          background: isTop ? TOP_BG : BOX_BG,
          border: CARD_BORDER,
          boxShadow: CARD_SHADOW,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '10px 20px',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            // Fill the available width and wrap to as many lines as needed so a
            // long label never spills outside the box — long unbreakable words
            // are broken too. Clamped to 3 lines (which fits the box height) as
            // a safety net for extreme strings.
            width: '100%',
            color: TEXT_WHITE,
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: isTop ? 900 : 700,
            fontSize: isTop ? 30 : 26,
            letterSpacing: '-0.012em',
            lineHeight: 1.15,
            textAlign: 'center',
            whiteSpace: 'normal',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3,
            overflow: 'hidden',
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

// Animated line (stroke-dashoffset draw-on).
function AnimLine({
  x1, y1, x2, y2, progress,
}: {
  x1: number; y1: number; x2: number; y2: number; progress: number;
}) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={CONNECTOR_COLOR}
      strokeWidth={CONNECTOR_WIDTH}
      strokeLinecap="round"
      strokeDasharray={length}
      strokeDashoffset={length * (1 - clamp01(progress))}
    />
  );
}

// Horizontal centres for a row of n boxes, centred on the canvas.
function rowCentres(n: number): number[] {
  const groupW = n * BOX_W + (n - 1) * H_GAP;
  const firstCx = CANVAS_W / 2 - groupW / 2 + BOX_W / 2;
  return Array.from({ length: n }, (_, i) => firstCx + i * (BOX_W + H_GAP));
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const OrgChart: React.FC<OrgChartProps> = ({ top, rows, timings }) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading OrgChart fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const TOP_START  = f(t.topStart);
  const TOP_DUR    = f(t.topDuration);
  const ROWS_START = f(t.rowsStart);
  const ROW_STAG   = f(t.rowStagger);
  const CONN_DUR   = f(t.connectorDuration);
  const BOX_STAG   = f(t.boxStagger);
  const BOX_DUR    = f(t.boxDuration);

  // ─── Vertical layout (auto-centred, adaptive pitch) ────────────────────────
  const T      = 1 + rows.length;                       // total rows incl. top
  const avail  = CANVAS_H - 2 * V_MARGIN;
  const pitch  = T > 1
    ? Math.max(PITCH_MIN, Math.min(PITCH_MAX, (avail - BOX_H) / (T - 1)))
    : 0;
  const stackH = (T - 1) * pitch + BOX_H;
  const topY   = (CANVAS_H - stackH) / 2;
  const rowTopY = (r: number) => topY + r * pitch;      // r: 0 = top, 1..R rows

  // ─── Per-row geometry ──────────────────────────────────────────────────────
  const rowGeom = rows.map((row, idx) => {
    const r       = idx + 1;                            // 1-based row position
    const centres = rowCentres(row.length);
    const boxTop  = rowTopY(r);
    const barY    = boxTop - DROP_ABOVE;
    const rowBase = ROWS_START + idx * ROW_STAG;
    const prevBottom = idx === 0
      ? rowTopY(0) + BOX_H                              // bottom of the top box
      : rowTopY(r - 1) + BOX_H;                         // bottom of the row above
    return { row, centres, boxTop, barY, rowBase, prevBottom };
  });

  return (
    <AbsoluteFill style={{ background: BG_COLOR, overflow: 'hidden' }}>
      {/* Connectors: central spine + per-row bars + drops, behind the boxes. */}
      <svg
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {rowGeom.map((g, idx) => {
          const cp     = clamp01((frame - g.rowBase) / CONN_DUR);
          const spineP = clamp01(cp / 0.4);
          const barP   = clamp01((cp - 0.3) / 0.4);
          const dropP  = clamp01((cp - 0.6) / 0.4);
          const minCx  = g.centres[0]!;
          const maxCx  = g.centres[g.centres.length - 1]!;
          return (
            <React.Fragment key={`conn-${idx}`}>
              {/* Spine segment from the row above down to this row's bar */}
              <AnimLine
                x1={CANVAS_W / 2} y1={g.prevBottom}
                x2={CANVAS_W / 2} y2={g.barY}
                progress={easeInOutCubic(spineP)}
              />
              {/* Horizontal bar across this row (only if more than one box) */}
              {g.centres.length > 1 && (
                <>
                  <AnimLine
                    x1={CANVAS_W / 2} y1={g.barY}
                    x2={minCx}        y2={g.barY}
                    progress={easeInOutCubic(barP)}
                  />
                  <AnimLine
                    x1={CANVAS_W / 2} y1={g.barY}
                    x2={maxCx}        y2={g.barY}
                    progress={easeInOutCubic(barP)}
                  />
                </>
              )}
              {/* Short drop from the bar down to each box top */}
              {g.centres.map((cx, i) => (
                <AnimLine
                  key={`drop-${idx}-${i}`}
                  x1={cx} y1={g.barY}
                  x2={cx} y2={g.boxTop}
                  progress={easeInOutCubic(dropP)}
                />
              ))}
            </React.Fragment>
          );
        })}
      </svg>

      {/* Top box */}
      <LabelBox
        isTop
        cx={CANVAS_W / 2}
        top={rowTopY(0)}
        width={TOP_BOX_W}
        height={BOX_H}
        label={top}
        frame={frame}
        startF={TOP_START}
        durF={TOP_DUR}
      />

      {/* Rows of boxes */}
      {rowGeom.map((g, idx) =>
        g.row.map((label, i) => (
          <LabelBox
            key={`box-${idx}-${i}`}
            isTop={false}
            cx={g.centres[i]!}
            top={g.boxTop}
            width={BOX_W}
            height={BOX_H}
            label={label}
            frame={frame}
            startF={g.rowBase + CONN_DUR * 0.55 + i * BOX_STAG}
            durF={BOX_DUR}
          />
        )),
      )}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const orgChartDefaultProps: OrgChartProps = {
  top: 'Executive Office',
  rows: [
    ['Product', 'Engineering', 'Design', 'Operations'],
    ['Research', 'Platform', 'Brand'],
    ['AI Lab', 'Infrastructure', 'Web', 'Mobile'],
  ],
};
