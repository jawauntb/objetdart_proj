"use client";

/**
 * /orb — plasma discs, countable.
 *
 * This file used to be a decorative widget: one aria-hidden canvas painting a
 * single plasma disc for whoever imported it, which by the end was nobody. The
 * material was always right — two crossing fbm-warped ribbons inside a radial
 * bloom, in one fragment shader — so the shader stayed and everything around it
 * became a room: a population of discs a hand can gather and let go, drifting
 * and pushing on each other in the dark.
 *
 * The whole field is ONE fullscreen quad. Discs reach the shader as a small
 * uniform array (position, radius, weight, seed, retire), so N discs cost one
 * draw call and no allocation per frame — the population's state vector lives
 * in a single Float32Array that is written in place.
 *
 * Determinism: every disc is a function of (seed, x, y, radius, born) and the
 * shared clocks. No Math.random anywhere; seeds come from a mulberry32 walk off
 * the field's own counter, so a reloaded field renders exactly as it was left.
 *
 * The laws it obeys, in `src/lib/orbfield.ts` and pinned by
 * `scripts/test-orbfield.mjs`: separation between discs, the drift integrator,
 * the dwell growth curve, and the cap that retires the oldest gracefully.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onVisibility,
} from "@/lib/room-runtime";
import { createGLStage, FULLSCREEN_VERT_CLIP } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  DISC_CAP,
  MAX_RADIUS,
  MIN_RADIUS,
  dwellRadius,
  seasonPalette,
  separate,
  stepDisc,
  type Disc,
} from "@/lib/orbfield";

const STORAGE_KEY = "objetdart:orb:v1";

// ———————————————————————————————————————————————————————————————
// the material: one quad, every disc, one pass
// ———————————————————————————————————————————————————————————————

const FIELD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_breath;
uniform float u_turbulence;
uniform float u_brightness;
uniform float u_reduced;
uniform float u_night;
uniform float u_lens;
uniform float u_tutti;
uniform int   u_count;
// Four floats per disc — x, y (aspect-corrected clip space), radius, weight —
// as a flat float array rather than vec4[], because the stage binds uniform
// arrays with uniform1fv and a flat array needs no second setter.
uniform float u_disc[${DISC_CAP * 4}];
// seed, retire 0..1, flare 0..1, season 0..1
uniform float u_discMeta[${DISC_CAP * 4}];
uniform vec3  u_palA;
uniform vec3  u_palHot;
uniform vec3  u_palB;
uniform vec3  u_palGlow;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.07;
    a *= 0.52;
  }
  return v;
}

/** One disc's premultiplied contribution at local uv (unit disc space). */
vec4 disc(vec2 uv, float seed, float weight, float retire, float flare, float t, float motion) {
  float r = length(uv);
  float edge = 1.0 - smoothstep(0.98, 1.005, r);
  if (edge <= 0.0) return vec4(0.0);

  float flow = 0.35 * motion;
  float breathe = 1.0 + sin(t * 6.2831853 * 0.14 * motion + seed * 6.2831853) * 0.14;

  // the ribbons turn with the lens, so twist really does rotate the level of
  // description rather than spinning the whole sprite
  float ca = cos(u_lens);
  float sa = sin(u_lens);
  vec2 lv = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);

  vec2 pA = lv * 1.6 + vec2(t * flow * 0.30 + seed * 7.1, t * flow * 0.20);
  vec2 pB = lv * 1.6 + vec2(t * flow * -0.22, t * flow * 0.27 + seed * 3.3);
  float nA = fbm(pA);
  float nB = fbm(pB + 17.3);

  float curveA = sin((lv.x + nA * 0.45) * 1.9 + t * flow * 0.55 + seed * 4.0) * 0.45;
  float bandA = smoothstep(0.42, 0.02, abs(lv.y - curveA));
  float curveB = sin((lv.y + nB * 0.45) * 1.7 + t * flow * 0.40 + 0.4) * 0.45;
  float bandB = smoothstep(0.42, 0.02, abs(lv.x - curveB));

  float turbA = fbm(lv * 3.4 + vec2(t * flow * 0.5, 0.0));
  float turbB = fbm(lv * 3.4 + vec2(0.0, t * flow * -0.5) + 9.1);
  bandA *= mix(0.75, 1.10, turbA);
  bandB *= mix(0.75, 1.10, turbB);

  float rimFade = smoothstep(1.0, 0.55, r);
  bandA *= rimFade;
  bandB *= rimFade;

  float hotMix = pow(bandA, 1.6) * smoothstep(0.9, 0.0, r);
  float bloom = exp(-r * r * 2.6);
  float coreHi = exp(-r * r * 8.0);

  vec3 col = u_palGlow * bloom * 0.85;
  col += mix(u_palA, u_palHot, hotMix) * bandA * 1.05;
  col += u_palB * bandB * 0.80;
  col += u_palB * coreHi * 0.35;
  col += u_palHot * coreHi * 0.25;

  // weight is the dwell made visible: a young disc is thin and pale, a long
  // hold leaves a heavy one. flare is the tap. retire is the bloom on the way
  // out — it brightens as it thins, so a delete is a farewell and not a cut.
  float body = 0.45 + 0.55 * weight;
  col *= breathe * body * (1.0 + flare * 1.6 + u_tutti * 0.9 + retire * 2.2);
  col *= (1.0 - smoothstep(0.86, 1.0, r) * 0.35);
  col *= (1.0 - u_night * 0.72);

  float aRadial = smoothstep(1.0, 0.0, r);
  float aField = clamp(bandA * 0.9 + bandB * 0.6 + bloom * 0.9 + coreHi, 0.0, 1.0);
  float alpha = clamp(mix(aRadial * 0.35, 1.0, aField), 0.0, 1.0) * edge;
  alpha *= (0.35 + 0.65 * weight) * (1.0 - retire);
  return vec4(col * alpha, alpha);
}

