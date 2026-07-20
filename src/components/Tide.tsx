"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";

/**
 * /tide — the lunar gravity-phase instrument.
 *
 * Night over the Atlantic. Candle on the sill. Floating in the sky is the
 * mechanism of the tide itself: the Earth, its exaggerated water ellipse,
 * and the Moon on its orbit. DRAG THE MOON around the Earth and the two
 * tidal bulges (near-side and antipodal) swing with it — so the sea at
 * your shore rises to HIGH when a bulge faces it and falls to LOW between.
 *
 * A second body, the Sun, also pulls. When Sun and Moon ALIGN (syzygy)
 * the bulges reinforce — a SPRING tide, extra high and low. When they sit
 * at right angles the pulls fight — a muted NEAP tide. Move the Sun, or
 * snap it, to feel the difference. The Moon's face lights by its angle to
 * the Sun, so the phase you make is the phase you see.
 *
 * Motion of the Moon -> phase of the tide. Everything else is felt.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

// Real-ish ratio: the Sun's tide-raising force is ~46% of the Moon's.
const MOON_AMP = 1.0;
const SUN_AMP = 0.46;
// "Your shore" sits at the top of the Earth (toward the sky). Screen-space
// angle, y-down, so straight up is -PI/2.
const SHORE_PHI = -Math.PI / 2;

// tide height contributed by a body at orbital angle `ang` with strength `s`.
// Two bulges 180deg apart -> the field has period PI in the body's angle.
const bodyTide = (ang: number, s: number) => s * Math.cos(2 * (SHORE_PHI - ang));

function phaseName(illum: number, waxing: boolean): string {
  if (illum < 0.04) return "new moon";
  if (illum > 0.96) return "full moon";
  if (illum < 0.46) return waxing ? "waxing crescent" : "waning crescent";
  if (illum < 0.54) return waxing ? "first quarter" : "last quarter";
  return waxing ? "waxing gibbous" : "waning gibbous";
}

export default function Tide() {
  // keep the page ambient bed: slow lunar water and buoy pulse
  useEffect(() => { getFieldAudio().setAmbientProfile("tide"); }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // orbital state — the whole instrument lives in these two angles.
  const moonAngRef = useRef(-Math.PI / 2);   // start near shore -> high tide
  const sunAngRef = useRef(-Math.PI / 2 + 0.5);

  // drag state: which body (if any) the pointer has grabbed.
  const dragRef = useRef<{ active: boolean; id: number; target: "moon" | "sun" | null; moved: boolean; downX: number; downY: number }>(
    { active: false, id: -1, target: null, moved: false, downX: 0, downY: 0 },
  );
  // live geometry, published each frame for hit-testing.
  const geomRef = useRef({
    earth: { x: 0, y: 0, r: 0 },
    moon: { x: 0, y: 0, r: 0 },
    sun: { x: 0, y: 0, r: 0 },
    orbitR: 0,
    sunOrbitR: 0,
  });

  // candle flame-lean, same feel as the original scene.
  const cursor = useRef({ x: -9999, y: -9999, tx: -9999, ty: -9999, over: false });
  const candleLean = useRef(0);
  const candleSparkRef = useRef(0);

  // event-band trackers so we only fire feedback on true crossings.
  const tideBandRef = useRef<"high" | "mid" | "low">("mid");
  const springBandRef = useRef<"spring" | "mid" | "neap">("mid");
  const lastBeatRef = useRef(-1);
  const lastDragToneRef = useRef(0);
  const lastDragTapeRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const autoRef = useRef(false);

  const recordTape = useField((s) => s.recordTape);
  const recordTapeRef = useRef(recordTape);
  useEffect(() => { recordTapeRef.current = recordTape; }, [recordTape]);

  const [auto, setAuto] = useState(false);
  const [readout, setReadout] = useState("tide held");
  useEffect(() => { autoRef.current = auto; }, [auto]);

  // DOM ripples for taps on the open sea.
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number; size: number; tone: "gold" | "pale" }>>([]);
  const rippleIdRef = useRef(0);
  const addRipple = useCallback((x: number, y: number, size: number, tone: "gold" | "pale") => {
    if (reduceMotionRef.current) return;
    const id = ++rippleIdRef.current;
    setRipples((rs) => [...rs.slice(-8), { id, x, y, size, tone }]);
    window.setTimeout(() => setRipples((rs) => rs.filter((r) => r.id !== id)), 720);
  }, []);

  // snap the Sun to a fixed elongation from the Moon (spring vs neap shortcut).
  const setSunOffset = useCallback((offset: number, label: string) => {
    sunAngRef.current = moonAngRef.current + offset;
    try { getFieldAudio().playNote(offset === 0 ? 67 : 60, 180); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTapeRef.current("preset", offset === 0 ? 0.82 : 0.5, `tide/${label}`);
  }, []);

  const toggleAuto = useCallback(() => {
    setAuto((v) => {
      const next = !v;
      autoRef.current = next;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      recordTapeRef.current("sigil", next ? 0.7 : 0.4, next ? "tide/orbit" : "tide/still");
      return next;
    });
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    const root = rootRef.current;
    if (!cv || !root) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const audio = getFieldAudio();
    audio.start();

    reduceMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => { reduceMotionRef.current = mq.matches; };
    mq.addEventListener?.("change", onMq);

    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.floor(window.innerWidth * dpr);
      cv.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // ── pointer handling ────────────────────────────────────────────
    const grab = (clientX: number, clientY: number): "moon" | "sun" | null => {
      const g = geomRef.current;
      const dm = Math.hypot(clientX - g.moon.x, clientY - g.moon.y);
      const ds = Math.hypot(clientX - g.sun.x, clientY - g.sun.y);
      const moonReach = g.moon.r + 34;
      const sunReach = g.sun.r + 34;
      const moonOk = dm <= moonReach;
      const sunOk = ds <= sunReach;
      if (moonOk && sunOk) return dm <= ds ? "moon" : "sun";
      if (moonOk) return "moon";
      if (sunOk) return "sun";
      return null;
    };

    const angleFromEarth = (clientX: number, clientY: number) => {
      const g = geomRef.current;
      return Math.atan2(clientY - g.earth.y, clientX - g.earth.x);
    };

    const onDown = (e: PointerEvent) => {
      const target = grab(e.clientX, e.clientY);
      dragRef.current = { active: true, id: e.pointerId, target, moved: false, downX: e.clientX, downY: e.clientY };
      cv.setPointerCapture?.(e.pointerId);
      if (target) {
        try { audio.playNote(target === "moon" ? 62 : 57, 140); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        recordTapeRef.current("object", 0.5, `tide/grab-${target}`);
      }
    };

    const onMove = (e: PointerEvent) => {
      cursor.current.tx = e.clientX;
      cursor.current.ty = e.clientY;
      cursor.current.over = true;

      const d = dragRef.current;
      if (!d.active) return;
      if (!d.moved && Math.hypot(e.clientX - d.downX, e.clientY - d.downY) > 5) d.moved = true;
      if (!d.target) return;

      const ang = angleFromEarth(e.clientX, e.clientY);
      if (d.target === "moon") moonAngRef.current = ang;
      else sunAngRef.current = ang;

      const now = performance.now();
      if (now - lastDragToneRef.current > 90) {
        lastDragToneRef.current = now;
        const tN = clamp(
          (bodyTide(moonAngRef.current, MOON_AMP) + bodyTide(sunAngRef.current, SUN_AMP)) / (MOON_AMP + SUN_AMP),
          -1, 1,
        );
        try { audio.playNote(52 + Math.round((tN * 0.5 + 0.5) * 20), 90); } catch { /* noop */ }
        try { haptics.ripple(0.18 + Math.abs(tN) * 0.22); } catch { /* noop */ }
      }
      if (now - lastDragTapeRef.current > 560) {
        lastDragTapeRef.current = now;
        recordTapeRef.current("ripple", 0.3, `tide/${d.target}`);
      }
    };

    const endTap = (e: PointerEvent) => {
      const d = dragRef.current;
      const wasActive = d.active;
      const wasTap = !d.moved && !d.target;
      dragRef.current = { active: false, id: -1, target: null, moved: false, downX: 0, downY: 0 };
      try { cv.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
      if (!wasActive || !wasTap) return;
      const g = geomRef.current;
      if (Math.hypot(e.clientX - g.earth.x, e.clientY - g.earth.y) <= g.earth.r * 1.35) {
        toggleAuto();
        addRipple(e.clientX, e.clientY, Math.max(70, g.earth.r * 2.4), "gold");
        return;
      }
      // a tap on the open sea — a soft chime and a pale ring.
      try { audio.chime(); } catch { /* noop */ }
      try { haptics.ripple(0.3); } catch { /* noop */ }
      recordTapeRef.current("ripple", 0.24, "tide/sea");
      addRipple(e.clientX, e.clientY, 70, "pale");
    };

    const onLeave = () => { cursor.current.over = false; };

    cv.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endTap);
    window.addEventListener("pointercancel", endTap);
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    // ── audio cadence: the beat tracks the tidal phase ──────────────
    const stepBeat = (now: number, tideN: number, band: "high" | "mid" | "low") => {
      const bpm = 48 + (tideN * 0.5 + 0.5) * 36;
      const beatLen = 60 / bpm;
      const idx = Math.floor((now - t0) / 1000 / beatLen);
      const phase = ((now - t0) / 1000) % beatLen;
      if (idx === lastBeatRef.current || phase > 0.06) return;
      lastBeatRef.current = idx;
      // sparse — skip beats in the muddy middle band so highs/lows sing.
      if (band === "mid" && idx % 2 === 0) return;
      const midi = 50 + Math.round((tideN * 0.5 + 0.5) * 15);
      try {
        if (band === "high") audio.playNote(midi + 5, 260);
        else if (band === "low") audio.playNote(midi - 4, 320);
        else audio.playNote(midi, 200);
      } catch { /* noop */ }
    };

    // ── render loop ─────────────────────────────────────────────────
    const draw = (nowMs: number) => {
      const now = nowMs;
      const t = (now - t0) / 1000;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const motion = reduceMotionRef.current ? 0 : 1;

      // auto-orbit: the passage of hours moves the Moon on its own.
      if (autoRef.current && !dragRef.current.target && motion) {
        moonAngRef.current = (moonAngRef.current + 0.0055) % TAU;
      }

      const moonAng = moonAngRef.current;
      const sunAng = sunAngRef.current;

      // tide height at the shore, exaggerated for legibility.
      const rawTide = bodyTide(moonAng, MOON_AMP) + bodyTide(sunAng, SUN_AMP);
      const tideN = clamp(rawTide / (MOON_AMP + SUN_AMP), -1, 1);
      // alignment: +1 at syzygy (new or full) -> spring; -1 at quadrature -> neap.
      const align = Math.cos(2 * (moonAng - sunAng));
      // moon illumination follows elongation from the Sun.
      const elong = ((moonAng - sunAng) % TAU + TAU) % TAU;
      const illum = (1 - Math.cos(elong)) / 2;
      const waxing = Math.sin(elong) > 0;

      // ── sky ──────────────────────────────────────────────────────
      const skyG = ctx.createLinearGradient(0, 0, 0, h * 0.62);
      skyG.addColorStop(0, "rgba(14, 19, 32, 1)");
      skyG.addColorStop(0.5, "rgba(22, 40, 68, 1)");
      skyG.addColorStop(1, "rgba(38, 68, 104, 1)");
      ctx.fillStyle = skyG;
      ctx.fillRect(0, 0, w, h);

      // stars (deterministic constellation, faint twinkle)
      ctx.fillStyle = "rgba(240, 244, 248, 0.6)";
      for (let i = 0; i < 70; i++) {
        const sx = (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1;
        const sy = (((Math.sin(i * 78.233) * 43758.5453) % 1) + 1) % 1;
        const tw = 0.6 + 0.4 * Math.sin(t * 1.4 + i * 1.3);
        ctx.globalAlpha = 0.42 * tw;
        ctx.fillRect(sx * w, sy * h * 0.5, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;

      // ── sea: its level rises and falls with the computed tide ─────
      const meanSeaY = h * 0.64;
      const swing = h * 0.085;
      const waterY = meanSeaY - tideN * swing;
      const seaG = ctx.createLinearGradient(0, waterY, 0, h);
      seaG.addColorStop(0, "rgba(34, 62, 96, 1)");
      seaG.addColorStop(0.4, "rgba(18, 38, 66, 1)");
      seaG.addColorStop(1, "rgba(6, 14, 28, 1)");
      ctx.fillStyle = seaG;
      ctx.fillRect(0, waterY, w, h - waterY);

      // moon-glint on the water beneath the Moon's azimuth
      const glintX = clamp(w * 0.5 + Math.cos(moonAng) * w * 0.28, 40, w - 40);
      const glint = ctx.createLinearGradient(glintX, waterY, glintX, h);
      glint.addColorStop(0, `rgba(232, 240, 252, ${0.28 + illum * 0.22})`);
      glint.addColorStop(1, "rgba(232, 240, 252, 0)");
      ctx.fillStyle = glint;
      ctx.fillRect(glintX - 30, waterY, 60, h - waterY);

      // swell lines — cadence quickens toward high tide
      const speed = 0.3 + (tideN * 0.5 + 0.5) * 0.9;
      const swells = [
        { off: 0.04, amp: 6, freq: 0.011, color: "rgba(160, 200, 230, 0.42)" },
        { off: 0.13, amp: 10, freq: 0.0095, color: "rgba(120, 170, 210, 0.5)" },
        { off: 0.24, amp: 15, freq: 0.008, color: "rgba(80, 130, 180, 0.6)" },
        { off: 0.34, amp: 21, freq: 0.0065, color: "rgba(50, 100, 150, 0.72)" },
      ];
      for (const s of swells) {
        const y0 = waterY + (h - waterY) * s.off;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const ph = x * s.freq + t * speed * motion;
          const v = Math.sin(ph) + 0.35 * Math.sin(ph * 2.3);
          const yy = y0 + v * s.amp;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      // waterline highlight
      ctx.strokeStyle = `rgba(220, 235, 255, ${0.2 + Math.abs(tideN) * 0.14})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, waterY);
      ctx.lineTo(w, waterY);
      ctx.stroke();

      // ── tide staff: a shore ruler with HIGH / MEAN / LOW + float ──
      const staffX = w < 620 ? 30 : 52;
      const hiY = meanSeaY - swing;
      const loY = meanSeaY + swing;
      ctx.strokeStyle = "rgba(242, 238, 230, 0.28)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(staffX, hiY);
      ctx.lineTo(staffX, loY);
      ctx.stroke();
      const ticks: Array<[number, string]> = [[hiY, "high"], [meanSeaY, "mean"], [loY, "low"]];
      ctx.font = "10px var(--font-mono, monospace)";
      ctx.textBaseline = "middle";
      for (const [ty, label] of ticks) {
        ctx.strokeStyle = "rgba(242, 238, 230, 0.35)";
        ctx.beginPath();
        ctx.moveTo(staffX - 5, ty);
        ctx.lineTo(staffX + 5, ty);
        ctx.stroke();
        ctx.fillStyle = "rgba(242, 238, 230, 0.42)";
        ctx.fillText(label, staffX + 10, ty);
      }
      // float at the current level
      const floatY = meanSeaY - tideN * swing;
      ctx.fillStyle = "rgba(200, 115, 42, 0.95)";
      ctx.beginPath();
      ctx.arc(staffX, floatY, 5.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 220, 160, 0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(staffX, floatY, 9, 0, TAU);
      ctx.stroke();

      // ── the mechanism: Earth, water ellipse, orbit, Moon, Sun ─────
      const ex = w * 0.5;
      const ey = h * (w < 620 ? 0.34 : 0.36);
      const earthR = Math.min(w, h) * (w < 620 ? 0.072 : 0.06);
      const orbitR = Math.min(w * 0.32, h * 0.24);
      const sunOrbitR = orbitR * 1.34;

      // orbit rings
      ctx.strokeStyle = "rgba(220, 235, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ex, ey, orbitR, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 220, 160, 0.09)";
      ctx.beginPath();
      ctx.arc(ex, ey, sunOrbitR, 0, TAU);
      ctx.stroke();

      // alignment line — glows near spring (syzygy)
      const springGlow = clamp((align - 0.2) / 0.8, 0, 1);
      if (springGlow > 0.01) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 224, 168, ${springGlow * 0.5})`;
        ctx.lineWidth = 1 + springGlow * 2;
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(moonAng) * orbitR, ey + Math.sin(moonAng) * orbitR);
        ctx.lineTo(ex - Math.cos(moonAng) * orbitR, ey - Math.sin(moonAng) * orbitR);
        ctx.stroke();
        ctx.restore();
      }

      // water ellipse — long axis points at the Moon, fatter near spring.
      const bulge = 0.24 + (align * 0.5 + 0.5) * 0.4; // 0.24 (neap) .. 0.64 (spring)
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(moonAng);
      const rx = earthR * (1 + bulge);
      const ry = earthR * (1 - bulge * 0.42);
      const wg = ctx.createRadialGradient(0, 0, earthR * 0.4, 0, 0, rx);
      wg.addColorStop(0, "rgba(90, 150, 200, 0.05)");
      wg.addColorStop(0.7, "rgba(110, 170, 220, 0.28)");
      wg.addColorStop(1, "rgba(150, 200, 240, 0.06)");
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(180, 216, 245, ${0.3 + springGlow * 0.35})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();

      // Earth body
      const eg = ctx.createRadialGradient(ex - earthR * 0.3, ey - earthR * 0.3, earthR * 0.1, ex, ey, earthR);
      eg.addColorStop(0, "rgba(70, 120, 150, 1)");
      eg.addColorStop(0.6, "rgba(34, 74, 104, 1)");
      eg.addColorStop(1, "rgba(16, 38, 62, 1)");
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(ex, ey, earthR, 0, TAU);
      ctx.fill();

      // shore marker on the Earth rim (the point whose tide we read)
      const shoreX = ex + Math.cos(SHORE_PHI) * earthR;
      const shoreY = ey + Math.sin(SHORE_PHI) * earthR;
      const shoreHot = clamp(tideN * 0.5 + 0.5, 0, 1);
      ctx.fillStyle = `rgba(255, ${Math.round(190 + shoreHot * 40)}, ${Math.round(120 + (1 - shoreHot) * 60)}, 0.95)`;
      ctx.beginPath();
      ctx.arc(shoreX, shoreY, 4 + shoreHot * 2, 0, TAU);
      ctx.fill();

      // Sun — draggable warm body on the outer ring
      const sx = ex + Math.cos(sunAng) * sunOrbitR;
      const sy = ey + Math.sin(sunAng) * sunOrbitR;
      const sunR = earthR * 0.62;
      const sunHalo = ctx.createRadialGradient(sx, sy, 0, sx, sy, sunR * 3);
      sunHalo.addColorStop(0, "rgba(255, 214, 130, 0.5)");
      sunHalo.addColorStop(0.4, "rgba(255, 180, 90, 0.18)");
      sunHalo.addColorStop(1, "rgba(255, 180, 90, 0)");
      ctx.fillStyle = sunHalo;
      ctx.beginPath();
      ctx.arc(sx, sy, sunR * 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 226, 158, 1)";
      ctx.beginPath();
      ctx.arc(sx, sy, sunR, 0, TAU);
      ctx.fill();

      // Moon — on the inner orbit, lit by its angle to the Sun
      const mx = ex + Math.cos(moonAng) * orbitR;
      const my = ey + Math.sin(moonAng) * orbitR;
      const moonR = earthR * 0.5;
      const grabbedMoon = dragRef.current.target === "moon";
      // soft grab halo
      ctx.fillStyle = `rgba(226, 236, 250, ${grabbedMoon ? 0.22 : 0.12})`;
      ctx.beginPath();
      ctx.arc(mx, my, moonR * (grabbedMoon ? 2 : 1.6), 0, TAU);
      ctx.fill();
      // dark disc
      ctx.fillStyle = "rgba(40, 54, 78, 1)";
      ctx.beginPath();
      ctx.arc(mx, my, moonR, 0, TAU);
      ctx.fill();
      // lit crescent/gibbous: clip to the disc, draw a lit lens toward the Sun
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, moonR, 0, TAU);
      ctx.clip();
      const lit = ctx.createRadialGradient(
        mx + Math.cos(sunAng) * moonR * 0.9,
        my + Math.sin(sunAng) * moonR * 0.9,
        0,
        mx + Math.cos(sunAng) * moonR * 0.9,
        my + Math.sin(sunAng) * moonR * 0.9,
        moonR * (0.7 + illum * 1.8),
      );
      lit.addColorStop(0, "rgba(244, 246, 250, 0.98)");
      lit.addColorStop(1, "rgba(244, 246, 250, 0)");
      ctx.fillStyle = lit;
      ctx.fillRect(mx - moonR, my - moonR, moonR * 2, moonR * 2);
      ctx.restore();
      ctx.strokeStyle = "rgba(226, 236, 250, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx, my, moonR, 0, TAU);
      ctx.stroke();

      // publish geometry for hit-testing
      geomRef.current = {
        earth: { x: ex, y: ey, r: earthR },
        moon: { x: mx, y: my, r: moonR },
        sun: { x: sx, y: sy, r: sunR },
        orbitR,
        sunOrbitR,
      };

      // ── candle on the sill (kept atmosphere + flame-lean) ─────────
      const narrow = w < 700;
      const sillY = h - (narrow ? 26 : 34);
      const candleX = w - (narrow ? 56 : 96);
      const candleH = narrow ? 58 : 74;
      const candleW = narrow ? 17 : 21;
      const candleBaseY = sillY;

      // sill ledge
      ctx.fillStyle = "rgba(80, 56, 36, 0.9)";
      ctx.fillRect(candleX - 44, sillY, 88, 12);

      const cur = cursor.current;
      if (cur.tx > -9000) {
        cur.x = cur.x < -9000 ? cur.tx : cur.x + (cur.tx - cur.x) * 0.2;
        cur.y = cur.y < -9000 ? cur.ty : cur.y + (cur.ty - cur.y) * 0.2;
      }
      const flameAnchorX = candleX;
      const flameAnchorY = candleBaseY - candleH - 18;
      let leanTarget = 0;
      if (cur.over && motion && cur.x > -9000) {
        const dx = cur.x - flameAnchorX;
        const dy = cur.y - flameAnchorY;
        const dd = Math.hypot(dx, dy);
        const pull = Math.max(0, 1 - dd / 300);
        leanTarget = (dx / (dd || 1)) * pull * 6;
      }
      candleLean.current += (leanTarget - candleLean.current) * 0.15;
      const leanX = candleLean.current;

      const sparkAge = candleSparkRef.current ? now - candleSparkRef.current : Infinity;
      const sparkBoost = sparkAge < 350 ? 1 - sparkAge / 350 : 0;
      const flickerR = (40 + Math.sin(t * 3.4) * 6 + Math.sin(t * 7.1) * 3) * (motion || 1) * (1 + sparkBoost * 0.6);
      const halo = ctx.createRadialGradient(candleX, candleBaseY - candleH - 10, 0, candleX, candleBaseY - candleH - 10, flickerR);
      halo.addColorStop(0, `rgba(255, 200, 130, ${0.5 + sparkBoost * 0.4})`);
      halo.addColorStop(0.4, `rgba(200, 115, 42, ${0.28 + sparkBoost * 0.3})`);
      halo.addColorStop(1, "rgba(200, 115, 42, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(candleX, candleBaseY - candleH - 10, flickerR, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "rgba(242, 238, 230, 0.95)";
      ctx.fillRect(candleX - candleW / 2, candleBaseY - candleH, candleW, candleH);
      ctx.strokeStyle = "rgba(21,23,26,0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(candleX - candleW / 2, candleBaseY - candleH, candleW, candleH);
      ctx.strokeStyle = "rgba(21,23,26,0.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(candleX, candleBaseY - candleH - 1);
      ctx.lineTo(candleX, candleBaseY - candleH - 9);
      ctx.stroke();
      const flameJitter = motion ? Math.sin(t * 9) * 1.2 + Math.cos(t * 5.3) * 0.8 : 0;
      ctx.fillStyle = "rgba(255, 200, 130, 0.85)";
      ctx.beginPath();
      ctx.moveTo(candleX, candleBaseY - candleH - 9);
      ctx.quadraticCurveTo(candleX + 5 + flameJitter + leanX, candleBaseY - candleH - 16, candleX + leanX * 0.6, candleBaseY - candleH - 26);
      ctx.quadraticCurveTo(candleX - 5 - flameJitter + leanX, candleBaseY - candleH - 16, candleX, candleBaseY - candleH - 9);
      ctx.fill();
      ctx.fillStyle = "rgba(200, 115, 42, 0.92)";
      ctx.beginPath();
      ctx.moveTo(candleX, candleBaseY - candleH - 9);
      ctx.quadraticCurveTo(candleX + 2.6 + leanX * 0.6, candleBaseY - candleH - 13, candleX + leanX * 0.4, candleBaseY - candleH - 20);
      ctx.quadraticCurveTo(candleX - 2.6 + leanX * 0.6, candleBaseY - candleH - 13, candleX, candleBaseY - candleH - 9);
      ctx.fill();

      // ── events: tide-band + spring crossings drive haptics/bell ───
      const band: "high" | "mid" | "low" = tideN > 0.55 ? "high" : tideN < -0.55 ? "low" : "mid";
      if (band !== tideBandRef.current) {
        if (band === "high") {
          try { audio.chime(); } catch { /* noop */ }
          try { haptics.ripple(0.6); } catch { /* noop */ }
          recordTapeRef.current("ripple", 0.66, "tide/high");
          addRipple(shoreX, shoreY, 96, "gold");
        } else if (band === "low") {
          try { audio.thud(); } catch { /* noop */ }
          try { haptics.roll(); } catch { /* noop */ }
          recordTapeRef.current("ripple", 0.5, "tide/low");
        }
        tideBandRef.current = band;
      }
      const sBand: "spring" | "mid" | "neap" = align > 0.72 ? "spring" : align < -0.72 ? "neap" : "mid";
      if (sBand !== springBandRef.current) {
        if (sBand === "spring") {
          try { audio.bell(); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          recordTapeRef.current("sigil", 0.82, "tide/spring");
        } else if (sBand === "neap") {
          try { audio.thud(); } catch { /* noop */ }
          recordTapeRef.current("sigil", 0.4, "tide/neap");
        }
        springBandRef.current = sBand;
      }

      stepBeat(now, tideN, band);

      // ── readout (throttled) ──────────────────────────────────────
      if (Math.floor(t * 7) !== Math.floor((t - 0.016) * 7)) {
        const pct = Math.round(tideN * 100);
        const phaseWord = sBand === "spring" ? "spring" : sBand === "neap" ? "neap" : "mid";
        const bandWord = band === "high" ? "high" : band === "low" ? "low" : "rising/falling";
        setReadout(`tide ${pct >= 0 ? "+" : ""}${pct}% · ${bandWord} · ${phaseWord} · ${phaseName(illum, waxing)}`);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      mq.removeEventListener?.("change", onMq);
      cv.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endTap);
      window.removeEventListener("pointercancel", endTap);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [addRipple, toggleAuto]);

  return (
    <div
      ref={rootRef}
      className="tide-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
    >
      <canvas
        ref={canvasRef}
        className="tide-canvas"
        role="img"
        aria-label="A lunar tide instrument. Drag the moon around the earth to swing the tidal bulges; the sea at the shore rises to high tide and falls to low. Move the sun to feel spring and neap tides."
      />

      <div className="tide-title" aria-hidden="true">
        <span>tide / lunar gravity</span>
        <strong>Tide</strong>
      </div>

      <button type="button" className="tide-orbit-primary" aria-pressed={auto} onClick={toggleAuto}>
        {auto ? "pause" : "orbit"}
      </button>

      <span className="tide-play-hint" aria-hidden="true">drag moon &amp; sun · tap earth</span>

      <MobileInstrumentPanel
        className="tide-mobile-panel"
        title="orbit & alignment"
        triggerLabel="tune"
        summary={readout}
      >
        <div className="tide-rail" aria-label="tide controls">
          <button type="button" className="tide-btn tide-orbit-secondary" aria-pressed={auto} onClick={toggleAuto}>
            {auto ? "pause orbit" : "let it orbit"}
          </button>
          <button type="button" className="tide-btn" onClick={() => setSunOffset(0, "spring")}>
            align sun · spring
          </button>
          <button type="button" className="tide-btn" onClick={() => setSunOffset(Math.PI / 2, "neap")}>
            quarter sun · neap
          </button>
        </div>
      </MobileInstrumentPanel>

      <output className="tide-readout" aria-live="polite">{readout}</output>

      <div
        className="tide-inscription-wrap"
        style={{ position: "fixed", left: 0, right: 0, bottom: 62, textAlign: "center", pointerEvents: "none", zIndex: 6 }}
      >
        <span
          className="tide-inscription"
          role="button"
          tabIndex={0}
          aria-label="what burns also keeps watch — chime"
          onClick={(e) => {
            e.stopPropagation();
            try { getFieldAudio().bell(); } catch { /* noop */ }
            try { haptics.roll(); } catch { /* noop */ }
            candleSparkRef.current = performance.now();
            recordTape("candle", 0.55, "inscription");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              try { getFieldAudio().bell(); } catch { /* noop */ }
              try { haptics.roll(); } catch { /* noop */ }
              candleSparkRef.current = performance.now();
              recordTape("candle", 0.55, "inscription");
            }
          }}
        >
          what burns also keeps watch.
        </span>
      </div>

      <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
        {ripples.map((r) => (
          <span
            key={r.id}
            className="tide-ripple"
            style={{
              left: r.x - r.size / 2,
              top: r.y - r.size / 2,
              width: r.size,
              height: r.size,
              borderColor: r.tone === "gold" ? "rgba(200,115,42,0.85)" : "rgba(220,235,255,0.45)",
            }}
          />
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .tide-instrument {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #0c1422;
          color: rgba(242, 238, 230, 0.94);
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .tide-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: grab;
          z-index: 0;
        }
        .tide-canvas:active { cursor: grabbing; }

        .tide-title {
          position: fixed;
          z-index: 2;
          top: 78px;
          left: var(--pad-x, 28px);
          pointer-events: none;
        }
        .tide-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(242, 238, 230, 0.46);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }
        .tide-title strong {
          display: block;
          color: rgba(246, 242, 226, 0.96);
          font-family: var(--font-serif);
          font-size: 128px;
          font-weight: 500;
          line-height: 0.86;
        }

        .tide-rail {
          position: fixed;
          z-index: 3;
          top: 92px;
          right: var(--pad-x, 28px);
          display: grid;
          gap: 8px;
          width: min(230px, 40vw);
        }
        .tide-btn {
          min-height: 48px;
          border: 1px solid rgba(200, 150, 90, 0.28);
          border-radius: 8px;
          background: rgba(12, 20, 34, 0.56);
          color: rgba(242, 238, 230, 0.82);
          padding: 8px 12px;
          font-family: var(--font-mono);
          font-size: 11px;
          text-align: left;
          cursor: pointer;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        .tide-btn[aria-pressed="true"] {
          border-color: rgba(200, 115, 42, 0.6);
          color: rgba(255, 214, 150, 0.96);
          background: rgba(200, 115, 42, 0.14);
        }

        .tide-orbit-primary,
        .tide-play-hint { display: none; }

        .tide-readout {
          position: fixed;
          z-index: 4;
          left: 50%;
          transform: translateX(-50%);
          bottom: calc(22px + env(safe-area-inset-bottom, 0px));
          max-width: min(560px, calc(100vw - 32px));
          padding: 9px 16px;
          border: 1px solid rgba(242, 238, 230, 0.13);
          border-radius: 999px;
          background: rgba(8, 14, 24, 0.58);
          color: rgba(242, 238, 230, 0.74);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          pointer-events: none;
        }

        .tide-inscription {
          display: inline-block;
          padding: 4px 8px;
          font-family: var(--font-serif);
          font-style: italic;
          font-size: 16px;
          color: rgba(242, 238, 230, 0.55);
          cursor: pointer;
          pointer-events: auto;
        }

        .tide-ripple {
          position: absolute;
          border-radius: 999px;
          border: 1.5px solid rgba(220, 235, 255, 0.45);
          animation: tide-ripple 0.72s ease-out forwards;
        }
        @keyframes tide-ripple {
          from { transform: scale(0.2); opacity: 0.8; }
          to { transform: scale(1); opacity: 0; }
        }

        body:has(.tide-instrument) {
          background: #0c1422;
          overflow: hidden;
        }
        body:has(.tide-instrument) header:not(.oda-site-header) { display: none !important; }
        body:has(.tide-instrument) .oda-field-watch,
        body:has(.tide-instrument) .oda-candle-mark,
        body:has(.tide-instrument) .oda-tape-shell,
        body:has(.tide-instrument) .oda-sound-toggle {
          display: none !important;
        }

        @media (prefers-reduced-motion: reduce) {
          .tide-ripple { animation: none; display: none; }
        }

        @media (max-width: 940px) {
          .tide-title { top: 34px; left: 20px; }
          .tide-title strong { font-size: 82px; }
          .tide-rail { top: auto; left: 12px; right: 12px; bottom: calc(74px + env(safe-area-inset-bottom, 0px)); width: auto; grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .tide-btn { text-align: center; font-size: 10px; padding: 8px 6px; }
        }
        @media (max-width: 720px) {
          .tide-readout { display: none; }
          .tide-orbit-primary {
            position: fixed;
            z-index: 5;
            right: 14px;
            bottom: calc(68px + env(safe-area-inset-bottom, 0px));
            min-width: 72px;
            min-height: 42px;
            display: inline-grid;
            place-items: center;
            border: 1px solid rgba(200, 150, 90, 0.42);
            border-radius: 999px;
            padding: 0 14px;
            background: rgba(12, 20, 34, 0.84);
            color: rgba(242, 238, 230, 0.9);
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            font: 10px/1 var(--font-mono);
            letter-spacing: 0.08em;
            text-transform: lowercase;
            cursor: pointer;
          }
          .tide-orbit-primary[aria-pressed="true"] {
            border-color: rgba(200, 115, 42, 0.7);
            background: rgba(200, 115, 42, 0.18);
            color: rgba(255, 214, 150, 0.96);
          }
          .tide-play-hint {
            position: fixed;
            z-index: 2;
            left: 50%;
            bottom: calc(122px + env(safe-area-inset-bottom, 0px));
            display: block;
            transform: translateX(-50%);
            color: rgba(242, 238, 230, 0.6);
            font: 10px/1 var(--font-mono);
            letter-spacing: 0.06em;
            white-space: nowrap;
            text-shadow: 0 2px 12px rgba(0, 0, 0, 0.82);
            pointer-events: none;
          }
          .tide-mobile-panel .mobile-instrument-panel__trigger {
            max-width: calc(100vw - 112px);
            border-color: rgba(200, 150, 90, 0.38);
            background: rgba(12, 20, 34, 0.86);
          }
          .tide-mobile-panel .mobile-instrument-panel__sheet {
            background: rgba(9, 16, 28, 0.98);
            border-color: rgba(200, 150, 90, 0.24);
          }
          .tide-mobile-panel .tide-rail {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .tide-mobile-panel .tide-orbit-secondary { display: none; }
          .tide-mobile-panel .tide-btn {
            min-height: 58px;
            padding: 10px;
            text-align: center;
          }
          .tide-inscription-wrap { bottom: 158px !important; }
        }
        @media (max-width: 520px) {
          .tide-title strong { font-size: 62px; }
          .tide-mobile-panel .tide-rail { grid-template-columns: 1fr; }
        }
      `,
        }}
      />
    </div>
  );
}
