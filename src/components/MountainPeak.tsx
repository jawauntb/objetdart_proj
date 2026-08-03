"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import {
  ridgeHeight,
  kickScree,
  stepScree,
  placeCairn,
  snowLine,
  mulberry32,
  mix32,
  type Scree,
  type Cairn,
} from "@/lib/mountain";
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

const STORAGE_KEY = "objetdart:mountain:v1";
const MAX_CAIRNS = 16;
const SEED = 0x0a1a;

export default function MountainPeak() {
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

    let cairns: Cairn[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { cairns?: Cairn[] };
        if (Array.isArray(parsed.cairns)) cairns = parsed.cairns.slice(-MAX_CAIRNS);
      }
    } catch {
      /* fresh */
    }
    setHasKept(cairns.length > 0);

    const writer = createIdleWriter(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ cairns }));
      } catch {
        /* noop */
      }
      setHasKept(cairns.length > 0);
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

    let scree: Scree[] = [];
    let tiltX = 0;
    let weather = 0.35;
    let lens = 0; // 0 felt, 1 contour
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
      tilt: ({ gamma }) => {
        if (reduced || asleep) return;
        tiltX = Math.max(-1, Math.min(1, gamma / 45));
      },
      shake: ({ intensity }) => {
        if (reduced || asleep) return;
        scree = scree.concat(kickScree(mix32(Date.now() & 0xffff, 2), 0.5 + tiltX * 0.1, 0.45, intensity));
        if (scree.length > 80) scree = scree.slice(-80);
        haptics.chop();
        audio.thud();
      },
    });

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
          audio.playNote(36 + Math.round((1 - e.y / height) * 24), 200);
          haptics.tap();
        },
        hold: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers !== 1) return;
          if (e.phase === "enter" && e.tier >= 1) {
            const stones = e.tier >= 3 ? 5 : e.tier >= 2 ? 3 : 1;
            cairns.push(
              placeCairn(mix32(e.x, e.y, cairns.length), e.x / width, e.y / height, stones),
            );
            if (cairns.length > MAX_CAIRNS) cairns.shift();
            writer.schedule();
            audio.spark();
            haptics.ripple(0.5);
          }
          if (e.phase === "release" && e.tier >= 3) {
            audio.bell();
            haptics.bloom();
          }
        },
        drag: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) weather = Math.max(0, Math.min(1, weather + e.dy * 0.001));
        },
        twist: ({ angle }) => {
          lastTouchAt = performance.now();
          lens = Math.max(0, Math.min(1, lens + angle * 0.15));
        },
        scrub: () => {
          lastTouchAt = performance.now();
          weather = Math.max(0, weather - 0.15);
          audio.playNote(50, 160);
          haptics.ripple(0.3);
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
      if (!asleep) scree = stepScree(scree, dt).slice(-Math.floor(80 * detail.particles));

      const snow = snowLine(t, weather);
      ctx.clearRect(0, 0, width, height);

      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, `rgba(${40 + weather * 40},${60 + weather * 30},${90 + weather * 40},1)`);
      sky.addColorStop(1, "#c4b49a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // mist
      if (weather > 0.2 && detail.shadows > 0) {
        ctx.fillStyle = `rgba(220,225,230,${0.15 * weather})`;
        ctx.fillRect(0, height * 0.45, width, height * 0.35);
      }

      const baseY = height * 0.92;
      const peakAmp = height * 0.72;
      const samples = Math.max(24, Math.floor(64 * detail.samples));

      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i <= samples; i++) {
        const nx = i / samples;
        const h = ridgeHeight(nx, SEED);
        const x = nx * width + tiltX * 18 * (1 - Math.abs(nx - 0.5) * 2);
        const y = baseY - h * peakAmp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();

      if (lens > 0.5) {
        ctx.fillStyle = "#e8e2d4";
        ctx.fill();
        ctx.strokeStyle = "rgba(40,40,40,0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
        // contour lines
        ctx.strokeStyle = "rgba(60,60,60,0.25)";
        for (let c = 0.2; c < 1; c += 0.15) {
          ctx.beginPath();
          let started = false;
          for (let i = 0; i <= samples; i++) {
            const nx = i / samples;
            const h = ridgeHeight(nx, SEED);
            if (h < c) {
              started = false;
              continue;
            }
            const x = nx * width + tiltX * 12;
            const y = baseY - c * peakAmp;
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else {
        const rock = ctx.createLinearGradient(0, height * 0.2, 0, height);
        rock.addColorStop(0, "#d8d5d0");
        rock.addColorStop(0.35, "#8a8478");
        rock.addColorStop(1, "#3a342c");
        ctx.fillStyle = rock;
        ctx.fill();

        // snow cap
        ctx.beginPath();
        let snowStarted = false;
        for (let i = 0; i <= samples; i++) {
          const nx = i / samples;
          const h = ridgeHeight(nx, SEED);
          if (h < 1 - snow) {
            snowStarted = false;
            continue;
          }
          const x = nx * width + tiltX * 18 * (1 - Math.abs(nx - 0.5) * 2);
          const y = baseY - h * peakAmp;
          if (!snowStarted) {
            ctx.moveTo(x, y);
            snowStarted = true;
          } else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(255,255,255,0.0)";
        ctx.fillStyle = "rgba(248,250,252,0.88)";
        // fill snow as band near top — simple overlay
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillRect(0, 0, width, height * (0.35 + (1 - snow) * 0.1));
        ctx.globalCompositeOperation = "source-over";
      }

      // cairns
      for (const c of cairns) {
        const rng = mulberry32(c.seed);
        const x = c.x * width;
        const y = c.y * height;
        for (let s = 0; s < c.stones; s++) {
          ctx.fillStyle = `rgba(${90 + rng() * 40},${85 + rng() * 30},${70 + rng() * 20},0.9)`;
          ctx.beginPath();
          ctx.ellipse(x + (rng() - 0.5) * 4, y - s * 5, 6 - s * 0.4, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // scree
      for (const s of scree) {
        ctx.fillStyle = `rgba(70,60,50,${0.7 * s.life})`;
        ctx.fillRect(s.x * width, s.y * height, 2.5, 2.5);
      }

      if (now - lastTouchAt > 20000 && now - glimmerAt > 6000 && !reduced && !asleep) glimmerAt = now;
      if (glimmerAt && now - glimmerAt < 1600) {
        const u = (now - glimmerAt) / 1600;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,255,255,${0.22 * (1 - u)})`;
        ctx.arc(width * 0.5, height * 0.35, 20 + u * 40, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        cairns.push(placeCairn(mix32(cairns.length, 9), 0.5, 0.55, 3));
        if (cairns.length > MAX_CAIRNS) cairns.shift();
        writer.schedule();
        audio.spark();
      }
      if (e.key === "ArrowUp") weather = Math.min(1, weather + 0.05);
      if (e.key === "ArrowDown") weather = Math.max(0, weather - 0.05);
    };
    window.addEventListener("keydown", onKey);

    (wrap as HTMLDivElement & { __letGo?: () => void }).__letGo = () => {
      cairns = [];
      writer.flush();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ cairns: [] }));
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
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#6a7a90" }}>
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="the mountain"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <LetGo label="scatter the cairns" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
