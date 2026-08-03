"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import {
  tideLine,
  sandWetness,
  spawnFoam,
  stepFoam,
  capFoam,
  mulberry32,
  mix32,
  type FoamSpeck,
} from "@/lib/coast";
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

const STORAGE_KEY = "objetdart:coast:v1";
const MAX_SHELLS = 24;

type Shell = { nx: number; ny: number; seed: number };

export default function CoastBeach() {
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

    let shells: Shell[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { shells?: Shell[] };
        if (Array.isArray(parsed.shells)) shells = parsed.shells.slice(-MAX_SHELLS);
      }
    } catch {
      /* fresh */
    }
    setHasKept(shells.length > 0);

    const writer = createIdleWriter(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ shells }));
      } catch {
        /* noop */
      }
      setHasKept(shells.length > 0);
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

    let foam: FoamSpeck[] = [];
    let tiltX = 0;
    let wind = 0;
    let moon = 0.5;
    let spray = 0;
    let grooves: { x0: number; y0: number; x1: number; y1: number; life: number }[] = [];
    let lastTouchAt = performance.now();
    let glimmerAt = 0;
    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    let last = performance.now();
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
        tiltX = Math.max(-1, Math.min(1, gamma / 45));
        moon = Math.max(0, Math.min(1, 0.5 + (beta - 35) / 90));
      },
      shake: ({ intensity }) => {
        if (reduced || asleep) return;
        spray = Math.min(1, spray + intensity);
        const tide = tideLine(performance.now() / 1000, moon);
        foam = capFoam(
          foam.concat(spawnFoam(mix32(Date.now() & 0xffff, 1), 0.5 + tiltX * 0.1, tide, Math.floor(8 * intensity))),
          Math.floor(80 * detailForTier(tier).particles),
        );
        haptics.chop();
        audio.buzz();
      },
      flip: ({ faceDown }) => {
        if (faceDown) {
          wind = 0;
          spray *= 0.2;
          haptics.roll();
        }
      },
    });

    const plantShell = (nx: number, ny: number) => {
      shells.push({ nx, ny, seed: mix32(Math.round(nx * 997), Math.round(ny * 991), shells.length) });
      if (shells.length > MAX_SHELLS) shells.shift();
      writer.schedule();
      audio.spark();
      haptics.ripple(0.5);
    };

    const detachGestures = attachGestures(
      canvas,
      {
        tap: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            wind = Math.max(-1, Math.min(1, wind + 0.35));
            audio.chime();
            haptics.ripple(0.4);
            return;
          }
          if (e.fingers === 2) return;
          const nx = e.x / Math.max(1, width);
          const ny = e.y / Math.max(1, height);
          foam = capFoam(foam.concat(spawnFoam(mix32(e.x, e.y), nx, ny, 6)), 100);
          audio.playNote(40 + Math.round((1 - ny) * 20), 140);
          haptics.tap();
        },
        hold: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers !== 1) return;
          if (e.phase === "enter" && e.tier >= 1) {
            plantShell(e.x / Math.max(1, width), e.y / Math.max(1, height));
          }
          if (e.phase === "release" && e.tier >= 3) {
            audio.bell();
            haptics.bloom();
          }
        },
        drag: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            wind = Math.max(-1, Math.min(1, wind + e.dx * 0.002));
            return;
          }
          if (e.fingers === 1 && e.phase !== "end") {
            grooves.push({
              x0: (e.x - e.dx) / width,
              y0: (e.y - e.dy) / height,
              x1: e.x / width,
              y1: e.y / height,
              life: 1,
            });
            if (grooves.length > 40) grooves.shift();
          }
        },
        scrub: () => {
          lastTouchAt = performance.now();
          const tide = tideLine(performance.now() / 1000, moon);
          foam = capFoam(foam.concat(spawnFoam(mix32(3, foam.length), 0.5, tide, 12)), 120);
          audio.playNote(55, 180);
          haptics.ripple(0.35);
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
      const t = audio.getAudioTime() ?? now / 1000;
      const tide = tideLine(t, moon);
      wind *= 0.99;
      spray *= 0.96;

      if (!asleep) {
        foam = capFoam(stepFoam(foam, dt, wind + tiltX * 0.3), Math.floor(100 * detail.particles));
        grooves = grooves.map((g) => ({ ...g, life: g.life - dt * 0.15 })).filter((g) => g.life > 0);
      }

      ctx.clearRect(0, 0, width, height);
      // sky
      const sky = ctx.createLinearGradient(0, 0, 0, height * tide);
      sky.addColorStop(0, "#7eb0d4");
      sky.addColorStop(1, "#cfe3f0");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height * tide + 2);

      // sea strip
      const sea = ctx.createLinearGradient(0, height * (tide - 0.12), 0, height * tide);
      sea.addColorStop(0, "rgba(40,110,150,0.55)");
      sea.addColorStop(1, "rgba(30,90,130,0.85)");
      ctx.fillStyle = sea;
      ctx.beginPath();
      ctx.moveTo(0, height * (tide - 0.08 + Math.sin(t * 1.2) * 0.01));
      for (let x = 0; x <= width; x += 8) {
        const nx = x / width;
        const y =
          tide -
          0.06 +
          Math.sin(nx * 9 + t * 1.4 + tiltX) * 0.012 +
          Math.sin(nx * 21 + t * 2.1) * 0.005;
        ctx.lineTo(x, y * height);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.fill();

      // sand
      for (let y = Math.floor(height * (tide - 0.02)); y < height; y += Math.max(2, Math.floor(4 / detail.samples))) {
        const ny = y / height;
        const wet = sandWetness(ny, tide);
        const shade = 180 - wet * 55 - (ny - tide) * 40;
        ctx.fillStyle = `rgb(${shade}, ${shade - 20}, ${shade - 45})`;
        ctx.fillRect(0, y, width, Math.max(2, Math.floor(4 / detail.samples)));
      }

      // dunes
      ctx.fillStyle = "rgba(210,185,140,0.55)";
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 12) {
        const nx = x / width;
        const h = 0.78 + Math.sin(nx * 4 + 0.4) * 0.04 + Math.sin(nx * 11) * 0.015;
        ctx.lineTo(x, h * height);
      }
      ctx.lineTo(width, height);
      ctx.fill();

      // grooves
      ctx.strokeStyle = "rgba(90,70,40,0.35)";
      ctx.lineWidth = 2;
      for (const g of grooves) {
        ctx.globalAlpha = g.life;
        ctx.beginPath();
        ctx.moveTo(g.x0 * width, g.y0 * height);
        ctx.lineTo(g.x1 * width, g.y1 * height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // shells
      for (const s of shells) {
        const rng = mulberry32(s.seed);
        const x = s.nx * width;
        const y = s.ny * height;
        ctx.fillStyle = `hsla(${30 + rng() * 40}, 35%, ${60 + rng() * 20}%, 0.85)`;
        ctx.beginPath();
        ctx.ellipse(x, y, 5 + rng() * 4, 3 + rng() * 2, rng() * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // foam
      for (const f of foam) {
        ctx.fillStyle = `rgba(255,255,255,${0.35 * f.life})`;
        ctx.beginPath();
        ctx.arc(f.x * width, f.y * height, 1.5 + f.life * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // spray
      if (spray > 0.05) {
        const rng = mulberry32(Math.floor(t * 3));
        for (let i = 0; i < Math.floor(20 * spray * detail.particles); i++) {
          ctx.fillStyle = `rgba(255,255,255,${0.3 * spray})`;
          ctx.fillRect(rng() * width, tide * height - rng() * 40 * spray, 2, 2);
        }
      }

      if (now - lastTouchAt > 20000 && now - glimmerAt > 6000 && !reduced && !asleep) glimmerAt = now;
      if (glimmerAt && now - glimmerAt < 1600) {
        const u = (now - glimmerAt) / 1600;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,255,255,${0.25 * (1 - u)})`;
        ctx.arc(width * 0.5, height * tide, 18 + u * 36, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const rng = mulberry32(mix32(shells.length, Math.floor(performance.now())));
        plantShell(0.4 + rng() * 0.2, tideLine(performance.now() / 1000, moon) + 0.05);
      }
      if (e.key === "ArrowLeft") wind = Math.max(-1, wind - 0.1);
      if (e.key === "ArrowRight") wind = Math.min(1, wind + 0.1);
    };
    window.addEventListener("keydown", onKey);

    (wrap as HTMLDivElement & { __letGo?: () => void }).__letGo = () => {
      shells = [];
      writer.flush();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ shells: [] }));
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
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#cfe3f0" }}>
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="the coast"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <LetGo label="clear the shore" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
