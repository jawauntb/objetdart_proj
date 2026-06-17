"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useField } from "@/store/field";
import { REGIONS, OBJECTS, ARCHIVE, GLYPHS, CONCERNS } from "@/data/content";
import { entrySlug } from "@/lib/slug";
import { getFieldAudio } from "@/lib/audio";
import { buildRegionReading } from "@/lib/reading";
import { sigilPolygonPoints, polygonLeftEdgeAt, type ObstacleShape } from "@/lib/sigil-shape";
import ConcernSigil from "@/components/ConcernSigil";
import ShapedProse from "@/components/ShapedProse";
import WaterText from "@/components/WaterText";
import type { ConcernKey } from "@/lib/types";

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function regionWeights(regionConcerns: ConcernKey[], userConcerns: Record<ConcernKey, number>): Record<ConcernKey, number> {
  const m = Object.fromEntries(CONCERNS.map((c) => [c.id, 30])) as Record<ConcernKey, number>;
  regionConcerns.forEach((c) => { m[c] = Math.max(70, userConcerns[c] ?? 50); });
  return m;
}

// Map of region → boundary path + label anchor + decoration drawer.
// Hand-authored. ViewBox 1600 × 1000 (16:10).
type Decor = (cx: number, cy: number) => React.ReactNode;
type R = { id: string; label: string; d: string; cx: number; cy: number; lx: number; ly: number; decor: Decor };

const REGIONS_MAP: R[] = [
  {
    id: "origin", label: "Origin Coast",
    d: "M 70,130 Q 60,80 120,72 L 280,80 Q 372,90 376,180 L 372,278 Q 358,308 290,300 Q 222,308 165,295 Q 92,302 82,250 Z",
    cx: 225, cy: 190, lx: 100, ly: 340,
    decor: (cx, cy) => (
      <g stroke="var(--ink-2)" strokeWidth={1.4} fill="none" opacity={0.85}>
        <path d={`M ${cx - 70},${cy + 0} Q ${cx - 35},${cy - 14} ${cx},${cy} T ${cx + 70},${cy}`} />
        <path d={`M ${cx - 70},${cy + 20} Q ${cx - 35},${cy + 6} ${cx},${cy + 20} T ${cx + 70},${cy + 20}`} />
        <path d={`M ${cx - 60},${cy + 40} Q ${cx - 30},${cy + 26} ${cx},${cy + 40} T ${cx + 60},${cy + 40}`} />
      </g>
    ),
  },
  {
    id: "road", label: "Road Current",
    d: "M 60,400 Q 55,360 95,358 L 320,380 Q 355,408 348,470 L 340,548 Q 320,580 240,572 Q 145,584 90,560 Q 50,540 55,490 Z",
    cx: 200, cy: 475, lx: 90, ly: 600,
    decor: (cx, cy) => (
      <g stroke="var(--ink-2)" strokeWidth={1.4} fill="none" strokeDasharray="6 6" opacity={0.85}>
        <path d={`M ${cx - 90},${cy + 35} Q ${cx - 40},${cy} ${cx + 10},${cy - 5} Q ${cx + 70},${cy - 20} ${cx + 110},${cy - 50}`} />
      </g>
    ),
  },
  {
    id: "ascent", label: "Ascent Plateau",
    d: "M 440,110 Q 460,80 530,82 L 820,98 Q 880,120 882,200 L 872,310 Q 850,350 760,344 Q 660,358 560,346 Q 470,358 450,300 Z",
    cx: 660, cy: 220, lx: 500, ly: 380,
    decor: (cx, cy) => (
      <g stroke="var(--ink-2)" strokeWidth={1.2} fill="none" opacity={0.85}>
        <ellipse cx={cx} cy={cy} rx={92} ry={42} />
        <ellipse cx={cx} cy={cy} rx={64} ry={30} />
        <ellipse cx={cx} cy={cy} rx={36} ry={18} />
        <circle cx={cx} cy={cy} r={3} fill="var(--ink-2)" />
      </g>
    ),
  },
  {
    id: "workbench", label: "Workbench Harbor",
    d: "M 680,440 Q 690,418 750,418 L 980,432 Q 1020,450 1018,520 L 1010,610 Q 994,640 920,634 Q 850,648 770,632 Q 700,648 686,592 Z",
    cx: 850, cy: 528, lx: 740, ly: 690,
    decor: (cx, cy) => (
      <g stroke="var(--ink-2)" strokeWidth={1.2} fill="none" opacity={0.85}>
        <rect x={cx - 60} y={cy - 28} width={120} height={56} />
        <line x1={cx - 60} y1={cy} x2={cx + 60} y2={cy} />
        <line x1={cx - 30} y1={cy - 28} x2={cx - 30} y2={cy + 28} />
        <line x1={cx} y1={cy - 28} x2={cx} y2={cy + 28} />
        <line x1={cx + 30} y1={cy - 28} x2={cx + 30} y2={cy + 28} />
        <line x1={cx} y1={cy + 28} x2={cx} y2={cy + 50} strokeWidth={2} />
      </g>
    ),
  },
  {
    id: "crash", label: "Crash Basin",
    d: "M 400,720 Q 410,690 470,690 L 660,706 Q 712,724 710,790 L 700,890 Q 680,924 590,920 Q 510,932 446,918 Q 390,924 380,860 Z",
    cx: 548, cy: 810, lx: 410, ly: 968,
    decor: (cx, cy) => (
      <g stroke="var(--ink-2)" fill="none" opacity={0.85} strokeWidth={1.2}>
        <circle cx={cx} cy={cy} r={56} />
        <circle cx={cx} cy={cy} r={36} />
        <circle cx={cx} cy={cy} r={16} />
        <line x1={cx} y1={cy - 70} x2={cx + 6} y2={cy - 56} />
        <line x1={cx + 60} y1={cy - 20} x2={cx + 76} y2={cy - 8} />
      </g>
    ),
  },
  {
    id: "loves", label: "House of Loves",
    d: "M 1120,680 Q 1130,652 1190,648 L 1400,664 Q 1456,684 1454,748 L 1448,832 Q 1432,872 1340,866 Q 1252,880 1180,868 Q 1108,876 1100,824 Z",
    cx: 1278, cy: 762, lx: 1140, ly: 924,
    decor: (cx, cy) => (
      <g fill="var(--ink-2)" opacity={0.9}>
        {[
          [-50, -20], [-12, -38], [40, -10], [60, 32], [12, 24], [-32, 18], [-58, -2],
        ].map(([dx, dy], i) => (
          <circle key={i} cx={cx + dx} cy={cy + dy} r={2.4} />
        ))}
        <g stroke="var(--ink-2)" strokeWidth={1} opacity={0.55}>
          <line x1={cx - 50} y1={cy - 20} x2={cx - 12} y2={cy - 38} />
          <line x1={cx - 12} y1={cy - 38} x2={cx + 40} y2={cy - 10} />
          <line x1={cx + 40} y1={cy - 10} x2={cx + 60} y2={cy + 32} />
        </g>
      </g>
    ),
  },
  {
    id: "spirit", label: "Spirit Interior",
    d: "M 1130,108 Q 1140,82 1200,80 L 1430,96 Q 1480,116 1480,180 L 1474,278 Q 1456,310 1370,304 Q 1280,316 1200,304 Q 1130,310 1120,250 Z",
    cx: 1300, cy: 200, lx: 1140, ly: 352,
    decor: (cx, cy) => (
      <g stroke="var(--ink-2)" strokeWidth={1.2} opacity={0.85}>
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={i} x1={cx - 60 + i * 16} y1={cy - 36} x2={cx - 60 + i * 16} y2={cy + 36} />
        ))}
      </g>
    ),
  },
  {
    id: "archive", label: "Archive Estuary",
    d: "M 1030,400 Q 1042,378 1100,376 L 1300,388 Q 1340,408 1338,464 L 1330,558 Q 1314,590 1248,584 Q 1170,594 1110,584 Q 1042,592 1030,540 Z",
    cx: 1180, cy: 482, lx: 1050, ly: 632,
    decor: (cx, cy) => (
      <g stroke="var(--ink-2)" strokeWidth={1.2} fill="none" opacity={0.85}>
        <line x1={cx - 80} y1={cy + 20} x2={cx + 80} y2={cy + 20} />
        <line x1={cx - 60} y1={cy + 20} x2={cx - 70} y2={cy - 18} />
        <line x1={cx - 28} y1={cy + 20} x2={cx - 18} y2={cy - 18} />
        <line x1={cx + 12} y1={cy + 20} x2={cx + 22} y2={cy - 18} />
        <line x1={cx + 48} y1={cy + 20} x2={cx + 56} y2={cy - 18} />
      </g>
    ),
  },
  {
    id: "horizon", label: "Future Horizon",
    d: "M 1330,520 Q 1340,496 1400,494 L 1540,500 Q 1576,510 1576,560 L 1572,710 Q 1556,742 1500,738 Q 1430,748 1380,738 Q 1330,742 1322,690 Z",
    cx: 1450, cy: 622, lx: 1340, ly: 808,
    decor: (cx, cy) => (
      <g stroke="var(--ink-2)" strokeWidth={1.2} opacity={0.85}>
        <line x1={cx - 100} y1={cy} x2={cx + 100} y2={cy} />
        <line x1={cx - 80} y1={cy - 16} x2={cx + 80} y2={cy - 16} opacity={0.55} />
        <line x1={cx - 60} y1={cy + 16} x2={cx + 60} y2={cy + 16} opacity={0.55} />
      </g>
    ),
  },
];

