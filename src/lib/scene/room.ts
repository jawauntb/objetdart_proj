"use client";

/**
 * scene/room — the shell every room shares, so a room author writes only its
 * material.
 *
 * What a room *is*, structurally: a background field, a population of
 * objects, and the shared buses. What a room author kept having to rewrite by
 * hand — and, room by room, kept getting wrong — was everything else: the
 * frame governor, the visibility pause, the DPR ceiling, the resize observer,
 * the gesture wiring, the vessel subscription, the idle persistence writer,
 * the glimmer clock, the keyboard dialect. Thirty of thirty-five rooms never
 * wired `room-runtime` at all. So it lives here once.
 *
 * The gesture grammar is the seam. This shell owns the *routing* — finger
 * count addresses the stack (grammar §3), so one finger reaches the material,
 * two the map, three the law — and turns each utterance into a `VerbEvent`
 * that the population delivers to the objects that declared that verb. A room
 * never sees a PointerEvent, and an object never sees a gesture it did not
 * claim.
 *
 * The room keeps the law-layer fields (wind, gravity, agitation, season, time
 * dilation) because they are properties of the *world*, not of any one thing
 * standing in it; objects read them from `StepContext`.
 */

import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  type QualityTier,
} from "@/lib/room-runtime";
import { createInstanceBuffer, type InstanceBuffer } from "@/lib/scene/instances";
import { createSceneLayer, type SceneLayer, type SceneLayerOptions } from "@/lib/scene/gl";
import {
  createVerbEvent,
  type ObjectVerb,
  type Population,
  type SceneObjectState,
  type StepContext,
  type VerbEvent,
} from "@/lib/scene/object";

export type RoomShellOptions<S extends SceneObjectState> = {
  /** the element the room fills; the resize observer watches it. */
  wrap: HTMLElement;
  canvas: HTMLCanvasElement;
  population: Population<S>;
  /** versioned localStorage key, or null for a room that keeps nothing. */
  storageKey: string | null;
  layer?: SceneLayerOptions;
  /** how many instances the population may draw at full quality. */
  instanceBudget?: number;
  /** called after the population steps, before it emits — the room's own law. */
  onStep?: (ctx: StepContext) => void;
  /**
   * A verb nothing answered. The material absorbs it gently (grammar §6, no
   * punishment) — a ripple where it landed, a note, never an error.
   */
  onUnanswered?: (e: VerbEvent) => void;
  /** the room's own words when a hand plants something. */
  onSpawn?: (s: S, e: VerbEvent) => void;
  /** ~20s of stillness: one physical hint, never text. */
  onGlimmer?: (nx: number, ny: number) => void;
  /** what a two-finger twist turns, when the room has a lens of its own. */
  onLens?: (angle: number) => void;
  /** told when the standing population changes, so <LetGo> can appear. */
  onStanding?: (n: number) => void;
};

export type RoomShell = {
  detach(): void;
  /** the shared quiet clear: everything retires over a breath, storage empties. */
  letGo(): void;
  /** for the room's own keyboard dialect. */
  spawnAt(nx: number, ny: number): void;
  readonly layer: SceneLayer;
};

/** How far a dwell must deepen before it has made something: the grammar's tier 2. */
const PLANT_TIER = 2;

