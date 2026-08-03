/**
 * scene/voice — the seam between the room's grammar and the things inside it.
 *
 * `RoomShell` speaks `RoomVoice` (`src/lib/gesture/defaults.ts`): the global
 * bindings, already classified, already routed by finger count. A population
 * speaks verbs. This is the one small translation between them, so no room
 * writes it twice and no room writes it differently.
 *
 * What it enforces by construction: a positional verb reaches the object
 * nearest the contact, a field verb reaches the whole population at once, and
 * an object only ever receives a verb its spec declared. What it leaves to the
 * room: what any of it *means* in that material.
 *
 * Pure — no DOM, no React. The `RoomVoice` import is type-only, so node can
 * load this alongside the rest of the model.
 */

import type { RoomVoice } from "@/lib/gesture/defaults";
import {
  createVerbEvent,
  type Population,
  type SceneObjectState,
  type VerbEvent,
} from "@/lib/scene/object";

export type PopulationVoiceOptions<S extends SceneObjectState> = {
  /** css size of the room, read fresh each event — the frame can resize. */
  size(): { width: number; height: number };
  /** room clock, ms. */
  now(): number;
  /**
   * A dwell that reached no object plants one. Return false to refuse (a room
   * with a full field, or one where empty ground means nothing).
   */
  plant?: (nx: number, ny: number) => boolean;
  /** Told after a spawn, so the room can sound it and schedule its save. */
  onSpawn?: (s: S, e: VerbEvent) => void;
  /** Told after any verb, with how many objects answered. Nothing punishes. */
  onAnswered?: (e: VerbEvent, answered: number) => void;
  /** The world's own fields, which the law layer writes and objects read. */
  world?: {
    wind(dx: number, dy: number): void;
    season(angle: number): void;
    agitate(intensity: number): void;
    gravity(beta: number, gamma: number): void;
    timeScale(k: number): void;
  };
};

/**
 * Build the `voice` a `RoomShell` wants from a population.
 *
 * Every global binding the material can express is wired here once; a room
 * adds only the verbs its objects declared, and the shell's default answers
 * cover the rest so nothing a hand does is ever met with silence.
 */
export function populationVoice<S extends SceneObjectState>(
  population: Population<S>,
  opts: PopulationVoiceOptions<S>,
): RoomVoice {
  const e = createVerbEvent(); // reused: nothing allocates per utterance
  const answers = new Set(population.spec.verbs);

  const place = (x: number, y: number) => {
    const { width, height } = opts.size();
    e.nx = x / Math.max(1, width);
    e.ny = y / Math.max(1, height);
  };

  const send = (verb: VerbEvent["verb"]) => {
    if (!answers.has(verb)) {
      opts.onAnswered?.(e, 0);
      return 0;
    }
    e.verb = verb;
    e.tMs = opts.now();
    const n = population.route(e);
    opts.onAnswered?.(e, n);
    return n;
  };

  return {
    tap: (t) => {
      if (t.fingers !== 1) return; // two is the frame's, three is tutti's
      place(t.x, t.y);
      e.intensity = t.intensity;
      e.elapsedMs = 0;
      e.tier = 0;
      send("touch");
    },
    tutti: (t) => {
      e.intensity = t.intensity;
      e.elapsedMs = 0;
      send("tutti");
    },
    plant: (p) => {
      place(p.x, p.y);
      e.intensity = p.intensity;
      e.tier = p.tier;
      e.elapsedMs = 0;
      // A dwell on something deepens it; a dwell on empty ground makes one.
      if (send("dwell") > 0) return;
      if (opts.plant && !opts.plant(e.nx, e.ny)) return;
      const born = population.spawn(e.nx, e.ny, opts.now());
      opts.onSpawn?.(born, e);
    },
    deepen: (d) => {
      place(d.x, d.y);
      e.elapsedMs = d.elapsed; // keeps counting past every tier, on purpose
      e.tier = d.tier;
      send("dwell");
    },
    ceremony: (c) => {
      place(c.x, c.y);
      e.elapsedMs = c.elapsed;
      e.tier = 3;
      send("ceremony");
    },
    timeScale: (k) => {
      opts.world?.timeScale(k);
      e.intensity = 1 - k;
      send("dilate");
    },
    drag: (d) => {
      if (d.fingers !== 1) return;
      const { width, height } = opts.size();
      place(d.x, d.y);
      e.dx = d.dx / Math.max(1, width);
      e.dy = d.dy / Math.max(1, height);
      send("stroke");
    },
    wind: (w) => {
      const { width, height } = opts.size();
      e.dx = w.dx / Math.max(1, width);
      e.dy = w.dy / Math.max(1, height);
      opts.world?.wind(e.dx, e.dy);
      send("wind");
    },
    stir: (s) => {
      place(s.cx, s.cy);
      e.intensity = Math.min(1, Math.abs(s.winding));
      send("stroke");
    },
    lens: (l) => {
      e.angle = l.angle;
      e.intensity = Math.min(1, Math.abs(l.velocity));
      send("lens");
    },
    season: (s) => {
      e.angle = s.angle;
      e.intensity = Math.min(1, Math.abs(s.velocity));
      opts.world?.season(s.angle);
      send("season");
    },
    scatter: (s) => {
      e.intensity = s.intensity;
      opts.world?.agitate(s.intensity);
      send("agitate");
    },
    gravity: (g) => {
      e.dx = Math.max(-1, Math.min(1, g.gamma / 45));
      e.dy = Math.max(-1, Math.min(1, (g.beta - 35) / 90));
      e.intensity = Math.abs(e.dx);
      opts.world?.gravity(g.beta, g.gamma);
      send("gravity");
    },
    knock: (k) => {
      e.intensity = k.intensity;
      send("knock");
    },
    night: (n) => {
      e.intensity = n.faceDown ? 1 : 0;
      send("night");
    },
  };
}
