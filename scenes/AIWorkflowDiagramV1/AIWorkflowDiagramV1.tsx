import { useEffect, useState }  from 'react';
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

// AIWorkflowDiagramV1 — animated AI workflow diagram. A source node feeds an
// intent router; the router branches to N=3 parallel agent nodes which all
// converge into a final LLM sink. Inspired by n8n flow editors and ZBrain-
// style pipeline marketing diagrams, recoloured to match the rest of the
// template set: deep-oxford background, dodger-blue node panels, white
// Satoshi Bold labels.
//
// Animation phases (default 15 s @ 30 fps):
//   • 0.0–0.85 s : platinum-blue base; oxford-blue radial gradient scales
//                  0 → 1 from the canvas centre (easeInOutCubic) so the
//                  dark canvas "irises in" over the light base — same
//                  intro device as TreeDiagram4x2.
//   • 0.85–1.5 s : source node pops in (easeOutBack overshoot → settle).
//   • 1.5–1.9 s  : source → router connector draws on (stroke-dashoffset).
//   • 1.9–2.6 s  : router node pops in.
//   • 2.6–3.6 s  : three branch connectors draw on, staggered.
//   • 3.0–4.5 s  : three branch nodes pop in, staggered.
//   • 4.3–5.5 s  : three converge connectors draw on, staggered.
//   • 5.5–6.3 s  : sink (LLM) node pops in with a slightly bigger overshoot.
//   • 6.5 s–end  : continuous "data packet" loop — a bright dot travels
//                  source → router → ⟨branch i⟩ → sink, repeating ~ every
//                  2.4 s and cycling through the 3 branches. The branch
//                  node + the sink node pulse softly as the packet arrives.
//
// All visuals drawn in CSS / inline SVG — no PNG dependencies.

// ─── Schema ──────────────────────────────────────────────────────────────────

const ICON_IDS = [
  'chat', 'router', 'shield', 'card', 'message', 'brain', 'gear', 'spark',
] as const;
type IconId = typeof ICON_IDS[number];

export const aiWorkflowNodeSchema = z.object({
  // Bold white caption inside the node. ≤16 chars at 30 px to stay on one line.
  label: z.string().min(1).max(16),
  icon:  z.enum(ICON_IDS),
});

// A column is a vertical stack of 1–3 node boxes.
export const aiWorkflowColumnSchema = z.array(aiWorkflowNodeSchema).min(1).max(3);

export const aiWorkflowDiagramV1TimingsSchema = z
  .object({
    bgScaleDuration:   z.number().positive(),  // oxford-blue irises in over platinum
    sourceStart:       z.number().nonnegative(),// first column begins popping
    nodePopDuration:   z.number().positive(),
    connectorDraw:     z.number().positive(),
    branchStagger:     z.number().positive(),   // stagger between boxes in a column
    pulsePeriod:       z.number().positive(),   // seconds per data-packet cycle
    pulseLoopStart:    z.number().nonnegative(),// floor; auto-bumped past build end
  })
  .partial();

export const aiWorkflowDiagramV1Schema = z.object({
  // 1–4 columns laid out left → right; each column holds 1–3 stacked boxes.
  // Adjacent columns are fully connected (every box links to every box in the
  // next column). The last column is styled as the output/sink.
  columns: z.array(aiWorkflowColumnSchema).min(1).max(4),
  timings: aiWorkflowDiagramV1TimingsSchema.optional(),
});

export type AIWorkflowNode = z.infer<typeof aiWorkflowNodeSchema>;
export type AIWorkflowDiagramV1Props = z.infer<typeof aiWorkflowDiagramV1Schema>;

