"use client";

/**
 * /mountain — the wanderer above the sea of fog. The olympus band at
 * ~10³·⁹ m, a peak standing kilometres over a valley tens of kilometres
 * wide (docs/plans/life-and-vista-bands.md §2).
 *
 * The invariant is two numbers: a heightfield seed and a fog altitude
 * (src/lib/heightfield.ts). What is peak, what is island and what is
 * drowned is a function of those two and nothing else.
 *
 * The load-bearing map is FOG ALTITUDE → THE SEA. The fog is a real
 * exponential-height volume, not a painted band: its optical depth along
 * any ray has a closed form, so what survives the distance is computed
 * rather than guessed, and its top rolls with a swell that is additive and
 * independent of the altitude. That last part is why raising the fog can
 * only ever drown more land — lift it and the ridges become an
 * archipelago, and the same water idiom that fills these valleys is the
 * one waiting one band down. Descend from the peak and the fog you were
 * standing above resolves into the actual sea.
 *
 * Where it rests is not a constant. A constant would drown one seed's
 * range and leave the next bare, so the room finds the inversion layer the
 * way weather does: the 62nd percentile of the land in a ring around the
 * summit. Whatever the seed, some of the range is always an archipelago.
 *
 * The figure with his back to us is not drawn. You are him, standing just
 * above the inversion layer with the fog at your feet, and the room is the
 * view: one finger turns the head, the vessel's tilt is the
 * horizon, and three fingers hold the world-law — the fog's altitude and
 * the sun's, with the whole palette following the sun from night through
 * dawn to alpenglow. The peak still keeps its cairns and its scree.
 *
 * A call is answered: tap and the ridge under your finger answers at the
 * delay its distance actually implies, lower the further it stands.
 *
 * Everything breathes on the shared 7s clock — the fog settles on the
 * exhale and lifts on the draw.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import { kickScree, stepScree, placeCairn, mulberry32, mix32, type Scree, type Cairn } from "@/lib/mountain";
import {
  FOG_BREATH_KM,
  OCTAVES_MARCH,
  ECHO_MAX_KM,
  echoDelayMs,
  echoMidi,
  fogSurfaceAt,
  fogTransmittance,
  groundAt,
  heightAt,
  paletteForSun,
  restingFogAltitude,
  snowlineKm,
  sunDirection,
  windVoice,
  type SkyPalette,
} from "@/lib/heightfield";
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
/** One mountain, always yours. */
const SEED = 0x0a1a;

/** The ranges the eye actually resolves, in km. Near ones get more octaves. */
// The first is the rock underfoot — a dark near ridge across the bottom
// of the frame, so the viewer is standing ON the mountain, not over it.
const RANGES = [0.26, 0.85, 1.5, 2.7, 4.8, 8.4, 15];
// A real pinhole, and a long lens. 66° made every ridge a low bump: apparent
// rise is focal-limited, and the massif's crests stand only ~0.26km over the
// inversion at 4km. 35° is also simply how the mountain photographs that
// prompted this room were taken — telephoto compression is what makes a peak
// tower. focal is derived from it rather than guessed.
const FOV = 0.62;
/** Where the eye stands, and how far it can see before the fog closes. */
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const rgb = (c: [number, number, number], a = 1) =>
  `rgba(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(
    clamp01(c[2]) * 255,
  )},${a})`;
