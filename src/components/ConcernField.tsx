"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useField } from "@/store/field";
import { CONCERNS, PRESET_KEYS, PRESETS } from "@/data/content";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { THRESHOLDS } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { buildReading } from "@/lib/reading";
import type { ConcernKey } from "@/lib/types";

/**
 * The concern compass.
 *
 * Eight concerns laid out as radial axes from a single center. Each
 * vertex on the polygon is a draggable handle. The polygon is your
 * valence geometry — the shape of your concern tonight. Drag a vertex
 * outward or inward and the whole polygon morphs.
 *
 * Layout is intentional, not data-order: opposites face across the
 * compass (prayer ↔ body, work ↔ memory, future ↔ love,
 * friendship ↔ risk). The cross- and diagonal-axes are the four
 * inner-life polarities.
 */

const RADIAL_ORDER: ConcernKey[] = [
  "prayer",      // 0  ▲ top
  "future",      // 1  ◢ upper-right
  "work",        // 2  ▶ right
  "risk",        // 3  ◣ lower-right
  "body",        // 4  ▼ bottom
  "love",        // 5  ◣ lower-left
  "memory",      // 6  ◀ left
  "friendship",  // 7  ◤ upper-left
];

// SVG geometry
const R_MAX = 220;
const VIEW = 640;
const CX = VIEW / 2;
const CY = VIEW / 2;

// `rose` is the lens: twist (2 fingers) turns the whole compass, and every
// geometry function below takes the same offset — the render path and the
// hit-test path are literally one map, so what a hand sees is always what it
// can grab however far the rose has been turned.
function axisAngle(i: number, rose = 0) {
  // start at top, go clockwise
  return -Math.PI / 2 + (i * Math.PI * 2) / 8 + rose;
}

function axisVec(i: number, rose = 0) {
  const a = axisAngle(i, rose);
  return { x: Math.cos(a), y: Math.sin(a) };
}

function pointAt(i: number, value: number, rose = 0) {
  const v = axisVec(i, rose);
  const r = (value / 100) * R_MAX;
  return { x: CX + v.x * r, y: CY + v.y * r };
}

function labelAt(i: number, pad = 32, rose = 0) {
  const v = axisVec(i, rose);
  return {
    x: CX + v.x * (R_MAX + pad),
    y: CY + v.y * (R_MAX + pad),
    anchor:
      Math.abs(v.x) < 0.25 ? ("middle" as const) :
      v.x > 0 ? ("start" as const) : ("end" as const),
    align:
      Math.abs(v.y) < 0.25 ? ("middle" as const) :
      v.y > 0 ? ("hanging" as const) : ("auto" as const),
  };
}

