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
  advanceStage,
  imbibe,
  offspringSeed,
  stageIndex,
  stageOf,
  GERMINATION_STAGES,
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

    // ————— the seeds in the soil —————
    // More than one, because a seed's only real neighbour is another seed:
    // they share the water that percolates down, and the nearest root takes
    // the drop. A crowded pot germinates slower, and that is the whole law.
    type Kernel = { m: SeedMorph; nx: number; ny: number; born: number };
    const MAX_KERNELS = 4;
    let kernels: Kernel[] = [];
    let generations = 0;
    let morph: SeedMorph = morphFromSeed(mix32(Date.now() & 0xffff, 0x5eed));
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          morph?: SeedMorph;
          generations?: number;
          kernels?: Array<{ m: SeedMorph; nx: number; ny: number }>;
        };
        if (parsed.morph) morph = parsed.morph;
        if (typeof parsed.generations === "number") generations = parsed.generations;
        if (Array.isArray(parsed.kernels)) {
          kernels = parsed.kernels
            .filter((k) => k && k.m && typeof k.m.seed === "number")
            .slice(-MAX_KERNELS)
            .map((k) => ({
              m: k.m,
              nx: Math.max(0.08, Math.min(0.92, Number(k.nx) || 0.5)),
              ny: Math.max(0.3, Math.min(0.86, Number(k.ny) || 0.52)),
              born: performance.now(),
            }));
        }
      }
    } catch {
      /* fresh */
    }
    // the first seed IS the one this room has always held; the rest are what
    // it sets when it makes it all the way to a shoot
    if (kernels.length === 0) kernels = [{ m: morph, nx: 0.5, ny: 0.52, born: performance.now() }];
    const primary = () => kernels[0] ?? { m: morph, nx: 0.5, ny: 0.52, born: 0 };
    /** water percolating down through the soil — a finite thing, competed for */
    const drops: { x: number; y: number; vx: number; vy: number; seed: number; born: number }[] = [];
    let dropCount = 0;
    let nextRainAt = 0;
    /** the top rung: the whole unfurling, run stage by stage */
    let unfurl: { at: number; gain: number } | null = null;
    const soilRngLife = mulberry32(mix32(primary().m.seed, 0x5011fe));
    setHasKept(kernels.some((k) => restingEnergy(k.m) > 0.05) || generations > 0);

    const writer = createIdleWriter(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            morph: primary().m,
            generations,
            kernels: kernels.map((k) => ({ m: k.m, nx: k.nx, ny: k.ny })),
          }),
        );
      } catch {
        /* noop */
      }
      setHasKept(kernels.some((k) => restingEnergy(k.m) > 0.05) || generations > 0);
    });

    /** The kernel under a point, or the one nearest to it. */
    const kernelAt = (x: number, y: number): Kernel => {
      let best = kernels[0];
      let bestD = Infinity;
      for (const k of kernels) {
        const d = Math.hypot(x - k.nx * width, y - k.ny * height);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      return best;
    };

    /** Rain: drops enter the soil and fall. Whoever is nearest drinks. */
    const rain = (n: number, atX?: number, atY?: number) => {
      for (let i = 0; i < n && drops.length < 60; i++) {
        dropCount += 1;
        const u = ((mix32(dropCount, 0x7a10) >>> 8) % 1000) / 1000;
        const v = ((mix32(dropCount, 0x7a11) >>> 8) % 1000) / 1000;
        drops.push({
          x: atX != null ? atX + (u - 0.5) * 40 : u * width,
          y: atY != null ? atY + (v - 0.5) * 20 : -6 - v * 40,
          vx: (u - 0.5) * 14,
          vy: 40 + v * 50,
          seed: mix32(dropCount, 0x7a12),
          born: performance.now(),
        });
      }
    };

    /** One stage further along for this kernel, in sight, sound and hand. */
    const stepStage = (k: Kernel, gain: number): boolean => {
      const before = stageIndex(k.m);
      const next = advanceStage(k.m);
      if (stageIndex(next) === before) return false;
      k.m = next;
      agitation = Math.min(1, agitation + 0.25 + gain * 0.3);
      audio.playNote(46 + stageIndex(k.m) * 4, 200 + Math.round(gain * 160));
      haptics.detent();
      writer.schedule();
      return true;
    };

    /** A shoot sets seeds: the pot holds what it grew, not only what it was. */
    const setSeeds = (k: Kernel, gain: number) => {
      if (stageOf(k.m) !== "shoot") return;
      const n = kernels.length >= MAX_KERNELS ? 1 : 1 + Math.round(gain);
      for (let i = 0; i < n; i++) {
        const seed = offspringSeed(k.m.seed, generations * 8 + kernels.length + i);
        const side = i % 2 === 0 ? 1 : -1;
        const child: Kernel = {
          m: morphFromSeed(seed),
          nx: Math.max(0.1, Math.min(0.9, k.nx + side * (0.11 + ((seed >>> 9) % 100) / 900))),
          ny: Math.max(0.34, Math.min(0.84, k.ny + (((seed >>> 5) % 100) / 1000 - 0.05))),
          born: performance.now(),
        };
        if (kernels.length >= MAX_KERNELS) {
          // at the cap the eldest gives way, visibly — never a silent refusal
          const gone = kernels.shift();
          if (gone) audio.playNote(31, 220);
        }
        kernels.push(child);
      }
      generations += 1;
      audio.bell();
      haptics.bloom();
      writer.schedule();
    };

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
            // ...and the top rung's own act, the largest thing this room
            // does: the FULL UNFURLING. Every stage in turn, one per beat,
            // all the way to the shoot — and a shoot sets seeds, so the pot
            // holds a generation it did not hold before.
            const k = kernelAt(e.x, e.y);
            k.m = rattleMorph(k.m, 0.5 + depth * 0.5);
            unfurl = { at: performance.now(), gain: e.intensity + depth * 0.5 };
            agitation = Math.min(1, agitation + 0.5 + depth * 0.3);
            audio.bell();
            haptics.storm();
            writer.schedule();
            return;
          }
          if (tier === 5) {
            // the husk nicks: the split line brightens where the taps landed
            const k5 = kernelAt(e.x, e.y);
            k5.m = rattleMorph(k5.m, 0.35 + e.intensity * 0.3 + depth * 0.2);
            morph = primary().m;
            agitation = Math.min(1, agitation + 0.3);
            audio.spark();
            haptics.ripple(0.5 + depth * 0.3);
            writer.schedule();
            return;
          }
          if (tier === 3) {
            // the 3-rung is the germination itself: the seed under the hand
            // goes ONE stage further along — dormant → imbibed → split →
            // radicle → cotyledons → shoot — and the kernel knocks against
            // its husk on the way. A stage it cannot reach yet still answers.
            const k = kernelAt(e.x, e.y);
            k.m = rattleMorph(k.m, 0.12 + e.intensity * 0.15);
            if (!stepStage(k, e.intensity + depth * 0.4)) {
              agitation = Math.min(1, agitation + 0.2 + depth * 0.15);
              audio.buzz();
              haptics.chop();
            }
            morph = primary().m;
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
        // the hand's pressure works the seed it is on; the rest of the pot
        // grows on what it has drunk, which is the whole competition
        const held = kernels[0];
        for (const k of kernels) {
          const p = k === held ? pressure : 0;
          k.m = growMorph(k.m, (dt * timeScale * detail.simHz) / 60, p + (k.m.water ?? 0) * 0.22);
        }
        morph = primary().m;
        if (pressure > 0) writer.schedule();
      }

      // ————— the physics BETWEEN the seeds —————
      // Water percolates down and the NEAREST root takes it, so two seeds
      // planted close share one rain between them and both come on slower —
      // the pot is a finite thing, and crowding is felt as time.
      if (!asleep && !reduced) {
        for (let i = drops.length - 1; i >= 0; i--) {
          const d = drops[i];
          d.vy += 90 * dt * timeScale;
          d.vx += (tiltX * 40 + wind * 30) * dt;
          d.vx *= Math.exp(-dt * 1.1);
          d.x += d.vx * dt * timeScale;
          d.y += d.vy * dt * timeScale;
          if (d.y > height + 12) {
            drops.splice(i, 1);
            continue;
          }
          // whoever is nearest drinks it — and only one of them can
          let taken: Kernel | null = null;
          let bestD = Infinity;
          for (const k of kernels) {
            const kd = Math.hypot(d.x - k.nx * width, d.y - k.ny * height);
            if (kd < bestD) {
              bestD = kd;
              taken = k;
            }
          }
          const reach = Math.min(width, height) * 0.16 * (taken ? taken.m.mass : 1) * 1.1;
          if (taken && bestD < reach) {
            taken.m = imbibe(taken.m, 0.06);
            drops.splice(i, 1);
            agitation = Math.min(1, agitation + 0.02);
            writer.schedule();
          }
        }

        // ————— aliveness: it rains on the pot with nobody here —————
        if (nextRainAt === 0) nextRainAt = now + 5000;
        if (now >= nextRainAt) {
          nextRainAt = now + 7000 + soilRngLife() * 11000;
          rain(3 + Math.floor(soilRngLife() * 5));
          audio.playNote(38 + Math.round(soilRngLife() * 6), 140);
        }
        // a seed that has drunk enough comes on by itself, stage by stage
        for (const k of kernels) {
          if ((k.m.water ?? 0) > 0.55 && stageIndex(k.m) < GERMINATION_STAGES.length - 1) {
            if (now - k.born > 9000 + stageIndex(k.m) * 7000) {
              k.born = now;
              stepStage(k, 0.2);
            }
          }
        }
      }

      // the unfurling, run stage by stage so the eye can follow it
      if (unfurl && now >= unfurl.at) {
        const k = primary();
        if (stageIndex(k.m) >= GERMINATION_STAGES.length - 1) {
          setSeeds(k, unfurl.gain);
          unfurl = null;
        } else {
          stepStage(k, unfurl.gain);
          unfurl.at = now + 420;
        }
        morph = primary().m;
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

      // the water still falling through the soil
      for (const d of drops) {
        ctx.strokeStyle = `rgba(150,190,210,${0.35 + Math.min(0.4, d.vy / 400)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.vx * 0.02, d.y - Math.min(9, d.vy * 0.045));
        ctx.stroke();
      }

      // every seed in the pot, drawn where it sits
      for (const kern of kernels) {
      const morph = kern.m;
      const cx = width * (kern.nx - 0.5) * 1.0 + width * 0.5 + tiltX * 28 + wind * 12;
      const cy = height * (kern.ny - 0.52) + height * 0.52 + tiltY * 18;
      const scale = Math.min(width, height) * 0.16 * morph.mass * (kernels.length > 1 ? 0.78 : 1);

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
      // what it has drunk, held as a cool ring inside the husk — the number
      // that decides whether it can germinate at all, shown and never written
      const w = morph.water ?? 0;
      if (w > 0.02) {
        ctx.strokeStyle = `rgba(150,190,210,${0.15 + w * 0.35})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, scale * 0.78, -Math.PI / 2, -Math.PI / 2 + w * Math.PI * 2);
        ctx.stroke();
      }
      // the shoot, once the seed has come all the way through
      if (morph.open >= 0.72 && morph.radicle >= 0.72) {
        ctx.strokeStyle = `rgba(150,200,110,${0.5 + morph.open * 0.3})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -scale * 0.6);
        ctx.quadraticCurveTo(scale * 0.2, -scale * 1.4, 0, -scale * 2.1);
        ctx.stroke();
      }
      ctx.restore();
      }

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
        ctx.arc(
          width * (primary().nx - 0.5) + width * 0.5 + tiltX * 28 + wind * 12,
          height * (primary().ny - 0.52) + height * 0.52 + tiltY * 18,
          16 + u * 40,
          0,
          Math.PI * 2,
        );
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
      kernels = [{ m: morph, nx: 0.5, ny: 0.52, born: performance.now() }];
      drops.length = 0;
      unfurl = null;
      generations = 0;
      writer.flush();
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ morph, generations, kernels: kernels.map((k) => ({ m: k.m, nx: k.nx, ny: k.ny })) }),
        );
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
