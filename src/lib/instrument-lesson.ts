// Shared teaching phrases for /light, /timbre, and /instrument.
//
// The meta-interface these rooms share: a human hand that learns by imitation
// meeting a glass continuum with no frets. Ghost fingers land where real hands
// should, sounding real chords — like a piano teacher's hands on the keys —
// so the plate itself teaches how it is played. No prose required.

import {
  AUDIBLE_MIN_HZ,
  AUDIBLE_MAX_HZ,
  frequencyFromMidi,
  noteName,
  type ScaleMode,
} from "@/lib/light-music";
import { TIMBRE_CHAIN } from "@/lib/timbre";

export type LessonGhost = {
  id: string;
  x: number;
  y: number;
  note: string;
  voice?: string;
  color?: string;
};

export type LessonEvent =
  | {
      t: number;
      kind: "on";
      id: string;
      midi: number;
      /** 0..1 plate x; derived from midi when omitted. */
      x?: number;
      /** 0..1 plate y — brightness on /light, timbre on the others. */
      y: number;
      voice?: string;
      brightness?: number;
    }
  | { t: number; kind: "off"; id: string }
  | { t: number; kind: "glide"; id: string; midi: number; x?: number; y?: number }
  | { t: number; kind: "morph"; id: string; y: number; voice?: string }
  | { t: number; kind: "window"; lo: number; w: number }
  | { t: number; kind: "lens"; mode: ScaleMode }
  | { t: number; kind: "grip"; a: { x: number; y: number }; b: { x: number; y: number } }
  | { t: number; kind: "ungrip" }
  | { t: number; kind: "label"; text: string };

export type LessonHandlers = {
  on?: (e: Extract<LessonEvent, { kind: "on" }> & { freq: number; x: number; note: string }) => void;
  off?: (e: Extract<LessonEvent, { kind: "off" }>) => void;
  glide?: (e: Extract<LessonEvent, { kind: "glide" }> & { freq: number; x: number }) => void;
  morph?: (e: Extract<LessonEvent, { kind: "morph" }>) => void;
  window?: (e: Extract<LessonEvent, { kind: "window" }>) => void;
  lens?: (e: Extract<LessonEvent, { kind: "lens" }>) => void;
  grip?: (e: Extract<LessonEvent, { kind: "grip" }>) => void;
  ungrip?: () => void;
  label?: (text: string) => void;
  done?: () => void;
};

/** Plate x from frequency — same log map the instruments play on. */
export function xFromFrequency(freq: number): number {
  const clamped = Math.max(AUDIBLE_MIN_HZ, Math.min(AUDIBLE_MAX_HZ, freq));
  return Math.log(clamped / AUDIBLE_MIN_HZ) / Math.log(AUDIBLE_MAX_HZ / AUDIBLE_MIN_HZ);
}

export function xFromMidi(midi: number): number {
  return xFromFrequency(frequencyFromMidi(midi));
}

/** Vertical detent for a named instrument in the chain (0 = harp … 1 = trumpet). */
export function yFromTimbreKey(key: string): number {
  const index = TIMBRE_CHAIN.findIndex((voice) => voice.key === key);
  if (index < 0) return 0.5;
  return index / (TIMBRE_CHAIN.length - 1);
}

/** Soft pull toward the nearest instrument band — band gravity. */
export function timbreGravity(y: number, strength = 0.22): number {
  const n = TIMBRE_CHAIN.length - 1;
  const nearest = Math.round(Math.max(0, Math.min(1, y)) * n) / n;
  const dist = Math.abs(y - nearest);
  if (dist > 0.09) return y;
  return y + (nearest - y) * strength;
}

/**
 * Visible frets for the current scale — the continuum becoming a piano of light.
 * Mid register only (A2–A5) so the lattice densifies where hands actually play.
 */
export function scaleLattice(mode: ScaleMode): { x: number; midi: number; note: string }[] {
  if (mode === "pure") return [];
  const penta = new Set([9, 0, 2, 4, 7]); // A C D E G
  const out: { x: number; midi: number; note: string }[] = [];
  for (let midi = 45; midi <= 81; midi++) {
    const pc = ((midi % 12) + 12) % 12;
    if (mode === "penta" && !penta.has(pc)) continue;
    const freq = frequencyFromMidi(midi);
    out.push({ x: xFromFrequency(freq), midi, note: noteName(freq) });
  }
  return out;
}