export default function ConcernField() {
  const router = useRouter();
  const concerns = useField((s) => s.concerns);
  const preset = useField((s) => s.preset);
  const setConcern = useField((s) => s.setConcern);
  const applyPreset = useField((s) => s.applyPreset);
  const recordTape = useField((s) => s.recordTape);

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<ConcernKey | null>(null);
  const [hovering, setHovering] = useState<ConcernKey | null>(null);
  const [hoverPreset, setHoverPreset] = useState<string | null>(null);

  // ── the grammar, alongside the founding drag ──────────────────────
  // The vertex drag below stays exactly as it has always been — it is the
  // site's founding interaction. The engine adds only what the grammar
  // owes this surface: tap intensity into the vertex-pull glow, a tapped
  // tempo entraining the dominant concern's voice, and the ceremony hold
  // at the polygon's center — keeping the reading, the oldest solemn act.
  const draggingRef = useRef<ConcernKey | null>(null);
  draggingRef.current = dragging;
  // transient tap glow at a vertex: radius/opacity ride the 0..1 from core
  const [tapGlow, setTapGlow] = useState<{ k: ConcernKey; intensity: number; key: number } | null>(null);
  // rhythm entrainment: the dominant concern's vertex pulses on each beat
  const [beat, setBeat] = useState<{ k: ConcernKey; key: number } | null>(null);
  // ceremony hold at the center: 0..1 progress toward the keep
  const [ceremony, setCeremony] = useState(0);
  const [keptFlash, setKeptFlash] = useState(0);
  // the law and vessel layers: three-finger tap (tutti), hold (time
  // dilation while held) and the vessel (tilt/shake/knock/flip)
  const [tutti, setTutti] = useState(0);
  const [dilation, setDilation] = useState(0);
  const [agitated, setAgitated] = useState(false);
  const [night, setNight] = useState(false);
  // the lens: how far the rose has been turned, in radians. Continuous with
  // the twist, never stepped — a quarter turn is a quarter turn.
  const [rose, setRose] = useState(0);
  const roseRef = useRef(0);
  // the dwell's charge, so a resting finger is visible from the tier it crosses
  const [charging, setCharging] = useState<{ k: ConcernKey; grip: number } | null>(null);

  // map a client-space pointer to a value on a given axis
  const valueFromPointer = (k: ConcernKey, clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    const i = RADIAL_ORDER.indexOf(k);
    const v = axisVec(i, roseRef.current);
    const dx = local.x - CX;
    const dy = local.y - CY;
    const t = (dx * v.x + dy * v.y) / R_MAX;
    return Math.max(0, Math.min(100, Math.round(t * 100)));
  };

  // global pointer move / up while dragging a vertex.
  // each drag holds a continuous tone tuned to that concern's voice +
  // current value, so the user is literally *playing* the compass.
  //
  // While dragging, we also emit small "ripple" tape events every ~120ms
  // with intensity scaled to pointer speed. Ripples aren't dedupe-merged
  // against concern events (different kind), so they show as a flowing
  // burst of small ripple glyphs on the tape during the drag.
  useEffect(() => {
    if (!dragging) return;
    const audio = getFieldAudio();
    audio.holdConcernTone(dragging, concerns[dragging] ?? 50);
    // mirror the audio hold on the store so global palette can tint
    useField.getState().setHeldConcern(dragging);

    // drag-speed tracking for ripple intensity
    let lastSampleAt = performance.now();
    let lastX: number | null = null;
    let lastY: number | null = null;
    let lastRippleAt = 0;
    let currentSpeed = 0; // px/sec, EMA-smoothed

    const onMove = (e: PointerEvent) => {
      const v = valueFromPointer(dragging, e.clientX, e.clientY);
      if (v != null) {
        setConcern(dragging, v);
        audio.holdConcernTone(dragging, v);
      }

      // update drag speed (EMA over the last few samples)
      const nowMs = performance.now();
      const dt = Math.max(1, nowMs - lastSampleAt) / 1000; // seconds
      if (lastX != null && lastY != null) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        const instSpeed = Math.hypot(dx, dy) / dt; // px/sec
        currentSpeed = currentSpeed * 0.6 + instSpeed * 0.4;
      }
      lastSampleAt = nowMs;
      lastX = e.clientX;
      lastY = e.clientY;

      // emit ripple roughly every 120ms while the drag is active
      if (nowMs - lastRippleAt >= 120) {
        lastRippleAt = nowMs;
        // map speed (0..~1500 px/s) into 0.15..0.7
        const intensity = Math.max(0.15, Math.min(0.7, 0.15 + currentSpeed / 2200));
        recordTape("ripple", intensity, dragging);
      }
    };
    const onUp = () => {
      audio.releaseConcernTone(dragging);
      useField.getState().setHeldConcern(null);
      setDragging(null);
      audio.chime();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      // safety: release if effect tears down mid-drag
      audio.releaseConcernTone(dragging);
      useField.getState().setHeldConcern(null);
    };
  }, [dragging, setConcern, concerns, recordTape]);

  // current concerns readable from inside the long-lived engine closure
  const concernsRef = useRef(concerns);
  concernsRef.current = concerns;

  // ── engine mount (docs/gesture-grammar.md) ─────────────────────────
  // Attached to the compass svg only — the page around it keeps its
  // scroll (manageStyle: false leaves touch-action: pan-y in place, and
  // noCapture leaves the vertex handles' own capture untouched).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const toSvg = (clientX: number, clientY: number) => {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      return pt.matrixTransform(ctm.inverse());
    };
    const nearestVertex = (x: number, y: number): { k: ConcernKey; d: number } | null => {
      let best: { k: ConcernKey; d: number } | null = null;
      RADIAL_ORDER.forEach((k, i) => {
        const p = pointAt(i, concernsRef.current[k], roseRef.current);
        const d = Math.hypot(p.x - x, p.y - y);
        if (!best || d < best.d) best = { k, d };
      });
      return best;
    };

    // rhythm entrainment bookkeeping
    let beatTimer: ReturnType<typeof setInterval> | null = null;
    let beatN = 0;
    const pulseTimers = new Set<ReturnType<typeof setTimeout>>();
    const pulseVoice = (k: ConcernKey, ms = 150) => {
      // a brief sounding of that concern's own voice — never while the
      // founding drag already holds a tone
      if (draggingRef.current) return;
      try {
        getFieldAudio().holdConcernTone(k, concernsRef.current[k] ?? 50);
        const t = setTimeout(() => {
          pulseTimers.delete(t);
          try { getFieldAudio().releaseConcernTone(k); } catch { /* noop */ }
        }, ms);
        pulseTimers.add(t);
      } catch { /* noop */ }
    };

    // ceremony hold bookkeeping: only a hold born near the polygon's
    // center gathers toward the keep
    const center = { active: false, fired: false };

    // The lens, the season and the weather, which an earlier pass left
    // unbound on the reasoning that rotating the view would desync what a
    // hand sees from what it can grab. It would have — but only because the
    // rotation was not threaded through the geometry. `axisAngle(i, rose)`
    // now feeds the render path AND `valueFromPointer` / `nearestVertex`
    // both, so the rose can turn freely and the grab still lands on the
    // bead under the finger. Only pan2 stays unbound, and it stays unbound
    // for the reason every yielded-frame room has: there is no camera here
    // to move.
    let tuttiTimer: ReturnType<typeof setTimeout> | null = null;
    let seasonAcc = 0;
    let chargeTarget: { k: ConcernKey; from: number } | null = null;
    const detach = attachGestures(svg as unknown as HTMLElement, {
      tap: (e) => {
        if (e.fingers === 2) {
          // step back: the compass has no camera of its own, so the frame
          // retreats the only way it can — the rose returns to true north
          // and the page steps back to the top of the room.
          setRose(0);
          roseRef.current = 0;
          window.scrollTo({ top: 0, behavior: "smooth" });
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }
        if (e.fingers === 3) {
          // tutti — every vertex answers together, once
          RADIAL_ORDER.forEach((k, i) => pulseVoice(k, 90 + i * 6));
          setTutti(Date.now());
          if (tuttiTimer) clearTimeout(tuttiTimer);
          tuttiTimer = setTimeout(() => setTutti(0), 700);
          try { haptics.ripple(0.45); } catch { /* noop */ }
          recordTape("sigil", 0.45, "compass/tutti");
          return;
        }
        const local = toSvg(e.x, e.y);
        if (!local) return;
        const hit = nearestVertex(local.x, local.y);
        if (!hit || hit.d > 72) return; // background taps are absorbed
        // tap intensity is the pull: the vertex glow blooms by the same
        // 0..1 the whole grammar reads
        setTapGlow({ k: hit.k, intensity: e.intensity, key: Date.now() });
        pulseVoice(hit.k, 160);
        try { haptics.ripple(0.2 + e.intensity * 0.4); } catch { /* noop */ }
        recordTape("ripple", 0.3 + e.intensity * 0.4, hit.k);
      },
      twist: (e) => {
        if (e.phase !== "move") return;
        if (e.fingers === 3) {
          // season — the room's slow cycle is the run of named presets, and
          // three fingers walk it forward or back. Continuous in the angle:
          // a quarter turn is one preset, and a tenth of a turn is a tenth
          // of the way there, so nothing latches.
          seasonAcc += e.angle;
          const step = Math.PI / 2;
          while (Math.abs(seasonAcc) >= step) {
            const direction = seasonAcc > 0 ? 1 : -1;
            seasonAcc -= direction * step;
            const st = useField.getState();
            const at = PRESET_KEYS.indexOf(st.preset ?? PRESET_KEYS[0]);
            const from = at >= 0 ? at : 0;
            const next = PRESET_KEYS[(from + direction + PRESET_KEYS.length) % PRESET_KEYS.length];
            st.applyPreset(next);
            try { getFieldAudio().bell(); } catch { /* noop */ }
            try { haptics.detent(); } catch { /* noop */ }
          }
          return;
        }
        // lens — the rose turns under the hand; which concern sits at the
        // top is the level of description this surface can change.
        roseRef.current += e.angle;
        setRose(roseRef.current);
        try { haptics.lens(); } catch { /* noop */ }
      },
      drag: (e) => {
        if (e.fingers !== 3) return;
        // weather — a gust across the rose. Every concern downwind gains
        // what the upwind ones lose, in proportion to how squarely it faces
        // the push, so the shape leans without the total running away.
        const mag = Math.hypot(e.dx, e.dy);
        if (mag < 0.001) return;
        const ux = e.dx / mag;
        const uy = e.dy / mag;
        const gust = Math.min(3.5, mag * 0.06);
        const st = useField.getState();
        RADIAL_ORDER.forEach((k, i) => {
          const v = axisVec(i, roseRef.current);
          const lean = v.x * ux + v.y * uy;
          const now = concernsRef.current[k] ?? 50;
          st.setConcern(k, Math.max(0, Math.min(100, Math.round(now + lean * gust))));
        });
      },
      rhythm: (e) => {
        // a steady tapped tempo: the dominant concern's voice falls into
        // the hand's pulse for ~8s
        if (e.stability <= 0.7) return;
        const entries = Object.entries(concernsRef.current) as Array<[ConcernKey, number]>;
        let dominant: ConcernKey = "prayer";
        let top = -Infinity;
        for (const [k, v] of entries) if (v > top) { top = v; dominant = k; }
        const interval = Math.max(280, Math.min(1500, 60000 / e.bpm));
        const until = performance.now() + 8000;
        if (beatTimer) clearInterval(beatTimer);
        beatTimer = setInterval(() => {
          if (performance.now() > until) {
            if (beatTimer) clearInterval(beatTimer);
            beatTimer = null;
            return;
          }
          beatN += 1;
          if (!reduce) setBeat({ k: dominant, key: beatN });
          pulseVoice(dominant, Math.min(200, interval * 0.45));
          try { haptics.tap(); } catch { /* noop */ }
        }, interval);
        recordTape("sigil", 0.5, `compass/entrain-${dominant}`);
      },
      hold: (e) => {
        if (e.fingers === 3) {
          // three-finger hold = time dilation while held: the compass's
          // own answers (tap glow, rhythm beat) slow continuously with
          // how long the hand has stayed.
          if (e.phase === "release") { setDilation(0); return; }
          setDilation(Math.min(1, e.elapsed / THRESHOLDS.ceremonyMs));
          return;
        }
        if (e.fingers !== 1 || draggingRef.current) return;
        if (e.phase === "release") {
          center.active = false;
          chargeTarget = null;
          setCeremony(0);
          setCharging(null);
          return;
        }
        if (e.phase === "enter") {
          const local = toSvg(e.x, e.y);
          center.active = Boolean(
            local && Math.hypot(local.x - CX, local.y - CY) < R_MAX * 0.38,
          );
          center.fired = false;
          chargeTarget = null;
          if (!center.active && local) {
            // a hold out on the rose charges the axis it landed on
            const hit = nearestVertex(local.x, local.y);
            if (hit && hit.d <= 96) chargeTarget = { k: hit.k, from: concernsRef.current[hit.k] ?? 50 };
          }
          if (!center.active) return;
        }
        if (!center.active) {
          // dwell (tier >= 2) — the charge. A resting finger grows its
          // concern outward continuously, so 900ms and 2400ms leave
          // measurably different weights, and it is visible from the tier
          // it crosses rather than only when the hand comes off.
          if (!chargeTarget) return;
          if (e.tier >= 2) {
            const grip = Math.max(0, 1 - Math.exp(-(e.elapsed - THRESHOLDS.dwellMs) / 1400));
            const grown = chargeTarget.from + (100 - chargeTarget.from) * grip;
            setConcern(chargeTarget.k, Math.max(0, Math.min(100, Math.round(grown))));
            setCharging({ k: chargeTarget.k, grip });
            if (e.tier >= 3) {
              // holding past the ceremony tier out here is still the charge,
              // deepening — the solemn act belongs to the center alone
              try { haptics.ripple(0.2 + grip * 0.5); } catch { /* noop */ }
            }
          }
          return;
        }
        setCeremony(Math.min(1, e.elapsed / THRESHOLDS.ceremonyMs));
        // the ceremony: the reading is kept — the same act as the keep
        // button, spoken by the oldest surface's own hand
        if (e.tier >= 3 && !center.fired) {
          center.fired = true;
          const st = useField.getState();
          const reading = buildReading({
            concerns: st.concerns,
            region: st.region,
            carriedObject: st.carriedObject,
          });
          const already = st.keptReadings.some((k) => k.hash === reading.hash);
          if (!already) {
            st.keepReading({
              hash: reading.hash,
              headline: reading.headline,
              topConcern: reading.top[0],
              region: reading.region.id,
              carriedObject: reading.carried?.id ?? null,
              keptAt: Date.now(),
            });
            try { getFieldAudio().thud(); } catch { /* noop */ }
          } else {
            // already kept — the compass answers gently, nothing refuses
            try { getFieldAudio().chime(); } catch { /* noop */ }
          }
          try { haptics.bloom(); } catch { /* noop */ }
          setKeptFlash(Date.now());
          setCeremony(0);
        }
      },
    }, { wheelZoom: false, manageStyle: false, noCapture: true });

    // vessel: tilt leans the whole compass (sight only, matching the
    // template's own tilt), shake agitates every vertex in a brief
    // shiver, a knock rings it like tutti, and face-down is night — the
    // compass dims until the phone turns back over.
    let agitateTimer: ReturnType<typeof setTimeout> | null = null;
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (reduce) return;
        // A drop-shadow offset, never a transform — the compass's
        // geometry is also its own hit-test math (see the note above),
        // so tilt only ever casts a lean, it never moves a vertex.
        const lean = Math.max(-1, Math.min(1, gamma / 45));
        svg.style.setProperty("--cf-tilt", (lean * 7).toFixed(1) + "px");
      },
      shake: () => {
        if (reduce) return;
        setAgitated(true);
        try { haptics.chop(); } catch { /* noop */ }
        try { getFieldAudio().chime(); } catch { /* noop */ }
        if (agitateTimer) clearTimeout(agitateTimer);
        agitateTimer = setTimeout(() => setAgitated(false), 460);
      },
      knock: () => {
        RADIAL_ORDER.forEach((k, i) => pulseVoice(k, 90 + i * 6));
        setTutti(Date.now());
        try { getFieldAudio().bell(); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        if (tuttiTimer) clearTimeout(tuttiTimer);
        tuttiTimer = setTimeout(() => setTutti(0), 700);
      },
      flip: ({ faceDown }) => setNight(faceDown),
    });

    return () => {
      detach();
      detachVessel();
      if (beatTimer) clearInterval(beatTimer);
      if (tuttiTimer) clearTimeout(tuttiTimer);
      if (agitateTimer) clearTimeout(agitateTimer);
      pulseTimers.forEach((t) => clearTimeout(t));
      try { getFieldAudio().releaseAllConcernTones(); } catch { /* noop */ }
    };
  }, [recordTape, setConcern]);

  // build the polygon points string
  const polygonPoints = RADIAL_ORDER.map((k, i) => {
    const p = pointAt(i, concerns[k], rose);
    return `${p.x},${p.y}`;
  }).join(" ");

  // preset ghost — preview the polygon shape of a hovered preset
  const ghostPoints = hoverPreset && PRESETS[hoverPreset]
    ? RADIAL_ORDER.map((k, i) => {
        const p = pointAt(i, PRESETS[hoverPreset][k], rose);
        return `${p.x},${p.y}`;
      }).join(" ")
    : null;

  return (
    <section id="concern-field" className="rule" data-touch-surface="true" style={{ scrollMarginTop: 72 }}>
      <div className="wrap">
        {/* The room says what it is and nothing about how to work it: it was a
            section of a scrolling page once, where a line of instruction was
            fair, and it is a room now, where it is not (AGENTS.md, "no
            instructions, ever"). Every move it answers lives in the guide. */}
        <div className="t-eyebrow">concern field</div>
        <h2 className="t-h2 italic" style={{ marginTop: 12, marginBottom: 12 }}>
          weights maintained against time
        </h2>

        <div
          className="concern-field__stage"
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            placeItems: "center",
          }}
        >
          <div style={{ width: "100%", maxWidth: 720 }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEW} ${VIEW}`}
              role="group"
              aria-label="concern compass"
              className={
                "concern-field__svg"
                + (tutti ? " is-tutti" : "")
                + (agitated ? " is-agitated" : "")
                + (night ? " is-night" : "")
              }
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                // The compass is embedded inside the home page (not
                // fullscreen). touch-action "none" would trap vertical
                // page scroll. "pan-y" still lets the page scroll while
                // the vertex pointerdown captures the drag for value-setting.
                touchAction: "pan-y",
                userSelect: "none",
                ["--cf-dilation" as string]: dilation,
              }}
            >
              {/* concentric rings */}
              {[0.25, 0.5, 0.75, 1].map((t, i) => (
                <circle
                  key={i}
                  cx={CX}
                  cy={CY}
                  r={t * R_MAX}
                  fill="none"
                  stroke="var(--rule)"
                  strokeWidth={1}
                />
              ))}
              {/* 50-mark ring highlighted slightly */}
              <circle
                cx={CX}
                cy={CY}
                r={R_MAX * 0.5}
                fill="none"
                stroke="rgba(21,23,26,0.28)"
                strokeWidth={1}
                strokeDasharray="3 4"
              />

              {/* axes */}
              {RADIAL_ORDER.map((k, i) => {
                const end = pointAt(i, 100, rose);
                const active = dragging === k || hovering === k;
                return (
                  <line
                    key={k}
                    x1={CX}
                    y1={CY}
                    x2={end.x}
                    y2={end.y}
                    stroke={active ? "var(--ink)" : "var(--rule)"}
                    strokeWidth={active ? 1.2 : 1}
                  />
                );
              })}

              {/* preset ghost — what the polygon would become on hover */}
              {ghostPoints && (
                <polygon
                  points={ghostPoints}
                  fill="rgba(200, 115, 42, 0.08)"
                  stroke="var(--candle)"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  style={{ pointerEvents: "none" }}
                />
              )}

              {/* the valence polygon — your shape tonight */}
              <polygon
                points={polygonPoints}
                fill="rgba(44, 74, 92, 0.16)"
                stroke="var(--ink)"
                strokeWidth={1.4}
                style={{ transition: dragging ? "none" : "all var(--t)" }}
              />

              {/* polygon inner stroke for depth */}
              <polygon
                points={polygonPoints}
                fill="none"
                stroke="rgba(44, 74, 92, 0.55)"
                strokeWidth={0.6}
                style={{ transition: dragging ? "none" : "all var(--t)" }}
              />

              {/* labels + readouts */}
              {RADIAL_ORDER.map((k, i) => {
                const meta = CONCERNS.find((c) => c.id === k)!;
                const l = labelAt(i, 36, rose);
                const value = concerns[k];
                const active = dragging === k || hovering === k;
                return (
                  <g key={`label-${k}`} pointerEvents="none">
                    <text
                      x={l.x}
                      y={l.y}
                      textAnchor={l.anchor}
                      dominantBaseline={l.align}
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontWeight: 400,
                        fontSize: 20,
                        fill: active ? "var(--ink)" : "var(--ink-2)",
                      }}
                    >
                      {meta.label.toLowerCase()}
                    </text>
                    <text
                      x={l.x}
                      y={l.y + (l.align === "hanging" ? 22 : -22)}
                      textAnchor={l.anchor}
                      dominantBaseline={l.align}
                      style={{
                        fontFamily: "var(--font-text)",
                        fontSize: 13,
                        fill: active ? "var(--candle)" : "var(--ink-2)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {Math.round(value)}
                    </text>
                  </g>
                );
              })}

              {/* vertices (last so they sit on top) */}
              {RADIAL_ORDER.map((k, i) => {
                const p = pointAt(i, concerns[k], rose);
                const active = dragging === k;
                const hover = hovering === k;
                return (
                  <g key={`v-${k}`}>
                    {(active || hover) && (
                      <circle cx={p.x} cy={p.y} r={14}
                        fill="rgba(200,115,42,0.12)" stroke="none" />
                    )}
                    {/* Invisible larger touch target. At the default
                        embed width (~720px CSS over a 640 viewBox), 1 user
                        unit ≈ 1.13 CSS px; on a 360px phone it shrinks to
                        ~0.56 CSS px. A radius of 26 user units gives a ~30
                        CSS px target on phone and ~58 CSS px on desktop —
                        clears the 44 CSS px floor at typical mobile widths
                        while staying invisible. */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={26}
                      fill="transparent"
                      stroke="none"
                      style={{ cursor: "grab", touchAction: "none" } as React.CSSProperties}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                        setDragging(k);
                      }}
                      onPointerEnter={() => setHovering(k)}
                      onPointerLeave={() => setHovering((h) => (h === k ? null : h))}
                    >
                      <title>{`${k}: ${Math.round(concerns[k])}`}</title>
                    </circle>
                    {/* Visible bead — pointer-events disabled so the larger
                        invisible target above receives all input. */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={active ? 7 : hover ? 6 : 5}
                      fill="var(--candle)"
                      stroke="var(--paper)"
                      strokeWidth={1.5}
                      style={{ pointerEvents: "none", transition: active ? "none" : "r var(--t)" }}
                    />
                  </g>
                );
              })}

              {/* the grammar's transient answers — never interactive */}
              <g pointerEvents="none">
                {/* tap glow: the vertex-pull halo, bloomed by tap intensity */}
                {tapGlow && (() => {
                  const p = pointAt(RADIAL_ORDER.indexOf(tapGlow.k), concerns[tapGlow.k], rose);
                  return (
                    <circle
                      key={`glow-${tapGlow.key}`}
                      className="cf-tap-glow"
                      cx={p.x}
                      cy={p.y}
                      r={10 + tapGlow.intensity * 18}
                      fill={`rgba(200,115,42,${0.10 + tapGlow.intensity * 0.24})`}
                    />
                  );
                })()}
                {/* rhythm beat: the dominant concern's vertex answers the tempo */}
                {beat && (() => {
                  const p = pointAt(RADIAL_ORDER.indexOf(beat.k), concerns[beat.k], rose);
                  return (
                    <circle
                      key={`beat-${beat.key}`}
                      className="cf-beat"
                      cx={p.x}
                      cy={p.y}
                      r={11}
                      fill="none"
                      stroke="var(--candle)"
                      strokeWidth={1.2}
                    />
                  );
                })()}
                {/* dwell: the charge gathering under a resting finger, out on
                    the rose — visible from the tier it crosses, and it keeps
                    thickening for as long as the hand stays */}
                {charging && (() => {
                  const p = pointAt(RADIAL_ORDER.indexOf(charging.k), concerns[charging.k], rose);
                  return (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={9 + charging.grip * 26}
                      fill={`rgba(200,115,42,${0.06 + charging.grip * 0.16})`}
                      stroke="var(--candle)"
                      strokeWidth={0.8 + charging.grip * 2.2}
                      strokeOpacity={0.3 + charging.grip * 0.5}
                    />
                  );
                })()}
                {/* ceremony: a ring gathers at the center while the hold deepens */}
                {ceremony > 0 && (
                  <circle
                    cx={CX}
                    cy={CY}
                    r={14 + ceremony * R_MAX * 0.34}
                    fill={`rgba(200,115,42,${ceremony * 0.05})`}
                    stroke="var(--candle)"
                    strokeWidth={1}
                    strokeOpacity={0.25 + ceremony * 0.55}
                    strokeDasharray="4 6"
                  />
                )}
                {/* the keep lands: one ring opens over the whole polygon */}
                {keptFlash > 0 && (
                  <circle
                    key={`kept-${keptFlash}`}
                    className="cf-kept-bloom"
                    cx={CX}
                    cy={CY}
                    r={24}
                    fill="none"
                    stroke="var(--candle)"
                    strokeWidth={1.4}
                  />
                )}
              </g>
            </svg>

            {/* glosses — small italic line for whoever the compass is currently lit on */}
            <div
              style={{
                marginTop: 16,
                textAlign: "center",
                minHeight: "1.6em",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 18,
                color: "var(--ink-2)",
              }}
            >
              {(() => {
                // lit by whatever the hand is on; silent otherwise. The
                // reserved line keeps the layout from jumping.
                const lit = dragging ?? hovering ?? charging?.k ?? null;
                const c = lit ? CONCERNS.find((x) => x.id === lit) : null;
                return c ? c.inscription : "";
              })()}
            </div>
          </div>
        </div>

        {/* presets */}
        <div className="t-eyebrow" style={{ marginTop: 56 }}>presets</div>
        <div className="concern-field__presets" style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PRESET_KEYS.map((name) => {
            const on = preset === name;
            return (
              <button
                key={name}
                onClick={() => { applyPreset(name); getFieldAudio().bell(); }}
                onMouseEnter={() => setHoverPreset(name)}
                onMouseLeave={() => setHoverPreset((p) => (p === name ? null : p))}
                onFocus={() => setHoverPreset(name)}
                onBlur={() => setHoverPreset((p) => (p === name ? null : p))}
                aria-pressed={on}
                className={`chip${on ? " is-active" : ""}`}
              >
                {name.toLowerCase()}
              </button>
            );
          })}
        </div>

        <div className="concern-field__next-row" style={{ marginTop: 56, display: "flex", justifyContent: "flex-end" }}>
          <button
            className="concern-field__next"
            onClick={() => {
              // the polygon read back to you — the same reading the ceremony
              // keeps, at its own permalink
              const st = useField.getState();
              const reading = buildReading({
                concerns: st.concerns,
                region: st.region,
                carriedObject: st.carriedObject,
              });
              try { getFieldAudio().bell(); } catch { /* noop */ }
              router.push(`/reading/${reading.hash}`);
            }}
            style={{
              background: "none",
              border: "1px solid var(--rule)",
              padding: "12px 18px",
              cursor: "pointer",
              fontFamily: "var(--font-text)",
              fontSize: 13,
              letterSpacing: "0.08em",
              textTransform: "lowercase",
              color: "var(--ink)",
              transition: "border-color var(--t), color var(--t)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--candle)";
              e.currentTarget.style.color = "var(--candle)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--rule)";
              e.currentTarget.style.color = "var(--ink)";
            }}
          >
            read the room →
          </button>
        </div>
      </div>
      <style>{`
        .cf-tap-glow { animation: cf-glow-fade 700ms ease-out forwards; }
        .cf-beat {
          animation: cf-beat-out calc(460ms + var(--cf-dilation, 0) * 1400ms) ease-out forwards;
          transform-origin: center; transform-box: fill-box;
        }
        .cf-kept-bloom { animation: cf-kept-open 900ms ease-out forwards; }
        @keyframes cf-glow-fade {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes cf-beat-out {
          from { opacity: 0.9; transform: scale(1); }
          to { opacity: 0; transform: scale(2.4); }
        }
        @keyframes cf-kept-open {
          from { opacity: 0.85; r: 24; }
          to { opacity: 0; r: ${R_MAX}; }
        }
        /* vessel: a lean cast as a shadow, never a moved vertex */
        .concern-field__svg {
          filter: drop-shadow(var(--cf-tilt, 0px) 6px 14px rgba(21,23,26,0.22));
          transition: filter 260ms ease-out;
        }
        /* three-finger tap / a knock on the case — tutti, one shared pulse */
        .concern-field__svg.is-tutti polygon:first-of-type {
          animation: cf-tutti 640ms ease-out;
        }
        @keyframes cf-tutti {
          0% { filter: none; }
          40% { filter: drop-shadow(0 0 18px rgba(200,115,42,0.6)); }
          100% { filter: none; }
        }
        /* shake — a brief shiver through the whole compass */
        .concern-field__svg.is-agitated {
          animation: cf-shudder 420ms ease-in-out;
        }
        @keyframes cf-shudder {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(3px, -2px); }
          50% { transform: translate(-3px, 2px); }
          75% { transform: translate(2px, 2px); }
        }
        /* flip face-down — night, until the phone turns back over */
        .concern-field__svg.is-night { opacity: 0.4; transition: opacity 900ms ease; }
        @media (prefers-reduced-motion: reduce) {
          .cf-tap-glow { animation-duration: 1ms; }
          .cf-beat, .cf-kept-bloom { animation: none; opacity: 0; }
          .concern-field__svg { filter: none; transition: none; }
          .concern-field__svg.is-tutti polygon:first-of-type { animation: none; }
          .concern-field__svg.is-agitated { animation: none; }
        }
        @media (max-width: 720px) {
          .concern-field__stage {
            margin-top: 30px !important;
          }
          .concern-field__presets .chip {
            min-height: 38px;
          }
          .concern-field__next-row {
            margin-top: 34px !important;
            justify-content: stretch !important;
          }
          .concern-field__next {
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
}
