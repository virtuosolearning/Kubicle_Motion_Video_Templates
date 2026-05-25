import { useEffect, useState } from 'react';
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

export const aiWorkflowDiagramV1TimingsSchema = z
  .object({
    bgScaleDuration:   z.number().positive(),  // oxford-blue irises in over platinum
    sourceStart:       z.number().nonnegative(),
    nodePopDuration:   z.number().positive(),
    connectorDraw:     z.number().positive(),
    branchStagger:     z.number().positive(),
    pulsePeriod:       z.number().positive(),  // seconds per data-packet cycle
    pulseLoopStart:    z.number().nonnegative(),
  })
  .partial();

export const aiWorkflowDiagramV1Schema = z.object({
  source:   aiWorkflowNodeSchema,
  router:   aiWorkflowNodeSchema,
  branches: z.array(aiWorkflowNodeSchema).length(3),
  sink:     aiWorkflowNodeSchema,
  timings:  aiWorkflowDiagramV1TimingsSchema.optional(),
});

export type AIWorkflowDiagramV1Props = z.infer<typeof aiWorkflowDiagramV1Schema>;

export const aiWorkflowDiagramV1Meta = {
  description:
    'Animated AI workflow diagram. A user-query source feeds an intent ' +
    'router that branches into three parallel agent nodes, all converging ' +
    'into a final LLM sink. Nodes pop in with overshoot, connectors draw ' +
    'on, then a continuous data-packet pulse loops through the graph to ' +
    'show flow. Use for "how our AI pipeline works" explainers, multi-' +
    'agent routing visuals, or any 1→3→1 fan-out/fan-in workflow story.',
  authoringNotes:
    'Supply 5 nodes total: source (left), router (next), 3 branches (fan- ' +
    'out, top→middle→bottom), and sink (right). Labels ≤16 chars; pick ' +
    'short parallel phrasing for the 3 branches ("Refunds Agent", ' +
    '"Support Agent", "General Agent" reads better than mixed lengths). ' +
    'Pick an icon per node from the set: chat, router, shield, card, ' +
    'message, brain, gear, spark. Default duration 450 frames (15 s).',
} as const;

// ─── Assets ──────────────────────────────────────────────────────────────────

const SATOSHI_BOLD_SRC = staticFile('fonts/Satoshi-Bold.woff2');

// ─── Layout constants ────────────────────────────────────────────────────────

const W = 1920;
const H = 1080;

const NODE_W = 280;
const NODE_H = 140;
const NODE_RADIUS = 26;

// Top-left positions for each node. Lays out as:
//   [source]  →  [router]  ─┬─→ [branch0]  ┐
//                           ├─→ [branch1]  ┼─→ [sink]
//                           └─→ [branch2]  ┘
const POS = {
  source:  { x: 100,  y: 470 },
  router:  { x: 540,  y: 470 },
  branch0: { x: 1020, y: 180 },
  branch1: { x: 1020, y: 470 },
  branch2: { x: 1020, y: 760 },
  sink:    { x: 1540, y: 470 },
} as const;

type Pos = { x: number; y: number };
const cx = (p: Pos) => p.x + NODE_W / 2;
const cy = (p: Pos) => p.y + NODE_H / 2;
const right = (p: Pos) => ({ x: p.x + NODE_W, y: p.y + NODE_H / 2 });
const left  = (p: Pos) => ({ x: p.x,           y: p.y + NODE_H / 2 });

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

