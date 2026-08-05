"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
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
    // two-finger pan: shifts the whole frame, eased back toward center —
    // distinct from one-finger drag (which tilts the seed's own body).
    let frameX = 0;
    let frameY = 0;
    let frameTX = 0;
    let frameTY = 0;
    // twist (2 fingers): an x-ray lens baring the root system.
    const lens = { v: 0, t: 0 };
    let twistAcc = 0;
    // three-finger twist: the slow season, a render-only warm/cool cast.
    let season = 0;
    // three-finger hold: time dilation while held.
    let timeScale = 1;
    let timeScaleTarget = 1;
    // a steady tapped pulse entrains the seed's breath for a while.
    let breathHz = 0.14;
    let entrainUntil = 0;
    let spanVoiceAt = 0;
    let asleep = false;
    let hidden = document.hidden;
    let galleryPaused = false;
    let lastTouchAt = performance.now();
    let glimmerAt = 0;
    let earlyCueAt = 0;
    const mountedAt = performance.now();
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
      knock: ({ intensity }) => {
        if (asleep) return;
        // a rap on the case is a rap on the husk: the kernel shudders as
        // hard as the knuckle landed
        agitation = Math.min(1, agitation + 0.25 + intensity * 0.35);
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
            // tutti — the whole seed answers at once, as hard as the chord landed.
            agitation = Math.min(1, agitation + 0.2 + e.intensity * 0.25);
            audio.chime();
            haptics.ripple(0.3 + e.intensity * 0.35);
            return;
          }
          if (e.fingers === 2) {
            // step back: lower the raised root-lens first. ScaleTravel
            // reads data-lens-raised and yields to us when this is set.
            if (lens.t > 0.5) {
              lens.t = 0;
              canvas.removeAttribute("data-lens-raised");
              audio.playNote(50, 120);
              haptics.tap();
            }
            return;
          }
          // the rapid-tap ladder (tiers 1 / 3 / 5 / n from gesture/core):
          // a poke → the kernel knocks inside → the husk nicks visibly →
          // the seed rattles itself awake.
          const tier = tapTrainTier(e.count);
          const depth = tapTrainDepth(e.count);
          if (tier === "n") {
            // crescendo: a rattle the seed itself keeps up for a moment
            morph = rattleMorph(morph, 0.5 + depth * 0.5);
            agitation = Math.min(1, agitation + 0.5 + depth * 0.3);
            audio.bell();
            haptics.storm();
            writer.schedule();
            return;
          }
          if (tier === 5) {
            // the husk nicks: the split line brightens where the taps landed
            morph = rattleMorph(morph, 0.35 + e.intensity * 0.3 + depth * 0.2);
            agitation = Math.min(1, agitation + 0.3);
            audio.spark();
            haptics.ripple(0.5 + depth * 0.3);
            writer.schedule();
            return;
          }
          if (tier === 3) {
            // the loose kernel knocks against the inside of its husk
            morph = rattleMorph(morph, 0.12 + e.intensity * 0.15);
            agitation = Math.min(1, agitation + 0.2 + depth * 0.15);
            audio.buzz();
            haptics.chop();
            writer.schedule();
            return;
          }
          agitation = Math.min(1, agitation + 0.12 * e.intensity);
          audio.playNote(48 + Math.round(e.intensity * 14), 160);
          haptics.tap();
        },
        hold: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // three-finger hold = time dilation while held.
            if (e.phase === "enter") {
              timeScaleTarget = 0.25;
              audio.playNote(36, 260);
              haptics.tap();
            }
            if (e.phase === "release") timeScaleTarget = 1;
            return;
          }
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
              // the ceremony deepens past its own threshold: a hold released
              // at 2.5s splits less of the husk than one carried to 5s
              const over = Math.min(1, Math.max(0, e.elapsed - 2500) / 3000);
              morph = {
                ...morph,
                husk: Math.max(0, morph.husk - 0.45 - over * 0.35),
                radicle: Math.min(1, morph.radicle + 0.2 + over * 0.15),
              };
              generations += 1;
              audio.bell();
              haptics.bloom();
              writer.schedule();
            }
            pressure = 0;
          }
        },
        span: (e) => {
          lastTouchAt = performance.now();
          // two still fingers cradle the seed: held warmth. the embryo grows
          // gently for as long as the interval is sustained, deeper the longer
          // it is held — a cradle, not a press.
          if (e.phase === "release") {
            pressure = 0;
            haptics.ripple(0.15 + Math.min(1, e.elapsed / 5000) * 0.25);
            return;
          }
          if (e.phase === "enter") {
            audio.playNote(45, 300);
            haptics.tap();
          }
          pressure = Math.min(0.75, 0.25 + e.elapsed / 6000);
          const now = performance.now();
          if (now - spanVoiceAt > 640) {
            spanVoiceAt = now;
            audio.playNote(45 + Math.round(Math.min(1, e.elapsed / 5000) * 7), 220);
            haptics.ripple(0.1 + Math.min(1, e.elapsed / 5000) * 0.2);
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
        pan2: (e) => {
          lastTouchAt = performance.now();
          // two-finger drag pans the frame — the composition shifts, the
          // seed's own body (tilt/wind) stays exactly where it is.
          frameTX = Math.max(-40, Math.min(40, frameTX + e.dx * 0.3));
          frameTY = Math.max(-40, Math.min(40, frameTY + e.dy * 0.3));
        },
        twist: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // three-finger twist = season: a slow render-only warm/cool cast.
            if (e.phase === "move") season += e.angle * 0.7;
            return;
          }
          // twist (2 fingers) = rotate the lens: an x-ray view baring the
          // root system beneath the husk.
          if (e.phase === "start") twistAcc = 0;
          if (e.phase === "move") twistAcc += e.angle;
          if (e.phase === "end" && Math.abs(twistAcc) > 0.9) {
            lens.t = lens.t > 0.5 ? 0 : 1;
            if (lens.t > 0.5) canvas.setAttribute("data-lens-raised", "1");
            else canvas.removeAttribute("data-lens-raised");
            audio.chime();
            haptics.tap();
          }
        },
        scrub: (e) => {
          lastTouchAt = performance.now();
          // stirring the soil around the seed: how far the circle has wound
          // is how much earth turns, and its direction leans the seed with
          // the swirl — winding and velocity are axes, never switches
          const turn = Math.min(1, Math.abs(e.winding) / 2);
          const spin = Math.min(1, Math.abs(e.angularVelocity) / 8);
          agitation = Math.min(1, agitation + 0.12 + turn * 0.25 + spin * 0.1);
          wind = Math.max(-1, Math.min(1, wind + Math.sign(e.winding) * (0.15 + spin * 0.3)));
          audio.playNote(58 + Math.round(spin * 10), 160 + Math.round(turn * 160));
          haptics.ripple(0.25 + turn * 0.3);
        },
        rhythm: (e) => {
          if (e.stability <= 0.7) return;
          // the seed's breath falls in with the hand's pulse — its tempo,
          // not just its presence, is what the room takes up
          breathHz = Math.max(0.08, Math.min(0.6, e.bpm / 240));
          entrainUntil = performance.now() + 9000;
          agitation = Math.min(1, agitation + 0.06 + e.stability * 0.06);
          audio.playNote(52, 140);
          haptics.tap();
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

      // three-finger hold = time dilation while held.
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!asleep && !reduced) {
        morph = growMorph(morph, dt * timeScale * detail.simHz / 60, pressure);
        if (pressure > 0) writer.schedule();
      }
      agitation *= reduced ? 0.9 : 0.985;
      wind *= 0.98;
      frameX += (frameTX - frameX) * Math.min(1, dt * 6);
      frameY += (frameTY - frameY) * Math.min(1, dt * 6);
      frameTX *= 0.9;
      frameTY *= 0.9;
      lens.v += (lens.t - lens.v) * Math.min(1, dt * 5);

      // the entrained breath eases back to the room's own 0.14 Hz once the
      // hand's pulse has faded
      if (now >= entrainUntil) breathHz += (0.14 - breathHz) * Math.min(1, dt * 0.5);
      const t = (audio.getAudioTime() ?? now / 1000) * timeScale;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * breathHz) * 0.5 + 0.5;

      ctx.clearRect(0, 0, width, height);
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, "#1a140f");
      g.addColorStop(0.55, "#0f1612");
      g.addColorStop(1, "#0a0e0c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      // two-finger pan shifts the whole frame; the seed's own physics
      // (tilt/wind) stay put underneath it.
      ctx.save();
      ctx.translate(frameX, frameY);

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

      // radicle — the twist-lens bares the root system: brighter, thicker.
      if (morph.radicle > 0.02) {
        ctx.strokeStyle = `rgba(${120 + lens.v * 60},${160 + lens.v * 60},90,${0.45 + morph.radicle * 0.4 + lens.v * 0.3})`;
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
      // three-finger twist = season: a slow render-only warm/cool cast.
      const seasonWarm = Math.sin(season) * 0.5 + 0.5;
      const seasonHue = hue + (seasonWarm - 0.5) * 22;
      // twist-lens dims the husk so the bared root reads through it.
      ctx.fillStyle = `hsla(${seasonHue}, 42%, ${28 + morph.open * 10}%, ${0.92 - lens.v * 0.5})`;
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

      // an early, physical suggestion of the central verb (a hand can grow
      // this) — once, a few seconds in, well before the 20s idle glimmer.
      if (!reduced && !asleep && earlyCueAt === 0 && now - mountedAt > 2200 && now - lastTouchAt > 2000) {
        earlyCueAt = now;
        agitation = Math.min(1, agitation + 0.12);
      }
      if (now - lastTouchAt > 20000 && now - glimmerAt > 6000 && !reduced && !asleep) glimmerAt = now;
      if (glimmerAt && now - glimmerAt < 1600) {
        const u = (now - glimmerAt) / 1600;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(238,234,219,${0.28 * (1 - u)})`;
        ctx.arc(cx, cy, 16 + u * 40, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

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
