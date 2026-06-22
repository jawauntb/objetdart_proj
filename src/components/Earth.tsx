"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";

/**
 * /earth — earth as a wave instrument.
 *
 * Vertical cross-section of the world. Top to bottom:
 *   1. Sky / horizon  (warm sand gradient)
 *   2. Surface line   (ground hairline + grass tufts)
 *   3. Strata         (six earth bands — topsoil → basalt)
 *   4. Root systems   (four branching SVG paths growing over 30s)
 *   5. Seismograph    (cream trace, scrolls right-to-left, magnitude
 *                      derived from cursor velocity + clicks + noise)
 *
 * The strata + grass are pre-rendered to an off-screen canvas. Only the
 * roots, seismograph trace, and active interactions are repainted per
 * frame. A 1800-sample ring buffer drives the seismograph (30s @ 60fps).
 */

type Stratum = {
  id: string;
  name: string;
  inscription: string;
  color: string;
  yFracTop: number; // fraction of strata band (0..1)
  yFracBot: number;
};

// Strata layout — each band's top/bottom as a fraction of the strata zone.
// The strata zone spans the band from 25% to 75% of viewport height (50%).
const STRATA: Stratum[] = [
  { id: "topsoil",   name: "topsoil",    inscription: "topsoil · the living crust",
    color: "#3a2818", yFracTop: 0.00, yFracBot: 0.10 },
  { id: "sandyclay", name: "sandy clay", inscription: "sandy clay · the slow river",
    color: "#a07840", yFracTop: 0.10, yFracBot: 0.26 },
  { id: "sandstone", name: "sandstone",  inscription: "sandstone · the pressed dune",
    color: "#7a4828", yFracTop: 0.26, yFracBot: 0.46 },
  { id: "shale",     name: "shale",      inscription: "shale · the silt of forgetting",
    color: "#403028", yFracTop: 0.46, yFracBot: 0.66 },
  { id: "limestone", name: "limestone",  inscription: "limestone · ancient sea",
    color: "#d8c8a8", yFracTop: 0.66, yFracBot: 0.84 },
  { id: "basalt",    name: "basalt",     inscription: "basalt · the body of fire",
    color: "#1a1612", yFracTop: 0.84, yFracBot: 1.00 },
];

// Zone fractions of the viewport (must sum to 1).
const SKY_FRAC     = 0.15;
const SURFACE_FRAC = 0.10;
const STRATA_FRAC  = 0.50;
const SEISMO_FRAC  = 0.25;

// Seismograph ring buffer — 1800 samples ≈ 30s at 60fps.
const SEISMO_SAMPLES = 1800;

// Root systems — 4 large branching SVG-style paths, defined as a tree.
// Each node has a relative offset from the surface anchor and children.
type RootNode = {
  // delta from parent (in px); start (root anchor) has its own absolute x
  dx: number;
  dy: number;
  width: number;
  children?: RootNode[];
};

type RootSpec = {
  // anchor x as fraction of width
  xFrac: number;
  tree: RootNode;
};

const ROOTS: RootSpec[] = [
  {
    xFrac: 0.18,
    tree: {
      dx: 0, dy: 0, width: 3.2,
      children: [
        { dx: -8,  dy: 40, width: 2.6,
          children: [
            { dx: -18, dy: 70, width: 1.8 },
            { dx: 6,   dy: 90, width: 1.6,
              children: [{ dx: -10, dy: 60, width: 1.0 }] },
          ] },
        { dx: 10, dy: 36, width: 2.4,
          children: [
            { dx: 22, dy: 80, width: 1.6 },
            { dx: -4, dy: 100, width: 1.4,
              children: [{ dx: 12, dy: 50, width: 0.9 }] },
          ] },
      ],
    },
  },
  {
    xFrac: 0.42,
    tree: {
      dx: 0, dy: 0, width: 3.6,
      children: [
        { dx: -12, dy: 50, width: 2.8,
          children: [
            { dx: -24, dy: 80, width: 1.8 },
            { dx: 4,   dy: 70, width: 1.6 },
          ] },
        { dx: 14, dy: 44, width: 2.6,
          children: [
            { dx: 26, dy: 90, width: 1.7 },
            { dx: -2, dy: 110, width: 1.4,
              children: [{ dx: 18, dy: 60, width: 0.9 }] },
          ] },
      ],
    },
  },
  {
    xFrac: 0.66,
    tree: {
      dx: 0, dy: 0, width: 3.0,
      children: [
        { dx: -10, dy: 46, width: 2.4,
          children: [
            { dx: -20, dy: 70, width: 1.6 },
            { dx: 6,   dy: 90, width: 1.4 },
          ] },
        { dx: 12, dy: 40, width: 2.6,
          children: [
            { dx: 28,  dy: 70, width: 1.7 },
            { dx: -6,  dy: 100, width: 1.5,
              children: [{ dx: 14, dy: 50, width: 1.0 }] },
          ] },
      ],
    },
  },
  {
    xFrac: 0.84,
    tree: {
      dx: 0, dy: 0, width: 3.4,
      children: [
        { dx: -14, dy: 42, width: 2.6,
          children: [
            { dx: -22, dy: 80, width: 1.8 },
            { dx: 4,   dy: 100, width: 1.5,
              children: [{ dx: -10, dy: 50, width: 0.9 }] },
          ] },
        { dx: 12, dy: 48, width: 2.4,
          children: [
            { dx: 22, dy: 80, width: 1.6 },
            { dx: -4, dy: 90, width: 1.3 },
          ] },
      ],
    },
  },
];

// Walk a root tree and yield every segment with a depth-ordered "arrival" time
// in [0,1]. Used both for growth animation and pulse-on-click.
type Segment = {
  x0: number; y0: number;
  x1: number; y1: number;
  width: number;
  arrive: number; // 0..1 — when this segment finishes drawing in the loop
};

function flattenRoot(spec: RootSpec, surfaceY: number, w: number): Segment[] {
  const ax = spec.xFrac * w;
  const segs: Segment[] = [];
  // BFS to figure out total node count for arrival times
  const all: Array<{ node: RootNode; px: number; py: number; depth: number }> = [];
  const visit = (node: RootNode, px: number, py: number, depth: number) => {
    const x = px + node.dx;
    const y = py + node.dy;
    all.push({ node, px: x, py: y, depth });
    if (node.children) {
      for (const ch of node.children) visit(ch, x, y, depth + 1);
    }
  };
  visit(spec.tree, ax, surfaceY, 0);

  // Build segments in BFS order so arrival ramps from trunk outward
  // (deeper segments arrive later)
  const maxDepth = Math.max(1, ...all.map((a) => a.depth));
  const visitSeg = (node: RootNode, px: number, py: number, depth: number) => {
    const x = px + node.dx;
    const y = py + node.dy;
    if (depth > 0) {
      // arrival: a fraction based on depth; spread across the 0..1 window
      const arrive = Math.min(1, (depth / (maxDepth + 0.5)) + 0.05);
      segs.push({ x0: px, y0: py, x1: x, y1: y, width: node.width, arrive });
    }
    if (node.children) {
      for (const ch of node.children) visitSeg(ch, x, y, depth + 1);
    }
  };
  visitSeg(spec.tree, ax, surfaceY, 0);
  return segs;
}