const mixc = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

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

    // Where the wanderer stands. NOT on the highest point: from the summit
    // every other ridge lies below the horizon and the whole range reads as
    // flat bands. He stands just above the inversion layer, so the fog is a
    // sea at his feet and the peaks that clear it rise past his eye — which
    // is the composition, and also just where a person on a mountain is.
    const restingFog = restingFogAltitude(SEED);
    const eyeY = restingFog + 0.11;
    // Every seed gets its own summit to look at: the bearing whose crest
    // subtends the largest angle from this station, held a little off centre
    // so the eye has somewhere to travel. One scan, once, at mount.
    let bestBearing = 0;
    let bestAngle = -Infinity;
    for (let b = 0; b < 192; b++) {
      const a = (b / 192) * Math.PI * 2;
      for (const d of [1.5, 2.2, 3, 4, 5.5, 7, 9]) {
        const ang = (heightAt(Math.sin(a) * d, Math.cos(a) * d, SEED, OCTAVES_MARCH) - eyeY) / d;
        if (ang > bestAngle) {
          bestAngle = ang;
          bestBearing = a;
        }
      }
    }

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
    let horizonTilt = 0; // the vessel is level with the world
    let yaw = bestBearing + 0.16; // the head, turned — the summit off centre
    let yawTarget = yaw;
    /** the world-law: how high the sea of fog stands, in km off its rest */
    let fogLift = 0;
    let fogLiftTarget = 0;
    /** and where the sun stands */
    let sunElev = 0.22;
    let sunAz = 0.7;
    let season = 0.4;
    let lens = 0; // 0 felt, 1 contour
    let lastTouchAt = performance.now();
    let glimmerAt = 0;
    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    let last = performance.now();
    let raf = 0;
    let running = true;
    let screeSerial = 0;
    let windAt = 0;

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

    /** Where the ground stands along the ray through this column, in km. */
    const groundAlong = (col: number, d: number, oct: number) => {
      const a = yaw + (col - 0.5) * FOV;
      return heightAt(Math.sin(a) * d, Math.cos(a) * d, SEED, oct);
    };

    /** The call, and the answer the distance owes it. */
    const callOut = (col: number, row: number) => {
      let hitKm = 2.4;
      for (const d of RANGES) {
        const h = groundAlong(col, d, OCTAVES_MARCH);
        if (h > eyeY - d * 0.45) {
          hitKm = d;
          break;
        }
      }
      void row;
      audio.playNote(echoMidi(0), 170);
      // past ECHO_MAX_KM the range simply keeps the call — nothing waits forever
      if (hitKm > ECHO_MAX_KM) return;
      const delay = echoDelayMs(hitKm);
      window.setTimeout(() => {
        try {
          audio.playNote(echoMidi(hitKm), 300);
          haptics.tap();
        } catch {
          /* noop */
        }
      }, delay);
    };

    const detachVessel = onVessel({
      tilt: ({ gamma, beta }) => {
        if (reduced || asleep) return;
        tiltX = clamp(gamma / 45, -1, 1);
        // the vessel is level with the world: the horizon answers the hand
        horizonTilt = clamp(gamma / 90, -0.35, 0.35);
        yawTarget = clamp(yawTarget + gamma * 0.00012, -1.1, 1.1);
        void beta;
      },
      shake: ({ intensity }) => {
        if (reduced || asleep) return;
        scree = scree.concat(
          kickScree(mix32(screeSerial++, 2), 0.5 + tiltX * 0.1, 0.45, intensity),
        );
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
            season = clamp01(season + 0.2);
            audio.chime();
            haptics.ripple(0.4);
            return;
          }
          if (e.fingers === 2) return;
          callOut(e.x / Math.max(1, width), e.y / Math.max(1, height));
          haptics.tap();
        },
        hold: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) return;
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
          // the breath drawn: the fog settles while the finger stays down
          if (e.phase === "tick") fogLiftTarget = clamp(fogLiftTarget - 0.00018 * 16, -FOG_BREATH_KM, FOG_BREATH_KM);
          if (e.phase === "release" && e.tier >= 3) {
            audio.bell();
            haptics.bloom();
          }
        },
        drag: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // the world-law: the sea of fog rises and falls, and the sun moves
            fogLiftTarget = clamp(fogLiftTarget - e.dy * 0.0016, -FOG_BREATH_KM * 1.6, FOG_BREATH_KM * 2.4);
            sunAz += e.dx * 0.0022;
            sunElev = clamp(sunElev + e.dx * 0.0009, -0.34, 1);
            return;
          }
          if (e.fingers !== 1) return;
          // one finger turns the head
          yawTarget = clamp(yawTarget - e.dx * 0.0022, -1.1, 1.1);
        },
        twist: ({ angle }) => {
          lastTouchAt = performance.now();
          lens = clamp01(lens + angle * 0.15);
        },
        scrub: () => {
          lastTouchAt = performance.now();
          fogLiftTarget = clamp(fogLiftTarget - 0.06, -FOG_BREATH_KM * 1.6, FOG_BREATH_KM * 2.4);
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

      yaw += (yawTarget - yaw) * Math.min(1, dt * 3);
      fogLift += (fogLiftTarget - fogLift) * Math.min(1, dt * 1.6);
      fogLiftTarget *= Math.exp(-dt * 0.09); // the inversion always returns

      // the shared 7s breath: the fog settles on the exhale, lifts on the draw
      const breath = reduced ? 0 : Math.sin(t * Math.PI * 2 * 0.14);
      const fogAltitude = restingFog + fogLift + breath * FOG_BREATH_KM * 0.18;
      const phase = reduced ? 0 : t * 0.09;

      const sun = sunDirection(sunAz, sunElev);
      const pal: SkyPalette = paletteForSun(sunElev);
      const snowKm = snowlineKm(season);

      ctx.clearRect(0, 0, width, height);

      // ——— the sky, following the sun ———
      const horizonY = height * (0.46 + horizonTilt * 0.12);
      const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizonY));
      sky.addColorStop(0, rgb(pal.zenith));
      sky.addColorStop(1, rgb(pal.horizon));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, Math.max(0, horizonY));
      // the far field below the horizon: the fog at its thinnest, which every
      // ridge is then drawn into
      const fogGrad = ctx.createLinearGradient(0, Math.max(0, horizonY), 0, height);
      fogGrad.addColorStop(0, rgb(mixc(pal.fog, pal.horizon, 0.5)));
      fogGrad.addColorStop(1, rgb(pal.fog));
      ctx.fillStyle = fogGrad;
      ctx.fillRect(0, Math.max(0, horizonY), width, height);

      // the sun itself, where it stands
      if (sunElev > 0.45) {
        const sx = width * (0.5 + Math.sin(sunAz - yaw) * 0.55);
        const sy = horizonY - sunElev * height * 0.42;
        const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, Math.min(width, height) * 0.3);
        g.addColorStop(0, rgb(pal.sun, 0.85));
        g.addColorStop(1, rgb(pal.sun, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }

      // ——— the ranges, far to near: each column its own waterline ———
      // Painter's order, and per COLUMN rather than per range, because both
      // the fog's shoreline and the aerial perspective vary across the frame.
      const step = Math.max(2, Math.round(3 / Math.max(0.4, detail.samples)));
      const focal = width / 2 / Math.tan(FOV / 2);
      const ROCK: [number, number, number] = [0.30, 0.27, 0.235];
      const SNOW: [number, number, number] = [0.93, 0.95, 0.98];
      for (let r = RANGES.length - 1; r >= 0; r--) {
        const d = RANGES[r];
        const oct = r <= 1 ? 6 : r <= 3 ? 4 : 3;
        const near = r === 0;
        for (let x = -step; x <= width + step; x += step) {
          const col = clamp01(x / Math.max(1, width));
          const a = yaw + (col - 0.5) * FOV;
          const wx = Math.sin(a) * d;
          const wz = Math.cos(a) * d;
          const g = groundAt(wx, wz, SEED, oct);
          const h = g.h;
          const fogTop = fogSurfaceAt(wx, wz, fogAltitude, phase);
          const drowned = fogTop > h;
          const top = drowned ? fogTop : h;
          // The ray to THIS point, not a fixed one. A distant peak is reached
          // by a ray that climbs out of the fog, so it stays visible; a valley
          // floor is reached by one that descends into it, and drowns. Using a
          // constant direction here made every range past 2.7km compute as
          // opaque and vanish — including the ridge that clears the fog.
          const rise = top - eyeY;
          const dist = Math.hypot(d, rise);
          const trans = fogTransmittance(eyeY, rise / Math.max(1e-4, dist), dist, fogAltitude);
          let y = horizonY - rise * (focal / d) + (col - 0.5) * horizonTilt * height * 0.1;
          // The rock underfoot is a LEDGE, not a projected ridge: at a quarter
          // of a kilometre the outcrop the station stands on subtends more than
          // the whole frame, so it is held to the bottom third where it reads
          // as the ground you are standing on — which is the composition.
          if (near) y = Math.max(y, height * 0.66 + (col - 0.5) * horizonTilt * height * 0.06);
          if (y > height) continue;

          let seen: [number, number, number];
          if (lens > 0.5) {
            seen = drowned ? [0.91, 0.89, 0.83] : [0.78, 0.75, 0.68];
          } else if (near) {
            // the rock underfoot: ink-dark, barely touched by the light
            seen = [0.055, 0.052, 0.06];
          } else if (drowned) {
            // the sea itself, lit rather than painted
            seen = mixc(pal.fog, pal.horizon, clamp01(1 - trans) * 0.45);
          } else {
            const nLen = Math.hypot(-g.dhdx, 1, -g.dhdz) || 1;
            const lambert = clamp01(
              ((-g.dhdx * sun[0] + 1 * sun[1] + -g.dhdz * sun[2]) / nLen) * 0.5 + 0.5,
            );
            const light = pal.ambient + pal.sunI * lambert;
            // Snow by slope AND altitude, and scoured off the very top: the
            // highest rock is bare and dark because it is too steep and too
            // wind-blown to hold anything. That inversion is what makes a
            // summit read as a summit rather than as high ground.
            const slope = Math.hypot(g.dhdx, g.dhdz);
            const flat = 1 / (1 + slope * 2.6);
            const held = clamp01((h - snowKm) / 0.3) * flat;
            const scour = 1 - clamp01((h - (snowKm + 0.52)) / 0.22);
            const snowy = clamp01(held * scour);
            const albedo = mixc(ROCK, SNOW, snowy * 0.94);
            const face: [number, number, number] = [
              albedo[0] * light,
              albedo[1] * light,
              albedo[2] * light,
            ];
            // aerial perspective: every further ridge dissolves toward the sky
            seen = mixc(pal.fog, face, trans);
          }
          ctx.fillStyle = rgb(seen, 1);
          ctx.fillRect(x, y, step + 1, height - y);
        }
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

      // the wind, heard when the fog is low and the ridge is bare
      if (!asleep && !reduced && now - windAt > 5200) {
        windAt = now;
        const w = windVoice(Math.max(0, eyeY - fogAltitude));
        if (w.gain > 0.04) {
          try {
            audio.playTone(w.hz, 2.4);
          } catch {
            /* the sea is not awake */
          }
        }
      }

      if (now - lastTouchAt > 20000 && now - glimmerAt > 6000 && !reduced && !asleep) glimmerAt = now;
      if (glimmerAt && now - glimmerAt < 1600) {
        const u = (now - glimmerAt) / 1600;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,255,255,${0.22 * (1 - u)})`;
        ctx.arc(width * 0.5, horizonY + 10, 20 + u * 40, 0, Math.PI * 2);
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
      // the keyboard's own hand on the world-law: the fog rises and falls
      if (e.key === "ArrowUp") fogLiftTarget = clamp(fogLiftTarget + 0.06, -FOG_BREATH_KM * 1.6, FOG_BREATH_KM * 2.4);
      if (e.key === "ArrowDown") fogLiftTarget = clamp(fogLiftTarget - 0.06, -FOG_BREATH_KM * 1.6, FOG_BREATH_KM * 2.4);
      if (e.key === "ArrowLeft") yawTarget = clamp(yawTarget - 0.12, -1.1, 1.1);
      if (e.key === "ArrowRight") yawTarget = clamp(yawTarget + 0.12, -1.1, 1.1);
      if (e.key === "Escape") lens = 0;
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
        aria-label="the peak above the sea of fog"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <LetGo label="scatter the cairns" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