function chord(
  t: number,
  ids: string[],
  midis: number[],
  y: number | number[],
  hold: number,
  voice?: string | string[],
): LessonEvent[] {
  const events: LessonEvent[] = [];
  ids.forEach((id, i) => {
    const yi = Array.isArray(y) ? y[i] ?? y[0] : y;
    const v = Array.isArray(voice) ? voice[i] : voice;
    events.push({
      t: t + i * 0.018,
      kind: "on",
      id,
      midi: midis[i],
      y: yi,
      voice: v,
      brightness: 1 - (Array.isArray(y) ? yi : y),
    });
    events.push({ t: t + hold, kind: "off", id });
  });
  return events;
}

function arpeggio(
  t: number,
  ids: string[],
  midis: number[],
  y: number | number[],
  step: number,
  hold: number,
  voice?: string | string[],
): LessonEvent[] {
  const events: LessonEvent[] = [];
  ids.forEach((id, i) => {
    const yi = Array.isArray(y) ? y[i] ?? y[0] : y;
    const v = Array.isArray(voice) ? voice[i] : voice;
    const at = t + i * step;
    events.push({
      t: at,
      kind: "on",
      id,
      midi: midis[i],
      y: yi,
      voice: v,
      brightness: 1 - yi,
    });
    events.push({ t: at + hold, kind: "off", id });
  });
  return events;
}

/** /light — chord shapes on the spectrum, then a climbing phrase. */
export function lightLesson(): LessonEvent[] {
  const y = 0.42;
  return [
    { t: 0, kind: "label", text: "a minor — three fingers" },
    { t: 0, kind: "lens", mode: "penta" },
    ...chord(0.05, ["l0", "l1", "l2"], [57, 60, 64], y, 1.15), // A3 C4 E4
    { t: 1.35, kind: "label", text: "c major" },
    ...chord(1.4, ["l3", "l4", "l5"], [60, 64, 67], 0.38, 1.1), // C4 E4 G4
    { t: 2.65, kind: "label", text: "walk the color" },
    ...arpeggio(2.7, ["l6", "l7", "l8", "l9"], [57, 60, 64, 69], [0.55, 0.45, 0.35, 0.28], 0.22, 0.7),
    { t: 3.9, kind: "label", text: "hold a chord" },
    ...chord(3.95, ["l10", "l11", "l12"], [57, 64, 69], [0.5, 0.36, 0.24], 1.4),
  ];
}

/** /timbre — same pitch morphing through the chain, then an orchestra chord. */
export function timbreLesson(): LessonEvent[] {
  const harp = yFromTimbreKey("harp");
  const piano = yFromTimbreKey("piano");
  const guitar = yFromTimbreKey("guitar");
  const violin = yFromTimbreKey("violin");
  const sax = yFromTimbreKey("saxophone");
  const trumpet = yFromTimbreKey("trumpet");

  return [
    { t: 0, kind: "label", text: "one note, every instrument" },
    { t: 0.05, kind: "on", id: "t0", midi: 57, y: harp, voice: "harp" },
    { t: 0.55, kind: "morph", id: "t0", y: piano, voice: "piano" },
    { t: 1.05, kind: "morph", id: "t0", y: guitar, voice: "guitar" },
    { t: 1.55, kind: "morph", id: "t0", y: violin, voice: "violin" },
    { t: 2.05, kind: "morph", id: "t0", y: sax, voice: "saxophone" },
    { t: 2.55, kind: "morph", id: "t0", y: trumpet, voice: "trumpet" },
    { t: 3.05, kind: "off", id: "t0" },
    { t: 3.2, kind: "label", text: "stack the room" },
    ...chord(
      3.3,
      ["t1", "t2", "t3", "t4"],
      [45, 57, 64, 69],
      [harp, piano, guitar, violin],
      1.6,
      ["harp", "piano", "guitar", "violin"],
    ),
    { t: 5.1, kind: "label", text: "piano triad" },
    ...chord(5.2, ["t5", "t6", "t7"], [60, 64, 67], piano, 1.3, "piano"),
  ];
}