export default function Earth() {
  // page-specific ambient bed: subsonic rumble
  useEffect(() => { getFieldAudio().setAmbientProfile("earth"); }, []);

  const wrapRef   = useRef<HTMLDivElement>(null);
  const bgRef     = useRef<HTMLCanvasElement>(null);   // pre-rendered strata + grass
  const fgRef     = useRef<HTMLCanvasElement>(null);   // roots + seismograph + interactions
  const [earthMarks, setEarthMarks] = useState<Array<{ label: string; tone: string; t: number }>>([
    { label: "still", tone: "#d8c8a8", t: 0 },
  ]);
  const markEarth = useCallback((label: string, tone = "#d8c8a8") => {
    setEarthMarks((prev) => [{ label, tone, t: performance.now() }, ...prev].slice(0, 5));
  }, []);
  // ring buffer for seismograph
  const seismoBufRef = useRef<Float32Array>(new Float32Array(SEISMO_SAMPLES));
  const seismoHeadRef = useRef<number>(0);
  // recent click impulses still decaying
  const clickSpikesRef = useRef<Array<{ t0: number; strength: number }>>([]);
  // last cursor location + velocity smoothing
  const cursorRef = useRef<{
    x: number; y: number; lastT: number; vel: number; over: boolean;
  }>({ x: 0, y: 0, lastT: 0, vel: 0, over: false });
  // active stratum highlight + inscription (ref for canvas; state for DOM)
  const activeStratumRef = useRef<{ id: string; t0: number } | null>(null);
  const [activeStratumId, setActiveStratumId] = useState<string | null>(null);
  // hovered stratum (cursor in strata zone — for label)
  const [hoverStratum, setHoverStratum] = useState<string | null>(null);
  // pulsed roots
  const pulsedRootsRef = useRef<Array<{ idx: number; t0: number }>>([]);
  // trench drag — vertical compression effect
  const trenchRef = useRef<{ y: number; startY: number; active: boolean; pointerId: number | null }>({
    y: 0, startY: 0, active: false, pointerId: null,
  });
  // dust puff effects (surface taps)
  const dustRef = useRef<Array<{ x: number; y: number; t0: number }>>([]);
  // big seismograph spike (when tapping the seismograph)
  const quakeSpikeRef = useRef<{ t0: number; strength: number } | null>(null);
  // current readout magnitude (0..9) for the Fraunces number
  const [magReadout, setMagReadout] = useState<string>("0.0");
  // memo of the latest flattened roots — recomputed on resize only
  const rootsRef = useRef<Array<{ segs: Segment[]; baseColor: string }>>([]);

  // ── Plants / orchard system ──────────────────────────────────────
  // A small population of growing plants sits in the surface band.
  // Each plant has a `growthT0` (ms) and a max growth time so the
  // animation can play once and then hold. Trees can carry fruit which
  // ripens late in the growth curve and can be picked.
  type PlantKind = "grass" | "flower" | "tree" | "vine";
  type Plant = {
    kind: PlantKind;
    xFrac: number;       // 0..1 position along surface
    seed: number;        // for deterministic per-plant variation
    growthT0: number;    // ms; when growth started (or restarted)
    growSpeedMul: number; // 1 normal, >1 for long-press boost
    growSpeedT0: number; // ms; timestamp boost started
    growSpeedDur: number; // ms; boost duration
    // flower / tree color hints
    color: string;
    // for trees: per-fruit state. position is a relative dy from canopy center.
    fruits: Array<{
      px: number; py: number; // canopy-relative offsets
      picked: boolean;
      pickT0: number;          // ms (when picked)
      vy: number;              // fall velocity once picked
      restPx: number;          // absolute x where it landed (in px)
      restPy: number;          // absolute y where it landed (in px)
    }>;
    // earthquake fall — 0..1 lean amount, with restoration
    fallAmt: number;
    fallT0: number;
    // click pulse
    pulseT0: number;
  };
  const plantsRef = useRef<Plant[]>([]);

  // Butterfly / bird visitor — single floating sprite, spawned every ~30s.
  type Visitor = {
    kind: "butterfly" | "bird";
    x: number; y: number;
    t0: number;
    // bezier path from off-left to off-right with mid waypoints
    // we sample the path by parametric t in [0..1]
    duration: number;     // ms total to cross
    // pause state — if user clicks, the visitor pauses on a plant briefly
    pausedUntil: number;
    perched: boolean;
    perchPlantIdx: number;
    // animation phase for wing flap
    flapPhase: number;
  };
  const visitorRef = useRef<Visitor | null>(null);
  const lastVisitorSpawnRef = useRef<number>(0);

  // Moisture droplets traveling down through soil layers (small dots).
  type Droplet = {
    x: number; y: number;
    vy: number;
    t0: number;
  };
  const dropletsRef = useRef<Droplet[]>([]);
  const lastDropletSpawnRef = useRef<number>(0);

  // Wind: same affordance as Fire — horizontal drag in empty sky/surface.
  // Stored as ref so the render loop can sample it without re-rendering.
  const earthWindRef = useRef<{ target: number; current: number }>({
    target: 0, current: 0,
  });

  // Earthquake shake — vector of (dx, dy) jitter applied to plants when
  // active. Driven by quakeSpikeRef and fresh on tap.
  const shakeRef = useRef<{ amp: number; t0: number }>({ amp: 0, t0: 0 });

  useEffect(() => {
    const wrap = wrapRef.current;
    const bg = bgRef.current;
    const fg = fgRef.current;
    if (!wrap || !bg || !fg) return;
    const bgCtx = bg.getContext("2d");
    const fgCtx = fg.getContext("2d");
    if (!bgCtx || !fgCtx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── Layout helpers ─────────────────────────────────────────────
    let viewW = 0;
    let viewH = 0;
    const zone = () => {
      const skyTop     = 0;
      const skyBot     = viewH * SKY_FRAC;
      const surfaceTop = skyBot;
      const surfaceBot = surfaceTop + viewH * SURFACE_FRAC;
      const strataTop  = surfaceBot;
      const strataBot  = strataTop + viewH * STRATA_FRAC;
      const seismoTop  = strataBot;
      const seismoBot  = viewH;
      return {
        skyTop, skyBot,
        surfaceTop, surfaceBot,
        strataTop, strataBot,
        seismoTop, seismoBot,
      };
    };

    // Stratum index at a given absolute y (in css px) — or null if outside.
    const stratumAt = (y: number): Stratum | null => {
      const z = zone();
      if (y < z.strataTop || y > z.strataBot) return null;
      const t = (y - z.strataTop) / (z.strataBot - z.strataTop);
      for (const s of STRATA) {
        if (t >= s.yFracTop && t <= s.yFracBot) return s;
      }
      return null;
    };

    // ── Pre-render background (strata + grass) ─────────────────────
    const renderBg = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      bg.width  = Math.floor(viewW * dpr);
      bg.height = Math.floor(viewH * dpr);
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const z = zone();

      // 1. Sky — warm sand gradient #e8d8b8 → #c8a878
      const skyG = bgCtx.createLinearGradient(0, z.skyTop, 0, z.skyBot);
      skyG.addColorStop(0, "#e8d8b8");
      skyG.addColorStop(1, "#c8a878");
      bgCtx.fillStyle = skyG;
      bgCtx.fillRect(0, z.skyTop, viewW, z.skyBot - z.skyTop);

      // 2. Surface — soft warmer tint band fades down to the surface line
      const surfG = bgCtx.createLinearGradient(0, z.surfaceTop, 0, z.surfaceBot);
      surfG.addColorStop(0, "#c8a878");
      surfG.addColorStop(1, "#7a5a32");
      bgCtx.fillStyle = surfG;
      bgCtx.fillRect(0, z.surfaceTop, viewW, z.surfaceBot - z.surfaceTop);

      // 3. Strata — six bands with subtle horizontal banding noise
      for (let i = 0; i < STRATA.length; i++) {
        const s = STRATA[i];
        const y0 = z.strataTop + s.yFracTop * (z.strataBot - z.strataTop);
        const y1 = z.strataTop + s.yFracBot * (z.strataBot - z.strataTop);
        bgCtx.fillStyle = s.color;
        bgCtx.fillRect(0, y0, viewW, y1 - y0);

        // subtle horizontal banding noise — 4-6 faint streaks per band
        const bandH = y1 - y0;
        const streaks = 5 + (i % 2);
        for (let k = 0; k < streaks; k++) {
          const sy = y0 + ((k + 0.5) / streaks) * bandH + (Math.sin(k * 12.4 + i * 3.1) * bandH * 0.06);
          // alternate light / dark streaks for texture
          const dark = (k + i) % 2 === 0;
          bgCtx.strokeStyle = dark
            ? "rgba(0, 0, 0, 0.10)"
            : "rgba(255, 250, 240, 0.06)";
          bgCtx.lineWidth = 0.8;
          bgCtx.beginPath();
          // gentle wandering polyline across the width
          for (let x = 0; x <= viewW; x += 24) {
            const yy = sy + Math.sin(x * 0.013 + k * 1.7 + i * 0.9) * 1.4;
            if (x === 0) bgCtx.moveTo(x, yy);
            else bgCtx.lineTo(x, yy);
          }
          bgCtx.stroke();
        }

        // hairline between bands (top edge except the first)
        if (i > 0) {
          bgCtx.strokeStyle = "rgba(10, 8, 6, 0.45)";
          bgCtx.lineWidth = 1;
          bgCtx.beginPath();
          bgCtx.moveTo(0, y0 + 0.5);
          bgCtx.lineTo(viewW, y0 + 0.5);
          bgCtx.stroke();
        }
      }

      // 2b. Ground hairline + grass tufts — drawn LAST over the surface band
      const groundY = z.surfaceBot;
      bgCtx.strokeStyle = "rgba(30, 22, 14, 0.7)";
      bgCtx.lineWidth = 1.2;
      bgCtx.beginPath();
      bgCtx.moveTo(0, groundY);
      bgCtx.lineTo(viewW, groundY);
      bgCtx.stroke();

      // grass tufts — small SVG-like curves at semi-regular intervals
      bgCtx.strokeStyle = "rgba(36, 60, 28, 0.74)";
      bgCtx.lineWidth = 1;
      bgCtx.lineCap = "round";
      const tuftStep = 28;
      for (let x = 12; x < viewW; x += tuftStep) {
        // each tuft is 3 little blades fanning slightly outward
        const jitter = Math.sin(x * 0.137) * 6;
        const baseX = x + jitter;
        const blades = 3;
        for (let b = 0; b < blades; b++) {
          const dir = b - 1; // -1, 0, +1
          const len = 7 + Math.abs(Math.sin(x * 0.21 + b)) * 4;
          const lean = dir * 3 + Math.sin(x * 0.4 + b) * 1.5;
          bgCtx.beginPath();
          bgCtx.moveTo(baseX + dir * 2, groundY);
          bgCtx.quadraticCurveTo(
            baseX + dir * 2 + lean * 0.5, groundY - len * 0.55,
            baseX + dir * 2 + lean,        groundY - len,
          );
          bgCtx.stroke();
        }
      }
      bgCtx.lineCap = "butt";

      // 5. Seismograph background — dark olive band
      bgCtx.fillStyle = "#1e2418";
      bgCtx.fillRect(0, z.seismoTop, viewW, z.seismoBot - z.seismoTop);
      // top hairline divider
      bgCtx.strokeStyle = "rgba(232, 226, 213, 0.18)";
      bgCtx.lineWidth = 1;
      bgCtx.beginPath();
      bgCtx.moveTo(0, z.seismoTop + 0.5);
      bgCtx.lineTo(viewW, z.seismoTop + 0.5);
      bgCtx.stroke();
      // baseline rule across the seismograph centre
      const seismoBaseY = z.seismoTop + (z.seismoBot - z.seismoTop) * 0.5;
      bgCtx.strokeStyle = "rgba(232, 226, 213, 0.10)";
      bgCtx.lineWidth = 1;
      bgCtx.beginPath();
      bgCtx.moveTo(0, seismoBaseY);
      bgCtx.lineTo(viewW, seismoBaseY);
      bgCtx.stroke();
    };

    // ── Plants seed (orchard) ──────────────────────────────────────
    // Build the orchard once. Kinds + positions + growth timing are
    // randomized but stable per-mount (we do NOT reseed on resize, so
    // plants persist their growth as the window changes).
    const seedPlants = () => {
      const now = performance.now();
      const flowerColors = ["#c43a3a", "#a23ac4", "#d8b800", "#e08020", "#e0d0e0"];
      // base layout — small orchard with grass tufts dispersed between
      const spec: Array<{ kind: PlantKind; x: number }> = [
        { kind: "tree",   x: 0.13 },
        { kind: "flower", x: 0.19 },
        { kind: "grass",  x: 0.24 },
        { kind: "tree",   x: 0.30 },
        { kind: "flower", x: 0.37 },
        { kind: "vine",   x: 0.43 },
        { kind: "grass",  x: 0.48 },
        { kind: "tree",   x: 0.55 },
        { kind: "flower", x: 0.62 },
        { kind: "grass",  x: 0.68 },
        { kind: "tree",   x: 0.74 },
        { kind: "vine",   x: 0.81 },
        { kind: "flower", x: 0.86 },
        { kind: "tree",   x: 0.91 },
      ];
      plantsRef.current = spec.map((s, i) => {
        const seed = i * 37 + 11;
        // Stagger growth start times so plants don't all bloom at once.
        const stagger = -Math.random() * 30000; // up to 30s into the past
        const p: Plant = {
          kind: s.kind,
          xFrac: s.x + (Math.random() - 0.5) * 0.018,
          seed,
          growthT0: now + stagger,
          growSpeedMul: 1,
          growSpeedT0: 0,
          growSpeedDur: 0,
          color: s.kind === "flower"
            ? flowerColors[i % flowerColors.length]
            : s.kind === "tree" ? "#2c4824" : "#3a5824",
          fruits: s.kind === "tree"
            ? Array.from({ length: 3 + Math.floor(Math.random() * 2) }).map(() => ({
                px: (Math.random() - 0.5) * 18,
                py: -10 + Math.random() * -14,
                picked: false,
                pickT0: 0,
                vy: 0,
                restPx: 0,
                restPy: 0,
              }))
            : [],
          fallAmt: 0,
          fallT0: 0,
          pulseT0: 0,
        };
        return p;
      });
    };

    // ── Resize ─────────────────────────────────────────────────────
    const resize = () => {
      const firstMount = viewW === 0;
      viewW = wrap.clientWidth;
      viewH = wrap.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fg.width  = Math.floor(viewW * dpr);
      fg.height = Math.floor(viewH * dpr);
      fgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderBg();
      // flatten roots once per resize
      const z = zone();
      const surfaceY = z.surfaceBot;
      rootsRef.current = ROOTS.map((r) => ({
        segs: flattenRoot(r, surfaceY, viewW),
        baseColor: "#1a1208",
      }));
      if (firstMount) seedPlants();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── Pointer / touch ────────────────────────────────────────────
    // hover ref to dedupe React state writes for stratum hover label
    const hoverStratumRef: { current: string | null } = { current: null };

    // Find which root index is closest to (x, y), or -1 if none in range.
    const pickRoot = (x: number, y: number): number => {
      const z = zone();
      if (y < z.surfaceBot - 4) return -1; // must be below surface
      const list = rootsRef.current;
      let best = -1;
      let bestD = 22; // px tolerance
      for (let i = 0; i < list.length; i++) {
        for (const seg of list[i].segs) {
          // distance from point to segment
          const dx = seg.x1 - seg.x0;
          const dy = seg.y1 - seg.y0;
          const len2 = dx * dx + dy * dy;
          let t = 0;
          if (len2 > 0) {
            t = ((x - seg.x0) * dx + (y - seg.y0) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
          }
          const px = seg.x0 + t * dx;
          const py = seg.y0 + t * dy;
          const d = Math.hypot(px - x, py - y);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
      return best;
    };

    const plantGrowth = (p: Plant, now: number): number => {
      const boostActive = now - p.growSpeedT0 < p.growSpeedDur;
      const speed = boostActive ? p.growSpeedMul : 1;
      return Math.max(0, Math.min(1, ((now - p.growthT0) * speed) / 4800));
    };

    const pickPlant = (x: number, y: number): number => {
      const z = zone();
      const groundY = z.surfaceBot;
      let best = -1;
      let bestD = 38;
      for (let i = 0; i < plantsRef.current.length; i++) {
        const p = plantsRef.current[i];
        const px = p.xFrac * viewW;
        const reach = p.kind === "tree" ? 118 : p.kind === "vine" ? 78 : 54;
        if (y < groundY - reach || y > groundY + 18) continue;
        const d = Math.hypot(px - x, Math.max(0, y - (groundY - reach * 0.45)));
        if (d < bestD) {
          best = i;
          bestD = d;
        }
      }
      return best;
    };

    const spawnDroplet = (x: number, y: number, count = 1) => {
      for (let i = 0; i < count; i++) {
        dropletsRef.current.push({
          x: x + (Math.random() - 0.5) * 22,
          y: y + Math.random() * 8,
          vy: 18 + Math.random() * 28,
          t0: performance.now(),
        });
      }
      if (dropletsRef.current.length > 34) {
        dropletsRef.current.splice(0, dropletsRef.current.length - 34);
      }
    };

    const drawPlant = (p: Plant, now: number, tSec: number) => {
      const z = zone();
      const groundY = z.surfaceBot;
      const x = p.xFrac * viewW;
      const g = plantGrowth(p, now);
      if (g <= 0.02) return;
      const pulseAge = p.pulseT0 ? (now - p.pulseT0) / 1000 : Infinity;
      const pulse = pulseAge < 1.1 ? Math.max(0, 1 - pulseAge / 1.1) : 0;
      const fallAge = p.fallT0 ? (now - p.fallT0) / 1000 : Infinity;
      const quakeLean = fallAge < 2.2
        ? p.fallAmt * Math.exp(-fallAge * 1.45) * Math.sin(fallAge * 13)
        : 0;
      const sway = (Math.sin(tSec * 0.9 + p.seed) * 1.6 + quakeLean * 9) * (reduce ? 0 : 1);
      const heightBase = p.kind === "tree" ? 92 : p.kind === "vine" ? 58 : p.kind === "flower" ? 46 : 28;
      const height = heightBase * g;

      fgCtx.save();
      fgCtx.translate(x, groundY);
      if (pulse > 0) {
        const aura = fgCtx.createRadialGradient(0, -height * 0.55, 0, 0, -height * 0.55, 42 + pulse * 18);
        aura.addColorStop(0, `rgba(255, 232, 154, ${0.28 * pulse})`);
        aura.addColorStop(1, "rgba(255, 232, 154, 0)");
        fgCtx.fillStyle = aura;
        fgCtx.beginPath();
        fgCtx.arc(0, -height * 0.55, 42 + pulse * 18, 0, Math.PI * 2);
        fgCtx.fill();
      }

      fgCtx.lineCap = "round";
      fgCtx.lineJoin = "round";
      if (p.kind === "tree") {
        fgCtx.strokeStyle = "#3a2514";
        fgCtx.lineWidth = 4.5 * Math.max(0.35, g);
        fgCtx.beginPath();
        fgCtx.moveTo(0, 0);
        fgCtx.quadraticCurveTo(sway * 0.5, -height * 0.48, sway, -height);
        fgCtx.stroke();
        fgCtx.lineWidth = 2.3;
        for (let i = -1; i <= 1; i++) {
          fgCtx.beginPath();
          fgCtx.moveTo(sway * 0.6, -height * (0.48 + i * 0.06));
          fgCtx.quadraticCurveTo(i * 13 + sway, -height * 0.72, i * 24 + sway, -height * 0.82);
          fgCtx.stroke();
        }
        const leafAlpha = 0.78 + pulse * 0.18;
        const canopy = [
          [-22, -height - 5, 23],
          [2 + sway, -height - 22, 28],
          [26, -height - 4, 22],
          [0, -height + 10, 26],
        ];
        for (const [cx, cy, r] of canopy) {
          fgCtx.fillStyle = `rgba(44, 72, 36, ${leafAlpha})`;
          fgCtx.beginPath();
          fgCtx.arc(cx + sway * 0.45, cy, r * Math.max(0.45, g), 0, Math.PI * 2);
          fgCtx.fill();
        }
        for (const fruit of p.fruits) {
          const ripe = g > 0.72;
          let fx = fruit.px + sway * 0.35;
          let fy = -height - 4 + fruit.py;
          if (fruit.picked) {
            const age = Math.min(1.4, (now - fruit.pickT0) / 1000);
            fx = fruit.restPx - x;
            fy = Math.min(-4, fruit.py + fruit.vy * age * 42 + age * age * 34);
          }
          fgCtx.fillStyle = ripe ? "rgba(206, 70, 42, 0.88)" : "rgba(142, 124, 52, 0.62)";
          fgCtx.beginPath();
          fgCtx.arc(fx, fy, ripe ? 3.4 : 2.2, 0, Math.PI * 2);
          fgCtx.fill();
        }
      } else if (p.kind === "flower") {
        fgCtx.strokeStyle = "#315622";
        fgCtx.lineWidth = 2;
        fgCtx.beginPath();
        fgCtx.moveTo(0, 0);
        fgCtx.quadraticCurveTo(sway * 0.6, -height * 0.5, sway, -height);
        fgCtx.stroke();
        fgCtx.fillStyle = "#426c2e";
        fgCtx.beginPath();
        fgCtx.ellipse(-6, -height * 0.42, 8, 3, -0.55, 0, Math.PI * 2);
        fgCtx.ellipse(7, -height * 0.56, 8, 3, 0.45, 0, Math.PI * 2);
        fgCtx.fill();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          fgCtx.fillStyle = p.color;
          fgCtx.beginPath();
          fgCtx.ellipse(sway + Math.cos(a) * 7, -height + Math.sin(a) * 7, 5, 2.8, a, 0, Math.PI * 2);
          fgCtx.fill();
        }
        fgCtx.fillStyle = "rgba(255, 224, 120, 0.9)";
        fgCtx.beginPath();
        fgCtx.arc(sway, -height, 3.2, 0, Math.PI * 2);
        fgCtx.fill();
      } else if (p.kind === "vine") {
        fgCtx.strokeStyle = "#315622";
        fgCtx.lineWidth = 2.2;
        fgCtx.beginPath();
        for (let i = 0; i <= 26; i++) {
          const u = i / 26;
          const yy = -height * u;
          const xx = Math.sin(u * Math.PI * 3 + p.seed) * 12 * g + sway * u;
          if (i === 0) fgCtx.moveTo(xx, yy);
          else fgCtx.lineTo(xx, yy);
        }
        fgCtx.stroke();
        fgCtx.fillStyle = "#456d30";
        for (let i = 2; i < 8; i++) {
          const u = i / 8;
          const yy = -height * u;
          const xx = Math.sin(u * Math.PI * 3 + p.seed) * 12 * g + sway * u;
          fgCtx.beginPath();
          fgCtx.ellipse(xx + (i % 2 ? 7 : -7), yy, 6, 3, i % 2 ? 0.5 : -0.5, 0, Math.PI * 2);
          fgCtx.fill();
        }
      } else {
        fgCtx.strokeStyle = "#3a5824";
        fgCtx.lineWidth = 1.5;
        for (let i = -2; i <= 2; i++) {
          fgCtx.beginPath();
          fgCtx.moveTo(i * 3, 0);
          fgCtx.quadraticCurveTo(i * 4 + sway * 0.2, -height * 0.55, i * 5 + sway, -height);
          fgCtx.stroke();
        }
      }
      fgCtx.restore();
    };

    const localXY = (e: PointerEvent): { x: number; y: number } => {
      const r = fg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      const { x, y } = localXY(e);
      const z = zone();

      // 1. Seismograph tap → big spike + thud + ripple tape
      if (y >= z.seismoTop) {
        const now = performance.now();
        quakeSpikeRef.current = { t0: now, strength: 1.0 };
        clickSpikesRef.current.push({ t0: now, strength: 1.4 });
        for (const p of plantsRef.current) {
          p.fallAmt = Math.sin(p.seed * 1.7) * 0.75;
          p.fallT0 = now;
        }
        getFieldAudio().thud();
        haptics.storm();
        markEarth("quake", "#f0c06a");
        useField.getState().recordTape("ripple", 1.0, "earth/quake");
        return;
      }

      // 2. Sky tap → send a little moisture down into the soil.
      if (y < z.surfaceTop) {
        spawnDroplet(x, y, 5);
        clickSpikesRef.current.push({ t0: performance.now(), strength: 0.25 });
        getFieldAudio().spark();
        haptics.ripple(0.35);
        markEarth("rain", "#9fc7d8");
        useField.getState().recordTape("ripple", 0.35, "earth/rain");
        return;
      }

      // 3. Surface tap → dust puff + chime
      if (y >= z.surfaceTop && y < z.surfaceBot + 4) {
        const plantIdx = pickPlant(x, y);
        if (plantIdx >= 0) {
          const now = performance.now();
          const p = plantsRef.current[plantIdx];
          p.pulseT0 = now;
          p.growSpeedMul = 2.2;
          p.growSpeedT0 = now;
          p.growSpeedDur = 2400;
          p.growthT0 = Math.min(p.growthT0, now - 2200);
          if (p.kind === "tree" && plantGrowth(p, now) > 0.72) {
            const fruit = p.fruits.find((f) => !f.picked);
            if (fruit) {
              fruit.picked = true;
              fruit.pickT0 = now;
              fruit.vy = 0.65 + Math.random() * 0.45;
              fruit.restPx = p.xFrac * viewW + fruit.px;
              fruit.restPy = z.surfaceBot - 4;
            }
          }
          spawnDroplet(x, z.surfaceTop, 4);
          clickSpikesRef.current.push({ t0: now, strength: 0.55 });
          getFieldAudio().bell();
          haptics.roll();
          markEarth(p.kind, p.color);
          useField.getState().recordTape("object", 0.55, `earth/${p.kind}`);
          return;
        }
        dustRef.current.push({ x, y: z.surfaceBot, t0: performance.now() });
        if (dustRef.current.length > 24) dustRef.current.shift();
        clickSpikesRef.current.push({ t0: performance.now(), strength: 0.4 });
        getFieldAudio().chime();
        haptics.ripple(0.45);
        markEarth("surface", "#b98952");
        useField.getState().recordTape("object", 0.4, "earth/surface");
        return;
      }

      // 4. Root pick?
      const rootIdx = pickRoot(x, y);
      if (rootIdx >= 0) {
        pulsedRootsRef.current.push({ idx: rootIdx, t0: performance.now() });
        clickSpikesRef.current.push({ t0: performance.now(), strength: 0.7 });
        getFieldAudio().thud();
        haptics.roll();
        markEarth("root", "#6d8f46");
        useField.getState().recordTape("object", 0.5, "earth/root");
        return;
      }

      // 5. Stratum click → highlight + named inscription + chime + region tape
      const s = stratumAt(y);
      if (s) {
        activeStratumRef.current = { id: s.id, t0: performance.now() };
        setActiveStratumId(s.id);
        // auto-clear the DOM inscription after the canvas highlight fades
        window.setTimeout(() => {
          // only clear if the same stratum is still the active one
          if (activeStratumRef.current?.id === s.id) {
            setActiveStratumId(null);
            activeStratumRef.current = null;
          }
        }, 2200);
        clickSpikesRef.current.push({ t0: performance.now(), strength: 0.55 });
        getFieldAudio().chime();
        haptics.ripple(0.6);
        markEarth(s.name, s.color);
        useField.getState().recordTape("region", 0.5, `earth/${s.id}`);
        // begin trench tracking if pointer moves vertically
        trenchRef.current = {
          y, startY: y, active: true, pointerId: e.pointerId,
        };
        try { fg.setPointerCapture(e.pointerId); } catch { /* noop */ }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const { x, y } = localXY(e);
      const now = performance.now();

      // velocity tracking for seismograph base
      const c = cursorRef.current;
      if (c.lastT > 0) {
        const dt = Math.max(1, now - c.lastT);
        const dx = x - c.x;
        const dy = y - c.y;
        const v = Math.hypot(dx, dy) / dt;     // px/ms
        // lerp smoothing
        c.vel = c.vel * 0.78 + v * 0.22;
      }
      c.x = x; c.y = y; c.lastT = now; c.over = true;

      // trench drag — record current y for compression effect
      if (trenchRef.current.active && e.pointerId === trenchRef.current.pointerId) {
        trenchRef.current.y = y;
      }

      // stratum hover label
      const s = stratumAt(y);
      const newHover = s ? s.id : null;
      if (newHover !== hoverStratumRef.current) {
        hoverStratumRef.current = newHover;
        setHoverStratum(newHover);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (trenchRef.current.active && e.pointerId === trenchRef.current.pointerId) {
        const fold = Math.abs(trenchRef.current.y - trenchRef.current.startY);
        if (fold > 18) {
          haptics.chop();
          markEarth("fold", "#8c5a32");
          useField.getState().recordTape("region", Math.min(0.8, fold / 160), "earth/fold");
        }
        trenchRef.current = { y: 0, startY: 0, active: false, pointerId: null };
        try { fg.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      }
    };

    const onPointerLeave = () => {
      cursorRef.current.over = false;
      if (hoverStratumRef.current !== null) {
        hoverStratumRef.current = null;
        setHoverStratum(null);
      }
    };

    fg.addEventListener("pointerdown",   onPointerDown);
    fg.addEventListener("pointermove",   onPointerMove);
    fg.addEventListener("pointerup",     onPointerUp);
    fg.addEventListener("pointercancel", onPointerUp);
    fg.addEventListener("pointerleave",  onPointerLeave);

    // ── Render loop ────────────────────────────────────────────────
    const t0 = performance.now();
    let raf = 0;

    // re-arm a UI tick to update the magnitude readout at ~10 Hz
    let lastReadoutMs = 0;

    const draw = (now: number) => {
      const tSec = (now - t0) / 1000;
      const z = zone();

      // clear foreground
      fgCtx.clearRect(0, 0, viewW, viewH);

      // ── 1. Trench effect (over strata) ─────────────────────────
      // While dragging vertically across strata, compress strata above
      // the cursor and draw a darker overlay to suggest displaced soil.
      if (trenchRef.current.active) {
        const ty = Math.max(z.strataTop, Math.min(z.strataBot, trenchRef.current.y));
        // gradient that darkens above the cursor — suggests compression
        const compressG = fgCtx.createLinearGradient(0, z.strataTop, 0, ty);
        compressG.addColorStop(0, "rgba(0, 0, 0, 0)");
        compressG.addColorStop(1, "rgba(0, 0, 0, 0.32)");
        fgCtx.fillStyle = compressG;
        fgCtx.fillRect(0, z.strataTop, viewW, ty - z.strataTop);
        // hairline at the cursor — the trench floor
        fgCtx.strokeStyle = "rgba(232, 226, 213, 0.36)";
        fgCtx.lineWidth = 1;
        fgCtx.beginPath();
        fgCtx.moveTo(0, ty);
        fgCtx.lineTo(viewW, ty);
        fgCtx.stroke();
      }

      // ── 2. Active stratum highlight ────────────────────────────
      if (activeStratumRef.current) {
        const age = (now - activeStratumRef.current.t0) / 1000;
        if (age > 2.2) {
          activeStratumRef.current = null;
        } else {
          const s = STRATA.find((x) => x.id === activeStratumRef.current!.id);
          if (s) {
            const y0 = z.strataTop + s.yFracTop * (z.strataBot - z.strataTop);
            const y1 = z.strataTop + s.yFracBot * (z.strataBot - z.strataTop);
            const a = Math.max(0, 1 - age / 2.2) * 0.34;
            fgCtx.fillStyle = `rgba(244, 230, 200, ${a})`;
            fgCtx.fillRect(0, y0, viewW, y1 - y0);
            // bright top + bottom hairline
            fgCtx.strokeStyle = `rgba(244, 230, 200, ${a + 0.2})`;
            fgCtx.lineWidth = 1;
            fgCtx.beginPath();
            fgCtx.moveTo(0, y0 + 0.5); fgCtx.lineTo(viewW, y0 + 0.5);
            fgCtx.moveTo(0, y1 - 0.5); fgCtx.lineTo(viewW, y1 - 0.5);
            fgCtx.stroke();
          }
        }
      }

      // ── 3. Moisture + dust + orchard touches ───────────────────
      if (!reduce && now - lastDropletSpawnRef.current > 1250) {
        lastDropletSpawnRef.current = now;
        spawnDroplet(Math.random() * viewW, z.surfaceTop + Math.random() * 8, 1);
      }
      for (let i = dropletsRef.current.length - 1; i >= 0; i--) {
        const d = dropletsRef.current[i];
        const age = (now - d.t0) / 1000;
        d.y += d.vy * 0.016;
        d.x += Math.sin(age * 2 + d.x * 0.02) * 0.12;
        if (d.y > z.strataBot || age > 8) {
          dropletsRef.current.splice(i, 1);
          continue;
        }
        const glow = fgCtx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 7);
        glow.addColorStop(0, "rgba(170, 220, 255, 0.56)");
        glow.addColorStop(1, "rgba(170, 220, 255, 0)");
        fgCtx.fillStyle = glow;
        fgCtx.beginPath();
        fgCtx.arc(d.x, d.y, 7, 0, Math.PI * 2);
        fgCtx.fill();
        fgCtx.fillStyle = "rgba(222, 244, 255, 0.72)";
        fgCtx.beginPath();
        fgCtx.arc(d.x, d.y, 1.7, 0, Math.PI * 2);
        fgCtx.fill();
      }

      for (let i = dustRef.current.length - 1; i >= 0; i--) {
        const d = dustRef.current[i];
        const age = (now - d.t0) / 1000;
        if (age > 1.2) { dustRef.current.splice(i, 1); continue; }
        const r0 = 6 + age * 24;
        const a = Math.max(0, 1 - age / 1.2) * 0.55;
        const g = fgCtx.createRadialGradient(d.x, d.y, 0, d.x, d.y, r0);
        g.addColorStop(0, `rgba(232, 216, 184, ${a})`);
        g.addColorStop(1, "rgba(232, 216, 184, 0)");
        fgCtx.fillStyle = g;
        fgCtx.beginPath();
        fgCtx.arc(d.x, d.y, r0, 0, Math.PI * 2);
        fgCtx.fill();
      }

      for (const p of plantsRef.current) {
        drawPlant(p, now, tSec);
      }

      // ── 4. Roots — branching, growing over 30s loop ────────────
      // growth phase 0..1 over 30s, then loops. Frozen in reduced-motion at full.
      const growth = reduce ? 1 : ((tSec / 30) % 1);
      for (let i = 0; i < rootsRef.current.length; i++) {
        const { segs, baseColor } = rootsRef.current[i];

        // pulse check
        let pulseAge = -1;
        for (let p = pulsedRootsRef.current.length - 1; p >= 0; p--) {
          const pr = pulsedRootsRef.current[p];
          const age = (now - pr.t0) / 1000;
          if (age > 1.6) { pulsedRootsRef.current.splice(p, 1); continue; }
          if (pr.idx === i) pulseAge = age;
        }
        const pulse = pulseAge >= 0 ? Math.max(0, 1 - pulseAge / 1.6) : 0;

        fgCtx.lineCap = "round";
        fgCtx.lineJoin = "round";
        for (const seg of segs) {
          if (growth < seg.arrive) {
            // partial draw: how far through this segment we are
            // we treat all segments with arrive ≤ growth as fully drawn;
            // any with arrive > growth are skipped except the boundary one
            // (we approximate by skipping — keeps render simple)
            continue;
          }
          // stroke color: base color (very dark) + pulse brightness
          const r = 0x1a + Math.round(pulse * 0xc0);
          const g = 0x12 + Math.round(pulse * 0xa8);
          const b = 0x08 + Math.round(pulse * 0x60);
          fgCtx.strokeStyle = pulse > 0
            ? `rgba(${r}, ${g}, ${b}, ${0.85 + pulse * 0.15})`
            : baseColor;
          fgCtx.lineWidth = seg.width * (1 + pulse * 0.7);
          fgCtx.beginPath();
          fgCtx.moveTo(seg.x0, seg.y0);
          fgCtx.lineTo(seg.x1, seg.y1);
          fgCtx.stroke();
        }
      }

      // ── 5. Seismograph trace ───────────────────────────────────
      // current magnitude: blend cursor velocity, recent click spikes, base noise
      const cur = cursorRef.current;
      // decay velocity smoothing
      cur.vel *= 0.92;
      // click spikes — decaying impulses
      let spike = 0;
      for (let i = clickSpikesRef.current.length - 1; i >= 0; i--) {
        const s = clickSpikesRef.current[i];
        const age = (now - s.t0) / 1000;
        if (age > 1.4) { clickSpikesRef.current.splice(i, 1); continue; }
        spike += s.strength * Math.exp(-age * 3.2);
      }
      // base micro-seismic noise (low amplitude jitter)
      const noise = (Math.random() - 0.5) * 0.06;
      // velocity scaled
      const velMag = Math.min(1.8, cur.vel * 0.9);
      // quake one-shot
      let quakeMag = 0;
      if (quakeSpikeRef.current) {
        const age = (now - quakeSpikeRef.current.t0) / 1000;
        if (age > 2.5) {
          quakeSpikeRef.current = null;
        } else {
          // big oscillating decay
          quakeMag = quakeSpikeRef.current.strength
                    * Math.exp(-age * 1.8)
                    * Math.cos(age * 26);
        }
      }
      const magnitude = velMag + spike + noise + quakeMag;

      // push into ring buffer
      const buf = seismoBufRef.current;
      const head = seismoHeadRef.current;
      buf[head] = magnitude;
      // advance head — UNLESS reduced motion (then we just overwrite the
      // same slot so the trace doesn't scroll)
      if (!reduce) {
        seismoHeadRef.current = (head + 1) % SEISMO_SAMPLES;
      }

      // Draw the trace — from oldest at left to newest at right.
      const seismoH = z.seismoBot - z.seismoTop;
      const baseY = z.seismoTop + seismoH * 0.5;
      const ampPx = seismoH * 0.34;

      fgCtx.strokeStyle = "#e8d8b8"; // cream
      fgCtx.lineWidth = 1.4;
      fgCtx.lineCap = "round";
      fgCtx.beginPath();
      // walk SEISMO_SAMPLES from oldest (head, since head is next to write) to newest (head-1)
      const oldest = seismoHeadRef.current; // index of the slot we'll next overwrite, which is the oldest sample
      for (let i = 0; i < SEISMO_SAMPLES; i++) {
        const idx = (oldest + i) % SEISMO_SAMPLES;
        const v = buf[idx];
        const x = (i / (SEISMO_SAMPLES - 1)) * viewW;
        // clamp magnitude visually to ±2.2 so big quakes don't blow past the band
        const clamped = Math.max(-2.2, Math.min(2.2, v));
        const y = baseY - clamped * (ampPx / 2.2);
        if (i === 0) fgCtx.moveTo(x, y);
        else fgCtx.lineTo(x, y);
      }
      fgCtx.stroke();

      // Update Fraunces magnitude readout at ~10 Hz
      if (now - lastReadoutMs > 100) {
        lastReadoutMs = now;
        // displayed magnitude 0..9 mapped from the absolute clamped magnitude
        const display = Math.min(9, Math.abs(magnitude) * 4.5);
        setMagReadout(display.toFixed(1));
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      fg.removeEventListener("pointerdown",   onPointerDown);
      fg.removeEventListener("pointermove",   onPointerMove);
      fg.removeEventListener("pointerup",     onPointerUp);
      fg.removeEventListener("pointercancel", onPointerUp);
      fg.removeEventListener("pointerleave",  onPointerLeave);
    };
  }, [markEarth]);

  // Inscription label for the active stratum (rendered as a DOM overlay so it
  // animates with CSS rather than per-frame canvas text).
  const inscription = (() => {
    if (!activeStratumId) return null;
    const s = STRATA.find((x) => x.id === activeStratumId);
    return s ? s.inscription : null;
  })();

  // Hover label for the cursor-hovered stratum
  const hoverLabel = (() => {
    if (!hoverStratum) return null;
    const s = STRATA.find((x) => x.id === hoverStratum);
    return s ? s.name : null;
  })();

  return (
    <div
      ref={wrapRef}
      data-touch-surface="true"
      aria-label="earth — click a stratum, tap the seismograph"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#1a1612",
        color: "rgba(232, 226, 213, 0.92)",
      }}
    >
      {/* pre-rendered strata + grass + seismograph background */}
      <canvas
        ref={bgRef}
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          display: "block",
        }}
      />
      {/* interactive foreground — roots, trace, effects */}
      <canvas
        ref={fgRef}
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          display: "block",
          touchAction: "none",
          cursor: "crosshair",
        }}
      />

      {/* ── Title block ─────────────────────────────────────────── */}
      <div
        className="earth-title"
        style={{
          position: "fixed",
          top: 80,
          left: "var(--pad-x)",
          color: "rgba(244, 238, 222, 0.95)",
          pointerEvents: "none",
          maxWidth: 560,
        }}
      >
        <div
          className="t-mono"
          style={{
            color: "rgba(244, 238, 222, 0.62)",
            marginBottom: 14,
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          EARTH / STRATA · SEISMOGRAPH
        </div>
        <WaterText
          as="h1"
          bobAmp={0}
          style={{
            display: "block",
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            fontSize: "clamp(48px, 7vw, 96px)",
            lineHeight: 1.0,
            letterSpacing: "-0.018em",
          }}
        >
          TERRA
        </WaterText>
        <WaterText
          as="div"
          bobAmp={2}
          style={{
            display: "block",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(18px, 2.2vw, 26px)",
            color: "rgba(244, 238, 222, 0.78)",
            marginTop: 6,
            letterSpacing: "0.002em",
          }}
        >
          the body of the world is also a wave
        </WaterText>
      </div>

      {/* ── Inscription (stratum name, fades out) ───────────────── */}
      {inscription && (
        <div
          className="t-mono"
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            color: "rgba(244, 230, 200, 0.96)",
            fontSize: 13,
            letterSpacing: "0.12em",
            textTransform: "lowercase",
            background: "rgba(20, 14, 8, 0.62)",
            padding: "6px 12px",
            border: "1px solid rgba(244, 230, 200, 0.24)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {inscription}
        </div>
      )}

      {/* ── Hover stratum label (cursor follow — only on fine pointer) ── */}
      {hoverLabel && (
        <div
          className="t-mono oda-earth-hover"
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            color: "rgba(244, 238, 222, 0.82)",
            fontSize: 11,
            letterSpacing: "0.10em",
            textTransform: "lowercase",
            pointerEvents: "none",
          }}
        >
          {hoverLabel}
        </div>
      )}

      <div
        className="earth-memory"
        data-earth-memory="true"
        aria-live="polite"
        style={{
          position: "fixed",
          left: 18,
          bottom: "calc(112px + env(safe-area-inset-bottom, 0px))",
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
          maxWidth: "min(480px, calc(100vw - 150px))",
          padding: "8px 10px",
          border: "1px solid rgba(232, 226, 213, 0.16)",
          borderRadius: 6,
          background: "rgba(20, 14, 8, 0.52)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          color: "rgba(232, 226, 213, 0.68)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 0,
          textTransform: "lowercase",
          pointerEvents: "none",
        }}
      >
        {earthMarks.map((mark, index) => (
          <span
            key={`${mark.label}-${mark.t}-${index}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              minWidth: 0,
              opacity: index === 0 ? 1 : 0.48,
              whiteSpace: "nowrap",
            }}
          >
            <i
              aria-hidden="true"
              style={{
                width: index === 0 ? 24 : 10,
                height: 2,
                flex: "0 0 auto",
                background: mark.tone,
                boxShadow: index === 0 ? `0 0 14px ${mark.tone}` : undefined,
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{mark.label}</span>
          </span>
        ))}
      </div>

      {/* ── Seismograph magnitude readout ────────────────────────── */}
      <div
        className="earth-magnitude"
        style={{
          position: "fixed",
          right: "calc(260px + env(safe-area-inset-right, 0px))",
          bottom: "calc(112px + env(safe-area-inset-bottom, 0px))",
          color: "rgba(232, 216, 184, 0.95)",
          pointerEvents: "none",
          textAlign: "right",
        }}
      >
        <div
          className="t-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            opacity: 0.6,
            marginBottom: 2,
          }}
        >
          magnitude
        </div>
        <div
          className="earth-magnitude-value"
          style={{
            fontFamily: "var(--font-fraunces, var(--font-serif))",
            fontWeight: 500,
            fontSize: 28,
            lineHeight: 1,
            fontFeatureSettings: '"tnum"',
          }}
        >
          {magReadout}
        </div>
      </div>

      {/* coarse pointers: hide hover label (touch can't hover) */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (hover: none), (pointer: coarse) {
              .oda-earth-hover { display: none !important; }
            }
            @media (max-width: 720px) {
              .earth-title {
                top: 72px !important;
                left: 16px !important;
                right: 16px !important;
                max-width: calc(100vw - 32px) !important;
              }
              .earth-title h1 {
                font-size: clamp(42px, 17vw, 64px) !important;
              }
              .earth-memory {
                left: 12px !important;
                bottom: calc(106px + env(safe-area-inset-bottom, 0px)) !important;
                max-width: calc(100vw - 116px) !important;
                gap: 6px !important;
                padding: 7px 8px !important;
              }
              .earth-memory span:nth-child(n+4) {
                display: none !important;
              }
              .earth-magnitude {
                right: 12px !important;
                bottom: calc(105px + env(safe-area-inset-bottom, 0px)) !important;
              }
              .earth-magnitude-value {
                font-size: 23px !important;
              }
            }
          `,
        }}
      />
    </div>
  );
}