void main() {
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  float t = u_time;
  float motion = mix(1.0, 0.08, u_reduced);

  // the dark the discs stand in: a slow field, not a flat fill
  float haze = fbm(p * 0.7 + vec2(t * 0.012 * motion, t * -0.008 * motion));
  vec3 bg = mix(vec3(0.016, 0.021, 0.033), vec3(0.055, 0.036, 0.024), haze * 0.8);
  bg *= 0.55 + 0.45 * u_breath;
  bg += u_palGlow * 0.04 * u_turbulence * u_brightness;
  bg *= (1.0 - u_night * 0.8);
  vec3 col = bg;

  for (int i = 0; i < ${DISC_CAP}; i++) {
    if (i >= u_count) break;
    float dx = u_disc[i * 4];
    float dy = u_disc[i * 4 + 1];
    float dr = u_disc[i * 4 + 2];
    float dw = u_disc[i * 4 + 3];
    float seed = u_discMeta[i * 4];
    float retire = u_discMeta[i * 4 + 1];
    float flare = u_discMeta[i * 4 + 2];
    float rad = max(0.0001, dr * (1.0 + retire * 0.55));
    vec2 uv = (p - vec2(dx, dy)) / rad;
    vec4 c = disc(uv, seed, dw, retire, flare, t, motion);
    col = col * (1.0 - c.a) + c.rgb;
  }

  gl_FragColor = vec4(col, 1.0);
}`;

// ———————————————————————————————————————————————————————————————
// the room
// ———————————————————————————————————————————————————————————————

type Persisted = { discs: Array<[number, number, number, number, number]>; season: number };

function loadDiscs(nowMs: number): { discs: Disc[]; season: number } {
  if (typeof window === "undefined") return { discs: [], season: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { discs: [], season: 0 };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const rows = Array.isArray(parsed.discs) ? parsed.discs : [];
    const discs: Disc[] = [];
    for (const row of rows.slice(-DISC_CAP)) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const [x, y, radius, weight, seed] = row.map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) continue;
      discs.push({
        x: Math.max(-2, Math.min(2, x)),
        y: Math.max(-1.4, Math.min(1.4, y)),
        vx: 0,
        vy: 0,
        radius: Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius)),
        weight: Math.max(0, Math.min(1, weight || 0)),
        seed: Number.isFinite(seed) ? seed : 0.5,
        born: nowMs,
        flare: 0,
        retire: 0,
      });
    }
    const season = Number.isFinite(parsed.season) ? (parsed.season as number) : 0;
    return { discs, season };
  } catch {
    return { discs: [], season: 0 };
  }
}

export default function PlasmaOrb() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [standing, setStanding] = useState(0);

  // the field's whole mutable state, reachable from the render loop and from
  // the voice below without either re-creating the other
  const api = useRef({
    plant: (_nx: number, _ny: number, _intensity: number) => {},
    deepen: (_elapsed: number, _nx: number, _ny: number) => {},
    ceremony: (_nx: number, _ny: number) => {},
    tap: (_nx: number, _ny: number, _intensity: number) => {},
    tutti: (_intensity: number) => {},
    lens: (_angle: number) => {},
    season: (_angle: number) => {},
    wind: (_dx: number, _dy: number) => {},
    drag: (_dx: number, _dy: number) => {},
    timeScale: (_k: number) => {},
    scatter: (_intensity: number) => {},
    gravity: (_beta: number, _gamma: number) => {},
    knock: (_intensity: number) => {},
    night: (_faceDown: boolean) => {},
    glimmer: () => {},
    letGo: () => {},
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const audio = getFieldAudio();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches;
    const onMedia = () => { reduced = media.matches; };
    media.addEventListener?.("change", onMedia);

    const startedAt = performance.now();
    const restored = loadDiscs(startedAt);
    const discs: Disc[] = restored.discs;
    let seedWalk = discs.length * 7 + 1;

    // the room's own world fields
    let season = restored.season;
    let lens = 0;
    let wind = 0;
    let gravity = 0;
    let agitation = 0;
    let timeScale = 1;
    let tutti = 0;
    let night = 0;
    let growing: Disc | null = null;
    /** the standing disc a hold came down on, if any — see plant/ceremony */
    let held: Disc | null = null;

    const writer = createIdleWriter(() => {
      try {
        const payload: Persisted = {
          discs: discs
            .filter((d) => d.retire <= 0)
            .map((d) => [
              +d.x.toFixed(4),
              +d.y.toFixed(4),
              +d.radius.toFixed(4),
              +d.weight.toFixed(3),
              +d.seed.toFixed(5),
            ]),
          season: +season.toFixed(4),
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* quota / private mode — the field still plays */
      }
    });

    // aspect-corrected clip space: the shader reads x in [-aspect, aspect]
    const aspect = () => wrap.clientWidth / Math.max(1, wrap.clientHeight);
    const toField = (nx: number, ny: number) => ({
      x: (nx * 2 - 1) * aspect(),
      y: 1 - ny * 2,
    });
    const nearest = (x: number, y: number): Disc | null => {
      let best: Disc | null = null;
      let bestD = Infinity;
      for (const d of discs) {
        if (d.retire > 0) continue;
        const dist = Math.hypot(d.x - x, d.y - y);
        if (dist < d.radius * 1.35 && dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    };
    const nextSeed = () => {
      // mulberry32, one step — deterministic and cheap, never Math.random
      seedWalk = (seedWalk + 0x6d2b79f5) | 0;
      let t = seedWalk;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    api.current.plant = (nx, ny, intensity) => {
      const at = toField(nx, ny);
      // A finger that came down ON a disc is feeding that disc, not making a
      // new one: the same hold then means "grow this" while it is held and
      // "annihilate this" if it is held past the ceremony tier.
      const under = nearest(at.x, at.y);
      if (under) {
        held = under;
        growing = null;
        under.flare = Math.min(1.6, under.flare + 0.25 + intensity * 0.35);
        haptics.tap();
        return;
      }
      held = null;
      if (discs.length >= DISC_CAP) {
        // the cap retires the oldest gracefully rather than refusing the hand
        const oldest = discs.reduce((a, b) => (a.born <= b.born ? a : b));
        oldest.retire = Math.max(oldest.retire, 0.01);
      }
      const born: Disc = {
        x: at.x,
        y: at.y,
        vx: 0,
        vy: 0,
        radius: MIN_RADIUS,
        weight: 0,
        seed: nextSeed(),
        born: performance.now(),
        flare: 0.4 + intensity * 0.4,
        retire: 0,
      };
      discs.push(born);
      growing = born;
      audio.spark();
      haptics.ripple(0.35 + intensity * 0.3);
      writer.schedule();
      setStanding(discs.filter((d) => d.retire <= 0).length);
    };

    api.current.deepen = (elapsed, nx, ny) => {
      // holding longer keeps deepening it — never a switch that latches, and
      // never the same thing at 900ms as at 2400ms
      if (held) {
        held.weight = Math.min(1, held.weight + 0.004);
        held.flare = Math.min(1.6, 0.2 + Math.min(1, elapsed / 2500) * 0.9);
        return;
      }
      if (!growing) return;
      const at = toField(nx, ny);
      growing.x = at.x;
      growing.y = at.y;
      growing.radius = dwellRadius(elapsed);
      growing.weight = Math.min(1, elapsed / 3200);
    };

    api.current.ceremony = (nx, ny) => {
      const at = toField(nx, ny);
      // the solemn act, both ways round: a hold that began on a standing disc
      // annihilates it — the delete a thumb can reach — and a hold that made
      // one seals it instead, so the same gesture never both makes and unmakes.
      const target = held ?? nearest(at.x, at.y);
      if (target) {
        held = null;
        growing = null;
        target.retire = Math.max(target.retire, 0.001);
        audio.thud();
        haptics.bloom();
        writer.schedule();
        return;
      }
      if (growing) {
        growing.weight = 1;
        growing.flare = 1.4;
        growing = null;
        audio.bell();
        haptics.bloom();
        writer.schedule();
      }
    };

    api.current.tap = (nx, ny, intensity) => {
      const at = toField(nx, ny);
      const hit = nearest(at.x, at.y);
      if (hit) {
        hit.flare = Math.min(1.6, hit.flare + 0.3 + intensity * 1.1);
        hit.vx += (hit.x - at.x) * 0.6 * intensity;
        hit.vy += (hit.y - at.y) * 0.6 * intensity;
        audio.playNote(Math.round(62 + hit.seed * 12 + intensity * 6), 90 + intensity * 160);
      } else {
        // open dark still answers: the whole field shivers by the same amount
        for (const d of discs) d.flare = Math.min(1.6, d.flare + intensity * 0.16);
        audio.playNote(Math.round(48 + intensity * 8), 70 + intensity * 90);
      }
      haptics.ripple(0.15 + intensity * 0.5);
    };

    api.current.tutti = (intensity) => {
      tutti = Math.min(1, tutti + 0.5 + intensity * 0.5);
      for (const d of discs) d.flare = Math.min(1.6, d.flare + 0.5 + intensity * 0.4);
      audio.chime();
      haptics.bloom();
    };

    api.current.lens = (angle) => { lens += angle; };
    api.current.season = (angle) => {
      season = (season + angle / (Math.PI * 2) + 1) % 1;
      writer.schedule();
    };
    api.current.wind = (dx, dy) => {
      wind = Math.max(-1.4, Math.min(1.4, wind + dx * 1.8));
      for (const d of discs) d.vy += dy * 0.22;
    };
    api.current.drag = (dx, dy) => {
      for (const d of discs) {
        d.vx += dx * 0.0022;
        d.vy -= dy * 0.0022;
      }
    };
    api.current.timeScale = (k) => { timeScale = k; };
    api.current.scatter = (intensity) => {
      agitation = Math.min(1, agitation + intensity);
      for (const d of discs) {
        d.vx += (d.seed - 0.5) * intensity * 2.4;
        d.vy += (0.5 - d.seed) * intensity * 1.8;
        d.flare = Math.min(1.6, d.flare + intensity * 0.4);
      }
      haptics.chop();
    };
    api.current.gravity = (beta, gamma) => {
      gravity = Math.max(-1, Math.min(1, beta / 45));
      wind = Math.max(-1.4, Math.min(1.4, wind * 0.7 + (gamma / 45) * 0.5));
    };
    api.current.knock = (intensity) => {
      tutti = Math.min(1, tutti + 0.4 + intensity * 0.6);
      for (const d of discs) d.flare = Math.min(1.6, d.flare + 0.35 + intensity * 0.5);
      audio.bell();
      haptics.tap();
    };
    api.current.night = (faceDown) => { night = faceDown ? 1 : 0; };
    api.current.glimmer = () => {
      // the room hints physically: a ripple where a dwell would land
      if (discs.length === 0) {
        tutti = Math.min(1, tutti + 0.18);
        return;
      }
      const d = discs[Math.floor(((performance.now() / 6000) % 1) * discs.length)];
      if (d) d.flare = Math.min(1.6, d.flare + 0.32);
    };
    api.current.letGo = () => {
      // an exhale, never a blink: every disc blooms out over a breath, and
      // storage is written empty at once so an emptied field stays empty
      for (const d of discs) d.retire = Math.max(d.retire, 0.001);
      growing = null;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ discs: [], season }));
      } catch {
        /* noop */
      }
      writer.cancel();
      audio.thud();
      haptics.roll();
      setStanding(0);
    };

    // ——— the stage: context cascade, DPR tiers, clocks, loss, teardown ———
    let prog: ReturnType<NonNullable<typeof stage>["program"]> = null;
    let quad: ReturnType<NonNullable<typeof stage>["fullscreenQuad"]> | null = null;
    const stage = createGLStage(canvas, {
      wrap,
      label: "orb",
      reducedMotion: reduced,
      embedded: isEmbeddedFrame(),
      onContextLost: () => {
        // every GL object is gone; the loop keeps stepping the population so
        // the field is where the hand left it when the driver comes back
        quad = null;
        prog = null;
      },
      onContextRestored: () => {
        prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
        quad = stage && prog ? stage.fullscreenQuad(prog) : null;
        if (!prog) wrap.setAttribute("data-orb-fallback", "1");
      },
    });
    prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    if (!stage || !prog) {
      // no GL at all: the wrapper's own gradient stands in so the room reads
      wrap.setAttribute("data-orb-fallback", "1");
    }

    // one buffer per uniform array, allocated once — never inside the loop
    const discBuf = new Float32Array(DISC_CAP * 4);
    const metaBuf = new Float32Array(DISC_CAP * 4);

    const gov = createFrameGovernor();
    let hidden = false;
    const offVisibility = onVisibility((h) => {
      hidden = h;
      if (h) gov.force("sleep");
    });

    let raf = 0;
    let last = performance.now();
    let lastStanding = discs.filter((d) => d.retire <= 0).length;
    setStanding(lastStanding);

    const draw = (now: number) => {
      const tier = gov.beginFrame(now);
      if (hidden) {
        last = now;
        raf = requestAnimationFrame(draw); // no draw while the tab is away
        return;
      }
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (now - last) / 1000) * timeScale;
      last = now;
      const tSec = audio.getAudioTime() ?? now / 1000;
      const a = aspect();

      wind *= 0.985;
      agitation *= 0.94;
      tutti *= 0.92;

      // the population acts on itself, then on the world
      separate(discs, dt);
      let alive = 0;
      for (let i = discs.length - 1; i >= 0; i--) {
        const d = discs[i];
        stepDisc(d, dt, { wind, gravity, agitation, aspect: a, reducedMotion: reduced });
        d.flare *= Math.exp(-dt * 2.6);
        if (d.retire > 0) {
          d.retire = Math.min(1, d.retire + dt * 1.5);
          if (d.retire >= 1) {
            discs.splice(i, 1);
            continue;
          }
        }
        if (d.retire <= 0) alive += 1;
      }
      if (growing && growing.retire > 0) growing = null;
      if (held && held.retire > 0) held = null;
      if (alive !== lastStanding) {
        lastStanding = alive;
        setStanding(alive);
      }

      if (stage && prog && quad) {
        const size = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: agitation, reducedMotion: reduced }),
          prog,
        );
        void size;
        const pal = seasonPalette(season);
        // the tier scales how many discs the GPU is asked for, never which
        // ones exist — quality bends, the population does not
        const shown = Math.min(discs.length, Math.max(1, Math.ceil(DISC_CAP * detail.particles)));
        for (let i = 0; i < shown; i++) {
          const d = discs[i];
          discBuf[i * 4] = d.x;
          discBuf[i * 4 + 1] = d.y;
          discBuf[i * 4 + 2] = d.radius;
          discBuf[i * 4 + 3] = d.weight;
          metaBuf[i * 4] = d.seed;
          metaBuf[i * 4 + 1] = d.retire;
          metaBuf[i * 4 + 2] = d.flare;
          metaBuf[i * 4 + 3] = season;
        }
        prog.setInt("u_count", shown);
        prog.setFloatArray(["u_disc", "u_disc[0]"], discBuf);
        prog.setFloatArray(["u_discMeta", "u_discMeta[0]"], metaBuf);
        prog.setFloat("u_night", night);
        prog.setFloat("u_lens", lens);
        prog.setFloat("u_tutti", tutti);
        prog.setVec3("u_palA", pal.a[0], pal.a[1], pal.a[2]);
        prog.setVec3("u_palHot", pal.hot[0], pal.hot[1], pal.hot[2]);
        prog.setVec3("u_palB", pal.b[0], pal.b[1], pal.b[2]);
        prog.setVec3("u_palGlow", pal.glow[0], pal.glow[1], pal.glow[2]);
        quad.draw();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      offVisibility();
      media.removeEventListener?.("change", onMedia);
      writer.flush();
      quad?.dispose();
      quad = null;
      prog = null;
      stage?.dispose();
    };
  }, []);

  const letGo = useCallback(() => api.current.letGo(), []);

  // The voice: only the verbs this material genuinely means. Every verb left
  // out still lands through `lib/gesture/defaults`, scaled by the magnitude the
  // hand offered — there are no dead taps here to discover later.
  const voice = useRef({
    tap: (e: { x: number; y: number; intensity: number; fingers: number }) => {
      if (e.fingers !== 1) return;
      api.current.tap(...norm(e.x, e.y, wrapRef.current), e.intensity);
    },
    tutti: (e: { intensity: number }) => api.current.tutti(e.intensity),
    plant: (e: { x: number; y: number; intensity: number }) => {
      api.current.plant(...norm(e.x, e.y, wrapRef.current), e.intensity);
    },
    deepen: (e: { elapsed: number; x: number; y: number }) => {
      const [nx, ny] = norm(e.x, e.y, wrapRef.current);
      api.current.deepen(e.elapsed, nx, ny);
    },
    ceremony: (e: { x: number; y: number }) => {
      const [nx, ny] = norm(e.x, e.y, wrapRef.current);
      api.current.ceremony(nx, ny);
    },
    timeScale: (k: number) => api.current.timeScale(k),
    drag: (e: { dx: number; dy: number; fingers: number }) => {
      if (e.fingers !== 1) return;
      api.current.drag(e.dx, e.dy);
    },
    wind: (e: { dx: number; dy: number }) => api.current.wind(e.dx * 0.004, e.dy * 0.004),
    lens: (e: { angle: number }) => api.current.lens(e.angle),
    season: (e: { angle: number }) => api.current.season(e.angle),
    scatter: (e: { intensity: number }) => api.current.scatter(e.intensity),
    gravity: (e: { beta: number; gamma: number }) => api.current.gravity(e.beta, e.gamma),
    knock: (e: { intensity: number }) => api.current.knock(e.intensity),
    night: (e: { faceDown: boolean }) => api.current.night(e.faceDown),
  }).current;

  return (
    <RoomShell
      route="/orb"
      surfaceRef={wrapRef}
      voice={voice}
      letGo={{ label: "let the plasma go", onLetGo: letGo, visible: standing > 0 }}
      onGlimmer={() => api.current.glimmer()}
      keyboard={{
        enter: () => api.current.tap(0.5, 0.5, 0.6),
        enterHeld: (elapsed) => {
          if (elapsed < 340) api.current.plant(0.5, 0.5, 0.5);
          else api.current.deepen(elapsed, 0.5, 0.5);
        },
        escape: () => api.current.ceremony(0.5, 0.5),
        arrow: (dx, dy) => api.current.wind(dx * 0.05, dy * 0.05),
      }}
      style={{ position: "fixed", inset: 0, background: "#04060b" }}
    >
      <div
        ref={wrapRef}
        className="orb-room"
        data-touch-surface="true"
        style={{ position: "absolute", inset: 0 }}
      >
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="a field of plasma discs — rest a finger on the dark and one gathers, hold on one until it blooms and it is let go"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
            touchAction: "none",
          }}
        />
        <style>{`
          /* the standing-in gradient for a browser with no WebGL at all */
          .orb-room[data-orb-fallback="1"] {
            background:
              radial-gradient(circle at 50% 46%, #ffb46e 0%, #c8732a 34%, transparent 68%),
              #04060b;
          }
        `}</style>
      </div>
    </RoomShell>
  );
}

/**
 * Contact point → 0..1 of the room's own box. The engine reports client
 * coordinates, so the room's origin has to come off them: the wrapper is
 * `position: fixed; inset: 0` today, which makes the two agree, and this is
 * what keeps them agreeing if it ever isn't.
 */
function norm(x: number, y: number, el: HTMLElement | null): [number, number] {
  const rect = el?.getBoundingClientRect();
  const w = Math.max(1, rect?.width ?? 1);
  const h = Math.max(1, rect?.height ?? 1);
  return [
    Math.max(0, Math.min(1, (x - (rect?.left ?? 0)) / w)),
    Math.max(0, Math.min(1, (y - (rect?.top ?? 0)) / h)),
  ];
}