export function createRoomShell<S extends SceneObjectState>(
  opts: RoomShellOptions<S>,
): RoomShell {
  const { wrap, canvas, population, storageKey } = opts;
  const audio = getFieldAudio();
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const embedded = isEmbeddedFrame();

  const layer = createSceneLayer(canvas, opts.layer);
  const budget = opts.instanceBudget ?? 2048;
  const buffer: InstanceBuffer = createInstanceBuffer(budget);
  const gov = createFrameGovernor(embedded ? "medium" : "high");

  // ——— the world's own fields: the law layer writes them, objects read them
  let wind = 0;
  let gravity = 0;
  let agitation = 0;
  let season = 0;
  let timeScale = 1;
  let lastStanding = -1;

  let width = 0;
  let height = 0;
  let tier: QualityTier = gov.tier();
  let hidden = false;
  let galleryPaused = false;
  let asleep = false;
  let lastTouchAt = now();
  let glimmerAt = 0;
  let last = now();
  let raf = 0;
  let running = true;

  function now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  const resize = () => {
    const rect = wrap.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    layer.resize(width, height, tier, { embedded, reducedMotion });
  };
  resize();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(wrap);

  // ——— persistence: one debounced writer, never a write per gesture
  const writer = createIdleWriter(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(population.serialize()));
    } catch {
      /* quota / private mode — the room still plays */
    }
  });
  if (storageKey) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) population.load(JSON.parse(raw), now());
    } catch {
      /* a fresh field */
    }
  }

  const announce = () => {
    const n = population.standing();
    if (n !== lastStanding) {
      lastStanding = n;
      opts.onStanding?.(n);
    }
  };
  announce();

  // ——— sleep: hidden tab or paused gallery frame draws nothing at all
  const syncSleep = () => {
    asleep = hidden || galleryPaused;
    if (asleep) gov.force("sleep");
  };
  const offVisibility = onVisibility((h) => {
    hidden = h;
    syncSleep();
  });
  const offGallery = onGalleryPause((p) => {
    galleryPaused = p;
    syncSleep();
  });

  // ——— the grammar, routed by finger count ————————————————————————
  const ev = createVerbEvent(); // reused: no allocation per utterance
  const nx = (x: number) => x / Math.max(1, width);
  const ny = (y: number) => y / Math.max(1, height);

  function deliver(verb: ObjectVerb): number {
    ev.verb = verb;
    ev.tMs = now();
    const answered = population.route(ev);
    if (answered === 0 && opts.onUnanswered) opts.onUnanswered(ev);
    return answered;
  }

  function touched() {
    lastTouchAt = now();
  }

  const detachGestures = attachGestures(
    canvas,
    {
      tap: (e) => {
        touched();
        ev.intensity = e.intensity;
        ev.elapsedMs = 0;
        ev.tier = 0;
        ev.nx = nx(e.x);
        ev.ny = ny(e.y);
        ev.dx = 0;
        ev.dy = 0;
        if (e.fingers === 3) {
          // tutti — one synchronized pulse of everything alive.
          deliver("tutti");
          audio.chime();
          haptics.ripple(0.35 + 0.3 * e.intensity);
          return;
        }
        // Two fingers are the frame's: ScaleTravel binds the step back, and a
        // room that also answered it would answer twice.
        if (e.fingers === 2) return;
        deliver("touch");
        audio.playNote(52 + Math.round(e.intensity * 12), 160 + e.intensity * 90);
        haptics.tap();
      },
      hold: (e) => {
        touched();
        ev.intensity = e.intensity;
        ev.elapsedMs = e.elapsed;
        ev.tier = e.tier;
        ev.nx = nx(e.x);
        ev.ny = ny(e.y);
        if (e.fingers === 3) {
          // Time dilation while held, and it keeps deepening: the room slows
          // further the longer the three fingers stay down.
          timeScale =
            e.phase === "release" ? 1 : Math.max(0.12, 1 - Math.min(0.88, e.elapsed / 2600));
          deliver("dilate");
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter" || e.phase === "tick") {
          // Legible while it happens: something gathers under the finger from
          // the moment the dwell tier is crossed, so the hand learns the verb
          // without being told.
          const answered = deliver("dwell");
          if (answered === 0 && e.tier >= PLANT_TIER && e.phase === "enter") {
            const born = population.spawn(ev.nx, ev.ny, now());
            opts.onSpawn?.(born, ev);
            audio.spark();
            haptics.ripple(0.5);
            writer.schedule();
            announce();
          }
        }
        if (e.phase === "release" && e.tier >= 3) {
          deliver("ceremony");
          audio.bell();
          haptics.bloom();
          writer.schedule();
          announce();
        }
      },
      drag: (e) => {
        touched();
        ev.intensity = 1;
        ev.elapsedMs = 0;
        ev.tier = 0;
        ev.nx = nx(e.x);
        ev.ny = ny(e.y);
        ev.dx = e.dx / Math.max(1, width);
        ev.dy = e.dy / Math.max(1, height);
        if (e.fingers === 3) {
          // Wind: the law layer pushes the whole world, continuously.
          wind = Math.max(-1, Math.min(1, wind + ev.dx * 2.2));
          deliver("wind");
          return;
        }
        if (e.fingers === 1) deliver("stroke");
      },
      twist: (e) => {
        touched();
        ev.angle = e.angle;
        ev.intensity = Math.min(1, Math.abs(e.velocity));
        if (e.fingers === 3) {
          // Season: the room's slow cycle, advanced or rewound.
          season = (season + e.angle / (Math.PI * 2) + 1) % 1;
          deliver("season");
          return;
        }
        // The lens: the level of description turning at fixed scale.
        opts.onLens?.(e.angle);
        deliver("lens");
      },
      pan2: () => {
        // The frame is the viewport here and ScaleTravel owns its verb. A room
        // with a camera of its own overrides this by binding pan2 itself.
      },
      scrub: (e) => {
        touched();
        ev.nx = nx(e.cx);
        ev.ny = ny(e.cy);
        ev.intensity = Math.min(1, Math.abs(e.winding));
        deliver("stroke");
      },
    },
    { wheelZoom: false },
  );

  // ——— the vessel: passive. The candle owns permission; a room never asks.
  const detachVessel = onVessel({
    tilt: ({ beta, gamma }) => {
      if (reducedMotion || asleep) return;
      gravity = Math.max(-1, Math.min(1, gamma / 45));
      ev.dx = gravity;
      ev.dy = Math.max(-1, Math.min(1, (beta - 35) / 90));
      ev.intensity = Math.abs(gravity);
      deliver("gravity");
    },
    shake: ({ intensity }) => {
      if (reducedMotion || asleep) return;
      agitation = Math.min(1, agitation + intensity);
      ev.intensity = intensity;
      deliver("agitate");
      haptics.chop();
      audio.buzz();
    },
    knock: ({ intensity }) => {
      if (asleep) return;
      ev.intensity = intensity;
      deliver("knock");
      audio.bell();
      haptics.tap();
    },
    flip: ({ faceDown }) => {
      ev.intensity = faceDown ? 1 : 0;
      deliver("night");
      if (faceDown) {
        wind *= 0.2;
        agitation *= 0.2;
        haptics.roll();
      }
    },
  });

  // ——— the loop ————————————————————————————————————————————————
  const step: StepContext = {
    dt: 0,
    tMs: 0,
    breath: 0,
    detail: 1,
    wind: 0,
    gravity: 0,
    agitation: 0,
    season: 0,
    timeScale: 1,
    reducedMotion,
  };

  const draw = (t: number) => {
    if (!running) return;
    tier = gov.beginFrame(t);
    if (asleep) {
      // Hidden means hidden: no simulation, no upload, no paint.
      last = t;
      raf = requestAnimationFrame(draw);
      return;
    }
    const detail = detailForTier(tier);
    const dt = Math.min(0.05, (t - last) / 1000) * timeScale;
    last = t;
    const tSec = audio.getAudioTime() ?? t / 1000;
    const breath = reducedMotion ? 0.5 : Math.sin(tSec * Math.PI * 2 * 0.14) * 0.5 + 0.5;

    wind *= 0.99;
    agitation *= 0.96;

    step.dt = dt;
    step.tMs = t;
    step.breath = breath;
    step.detail = detail.particles;
    step.wind = wind;
    step.gravity = gravity;
    step.agitation = agitation;
    step.season = season;
    step.timeScale = timeScale;
    population.step(step);
    opts.onStep?.(step);

    buffer.reset();
    population.emit(
      { width, height, tMs: t, breath, detail: detail.particles, reducedMotion },
      buffer,
    );

    layer.draw(buffer, {
      tSec,
      breath,
      wind,
      gravity,
      agitation,
      season,
      detail: detail.particles,
    });

    // The glimmer: after ~20s of stillness, one physical hint where a verb
    // would land. Never text, never a label, never twice in a breath.
    if (!reducedMotion && t - lastTouchAt > 20000 && t - glimmerAt > 6000) {
      glimmerAt = t;
      opts.onGlimmer?.(0.5, 0.6);
    }

    announce();
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  return {
    layer,
    spawnAt(x, y) {
      ev.nx = x;
      ev.ny = y;
      ev.intensity = 0.6;
      ev.tier = PLANT_TIER;
      const born = population.spawn(x, y, now());
      opts.onSpawn?.(born, ev);
      writer.schedule();
      announce();
      touched();
    },
    letGo() {
      // The act is an exhale: the population retires over a breath in its own
      // material, and storage is written empty at once — an empty room is a
      // remembered state, and nothing respawns over a deliberate clearing.
      population.letGo();
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify({ kind: population.spec.kind, items: [] }));
        } catch {
          /* noop */
        }
      }
      writer.cancel();
      announce();
      audio.thud();
      haptics.roll();
    },
    detach() {
      running = false;
      ro?.disconnect();
      detachGestures();
      detachVessel();
      offVisibility();
      offGallery();
      writer.flush();
      cancelAnimationFrame(raf);
      layer.dispose();
    },
  };
}