function triggerRegionTone(regionId: string): void {
  const a = getFieldAudio();
  switch (regionId) {
    case "origin":    a.chime();  break;
    case "road":      a.thud();   break;
    case "ascent":    a.bell();   break;
    case "workbench": a.chime();  break;
    case "crash":     a.refuse(); break;
    case "loves":     a.bell();   break;
    case "spirit":    a.bell();   break;
    case "archive":   a.thud();   break;
    case "horizon":   a.chime();  break;
    default:          a.chime();  break;
  }
}

function Drawer({
  regionId,
  onClose,
}: {
  regionId: string;
  onClose: () => void;
}) {
  const region = REGIONS.find((r) => r.id === regionId);
  const carried = useField((s) => s.carriedObject);
  const concerns = useField((s) => s.concerns);
  const pulseRegions = useField((s) => s.pulseRegions);

  const proseWrapRef = useRef<HTMLDivElement>(null);
  const proseWidth = useElementWidth(proseWrapRef);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ startY: number; startX: number; pointerId: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
    };
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus({ preventScroll: true });
    return () => {
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  const sigilSize = Math.min(120, Math.max(80, proseWidth * 0.28));
  const polygonPoints = sigilPolygonPoints(
    regionWeights(region?.concerns ?? [], concerns),
    sigilSize,
  );
  const sigilLeftInWrap = Math.max(0, proseWidth - sigilSize);

  const obstacle: ObstacleShape | undefined = proseWidth > 240
    ? {
        top: 0,
        height: sigilSize,
        side: "right",
        edgeAt: (y) => {
          const yLocal = y - 0;
          const xLocal = polygonLeftEdgeAt(polygonPoints, yLocal);
          return xLocal === null ? null : sigilLeftInWrap + xLocal;
        },
        padding: 14,
      }
    : undefined;

  if (!region) return null;

  const reading = buildRegionReading(region.id, concerns, carried);

  const relatedArchive = ARCHIVE.filter(
    (a) => a.region === region.id || a.concerns.some((c) => region.concerns.includes(c)),
  ).slice(0, 3);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (typeof window === "undefined") return;
    if (window.innerWidth > 720) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.clientY - rect.top > 80) return;
    dragRef.current = { startY: e.clientY, startX: e.clientX, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dy = e.clientY - d.startY;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12) {
      dragRef.current = null;
      setDragOffset(0);
      return;
    }
    setDragOffset(Math.max(0, dy));
  };

  const endDrag = (commit: boolean) => {
    const offset = dragOffset;
    dragRef.current = null;
    setDragOffset(0);
    if (commit && offset > 80) onClose();
  };

  const onPointerUp = () => endDrag(true);
  const onPointerCancel = () => endDrag(false);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          top: 56,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.20)",
          zIndex: 29,
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={region.label}
        className="atlas-drawer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          position: "fixed",
          top: 56,
          right: 0,
          bottom: 0,
          width: "min(44vw, 520px)",
          background: "var(--paper-2)",
          borderLeft: "1px solid var(--rule)",
          padding: "var(--pad-x)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          paddingBottom: "calc(var(--pad-x) + 56px)",
          zIndex: 40,
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: dragOffset > 0 || reduceMotion ? "none" : "transform 220ms cubic-bezier(.2,.6,.2,1)",
          touchAction: "pan-y",
        }}
      >
      <style>{`
        @media (max-width: 720px) {
          .atlas-drawer {
            top: auto !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            max-height: min(82dvh, calc(100dvh - 88px));
            border-left: 0 !important;
            border-top: 1px solid var(--rule);
            border-radius: 8px 8px 0 0;
            padding-bottom: calc(var(--pad-x) + env(safe-area-inset-bottom, 0px) + 20px) !important;
          }
          .atlas-drawer .atlas-drawer__handle { display: block !important; }
        }
      `}</style>
      <div
        aria-hidden="true"
        className="atlas-drawer__handle"
        style={{
          display: "none",
          width: 44,
          height: 4,
          borderRadius: 2,
          background: "var(--rule)",
          margin: "0 auto 12px",
          opacity: 0.7,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label="concerns for this region">
          {region.concerns.map((c) => (
            <button
              key={c}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const ids = REGIONS.filter((r) => r.concerns.includes(c)).map((r) => r.id);
                if (ids.length) pulseRegions(ids);
                getFieldAudio().chime();
              }}
              className="t-eyebrow"
              style={{
                background: "transparent",
                border: "1px solid var(--rule)",
                padding: "4px 8px",
                cursor: "pointer",
                color: "var(--ink-2)",
                borderRadius: 3,
                fontFamily: "inherit",
                minHeight: 28,
              }}
              aria-label={`pulse ${c} regions`}
              title={`pulse ${c} regions on the compass`}
            >
              {c.toLowerCase()}
            </button>
          ))}
        </div>
        <button
          ref={closeBtnRef}
          onClick={onClose}
          aria-label="close"
          style={{
            background: "none",
            border: "1px solid var(--rule)",
            padding: "10px 14px",
            margin: "-10px -10px -10px 0",
            minHeight: 44,
            minWidth: 44,
            cursor: "pointer",
            fontFamily: "var(--font-text)",
            fontSize: 13,
            letterSpacing: "0.06em",
            textTransform: "lowercase",
            color: "var(--ink)",
            borderRadius: 4,
          }}
        >
          close ×
        </button>
      </div>

      <h3 className="t-h2 italic" style={{ marginTop: 12, marginBottom: 18, maxWidth: "22ch" }}>
        {reading.headline}
      </h3>

      <div ref={proseWrapRef} style={{ position: "relative", marginTop: 8 }}>
        {proseWidth > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: sigilLeftInWrap,
              top: 0,
              width: sigilSize,
              height: sigilSize,
              pointerEvents: "none",
            }}
          >
            <ConcernSigil
              concerns={regionWeights(region.concerns, concerns)}
              size={sigilSize}
              showAxes
              showDots={false}
            />
          </div>
        )}
        {proseWidth > 0 && (
          <ShapedProse
            text={reading.paragraphs}
            lineHeight={28}
            width={proseWidth}
            obstacle={obstacle}
            paragraphGap={16}
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              color: "var(--ink)",
            }}
          />
        )}
      </div>

      {relatedArchive.length > 0 && (
        <div className="rule" style={{ marginTop: 32, paddingTop: 20 }}>
          <div className="t-eyebrow">drawers nearby</div>
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {relatedArchive.map((a) => (
              <li key={a.id} style={{ marginBottom: 10 }}>
                <Link
                  href={`/archive/${entrySlug(a)}`}
                  style={{ borderBottom: "1px solid var(--candle)", color: "var(--ink)" }}
                  className="t-body"
                >
                  {a.title}
                </Link>
                <div className="t-meta" style={{ color: "var(--ink-2)" }}>{a.year} · {a.medium} · {a.status ?? ""}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </>
  );
}

// ── Water creatures spawned on empty water taps ──
type WaterCreature = {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  age: number;
  kind: "fish" | "wave";
  bobPhase: number;
};

// Adjacency for the current curves.
const CURRENT_LINKS: Array<[string, string]> = [
  ["origin", "road"],
  ["origin", "ascent"],
  ["ascent", "workbench"],
  ["workbench", "archive"],
  ["road", "crash"],
  ["crash", "workbench"],
  ["spirit", "archive"],
  ["archive", "horizon"],
  ["horizon", "loves"],
  ["loves", "workbench"],
  ["spirit", "ascent"],
];

type RegionRuntime = {
  driftX: number; driftY: number;
  dragX: number;  dragY: number;
  velX: number;   velY: number;
  hoverElev: number;
};

export default function Atlas() {
  const pathname = usePathname() ?? "";
  const isRegionRoute = pathname.startsWith("/atlas/");
  const region = useField((s) => s.region);
  const setRegion = useField((s) => s.setRegion);
  const carried = useField((s) => s.carriedObject);
  const setCarried = useField((s) => s.setCarried);
  const haloRegions = useField((s) => s.haloRegions);
  const recordTape = useField((s) => s.recordTape);
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, [haloRegions]);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [sigilPings, setSigilPings] = useState<Record<string, number>>({});
  const [exhaleId, setExhaleId] = useState<string | null>(null);
  const [drawerRegion, setDrawerRegion] = useState<string | null>(null);
  const lastAutoDrawerRegionRef = useRef<string | null>(null);
  const selectedRegion = region ? REGIONS.find((r) => r.id === region) ?? null : null;

  useEffect(() => {
    if (!region) {
      setDrawerRegion(null);
      lastAutoDrawerRegionRef.current = null;
      return;
    }
    if (isRegionRoute && lastAutoDrawerRegionRef.current !== region) {
      setDrawerRegion(region);
      lastAutoDrawerRegionRef.current = region;
    }
  }, [isRegionRoute, region]);

  const openRegionDrawer = (id: string | null = region) => {
    if (!id) return;
    setDrawerRegion(id);
    getFieldAudio().chime();
  };

  // zoom-to-region animation state.
  const [zoomTarget, setZoomTarget] = useState<string | null>(null);
  const [zoomT, setZoomT] = useState(0);

  // compass rose rotation in degrees.
  const [compassRot, setCompassRot] = useState(0);
  const compassDragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);

  // per-region runtime: drift + drag + springy velocity.
  const runtimeRef = useRef<Record<string, RegionRuntime>>({});
  if (Object.keys(runtimeRef.current).length === 0) {
    for (const r of REGIONS_MAP) {
      runtimeRef.current[r.id] = {
        driftX: 0, driftY: 0,
        dragX: 0, dragY: 0,
        velX: 0, velY: 0,
        hoverElev: 0,
      };
    }
  }

  // ticker for drift, springs, water creatures, zoom transition.
  const tFreezeRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const [, setAnimTick] = useState(0);
  useEffect(() => {
    reduceMotionRef.current = typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let lastT = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      if (!reduceMotionRef.current) tFreezeRef.current += dt;
      const rt = runtimeRef.current;
      for (const id in rt) {
        const r = rt[id];
        const seed = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
        const targetDX = Math.sin(tFreezeRef.current * 0.20 + seed) * 5;
        const targetDY = Math.cos(tFreezeRef.current * 0.16 + seed * 1.3) * 4;
        r.driftX += (targetDX - r.driftX) * 0.04;
        r.driftY += (targetDY - r.driftY) * 0.04;
        const k = 14;
        const damp = 6;
        const ax = -k * r.dragX - damp * r.velX;
        const ay = -k * r.dragY - damp * r.velY;
        r.velX += ax * dt;
        r.velY += ay * dt;
        r.dragX += r.velX * dt;
        r.dragY += r.velY * dt;
        const targetElev = hoverId === id ? 1 : 0;
        r.hoverElev += (targetElev - r.hoverElev) * 0.18;
      }
      const next: WaterCreature[] = [];
      for (const fc of waterCreaturesRef.current) {
        fc.age += dt;
        fc.x += fc.vx * dt;
        fc.y += fc.vy * dt;
        fc.bobPhase += dt * 4;
        if (fc.age < 4) next.push(fc);
      }
      waterCreaturesRef.current = next;
      if (zoomTarget && zoomT < 1) {
        const nextT = Math.min(1, zoomT + dt / 0.55);
        setZoomT(nextT);
        if (nextT >= 1) {
          setRegion(zoomTarget);
          setZoomTarget(null);
          setZoomT(0);
        }
      }
      setAnimTick((k) => (k + 1) % 100000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hoverId, zoomTarget, zoomT, setRegion]);

  const waterCreaturesRef = useRef<WaterCreature[]>([]);
  const creatureIdRef = useRef(0);

  const pressRef = useRef<{
    regionId: string;
    pointerId: number;
    timer: number | null;
    startX: number;
    startY: number;
    fired: boolean;
  } | null>(null);

  const hoverClearTimer = useRef<number | null>(null);
  const enterHover = (id: string) => {
    if (hoverClearTimer.current !== null) {
      window.clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
    setHoverId(id);
  };
  const leaveHover = (id: string) => {
    if (hoverClearTimer.current !== null) {
      window.clearTimeout(hoverClearTimer.current);
    }
    hoverClearTimer.current = window.setTimeout(() => {
      hoverClearTimer.current = null;
      setHoverId((cur) => (cur === id ? null : cur));
    }, 30);
  };

  const suppressClickRef = useRef(false);

  const clearPressTimer = () => {
    const p = pressRef.current;
    if (p && p.timer !== null) {
      window.clearTimeout(p.timer);
      p.timer = null;
    }
  };

  const endExhale = (regionId: string) => {
    setExhaleId((cur) => (cur === regionId ? null : cur));
    const data = REGIONS.find((rr) => rr.id === regionId);
    const concernId = data?.concerns?.[0];
    if (concernId) {
      try { getFieldAudio().releaseConcernTone(concernId); } catch { /* noop */ }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawerRegion) {
        setDrawerRegion(null);
        return;
      }
      setRegion(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerRegion, setRegion]);

  useEffect(() => {
    return () => {
      try { getFieldAudio().releaseAllConcernTones(); } catch { /* noop */ }
    };
  }, []);

  // region drag tracking
  const regionDragRef = useRef<{
    regionId: string;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastT: number;
    isDragging: boolean;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const clientToSvg = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 1600;
    const y = ((clientY - rect.top) / rect.height) * 1000;
    return { x, y };
  };

  const spawnWaterCreature = (svgX: number, svgY: number) => {
    if (reduceMotionRef.current) return;
    const id = ++creatureIdRef.current;
    const kind: "fish" | "wave" = Math.random() < 0.45 ? "fish" : "wave";
    waterCreaturesRef.current.push({
      id,
      x: svgX,
      y: svgY,
      vx: (Math.random() - 0.5) * 60,
      vy: kind === "fish" ? (Math.random() - 0.3) * 8 : 0,
      age: 0,
      kind,
      bobPhase: Math.random() * 7,
    });
    if (waterCreaturesRef.current.length > 16) waterCreaturesRef.current.shift();
  };

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    if (target.closest("[data-region]")) return;
    const pos = clientToSvg(e.clientX, e.clientY);
    if (!pos) return;
    spawnWaterCreature(pos.x, pos.y);
    getFieldAudio().chime();
    compassDragRef.current = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  };
  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const cd = compassDragRef.current;
    if (!cd || e.pointerId !== cd.pointerId) return;
    const dx = e.clientX - cd.lastX;
    setCompassRot((r) => r + dx * 0.5);
    cd.lastX = e.clientX;
    cd.lastY = e.clientY;
  };
  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (compassDragRef.current?.pointerId === e.pointerId) {
      compassDragRef.current = null;
    }
  };

  const beginZoomTo = (regionId: string) => {
    setZoomTarget(regionId);
    setZoomT(0);
    triggerRegionTone(regionId);
    setSigilPings((m) => ({ ...m, [regionId]: Date.now() }));
    setNow(Date.now());
    recordTape("object", 0.5, regionId);
  };

  const viewBoxAttr = (() => {
    if (!zoomTarget) return "0 0 1600 1000";
    const tgt = REGIONS_MAP.find((r) => r.id === zoomTarget);
    if (!tgt) return "0 0 1600 1000";
    const e = 1 - Math.pow(1 - zoomT, 3);
    const cx0 = 800, cy0 = 500, w0 = 1600, h0 = 1000;
    const cxT = tgt.cx, cyT = tgt.cy;
    const wT = 600, hT = 375;
    const cx = cx0 + (cxT - cx0) * e;
    const cy = cy0 + (cyT - cy0) * e;
    const w = w0 + (wT - w0) * e;
    const h = h0 + (hT - h0) * e;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  })();

  return (
    <section id="atlas" className="rule" data-touch-surface="true" style={{ scrollMarginTop: 72 }}>
      <div className="wrap">
        <div className="t-eyebrow">atlas · the territories</div>
        <WaterText
          as="h2"
          bobAmp={0}
          className="t-h2 italic"
          style={{ display: "block", marginTop: 12, marginBottom: 24 }}
        >
          a room you tune, an atlas you cross
        </WaterText>

        <div className="atlas-map" style={{ width: "100%", maxWidth: 1100, margin: "0 auto", position: "relative" }}>
          <div
            className="atlas-map__cue t-eyebrow"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 14,
              left: 16,
              zIndex: 2,
              color: "rgba(21, 23, 26, 0.58)",
              pointerEvents: "none",
            }}
          >
            tap a coast · drag empty water
          </div>
          <svg
            ref={svgRef}
            viewBox={viewBoxAttr}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Atlas of nine territories"
            onPointerDown={onSvgPointerDown}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerCancel={onSvgPointerUp}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              background:
                "radial-gradient(ellipse at 30% 20%, rgba(232, 200, 130, 0.18), transparent 60%), " +
                "radial-gradient(ellipse at 75% 70%, rgba(220, 180, 110, 0.14), transparent 65%), " +
                "linear-gradient(180deg, rgba(244, 224, 178, 0.32), rgba(238, 214, 168, 0.18))",
              borderRadius: 8,
              cursor: zoomTarget ? "wait" : "grab",
              touchAction: "pan-y",
              WebkitUserSelect: "none",
              userSelect: "none",
              WebkitTouchCallout: "none",
            }}
          >
            <rect x="20" y="20" width="1560" height="960" fill="none" stroke="var(--rule)" strokeWidth={1} />

            {/* parchment grain */}
            <g opacity={0.10} fill="var(--ink-2)" pointerEvents="none">
              {Array.from({ length: 60 }).map((_, i) => {
                const x = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 1600;
                const y = (((Math.sin(i * 78.233) * 43758.5453) % 1) + 1) % 1 * 1000;
                return <circle key={i} cx={x} cy={y} r={0.8} />;
              })}
            </g>

            {/* current flow lines between regions */}
            <g pointerEvents="none">
              {CURRENT_LINKS.map(([a, b], i) => {
                const A = REGIONS_MAP.find((r) => r.id === a);
                const B = REGIONS_MAP.find((r) => r.id === b);
                if (!A || !B) return null;
                const rtA = runtimeRef.current[a];
                const rtB = runtimeRef.current[b];
                const ax = A.cx + rtA.driftX + rtA.dragX;
                const ay = A.cy + rtA.driftY + rtA.dragY;
                const bx = B.cx + rtB.driftX + rtB.dragX;
                const by = B.cy + rtB.driftY + rtB.dragY;
                const mx = (ax + bx) / 2;
                const my = (ay + by) / 2;
                const dx = bx - ax;
                const dy = by - ay;
                const len = Math.hypot(dx, dy) || 1;
                const px = -dy / len;
                const py = dx / len;
                const wob = Math.sin(tFreezeRef.current * 0.45 + i * 1.7) * 30;
                const cx1 = mx + px * (40 + wob);
                const cy1 = my + py * (40 + wob);
                const path = `M ${ax},${ay} Q ${cx1},${cy1} ${bx},${by}`;
                return (
                  <g key={`${a}-${b}`}>
                    <path
                      d={path}
                      fill="none"
                      stroke="var(--ink-2)"
                      strokeWidth={1}
                      strokeDasharray="2 8"
                      opacity={0.30}
                    />
                    <circle r={1.6} fill="var(--candle)" opacity={0.6}>
                      <animateMotion
                        dur={`${10 + (i % 4) * 2}s`}
                        repeatCount="indefinite"
                        path={path}
                      />
                    </circle>
                  </g>
                );
              })}
            </g>

            {REGIONS_MAP.map((r) => {
              const active = region === r.id;
              const haloAt = haloRegions[r.id];
              const halo = haloAt && now - haloAt < 800;
              const sigilPulse = haloAt && now - haloAt < 700;
              const hovered = hoverId === r.id;
              const pingAt = sigilPings[r.id];
              const sigilPinging = pingAt && now - pingAt < 500;
              const exhaling = exhaleId === r.id;
              const sigilHitRx = 90;
              const sigilHitRy = 46;
              const rt = runtimeRef.current[r.id];
              const offX = rt.driftX + rt.dragX;
              const offY = rt.driftY + rt.dragY;
              const elev = rt.hoverElev;
              const isVisiting = zoomTarget === r.id;
              const elevScale = 1 + elev * 0.03 + (isVisiting ? 0.05 : 0);

              return (
                <g
                  key={r.id}
                  data-region={r.id}
                  className={`atlas-region${hovered ? " is-hover" : ""}`}
                  style={{
                    transform: `translate(${offX}px, ${offY - elev * 6}px) scale(${elevScale})`,
                    transformOrigin: `${r.cx}px ${r.cy}px`,
                    transformBox: "fill-box",
                  }}
                >
                  {(elev > 0.05 || isVisiting) && (
                    <path
                      d={r.d}
                      fill="rgba(40, 24, 8, 0.20)"
                      stroke="none"
                      transform={`translate(${4 + elev * 6}, ${5 + elev * 7})`}
                      opacity={0.6 * Math.max(elev, isVisiting ? 1 : 0)}
                      pointerEvents="none"
                    />
                  )}

                  {/* contour lines */}
                  <g pointerEvents="none" opacity={0.32}>
                    {[1.04, 1.08, 1.12].map((sc, i) => (
                      <path
                        key={i}
                        d={r.d}
                        fill="none"
                        stroke="var(--ink-2)"
                        strokeWidth={0.6}
                        strokeDasharray="1 3"
                        style={{
                          transform: `scale(${sc})`,
                          transformOrigin: `${r.cx}px ${r.cy}px`,
                          transformBox: "fill-box",
                          opacity: 0.55 - i * 0.18,
                        }}
                      />
                    ))}
                  </g>

                  <path
                    className="atlas-region__boundary"
                    d={r.d}
                    fill={active || isVisiting ? "rgba(232, 200, 130, 0.35)" : "rgba(244, 224, 178, 0.22)"}
                    stroke="var(--ink)"
                    strokeWidth={active || isVisiting ? 1.6 : 1}
                  />

                  {halo && (
                    <path
                      key={haloAt}
                      d={r.d}
                      fill="rgba(200,115,42,0.30)"
                      stroke="none"
                      className="is-halo"
                    />
                  )}

                  {exhaling && (
                    <path
                      d={r.d}
                      fill="rgba(120, 170, 210, 0.30)"
                      stroke="none"
                      className="atlas-region__exhale"
                    />
                  )}

                  <g
                    key={sigilPulse ? `pulse-${haloAt}` : (sigilPinging ? `ping-${pingAt}` : "static")}
                    className={[
                      "atlas-region__sigil",
                      sigilPulse ? "atlas-sigil--pulse" : "",
                      sigilPinging && !sigilPulse ? "atlas-sigil--ping" : "",
                    ].filter(Boolean).join(" ")}
                    style={{
                      transformOrigin: `${r.cx}px ${r.cy}px`,
                      transform: hovered ? "scale(1.04)" : undefined,
                      opacity: hovered ? 1 : undefined,
                    }}
                  >
                    {r.decor(r.cx, r.cy)}
                  </g>

                  {/* "you are visiting" boat */}
                  {elev > 0.4 && (
                    <g pointerEvents="none" opacity={Math.min(1, elev * 1.4)}>
                      <g transform={`translate(${r.cx}, ${r.cy - 80})`}>
                        <path d="M -12,0 L 12,0 L 8,5 L -8,5 Z" fill="var(--ink)" />
                        <line x1={0} y1={0} x2={0} y2={-14} stroke="var(--ink)" strokeWidth={1.2} />
                        <path d="M 0,-14 L 9,-1 L 0,-1 Z" fill="var(--candle)" stroke="var(--ink)" strokeWidth={0.8} />
                        <line x1={0} y1={-14} x2={6} y2={-12} stroke="var(--candle)" strokeWidth={1.2} />
                      </g>
                    </g>
                  )}

                  <path
                    d={r.d}
                    fill="transparent"
                    style={{ cursor: zoomTarget ? "wait" : "pointer", touchAction: "none" }}
                    onPointerEnter={() => enterHover(r.id)}
                    onPointerLeave={() => {
                      leaveHover(r.id);
                      const p = pressRef.current;
                      if (p && p.regionId === r.id) {
                        clearPressTimer();
                        pressRef.current = null;
                      }
                    }}
                    onPointerDown={(e) => {
                      if (zoomTarget) return;
                      regionDragRef.current = {
                        regionId: r.id,
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                        lastX: e.clientX,
                        lastY: e.clientY,
                        lastT: performance.now(),
                        isDragging: false,
                      };
                      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
                      clearPressTimer();
                      const concern = REGIONS.find((rr) => rr.id === r.id)?.concerns?.[0];
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const pointerId = e.pointerId;
                      const timer = window.setTimeout(() => {
                        if (!pressRef.current || pressRef.current.pointerId !== pointerId) return;
                        if (regionDragRef.current?.isDragging) return;
                        pressRef.current.fired = true;
                        setExhaleId(r.id);
                        suppressClickRef.current = true;
                        if (concern) {
                          try { getFieldAudio().holdConcernTone(concern, 80); } catch { /* noop */ }
                        }
                        window.setTimeout(() => endExhale(r.id), 1100);
                      }, 480);
                      pressRef.current = {
                        regionId: r.id,
                        pointerId,
                        timer,
                        startX,
                        startY,
                        fired: false,
                      };
                    }}
                    onPointerMove={(e) => {
                      const rd = regionDragRef.current;
                      if (!rd || rd.pointerId !== e.pointerId || rd.regionId !== r.id) return;
                      const dx = e.clientX - rd.startX;
                      const dy = e.clientY - rd.startY;
                      if (!rd.isDragging && (dx * dx + dy * dy) > 64) {
                        rd.isDragging = true;
                        clearPressTimer();
                        pressRef.current = null;
                        suppressClickRef.current = true;
                      }
                      if (rd.isDragging) {
                        const svg = svgRef.current;
                        if (!svg) return;
                        const rect = svg.getBoundingClientRect();
                        const scaleX = 1600 / rect.width;
                        const scaleY = 1000 / rect.height;
                        const sdx = dx * scaleX;
                        const sdy = dy * scaleY;
                        const rrt = runtimeRef.current[r.id];
                        rrt.dragX = sdx;
                        rrt.dragY = sdy;
                        const dtMs = performance.now() - rd.lastT;
                        if (dtMs > 0) {
                          const vx = ((e.clientX - rd.lastX) * scaleX) / (dtMs / 1000);
                          const vy = ((e.clientY - rd.lastY) * scaleY) / (dtMs / 1000);
                          rrt.velX = vx;
                          rrt.velY = vy;
                        }
                        rd.lastX = e.clientX;
                        rd.lastY = e.clientY;
                        rd.lastT = performance.now();
                      }
                    }}
                    onPointerUp={(e) => {
                      const rd = regionDragRef.current;
                      clearPressTimer();
                      pressRef.current = null;
                      if (rd && rd.regionId === r.id && rd.pointerId === e.pointerId) {
                        regionDragRef.current = null;
                        try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* noop */ }
                      }
                    }}
                    onPointerCancel={() => {
                      clearPressTimer();
                      pressRef.current = null;
                      regionDragRef.current = null;
                    }}
                    onClick={(e) => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        e.preventDefault();
                        return;
                      }
                      if (carried) {
                        const o = OBJECTS.find((x) => x.id === carried);
                        const compatible = o?.regions.includes(r.id) ?? false;
                        if (compatible) getFieldAudio().thud();
                        else getFieldAudio().refuse();
                      } else {
                        getFieldAudio().bell();
                      }
                      setRegion(r.id);
                    }}
                  >
                    <title>{r.label}</title>
                  </path>

                  <ellipse
                    cx={r.cx}
                    cy={r.cy}
                    rx={sigilHitRx}
                    ry={sigilHitRy}
                    fill="transparent"
                    style={{ cursor: zoomTarget ? "wait" : "pointer", touchAction: "none" }}
                    onPointerEnter={() => enterHover(r.id)}
                    onPointerLeave={() => leaveHover(r.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (zoomTarget) return;
                      beginZoomTo(r.id);
                    }}
                  >
                    <title>{`${r.label} — sigil`}</title>
                  </ellipse>

                  <text
                    x={r.lx}
                    y={r.ly}
                    fill="var(--ink)"
                    className="atlas-region__label"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontWeight: hovered ? 600 : 400,
                      fontSize: 22,
                      pointerEvents: "none",
                      transform: hovered ? "translate(0, -2px)" : undefined,
                      transformBox: "fill-box",
                    }}
                  >
                    {r.label.toLowerCase()}
                  </text>
                </g>
              );
            })}

            {/* water creatures */}
            <g pointerEvents="none">
              {waterCreaturesRef.current.map((fc) => {
                const lr = 1 - fc.age / 4;
                if (fc.kind === "fish") {
                  const bob = Math.sin(fc.bobPhase) * 4;
                  const dir = fc.vx >= 0 ? 1 : -1;
                  return (
                    <g key={fc.id} opacity={lr} transform={`translate(${fc.x}, ${fc.y + bob}) scale(${dir}, 1)`}>
                      <path d="M 0,0 Q 10,-4 18,0 Q 10,4 0,0 Z M 18,0 L 24,-4 L 24,4 Z"
                        fill="var(--ink-2)" />
                      <circle cx={4} cy={-1} r={0.8} fill="var(--paper-2)" />
                    </g>
                  );
                }
                return (
                  <g key={fc.id} opacity={lr * 0.85} transform={`translate(${fc.x}, ${fc.y})`}>
                    <path d="M -16,0 Q -10,-5 -4,0 Q 2,5 8,0 Q 14,-5 20,0"
                      stroke="var(--ink-2)" strokeWidth={1.2} fill="none" />
                  </g>
                );
              })}
            </g>

            {/* compass rose */}
            <g
              transform={`translate(120, 880) rotate(${compassRot})`}
              opacity={0.85}
              pointerEvents="none"
            >
              <circle r={56} fill="rgba(244, 224, 178, 0.4)" stroke="var(--ink)" strokeWidth={1} />
              <circle r={42} fill="none" stroke="var(--ink-2)" strokeWidth={0.6} strokeDasharray="2 4" />
              {Array.from({ length: 8 }).map((_, i) => {
                const ang = (i / 8) * Math.PI * 2;
                const x = Math.cos(ang) * 50;
                const y = Math.sin(ang) * 50;
                const isCardinal = i % 2 === 0;
                return (
                  <line
                    key={i}
                    x1={0}
                    y1={0}
                    x2={x}
                    y2={y}
                    stroke="var(--ink)"
                    strokeWidth={isCardinal ? 1.2 : 0.6}
                  />
                );
              })}
              <polygon points="0,-50 -5,-32 5,-32" fill="var(--ink)" />
              <polygon points="0,50 -5,32 5,32" fill="var(--ink-2)" opacity={0.5} />
              <circle r={3} fill="var(--candle)" />
              <g transform={`rotate(${-compassRot})`}>
                {["N", "E", "S", "W"].map((dir, i) => {
                  const ang = (i / 4) * Math.PI * 2 - Math.PI / 2;
                  const r = 68;
                  return (
                    <text key={dir} x={Math.cos(ang) * r} y={Math.sin(ang) * r + 4}
                      textAnchor="middle"
                      fontFamily="var(--font-serif)" fontStyle="italic"
                      fontSize={12} fill="var(--ink-2)">
                      {dir.toLowerCase()}
                    </text>
                  );
                })}
              </g>
            </g>
          </svg>
        </div>

        <div
          className="atlas-callout"
          style={{
            marginTop: 16,
            borderTop: "1px solid var(--rule)",
            borderBottom: "1px solid var(--rule)",
            padding: "14px 0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, maxWidth: 660 }}>
            <div className="t-eyebrow">
              {selectedRegion ? "selected territory" : "point of departure"}
            </div>
            <div className="t-h3 italic" style={{ marginTop: 4 }}>
              {selectedRegion
                ? selectedRegion.label.toLowerCase()
                : "choose a territory without leaving the page"}
            </div>
            <p className="t-meta italic" style={{ margin: "4px 0 0", color: "var(--ink-2)" }}>
              {selectedRegion
                ? `${selectedRegion.inscription.toLowerCase()} · ${selectedRegion.concerns.join(" / ")}`
                : "the atlas can steer the reading first; the long drawer can wait."}
            </p>
          </div>
          <div className="atlas-callout__actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {selectedRegion ? (
              <>
                <button className="atlas-callout__button" onClick={() => openRegionDrawer(selectedRegion.id)}>
                  read territory
                </button>
                <button
                  className="atlas-callout__button"
                  onClick={() => document.getElementById("reading")?.scrollIntoView({ behavior: "smooth" })}
                >
                  leave reading
                </button>
                <button className="atlas-callout__button is-quiet" onClick={() => setRegion(null)}>
                  clear
                </button>
              </>
            ) : (
              <>
                <button className="atlas-callout__button" onClick={() => beginZoomTo("origin")}>
                  visit origin
                </button>
                <button
                  className="atlas-callout__button is-quiet"
                  onClick={() => document.getElementById("concern-field")?.scrollIntoView({ behavior: "smooth" })}
                >
                  tune first
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 36 }}>
          <div className="t-eyebrow">objects · carry one onto a territory</div>
          <div
            className="atlas-object-row"
            style={{
              marginTop: 14,
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            {OBJECTS.map((o) => {
              const active = carried === o.id;
              return (
                <button
                  key={o.id}
                  className="atlas-object"
                  onClick={() => {
                    const willCarry = !active;
                    setCarried(active ? null : o.id);
                    if (willCarry) getFieldAudio().chime();
                  }}
                  aria-pressed={active}
                  aria-label={`carry ${o.label}`}
                  title={o.label}
                  style={{
                    width: 44, height: 44,
                    background: active ? "var(--ink)" : "transparent",
                    color: active ? "var(--candle)" : "var(--ink-2)",
                    border: `1px solid ${active ? "var(--ink)" : "var(--rule)"}`,
                    cursor: "pointer",
                    transition: "all var(--t)",
                    display: "grid", placeItems: "center",
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={20}
                    height={20}
                    stroke="currentColor"
                    fill="none"
                    strokeWidth={1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dangerouslySetInnerHTML={{ __html: GLYPHS[o.glyph] }}
                  />
                </button>
              );
            })}
          </div>
          {carried && (
            <div className="t-meta italic" style={{ marginTop: 10, color: "var(--ink-2)" }}>
              carrying {OBJECTS.find((o) => o.id === carried)?.label.toLowerCase()} — click a territory to leave a reading with it.
            </div>
          )}
        </div>
      </div>

      <style>{`
        .atlas-callout__button {
          min-height: 44px;
          border: 1px solid var(--ink);
          background: var(--ink);
          color: var(--paper);
          padding: 11px 14px;
          cursor: pointer;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: lowercase;
          transition: border-color var(--t), color var(--t), background var(--t);
        }
        .atlas-callout__button.is-quiet {
          background: transparent;
          color: var(--ink);
          border-color: var(--rule);
        }
        .atlas-callout__button:hover,
        .atlas-callout__button:focus-visible {
          border-color: var(--candle);
          color: var(--candle);
          background: rgba(200, 115, 42, 0.07);
        }
        @media (max-width: 720px) {
          .atlas-map__cue {
            display: none;
          }
          .atlas-callout {
            align-items: stretch !important;
          }
          .atlas-callout__actions {
            width: 100%;
            display: grid !important;
            grid-template-columns: 1fr;
          }
          .atlas-callout__button {
            width: 100%;
          }
          .atlas-object-row {
            gap: 8px !important;
          }
          .atlas-object {
            width: 44px !important;
            height: 44px !important;
          }
        }
      `}</style>

      {drawerRegion && <Drawer regionId={drawerRegion} onClose={() => setDrawerRegion(null)} />}
    </section>
  );
}