export const aiWorkflowDiagramV1Meta = {
  description:
    'Animated AI workflow diagram with a flexible column layout. 1–4 ' +
    'columns laid out left → right, each holding 1–3 stacked node boxes. ' +
    'Adjacent columns are fully connected — every box links to every box ' +
    'in the next column. Boxes pop in column by column, connectors draw ' +
    'on, then a data-packet pulse loops through one path across the graph. ' +
    'Use for AI-pipeline explainers, multi-agent routing, or any staged ' +
    'fan-out / fan-in workflow story.',
  authoringNotes:
    'columns is an array of 1–4 columns; each column is an array of 1–3 ' +
    'nodes. Example shapes: [[1],[1],[3],[1]] (classic source→router→3 ' +
    'agents→sink) or [[3],[2],[3],[1]] for an uneven graph. Labels ≤16 ' +
    'chars — keep parallel phrasing within a column. Pick an icon per node ' +
    'from: chat, router, shield, card, message, brain, gear, spark. The ' +
    'last column is styled as the output/sink. Default duration 450 frames ' +
    '(15 s); the build phase auto-extends with more columns/boxes and the ' +
    'pulse loop starts once the graph is fully drawn.',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const W = 1920;
const H = 1080;

const NODE_W = 280;
const NODE_H = 140;
const NODE_RADIUS = 26;

type Pos = { x: number; y: number };
const right = (p: Pos) => ({ x: p.x + NODE_W, y: p.y + NODE_H / 2 });
const left  = (p: Pos) => ({ x: p.x,           y: p.y + NODE_H / 2 });

// ── Dynamic layout ───────────────────────────────────────────────────────────
// Columns are spread evenly across the canvas width; boxes within a column are
// stacked and vertically centred. These constants are tuned so the classic
// [[1],[1],[3],[1]] shape reproduces the original layout exactly:
//   1 box  → y 470 (centre)         3 boxes → y 180 / 470 / 760
//   4 cols → x 120 / 586 / 1053 / 1520 (≈ the old 100 / 540 / 1020 / 1540)
const MARGIN_X = 120;
const V_GAP    = 150;

// Left-x of column i in an n-column layout.
function columnX(i: number, n: number): number {
  if (n <= 1) return (W - NODE_W) / 2;
  const step = (W - 2 * MARGIN_X - NODE_W) / (n - 1);
  return MARGIN_X + i * step;
}

// Top-y of box j in a column of m boxes (stack vertically centred on canvas).
function boxY(j: number, m: number): number {
  const stackH = m * NODE_H + (m - 1) * V_GAP;
  const top = (H - stackH) / 2;
  return top + j * (NODE_H + V_GAP);
}

// Connector definitions — cubic-bezier (P0,P1,P2,P3). Straight horizontals
// degenerate by placing control points on the same y as the endpoints.
type Bezier = { p0: Pos; p1: Pos; p2: Pos; p3: Pos };

function makeHCurve(a: Pos, b: Pos): Bezier {
  const dx = b.x - a.x;
  return {
    p0: a,
    p1: { x: a.x + dx * 0.5, y: a.y },
    p2: { x: a.x + dx * 0.5, y: b.y },
    p3: b,
  };
}

// ─── Animation timings ───────────────────────────────────────────────────────

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

const DEFAULT_TIMINGS = {
  bgScaleDuration: 0.85,
  sourceStart:     0.90,    // starts just after the oxford bg has settled
  nodePopDuration: 0.70,
  connectorDraw:   0.40,
  branchStagger:   0.25,
  pulsePeriod:     2.40,
  pulseLoopStart:  6.60,
} as const;

const easeOutBack    = Easing.out(Easing.back(1.7));
const easeOutBackBig = Easing.out(Easing.back(2.2));
const easeOutCubic   = Easing.out(Easing.cubic);
const easeInOutCubic = Easing.inOut(Easing.cubic);

// ─── Palette ─────────────────────────────────────────────────────────────────

// Platinum-blue base under the oxford layer (matches the other templates'
// "platinum" colour). The oxford gradient scales over the top during intro.
const PLATINUM_BG = '#E6ECF2';

// Oxford-blue radial gradient — same family as TreeDiagram4x2 so the two
// templates feel like a set. Scales 0 → 1 from canvas centre.
const OXFORD_BG =
  'radial-gradient(ellipse at 50% 50%, ' +
  '#0a3050 0%, #052438 38%, #02101c 72%, #000000 100%)';

// Node body — bright dodger-blue gradient (matches the ZBrain ref + the
// dodger accents already used throughout the set).
const NODE_BG =
  'linear-gradient(180deg, #3CAEFF 0%, #0496FF 55%, #0270CC 100%)';
const NODE_BORDER = 'rgba(255, 255, 255, 0.22)';
const NODE_GLOW   =
  '0 18px 36px rgba(2, 24, 48, 0.55), 0 4px 10px rgba(2, 24, 48, 0.40), ' +
  '0 0 0 1px rgba(255, 255, 255, 0.06) inset';

const SINK_BG =
  'linear-gradient(180deg, #57BBFF 0%, #1A9CFE 55%, #0A7FE0 100%)';

const CONNECTOR_STROKE = '#0496FF';
const CONNECTOR_GLOW   = '#0496FF';

const PACKET_CORE  = '#FFFFFF';
const PACKET_GLOW  = '#7FC9FF';

const LABEL_COLOR  = '#FFFFFF';
const SUBLABEL_COLOR = 'rgba(255, 255, 255, 0.72)';

// ─── Font loading ────────────────────────────────────────────────────────────

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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Bezier helpers ──────────────────────────────────────────────────────────

function bezierPathD(b: Bezier): string {
  return `M ${b.p0.x} ${b.p0.y} C ${b.p1.x} ${b.p1.y}, ${b.p2.x} ${b.p2.y}, ${b.p3.x} ${b.p3.y}`;
}

function bezierAt(b: Bezier, t: number): Pos {
  const u = 1 - t;
  const x =
    u * u * u * b.p0.x +
    3 * u * u * t * b.p1.x +
    3 * u * t * t * b.p2.x +
    t * t * t * b.p3.x;
  const y =
    u * u * u * b.p0.y +
    3 * u * u * t * b.p1.y +
    3 * u * t * t * b.p2.y +
    t * t * t * b.p3.y;
  return { x, y };
}

// ─── Icon glyphs (white stroke on dodger background) ─────────────────────────

const ICON_SIZE = 48;

function Icon({ id }: { id: IconId }) {
  const s = ICON_SIZE;
  const stroke = '#FFFFFF';
  const sw = 2.4;
  const common = {
    width: s,
    height: s,
    viewBox: '0 0 48 48',
    fill: 'none',
    stroke,
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (id) {
    case 'chat':
      return (
        <svg {...common}>
          <path d="M8 12c0-2 1.5-3.5 3.5-3.5h25C38.5 8.5 40 10 40 12v18c0 2-1.5 3.5-3.5 3.5H22l-7 6v-6h-3.5C9.5 33.5 8 32 8 30z" />
          <line x1="15" y1="18" x2="33" y2="18" />
          <line x1="15" y1="25" x2="27" y2="25" />
        </svg>
      );
    case 'router':
      return (
        <svg {...common}>
          <circle cx="10" cy="24" r="4" />
          <circle cx="38" cy="10" r="4" />
          <circle cx="38" cy="24" r="4" />
          <circle cx="38" cy="38" r="4" />
          <path d="M14 24 H22 C26 24 26 10 30 10 H34" />
          <line x1="14" y1="24" x2="34" y2="24" />
          <path d="M14 24 H22 C26 24 26 38 30 38 H34" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M24 6 L40 12 V24 C40 32 33 38 24 42 C15 38 8 32 8 24 V12 Z" />
          <path d="M17 24 L22 29 L31 19" />
        </svg>
      );
    case 'card':
      return (
        <svg {...common}>
          <rect x="6" y="11" width="36" height="26" rx="3" />
          <line x1="6" y1="19" x2="42" y2="19" />
          <line x1="12" y1="29" x2="20" y2="29" />
        </svg>
      );
    case 'message':
      return (
        <svg {...common}>
          <path d="M8 10h32v22H24l-7 6v-6H8z" />
          <circle cx="17" cy="21" r="1.6" fill={stroke} stroke="none" />
          <circle cx="24" cy="21" r="1.6" fill={stroke} stroke="none" />
          <circle cx="31" cy="21" r="1.6" fill={stroke} stroke="none" />
        </svg>
      );
    case 'brain':
      return (
        <svg {...common}>
          <path d="M19 8c-4 0-7 3-7 7v0c-2 1-3 3-3 5s1 4 3 5v0c0 4 3 7 7 7h5V8z" />
          <path d="M29 8c4 0 7 3 7 7v0c2 1 3 3 3 5s-1 4-3 5v0c0 4-3 7-7 7h-5V8z" />
          <line x1="24" y1="8" x2="24" y2="32" />
          <path d="M16 18 H20" />
          <path d="M28 18 H32" />
          <path d="M16 24 H20" />
          <path d="M28 24 H32" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="24" cy="24" r="6" />
          <path d="M24 6 v6 M24 36 v6 M6 24 h6 M36 24 h6 M11 11 l4 4 M33 33 l4 4 M11 37 l4 -4 M33 15 l4 -4" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M24 6 L27 19 L40 22 L27 25 L24 38 L21 25 L8 22 L21 19 Z" />
        </svg>
      );
  }
}

// ─── Node ────────────────────────────────────────────────────────────────────

function Node({
  pos,
  label,
  icon,
  popProgress,
  pulse,
  isSink,
}: {
  pos: Pos;
  label: string;
  icon: IconId;
  popProgress: number;          // 0 → 1, eased via easeOutBack outside
  pulse: number;                // 0–1 transient bump (for packet arrival)
  isSink?: boolean;
}) {
  if (popProgress <= 0 && pulse <= 0) return null;
  const scale = Math.max(0, popProgress) + pulse * 0.06;
  const opacity = clamp01(popProgress * 1.5);

  // Pulse adds a soft glow ring during transient
  const glowRing = pulse > 0
    ? `, 0 0 ${24 + pulse * 28}px rgba(127, 201, 255, ${0.35 + pulse * 0.35})`
    : '';

  return (
    <div
      style={{
        position: 'absolute',
        left: pos.x,
        top:  pos.y,
        width:  NODE_W,
        height: NODE_H,
        borderRadius: NODE_RADIUS,
        background: isSink ? SINK_BG : NODE_BG,
        border: `1px solid ${NODE_BORDER}`,
        boxShadow: NODE_GLOW + glowRing,
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        opacity,
        display: 'flex',
        alignItems: 'center',
        padding: '0 22px',
        gap: 18,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width:  64,
          height: 64,
          borderRadius: 18,
          background: 'rgba(255, 255, 255, 0.14)',
          border: '1px solid rgba(255, 255, 255, 0.20)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon id={icon} />
      </div>

      <div
        style={{
          fontFamily: "'Satoshi', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 30,
          letterSpacing: '-0.01em',
          color: LABEL_COLOR,
          lineHeight: 1.1,
          textShadow: '0 1px 2px rgba(2, 24, 48, 0.40)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── Connector ───────────────────────────────────────────────────────────────

function Connector({
  bezier,
  drawProgress,
}: {
  bezier: Bezier;
  drawProgress: number;     // 0 → 1 reveal
}) {
  if (drawProgress <= 0) return null;
  const d = bezierPathD(bezier);
  const dash = 1 - clamp01(drawProgress);

  return (
    <>
      {/* Soft outer glow */}
      <path
        d={d}
        fill="none"
        stroke={CONNECTOR_GLOW}
        strokeWidth={10}
        strokeLinecap="round"
        opacity={0.18 * clamp01(drawProgress)}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={dash}
      />
      {/* Inner stroke */}
      <path
        d={d}
        fill="none"
        stroke={CONNECTOR_STROKE}
        strokeWidth={3}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={dash}
      />
    </>
  );
}

// ─── Data packet ─────────────────────────────────────────────────────────────

function Packet({ pos, opacity }: { pos: Pos; opacity: number }) {
  if (opacity <= 0) return null;
  return (
    <g opacity={opacity}>
      <circle cx={pos.x} cy={pos.y} r={14} fill={PACKET_GLOW} opacity={0.35} />
      <circle cx={pos.x} cy={pos.y} r={8}  fill={PACKET_GLOW} opacity={0.55} />
      <circle cx={pos.x} cy={pos.y} r={4.5} fill={PACKET_CORE} />
    </g>
  );
}

// ─── Background dot grid ─────────────────────────────────────────────────────

function DotGrid({ opacity }: { opacity: number }) {
  if (opacity <= 0) return null;
  const cols = 32;
  const rows = 18;
  const stepX = W / cols;
  const stepY = H / rows;
  const dots: JSX.Element[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cxd = c * stepX + stepX / 2;
      const cyd = r * stepY + stepY / 2;
      dots.push(<circle key={`${r}-${c}`} cx={cxd} cy={cyd} r={1.2} fill="#FFFFFF" />);
    }
  }
  return <g opacity={0.06 * opacity}>{dots}</g>;
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export const AIWorkflowDiagramV1: React.FC<AIWorkflowDiagramV1Props> = ({
  columns, timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading AIWorkflowDiagramV1 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BG_DUR        = f(t.bgScaleDuration);
  const FIRST_START   = f(t.sourceStart);
  const POP_DUR       = f(t.nodePopDuration);
  const CONN_DUR      = f(t.connectorDraw);
  const STAGGER       = f(t.branchStagger);
  const PULSE_PERIOD  = f(t.pulsePeriod);
  const PULSE_FLOOR   = f(t.pulseLoopStart);

  const nCols = columns.length;
  const lastCol = nCols - 1;

  // ── Geometry: top-left of every box, indexed [col][row] ────────────────────
  const layout: Pos[][] = columns.map((col, c) =>
    col.map((_, r) => ({ x: columnX(c, nCols), y: boxY(r, col.length) })),
  );

  // ── Connectors: complete bipartite between adjacent columns ────────────────
  type Conn = { c: number; r: number; r2: number; bezier: Bezier };
  const conns: Conn[] = [];
  for (let c = 0; c < nCols - 1; c++) {
    for (let r = 0; r < columns[c]!.length; r++) {
      for (let r2 = 0; r2 < columns[c + 1]!.length; r2++) {
        conns.push({
          c, r, r2,
          bezier: makeHCurve(right(layout[c]![r]!), left(layout[c + 1]![r2]!)),
        });
      }
    }
  }
  const connFor = (c: number, r: number, r2: number) =>
    conns.find((x) => x.c === c && x.r === r && x.r2 === r2);

  // ── Staged timeline (frames), built column by column ───────────────────────
  // colStart[c] : first box of column c begins popping (boxes stagger after).
  // connStart[c]: connectors from column c → c+1 begin drawing.
  const colStart: number[] = [];
  const connStart: number[] = [];
  let cursor = FIRST_START;
  for (let c = 0; c < nCols; c++) {
    colStart[c] = cursor;
    const colPopEnd = cursor + (columns[c]!.length - 1) * STAGGER + POP_DUR;
    if (c < nCols - 1) {
      connStart[c] = colPopEnd;
      cursor = colPopEnd + CONN_DUR;     // next column waits for connectors
    } else {
      cursor = colPopEnd;
    }
  }
  const buildEnd = cursor;
  // Pulse never starts before the graph is fully drawn.
  const PULSE_START = Math.max(PULSE_FLOOR, buildEnd);

  // Helpers
  const popAt = (start: number, isBig = false) => {
    const p = interpolate(frame, [start, start + POP_DUR], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return (isBig ? easeOutBackBig : easeOutBack)(p);
  };
  const drawAt = (start: number) =>
    easeOutCubic(interpolate(frame, [start, start + CONN_DUR], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }));

  // Oxford background "irises in" over the platinum base — same device as
  // TreeDiagram4x2. Once it's fully scaled the diagram starts building.
  const bgScale = interpolate(frame, [0, BG_DUR], [0, 1], {
    extrapolateLeft:  'clamp',
    extrapolateRight: 'clamp',
    easing: easeInOutCubic,
  });
  const bgOp = clamp01((bgScale - 0.5) * 2);

  // Per-box pop progress (last column gets the bigger sink overshoot).
  const popProg: number[][] = columns.map((col, c) =>
    col.map((_, r) => popAt(colStart[c] + r * STAGGER, c === lastCol)),
  );

  // Per-connector draw progress.
  const connDraw = conns.map((cn) => drawAt(connStart[cn.c]!));

  // ── Data-packet pulse loop ────────────────────────────────────────────────
  // The packet travels one box per column along a chosen path, one connector
  // per "leg" (nCols-1 legs total) per PULSE_PERIOD. The chosen box in column
  // c rotates as (cycle + c) % colLength, so different routes light up over
  // time. Needs ≥2 columns; a single column has nothing to traverse.
  let packetPos: Pos | null = null;
  let packetOp = 0;
  const nodeHit: number[][] = columns.map((col) => col.map(() => 0));

  if (nCols >= 2 && frame >= PULSE_START) {
    const since = frame - PULSE_START;
    const cycle = Math.floor(since / PULSE_PERIOD);
    const localT = (since % PULSE_PERIOD) / PULSE_PERIOD; // 0–1

    // Path: which box to pass through in each column this cycle.
    const path = columns.map((col, c) => (cycle + c) % col.length);

    const legs = nCols - 1;
    const legLen = 1 / legs;
    const fadeInEnd = 0.04;
    const fadeOutStart = 0.96;
    packetOp = easeOutCubic(clamp01(localT / fadeInEnd))
             * (1 - easeOutCubic(clamp01((localT - fadeOutStart) / (1 - fadeOutStart))));

    const legIdx = Math.min(legs - 1, Math.floor(localT / legLen));
    const legT = clamp01((localT - legIdx * legLen) / legLen);

    const fromR = path[legIdx]!;
    const toR   = path[legIdx + 1]!;
    const cn = connFor(legIdx, fromR, toR);
    if (cn) packetPos = bezierAt(cn.bezier, easeInOutCubic(legT));

    // Pulse the source box at the very start of its journey.
    if (legIdx === 0) {
      nodeHit[0]![path[0]!] = Math.max(
        nodeHit[0]![path[0]!]!,
        Math.sin(Math.PI * clamp01(1 - legT * 2)),
      );
    }
    // Pulse the destination box as the packet arrives (back half of the leg).
    const arriveCol = legIdx + 1;
    nodeHit[arriveCol]![toR] = Math.max(
      nodeHit[arriveCol]![toR]!,
      Math.sin(Math.PI * clamp01((legT - 0.5) / 0.5)),
    );
  }

  return (
    <AbsoluteFill style={{ background: PLATINUM_BG, overflow: 'hidden' }}>
      {/* Oxford-blue radial gradient scales 0 → 1 from the centre over the
          platinum base. Mirrors TreeDiagram4x2's intro device. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: OXFORD_BG,
          transform: `scale(${bgScale})`,
          transformOrigin: 'center center',
        }}
      />

      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        <DotGrid opacity={bgOp} />

        {/* Connectors (drawn beneath nodes) */}
        {conns.map((cn, i) => (
          <Connector key={`c${cn.c}-${cn.r}-${cn.r2}`} bezier={cn.bezier} drawProgress={connDraw[i]!} />
        ))}

        {/* Data packet (above connectors, below nodes) */}
        {packetPos && <Packet pos={packetPos} opacity={packetOp} />}
      </svg>

      {/* Nodes (HTML for crisp text + drop shadows) */}
      {columns.map((col, c) =>
        col.map((node, r) => (
          <Node
            key={`n${c}-${r}`}
            pos={layout[c]![r]!}
            label={node.label}
            icon={node.icon}
            popProgress={popProg[c]![r]!}
            pulse={nodeHit[c]![r]!}
            isSink={c === lastCol}
          />
        )),
      )}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

// Default = the classic source → router → 3 agents → sink shape, expressed
// in the new column model ([[1],[1],[3],[1]]). Reproduces the original layout.
export const aiWorkflowDiagramV1DefaultProps: AIWorkflowDiagramV1Props = {
  columns: [
    [{ label: 'User Query',    icon: 'chat'   }],
    [{ label: 'Intent Router', icon: 'router' }],
    [
      { label: 'Refunds Agent', icon: 'card'    },
      { label: 'Support Agent', icon: 'shield'  },
      { label: 'General Agent', icon: 'message' },
    ],
    [{ label: 'LLM Engine',    icon: 'brain'  }],
  ],
};
