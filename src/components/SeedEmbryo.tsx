"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import {
  morphFromSeed,
  growMorph,
  rattleMorph,
  restingEnergy,
  mulberry32,
  mix32,
  type SeedMorph,
} from "@/lib/seed";
import {
  onVisibility,
  onGalleryPause,
  resolveDpr,
  createIdleWriter,
  createFrameGovernor,
  isEmbeddedFrame,
  detailForTier,
  type QualityTier,
} from "@/lib/room-runtime";

const STORAGE_KEY = "objetdart:seed:v1";

export default function SeedEmbryo() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");

    let morph: SeedMorph = morphFromSeed(mix32(Date.now() & 0xffff, 0x5eed));
    let generations = 0;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { morph?: SeedMorph; generations?: number };
        if (parsed.morph) morph = parsed.morph;
        if (typeof parsed.generations === "number") generations = parsed.generations;
      }
    } catch {
      /* fresh */
    }
    setHasKept(restingEnergy(morph) > 0.05 || generations > 0);

    const writer = createIdleWriter(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ morph, generations }));
      } catch {
        /* noop */
      }
      setHasKept(restingEnergy(morph) > 0.05 || generations > 0);
    });

    let width = 0;
    let height = 0;
    let tier: QualityTier = gov.tier();
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = resolveDpr(tier, { embedded, reducedMotion: reduced });
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let tiltX = 0;
    let tiltY = 0;
    let wind = 0;
    let agitation = 0;
    let pressure = 0;
    let asleep = false;
    let hidden = document.hidden;
    let galleryPaused = false;
    let lastTouchAt = performance.now();
    let glimmerAt = 0;
    let last = performance.now();
    let raf = 0;
    let running = true;

    const syncSleep = () => {
      const sleep = hidden || galleryPaused || (embedded && !document.hasFocus());
      if (sleep) gov.force("sleep");
      asleep = sleep;
    };

    const unvis = onVisibility((h) => {
      hidden = h;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduced || asleep) return;
        tiltX = Math.max(-1, Math.min(1, gamma / 45));
        tiltY = Math.max(-1, Math.min(1, (beta - 35) / 45));
      },
      shake: ({ intensity }) => {
        if (reduced || asleep) return;
        morph = rattleMorph(morph, intensity);
        agitation = Math.min(1, agitation + intensity);
        haptics.chop();
        audio.buzz();
        writer.schedule();
      },
      knock: () => {
        if (asleep) return;
        agitation = Math.min(1, agitation + 0.4);
        haptics.tap();
        audio.thud();
      },
      flip: ({ faceDown }) => {
        asleep = faceDown || hidden || galleryPaused;
        if (faceDown) haptics.roll();
      },
    });

    const detachGestures = attachGestures(
      canvas,
      {
        tap: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            agitation = Math.min(1, agitation + 0.3);
            audio.chime();
            haptics.ripple(0.45);
            return;
          }
          if (e.fingers === 2) return;
          agitation = Math.min(1, agitation + 0.12 * e.intensity);
          audio.playNote(48 + Math.round(e.intensity * 14), 160);
          haptics.tap();
        },
        hold: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers !== 1) return;
          if (e.phase === "enter") {
            pressure = 0.4;
            audio.spark();
            haptics.ripple(0.4);
          }
          if (e.phase === "tick") {
            pressure = Math.min(1, 0.4 + e.elapsed / 2800);
            agitation = Math.min(1, agitation + e.elapsed / 50000);
          }
          if (e.phase === "release") {
            if (e.tier >= 3) {
              morph = { ...morph, husk: Math.max(0, morph.husk - 0.55), radicle: Math.min(1, morph.radicle + 0.25) };
              generations += 1;
              audio.bell();
              haptics.bloom();
              writer.schedule();
            }
            pressure = 0;
          }
        },
        drag: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3 && !reduced) wind = Math.max(-1, Math.min(1, wind + e.dx * 0.002));
          else if (e.fingers === 1) {
            tiltX = Math.max(-1, Math.min(1, tiltX + e.dx * 0.0015));
            tiltY = Math.max(-1, Math.min(1, tiltY + e.dy * 0.0015));
          }
        },
        scrub: () => {
          lastTouchAt = performance.now();
          agitation = Math.min(1, agitation + 0.2);
          audio.playNote(62, 200);
          haptics.ripple(0.35);
        },
        rhythm: (e) => {
          if (e.stability > 0.7) agitation = Math.min(1, agitation + 0.08);
        },
      },
      { wheelZoom: false },
    );

    const draw = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tier = gov.beginFrame(now);
      const detail = detailForTier(tier);

      if (!asleep && !reduced) {
        morph = growMorph(morph, dt * detail.simHz / 60, pressure);
        if (pressure > 0) writer.schedule();
      }
      agitation *= reduced ? 0.9 : 0.985;
      wind *= 0.98;

      const t = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      ctx.clearRect(0, 0, width, height);
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, "#1a140f");
      g.addColorStop(0.55, "#0f1612");
      g.addColorStop(1, "#0a0e0c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      // soil motes
      const moteN = Math.floor(40 * detail.particles);
      const soilRng = mulberry32(morph.seed ^ 0x5011);
      for (let i = 0; i < moteN; i++) {
        const mx = soilRng() * width;
        const my = height * (0.55 + soilRng() * 0.45);
        ctx.fillStyle = `rgba(90,70,40,${0.15 + soilRng() * 0.25})`;
        ctx.fillRect(mx, my, 1.5, 1.5);
      }

      const cx = width * 0.5 + tiltX * 28 + wind * 12;
      const cy = height * 0.52 + tiltY * 18;
      const scale = Math.min(width, height) * 0.16 * morph.mass;

      // radicle
      if (morph.radicle > 0.02) {
        ctx.strokeStyle = `rgba(120,160,90,${0.45 + morph.radicle * 0.4})`;
        ctx.lineWidth = 2 + morph.radicle * 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy + scale * 0.2);
        const len = morph.radicle * scale * 1.8;
        ctx.quadraticCurveTo(
          cx + tiltX * 20 + Math.sin(t * 2) * 6 * agitation,
          cy + len * 0.5,
          cx + tiltX * 30,
          cy + len,
        );
        ctx.stroke();
      }

      // husk / body
      const split = 1 - morph.husk;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tiltX * 0.2 + wind * 0.1);
      const hue = 28 + morph.hue * 40;
      ctx.fillStyle = `hsla(${hue}, 42%, ${28 + morph.open * 10}%, 0.92)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, scale * (0.7 + split * 0.15), scale, 0, 0, Math.PI * 2);
      ctx.fill();
      if (split > 0.05) {
        ctx.strokeStyle = `rgba(240,220,160,${0.25 + split * 0.4})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-scale * 0.2, -scale * 0.6);
        ctx.lineTo(scale * 0.15, scale * 0.5);
        ctx.stroke();
      }
      // cotyledons
      if (morph.open > 0.05) {
        const o = morph.open;
        ctx.fillStyle = `rgba(150,190,100,${0.35 + o * 0.45})`;
        ctx.beginPath();
        ctx.ellipse(-scale * 0.35 * o, -scale * 0.7 * o, scale * 0.45 * o, scale * 0.22 * o, -0.6, 0, Math.PI * 2);
        ctx.ellipse(scale * 0.35 * o, -scale * 0.7 * o, scale * 0.45 * o, scale * 0.22 * o, 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      // breath glow
      ctx.fillStyle = `rgba(243,215,122,${0.08 + breath * 0.1 + agitation * 0.15})`;
      ctx.beginPath();
      ctx.arc(0, 0, scale * (1.1 + breath * 0.15), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (now - lastTouchAt > 20000 && now - glimmerAt > 6000 && !reduced && !asleep) glimmerAt = now;
      if (glimmerAt && now - glimmerAt < 1600) {
        const u = (now - glimmerAt) / 1600;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(238,234,219,${0.28 * (1 - u)})`;
        ctx.arc(cx, cy, 16 + u * 40, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (!asleep || agitation > 0.02) raf = requestAnimationFrame(draw);
      else {
        // sleep: wake check slowly
        raf = window.setTimeout(() => {
          raf = requestAnimationFrame(draw);
        }, 200) as unknown as number;
      }
    };
    raf = requestAnimationFrame(draw);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        agitation = Math.min(1, agitation + 0.2);
        audio.spark();
        haptics.tap();
      }
      if (e.key === "ArrowLeft") tiltX = Math.max(-1, tiltX - 0.1);
      if (e.key === "ArrowRight") tiltX = Math.min(1, tiltX + 0.1);
      if (e.key === "ArrowUp") pressure = 0.7;
      if (e.key === "ArrowDown") pressure = 0;
    };
    window.addEventListener("keydown", onKey);

    (wrap as HTMLDivElement & { __letGo?: () => void }).__letGo = () => {
      morph = morphFromSeed(mix32(morph.seed, generations + 1));
      generations = 0;
      writer.flush();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ morph, generations }));
      } catch {
        /* noop */
      }
      setHasKept(false);
    };

    return () => {
      running = false;
      ro.disconnect();
      detachGestures();
      detachVessel();
      unvis();
      ungal();
      writer.flush();
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, []);

  const letGo = () => {
    const wrap = wrapRef.current as (HTMLDivElement & { __letGo?: () => void }) | null;
    wrap?.__letGo?.();
    getFieldAudio().thud();
    haptics.roll();
    setHasKept(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#0a0e0c" }}>
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="a seed"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <LetGo label="let the seed rest" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