/**
 * /instrument — the grammar as a lesson: staggered voices, then a pinch that
 * zooms the pitch window, then a twist that turns the scale lens.
 */
export function instrumentLesson(): LessonEvent[] {
  const piano = yFromTimbreKey("piano");
  const guitar = yFromTimbreKey("guitar");
  const violin = yFromTimbreKey("violin");

  return [
    { t: 0, kind: "label", text: "every finger a voice" },
    { t: 0, kind: "lens", mode: "penta" },
    { t: 0, kind: "window", lo: 0, w: 1 },
    // staggered landings — an arpeggio the grammar keeps as voices
    ...arpeggio(0.1, ["i0", "i1", "i2"], [57, 60, 64], [piano, piano, guitar], 0.16, 1.2, [
      "piano",
      "piano",
      "guitar",
    ]),
    { t: 1.6, kind: "label", text: "pinch zooms the map" },
    {
      t: 1.7,
      kind: "grip",
      a: { x: 0.32, y: 0.48 },
      b: { x: 0.68, y: 0.52 },
    },
    { t: 1.9, kind: "window", lo: 0.28, w: 0.44 },
    {
      t: 2.15,
      kind: "grip",
      a: { x: 0.38, y: 0.48 },
      b: { x: 0.62, y: 0.52 },
    },
    { t: 2.35, kind: "window", lo: 0.34, w: 0.28 },
    { t: 2.55, kind: "ungrip" },
    { t: 2.7, kind: "label", text: "twist turns the lens" },
    {
      t: 2.8,
      kind: "grip",
      a: { x: 0.42, y: 0.4 },
      b: { x: 0.58, y: 0.6 },
    },
    { t: 3.05, kind: "lens", mode: "chroma" },
    {
      t: 3.25,
      kind: "grip",
      a: { x: 0.4, y: 0.58 },
      b: { x: 0.6, y: 0.42 },
    },
    { t: 3.45, kind: "lens", mode: "pure" },
    { t: 3.65, kind: "ungrip" },
    { t: 3.8, kind: "label", text: "play inside the window" },
    { t: 3.85, kind: "lens", mode: "penta" },
    ...chord(3.9, ["i3", "i4", "i5"], [60, 64, 67], [piano, guitar, violin], 1.5, [
      "piano",
      "guitar",
      "violin",
    ]),
    { t: 5.5, kind: "window", lo: 0, w: 1 },
  ];
}

/** Run a lesson on wall-clock timeouts. Returns a cancel function. */
export function playLesson(events: LessonEvent[], handlers: LessonHandlers): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  const sorted = [...events].sort((a, b) => a.t - b.t);
  const lastT = sorted.length ? sorted[sorted.length - 1].t : 0;

  for (const event of sorted) {
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        if (event.kind === "on") {
          const freq = frequencyFromMidi(event.midi);
          const x = event.x ?? xFromMidi(event.midi);
          handlers.on?.({ ...event, freq, x, note: noteName(freq) });
          return;
        }
        if (event.kind === "off") {
          handlers.off?.(event);
          return;
        }
        if (event.kind === "glide") {
          const freq = frequencyFromMidi(event.midi);
          const x = event.x ?? xFromMidi(event.midi);
          handlers.glide?.({ ...event, freq, x });
          return;
        }
        if (event.kind === "morph") {
          handlers.morph?.(event);
          return;
        }
        if (event.kind === "window") {
          handlers.window?.(event);
          return;
        }
        if (event.kind === "lens") {
          handlers.lens?.(event);
          return;
        }
        if (event.kind === "grip") {
          handlers.grip?.(event);
          return;
        }
        if (event.kind === "ungrip") {
          handlers.ungrip?.();
          return;
        }
        if (event.kind === "label") {
          handlers.label?.(event.text);
        }
      }, Math.max(0, event.t * 1000)),
    );
  }

  timers.push(
    setTimeout(() => {
      if (!cancelled) handlers.done?.();
    }, lastT * 1000 + 80),
  );

  return () => {
    cancelled = true;
    timers.forEach((timer) => clearTimeout(timer));
  };
}

export function lessonDuration(events: LessonEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.t), 0);
}
