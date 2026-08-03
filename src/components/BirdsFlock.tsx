"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import { flockFromSeed, stepFlock, roostBird, mix32, type Bird } from "@/lib/birds";
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

const STORAGE_KEY = "objetdart:birds:v1";

function countForTier(tier: QualityTier): number {
  if (tier === "sleep") return 12;
  if (tier === "low") return 28;
  if (tier === "medium") return 48;
  return 80;
}

export default function BirdsFlock() {
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

    let flockSeed = mix32(0xb17d, 1);
    let roosts = 0;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { seed?: number; roosts?: number };
        if (typeof parsed.seed === "number") flockSeed = parsed.seed;
        if (typeof parsed.roosts === "number") roosts = parsed.roosts;
      }
    } catch {
      /* fresh */
    }
    setHasKept(roosts > 0);

    const writer = createIdleWriter(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ seed: flockSeed, roosts }));
      } catch {
        /* noop */
      }
      setHasKept(roosts > 0);
    });

    let width = 0;
    let height = 0;
    let tier: QualityTier = gov.tier();
    let birds: Bird[] = flockFromSeed(flockSeed, countForTier(tier));

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

    let windX = 0;
    let windY = 0;
    let call = 60;
    let scare: { x: number; y: number; strength: number } | null = null;
    let weather = 0.2;
    let lastTouchAt = performance.now();
    let glimmerAt = 0;
    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    let last = performance.now();
    let lastCount = birds.length;
    let raf = 0;
    let running = true;

    const syncSleep = () => {
      asleep = hidden || galleryPaused;
      if (asleep) gov.force("sleep");
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
      tilt: ({ gamma, beta }) => {
        if (reduced || asleep) return;
        windX = Math.max(-0.4, Math.min(0.4, gamma / 90));
        windY = Math.max(-0.2, Math.min(0.2, (beta - 35) / 120));
      },
      shake: ({ intensity }) => {
        if (reduced || asleep) return;
        scare = { x: 0.5, y: 0.4, strength: 2 + intensity * 3 };
        haptics.chop();
        audio.buzz();
      },
    });

    const nearest = (x: number, y: number) => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < birds.length; i++) {
        const d = Math.hypot(birds[i].x - x, birds[i].y - y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    const detachGestures = attachGestures(
      canvas,
      {
        tap: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            weather = Math.min(1, weather + 0.2);
            audio.chime();
            haptics.ripple(0.4);
            return;
          }
          if (e.fingers === 2) return;
          scare = {
            x: e.x / Math.max(1, width),
            y: e.y / Math.max(1, height),
            strength: 1.5 + e.intensity * 2,
          };
          audio.playNote(call + Math.round(e.intensity * 8), 120);
          haptics.tap();
        },
        hold: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers !== 1) return;
          if (e.phase === "enter" && e.tier >= 1) {
            const i = nearest(e.x / width, e.y / height);
            birds = roostBird(birds, i);
            roosts += 1;
            writer.schedule();
            audio.spark();
            haptics.ripple(0.45);
          }
          if (e.phase === "release" && e.tier >= 3) {
            audio.bell();
            haptics.bloom();
          }
        },
        drag: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) weather = Math.max(0, Math.min(1, weather + e.dy * 0.001));
          else if (e.fingers === 1) {
            windX = Math.max(-0.5, Math.min(0.5, e.dx * 0.01));
            windY = Math.max(-0.3, Math.min(0.3, e.dy * 0.01));
          }
        },
        scrub: ({ angularVelocity }) => {
          lastTouchAt = performance.now();
          call = Math.max(48, Math.min(84, call + angularVelocity * 8));
          audio.playNote(Math.round(call), 100);
          haptics.ripple(0.25);
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
      const want = countForTier(tier);
      if (want !== lastCount) {
        birds = flockFromSeed(flockSeed, want);
        lastCount = want;
      }

      if (!asleep && !reduced) {
        birds = stepFlock(birds, dt, {
          separation: 1.8,
          alignment: 1.1,
          cohesion: 0.9,
          windX: windX + Math.sin(now / 1000) * 0.02,
          windY,
          scare,
          maxSpeed: 0.35 + weather * 0.1,
        });
      }
      if (scare) {
        scare.strength *= 0.92;
        if (scare.strength < 0.15) scare = null;
      }
      windX *= 0.96;
      windY *= 0.96;

      ctx.clearRect(0, 0, width, height);
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, `rgb(${140 - weather * 40},${180 - weather * 30},${210 - weather * 20})`);
      sky.addColorStop(1, "#dfe6c8");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // meadow
      ctx.fillStyle = "#8fa86a";
      ctx.beginPath();
      ctx.moveTo(0, height * 0.72);
      for (let x = 0; x <= width; x += 16) {
        ctx.lineTo(x, height * (0.72 + Math.sin(x * 0.01) * 0.02));
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.fill();

      for (const b of birds) {
        const x = b.x * width;
        const y = b.y * height;
        const ang = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.fillStyle = "rgba(30,30,35,0.85)";
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(-4, 2.5);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-4, -2.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      if (now - lastTouchAt > 20000 && now - glimmerAt > 6000 && !reduced && !asleep) glimmerAt = now;
      if (glimmerAt && now - glimmerAt < 1600) {
        const u = (now - glimmerAt) / 1600;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,255,255,${0.25 * (1 - u)})`;
        ctx.arc(width * 0.5, height * 0.4, 18 + u * 40, 0, Math.PI * 2);
        ctx.stroke();
      }

      void detail;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        scare = { x: 0.5, y: 0.4, strength: 2 };
        audio.playNote(call, 120);
      }
      if (e.key === "ArrowLeft") windX = -0.3;
      if (e.key === "ArrowRight") windX = 0.3;
    };
    window.addEventListener("keydown", onKey);

    (wrap as HTMLDivElement & { __letGo?: () => void }).__letGo = () => {
      roosts = 0;
      flockSeed = mix32(flockSeed, 99);
      birds = flockFromSeed(flockSeed, countForTier(tier));
      writer.flush();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ seed: flockSeed, roosts: 0 }));
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
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#b8cce0" }}>
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="birds"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <LetGo label="release the flock" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