const CONNECTORS = {
  src2router:   makeHCurve(right(POS.source),  left(POS.router)),
  router2b0:    makeHCurve(right(POS.router),  left(POS.branch0)),
  router2b1:    makeHCurve(right(POS.router),  left(POS.branch1)),
  router2b2:    makeHCurve(right(POS.router),  left(POS.branch2)),
  b0_2sink:     makeHCurve(right(POS.branch0), left(POS.sink)),
  b1_2sink:     makeHCurve(right(POS.branch1), left(POS.sink)),
  b2_2sink:     makeHCurve(right(POS.branch2), left(POS.sink)),
} as const;

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
  source, router, branches, sink, timings,
}) => {
  const frame = useCurrentFrame();

  const [handle] = useState(() => delayRender('Loading AIWorkflowDiagramV1 fonts'));
  useEffect(() => {
    loadFonts()
      .catch(() => { /* font failure is non-fatal */ })
      .finally(() => continueRender(handle));
  }, [handle]);

  const t = { ...DEFAULT_TIMINGS, ...timings };
  const BG_DUR       = f(t.bgScaleDuration);
  const SOURCE_START = f(t.sourceStart);
  const POP_DUR      = f(t.nodePopDuration);
  const CONN_DUR     = f(t.connectorDraw);
  const STAGGER      = f(t.branchStagger);
  const PULSE_PERIOD = f(t.pulsePeriod);
  const PULSE_START  = f(t.pulseLoopStart);

  // Build the staged timeline (frames).
  const T = {
    bgEnd:           BG_DUR,
    sourceStart:     SOURCE_START,
    sourceEnd:       SOURCE_START + POP_DUR,
    conn0Start:      SOURCE_START + POP_DUR,
    conn0End:        SOURCE_START + POP_DUR + CONN_DUR,
    routerStart:     SOURCE_START + POP_DUR + CONN_DUR,
    routerEnd:       SOURCE_START + POP_DUR + CONN_DUR + POP_DUR,
    branchConnStart: SOURCE_START + POP_DUR + CONN_DUR + POP_DUR,
    branchStart:     SOURCE_START + POP_DUR + CONN_DUR + POP_DUR + STAGGER,
    convConnStart:   SOURCE_START + POP_DUR + CONN_DUR + POP_DUR + 2 * STAGGER + CONN_DUR + POP_DUR,
    sinkStart:       SOURCE_START + POP_DUR + CONN_DUR + POP_DUR + 2 * STAGGER + CONN_DUR + POP_DUR + 2 * STAGGER + CONN_DUR,
  };
  T.sinkStart = T.convConnStart + 2 * STAGGER + CONN_DUR;

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
  // Dot grid + diagram fade tied to bg-scale completion so nothing flashes
  // through during the iris-in.
  const bgOp = clamp01((bgScale - 0.5) * 2);

  // Pop progresses
  const popSource = popAt(T.sourceStart);
  const popRouter = popAt(T.routerStart);
  const popBranch0 = popAt(T.branchStart + 0 * STAGGER);
  const popBranch1 = popAt(T.branchStart + 1 * STAGGER);
  const popBranch2 = popAt(T.branchStart + 2 * STAGGER);
  const popSink   = popAt(T.sinkStart, true);

  // Connector draws
  const drSrc2Router = drawAt(T.conn0Start);
  const drRouter2B0  = drawAt(T.branchConnStart + 0 * STAGGER);
  const drRouter2B1  = drawAt(T.branchConnStart + 1 * STAGGER);
  const drRouter2B2  = drawAt(T.branchConnStart + 2 * STAGGER);
  const drB02Sink    = drawAt(T.convConnStart + 0 * STAGGER);
  const drB12Sink    = drawAt(T.convConnStart + 1 * STAGGER);
  const drB22Sink    = drawAt(T.convConnStart + 2 * STAGGER);

  // ── Data-packet pulse loop ────────────────────────────────────────────────
  // Each pulse travels source→router→⟨branch i⟩→sink in PULSE_PERIOD frames.
  // We split that into 3 equal legs (source→router 25%, router→branch 35%,
  // branch→sink 40%). Branch index cycles 0,1,2,0,1,2,…
  type Leg = { conn: Bezier; t0: number; t1: number };

  const branchPositions = [POS.branch0, POS.branch1, POS.branch2];
  const branchConns = [CONNECTORS.router2b0, CONNECTORS.router2b1, CONNECTORS.router2b2];
  const convConns  = [CONNECTORS.b0_2sink,  CONNECTORS.b1_2sink,  CONNECTORS.b2_2sink];

  let packetPos: Pos | null = null;
  let packetOp = 0;
  const branchHit = [0, 0, 0]; // pulse per branch
  let sinkHit = 0;

  if (frame >= PULSE_START) {
    const sincePulseStart = frame - PULSE_START;
    const cycleIndex = Math.floor(sincePulseStart / PULSE_PERIOD);
    const localT = (sincePulseStart % PULSE_PERIOD) / PULSE_PERIOD; // 0–1
    const branchIdx = cycleIndex % 3;

    // 3 legs with weighted durations summing to 1
    const W0 = 0.25, W1 = 0.35, W2 = 0.40;
    const fadeInEnd  = 0.05;
    const fadeOutStart = 0.95;

    packetOp = easeOutCubic(clamp01(localT / fadeInEnd))
             * (1 - easeOutCubic(clamp01((localT - fadeOutStart) / (1 - fadeOutStart))));

    if (localT < W0) {
      const lt = localT / W0;
      packetPos = bezierAt(CONNECTORS.src2router, easeInOutCubic(lt));
    } else if (localT < W0 + W1) {
      const lt = (localT - W0) / W1;
      packetPos = bezierAt(branchConns[branchIdx]!, easeInOutCubic(lt));
    } else {
      const lt = (localT - W0 - W1) / W2;
      packetPos = bezierAt(convConns[branchIdx]!, easeInOutCubic(lt));
      // Branch pulse fires at packet's exit from branch (start of leg 3)
      branchHit[branchIdx] = Math.sin(Math.PI * clamp01(lt * 1.5));
      // Sink pulse fires as packet lands
      sinkHit = Math.sin(Math.PI * clamp01((lt - 0.6) / 0.4));
    }
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
        <Connector bezier={CONNECTORS.src2router} drawProgress={drSrc2Router} />
        <Connector bezier={CONNECTORS.router2b0} drawProgress={drRouter2B0} />
        <Connector bezier={CONNECTORS.router2b1} drawProgress={drRouter2B1} />
        <Connector bezier={CONNECTORS.router2b2} drawProgress={drRouter2B2} />
        <Connector bezier={CONNECTORS.b0_2sink} drawProgress={drB02Sink} />
        <Connector bezier={CONNECTORS.b1_2sink} drawProgress={drB12Sink} />
        <Connector bezier={CONNECTORS.b2_2sink} drawProgress={drB22Sink} />

        {/* Data packet (above connectors, below nodes) */}
        {packetPos && <Packet pos={packetPos} opacity={packetOp} />}
      </svg>

      {/* Nodes (HTML for crisp text + drop shadows) */}
      <Node pos={POS.source}  label={source.label}     icon={source.icon}     popProgress={popSource}  pulse={0} />
      <Node pos={POS.router}  label={router.label}     icon={router.icon}     popProgress={popRouter}  pulse={0} />
      <Node pos={POS.branch0} label={branches[0]!.label} icon={branches[0]!.icon} popProgress={popBranch0} pulse={branchHit[0]!} />
      <Node pos={POS.branch1} label={branches[1]!.label} icon={branches[1]!.icon} popProgress={popBranch1} pulse={branchHit[1]!} />
      <Node pos={POS.branch2} label={branches[2]!.label} icon={branches[2]!.icon} popProgress={popBranch2} pulse={branchHit[2]!} />
      <Node pos={POS.sink}    label={sink.label}       icon={sink.icon}       popProgress={popSink}    pulse={sinkHit} isSink />

      {/* Small "centre / orchestration" cue under the router during pulses */}
      {frame >= PULSE_START && (
        <div
          style={{
            position: 'absolute',
            left:  cx(POS.router) - 100,
            top:   POS.router.y + NODE_H + 14,
            width: 200,
            textAlign: 'center',
            fontFamily: "'Satoshi', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: SUBLABEL_COLOR,
            pointerEvents: 'none',
          }}
        >
          Route by intent
        </div>
      )}
    </AbsoluteFill>
  );
};

// ─── Demo / test props ───────────────────────────────────────────────────────

export const aiWorkflowDiagramV1DefaultProps: AIWorkflowDiagramV1Props = {
  source:  { label: 'User Query',     icon: 'chat'    },
  router:  { label: 'Intent Router',  icon: 'router'  },
  branches: [
    { label: 'Refunds Agent',  icon: 'card'    },
    { label: 'Support Agent',  icon: 'shield'  },
    { label: 'General Agent',  icon: 'message' },
  ],
  sink:    { label: 'LLM Engine',     icon: 'brain'   },
};
