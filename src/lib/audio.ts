// Procedural Atlantic + per-page ambient profiles. Brown noise → lowpass →
// gain, with a 0.14 Hz swell LFO and a 0.03 Hz drift LFO modulating the
// gain so the noise breathes like waves. No samples, no assets — just the
// Web Audio graph. setAmbientProfile() swaps the ambient layer with a
// short crossfade so each page can set its own bed.

import type { ConcernKey } from "@/lib/types";

// The named ambient beds each page can request. Profiles swap through the
// singleton audio engine so route changes do not accidentally start parallel
// ambient graphs.
export type AmbientProfile =
  | "ocean"      // brown noise + swell LFO — default Atlantic
  | "storm"      // ocean + wind hiss + thunder rumble
  | "wind"       // pink-ish airy noise + faint bird-like sines
  | "fire"       // band-passed crackle
  | "earth"      // subsonic rumble
  | "cosmic"     // very faint pink noise + distant sine drones
  | "monitor"    // hospital beep ambient (subliminal)
  | "electric"   // 60 Hz hum + occasional spark
  | "garden"     // gentle wind + filtered bird chatter
  | "clockwork"  // faint mechanical ticks + soft pulse
  | "silent";    // no ambient at all (Signal uses this)

export type AmbientProfileOptions = {
  // Seconds. Keep short when moving to "silent" so old beds do not sit under
  // foreground music.
  fadeSec?: number;
};

// every concern has its own voice — timbre + pitch.
// Order matches RADIAL_ORDER in the compass.
export type ConcernVoice = {
  type: OscillatorType;
  freq: number;       // base hz when value=50
  pitchRange: number; // hz delta from low (value=0) to high (value=100)
  gain: number;       // peak gain
  lp?: number;        // optional lowpass cutoff
};

// ── Generative composer types ─────────────────────────────────────────
export type ScaleName =
  | "ionian" | "aeolian" | "dorian" | "lydian" | "mixolydian" | "auto";

export type ComposeOpts = {
  concerns?: Partial<Record<ConcernKey, number>>;
  duration?: number;   // seconds
  tempo?: number;      // BPM
  scale?: ScaleName;
  prompt?: string;       // NEW — natural language prompt
  oceanicCoda?: boolean; // NEW — default TRUE; appends 12s sea outro
};

// Result of parsing a prompt for compositional hints. Surfaced via
// parsePromptMods so the UI can show the user what the engine picked up.
export type PromptMods = {
  tempoDelta: number;                  // BPM offset applied on top of base
  scale: Exclude<ScaleName, "auto"> | null; // forced scale, if any
  melodyDensity: number;               // multiplier on phrase gaps (>1 = sparser)
  shimmerBoost: number;                // multiplier on shimmer count
  chordVoiceBoost: boolean;            // add a fourth chord voice
  addBells: boolean;
  droneEmphasis: boolean;
  addRain: boolean;
  addFireWash: boolean;
  // Human-readable chips for UI display ("tempo: slow ↓", "+bells", …)
  chips: string[];
};

export type ComposeHandle = {
  stop: () => void;
  end: number;         // AudioContext time at piece end
  duration: number;    // seconds
};

// Module-level reference to the currently-running composition so callers
// don't have to track it themselves. composeMusic() stops any prior piece
// before starting a new one.
let currentComposition: ComposeHandle | null = null;

export function getCurrentComposition(): ComposeHandle | null {
  return currentComposition;
}

// Semitone offsets from the tonic for each mode (octave-relative).
const SCALE_DEGREES: Record<Exclude<ScaleName, "auto">, number[]> = {
  ionian:     [0, 2, 4, 5, 7, 9, 11],
  aeolian:    [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const PROMPT_FALLBACK_SCALES: Array<Exclude<ScaleName, "auto" | "aeolian">> = [
  "ionian",
  "dorian",
  "lydian",
  "mixolydian",
];

export function pickPromptFallbackScale(prompt: string): Exclude<ScaleName, "auto" | "aeolian"> {
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = (hash * 31 + prompt.charCodeAt(i)) >>> 0;
  }
  return PROMPT_FALLBACK_SCALES[hash % PROMPT_FALLBACK_SCALES.length];
}

// Map each concern key (high value) to a preferred mode. Looked up when
// scale === "auto". The top-weighted concern wins.
const CONCERN_TO_SCALE: Record<ConcernKey, Exclude<ScaleName, "auto">> = {
  prayer: "lydian",
  love: "mixolydian",
  memory: "aeolian",
  risk: "dorian",
  work: "ionian",
  body: "mixolydian",
  friendship: "ionian",
  future: "lydian",
};

function pickScale(
  scale: ScaleName,
  concerns: Partial<Record<ConcernKey, number>>,
): Exclude<ScaleName, "auto"> {
  if (scale !== "auto") return scale;
  const keys = Object.keys(concerns) as ConcernKey[];
  if (keys.length === 0) return "ionian";
  let top: ConcernKey = keys[0];
  let topV = concerns[top] ?? 0;
  for (const k of keys) {
    const v = concerns[k] ?? 0;
    if (v > topV) { top = k; topV = v; }
  }
  return CONCERN_TO_SCALE[top] ?? "ionian";
}

function pickTempo(
  override: number | undefined,
  concerns: Partial<Record<ConcernKey, number>>,
): number {
  if (override && override > 0) return override;
  const risk = concerns.risk ?? 0;
  const work = concerns.work ?? 0;
  const prayer = concerns.prayer ?? 0;
  const memory = concerns.memory ?? 0;
  const pressure = risk + work;
  const stillness = prayer + memory;
  if (pressure > 130) return 110;
  if (stillness > 130) return 62;
  return 80;
}

// midiHz: A4 = 440 Hz, MIDI 69.
function midiHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Simple keyword scanner — turns a natural-language prompt into a set of
// concrete layer/parameter adjustments. Regex-based on purpose; the goal is
// vibe-level steering, not NLP. Exported so the UI can render chips.
export function parsePromptMods(prompt: string | undefined): PromptMods {
  const mods: PromptMods = {
    tempoDelta: 0,
    scale: null,
    melodyDensity: 1,
    shimmerBoost: 1,
    chordVoiceBoost: false,
    addBells: false,
    droneEmphasis: false,
    addRain: false,
    addFireWash: false,
    chips: [],
  };
  if (!prompt) return mods;
  const p = prompt.toLowerCase();

  const has = (re: RegExp) => re.test(p);

  if (has(/\b(slow|calm|still|drift)\b/)) {
    mods.tempoDelta -= 15;
    mods.chips.push("tempo: slow ↓");
  }
  if (has(/\b(fast|frantic|rush|urgent|racing)\b/)) {
    mods.tempoDelta += 25;
    mods.chips.push("tempo: fast ↑");
  }
  if (has(/\b(dark|minor|sad|grief)\b/)) {
    mods.scale = "aeolian";
    mods.chips.push("key: aeolian");
  } else if (has(/\b(mystery|uncanny)\b/)) {
    mods.scale = "dorian";
    mods.chips.push("key: dorian");
  } else if (has(/\b(bright|major|joy|open)\b/)) {
    // ionian/lydian — pick lydian if "open", else ionian
    mods.scale = has(/\b(open|lydian)\b/) ? "lydian" : "ionian";
    mods.chips.push(`key: ${mods.scale}`);
  } else if (has(/\b(warm|love|tender)\b/)) {
    mods.scale = "mixolydian";
    mods.chips.push("key: mixolydian");
  }
  if (has(/\b(sparse|quiet|lonely)\b/)) {
    mods.melodyDensity = 1.8;
    mods.chips.push("sparse");
  }
  if (has(/\b(dense|thick|full)\b/)) {
    mods.shimmerBoost = 1.9;
    mods.chordVoiceBoost = true;
    mods.chips.push("dense");
  }
  if (has(/\bbells?\b/)) {
    mods.addBells = true;
    mods.chips.push("+bells");
  }
  if (has(/\bdrones?\b/)) {
    mods.droneEmphasis = true;
    mods.chips.push("+drone");
  }
  if (has(/\b(rain|patter)\b/)) {
    mods.addRain = true;
    mods.chips.push("+rain");
  }
  if (has(/\b(fire|burn|flame)\b/)) {
    mods.addFireWash = true;
    mods.chips.push("+fire");
  }

  return mods;
}

type FieldAudio = {
  start: () => Promise<void>;
  setMuted: (m: boolean) => void;
  isMuted: () => boolean;
  // AudioContext.currentTime once audio has started, else null.
  // Visual LFOs read this to stay in phase with the audio swell.
  getAudioTime: () => number | null;
  // Analyser sitting at the tail of the master output. Null until the
  // audio context exists. Visualisers pull FFT/time-domain data from this.
  getAnalyser: () => AnalyserNode | null;
  // Raw AudioContext for advanced callers (e.g. wiring a mic stream).
  // Null until the context has been created (lazy).
  getAudioContext: () => AudioContext | null;
  // soft one-shots, gentle enough to layer under the procedural ocean
  chime: () => void;     // drag end / object pickup
  bell:  () => void;     // reading reveal / preset snap
  thud:  () => void;     // keep / drop
  refuse: () => void;    // bad action
  spark: () => void;     // candle tap
  // pitched single-note triangle oscillator with ADSR. used by /waves
  // PhaseChart so each candle clicks at a pitch picked from the phase scale.
  playTone: (freq: number, durationSec?: number) => void;
  playNote: (midi: number, durationMs?: number) => void;
  // continuous-tone interface for compass drag — call holdConcernTone(id)
  // when dragging starts, set its value while dragging, release when done
  holdConcernTone: (id: string, value: number) => void;
  releaseConcernTone: (id: string) => void;
  releaseAllConcernTones: () => void;
  // play a short procedural phrase derived from polygon weights
  playSigilPhrase: (concerns: Record<string, number>) => Promise<void>;
  // start a generative composition (~45-90s). Returns a handle with stop().
  composeMusic: (opts?: ComposeOpts) => ComposeHandle | null;
  // play decoded generated audio through the shared analyser/master sink.
  playAudioClip: (data: ArrayBuffer) => Promise<ComposeHandle | null>;
  // peek at the active composition, or null if none.
  getCurrentComposition: () => ComposeHandle | null;
  // Swap the ambient bed through the singleton engine with a short fade.
  // Pages call this on mount so each route gets its own atmosphere
  // instead of every page playing the sea.
  setAmbientProfile: (name: AmbientProfile, options?: AmbientProfileOptions) => void;
  // Read back the active profile, mostly for debugging / tests.
  getAmbientProfile: () => AmbientProfile;
};

let instance: FieldAudio | null = null;
const STORAGE_KEY = "objetdart:audio:muted";
const DEFAULT_AMBIENT_FADE_SEC = 0.65;
const SILENT_AMBIENT_FADE_SEC = 0.12;

export function setAmbientProfile(
  name: AmbientProfile,
  options?: AmbientProfileOptions,
): void {
  getFieldAudio().setAmbientProfile(name, options);
}

export function getFieldAudio(): FieldAudio {
  if (instance) return instance;

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  // Sink the whole audio graph passes through before the speakers. Everything
  // that used to `connect(ctx.destination)` now connects to this sink, which
  // then feeds the analyser, which feeds the destination. Keeps the FFT live
  // for ANY sound the engine makes (ambient noise, sigil phrases, one-shots).
  let sink: GainNode | null = null;
  let started = false;
  let muted = false;

  // Current ambient bed. Tracked here so setAmbientProfile() can fade and
  // disconnect the previous layer instead of leaving duplicate procedural
  // beds running after route/profile changes.
  type AmbientLayer = {
    profile: AmbientProfile;
    // Top-level fader for this layer. Crossfades aim at this gain.
    fader: GainNode;
    // Every scheduled source feeding the layer — stopped & disconnected on
    // teardown.
    sources: AudioScheduledSourceNode[];
    // Every gain/filter/etc. node owned by the layer.
    nodes: { disconnect: () => void }[];
  };
  let ambientLayer: AmbientLayer | null = null;
  let currentProfile: AmbientProfile = "ocean";
  // Watchdog interval id — checks the audio context every 5s and resumes
  // it if the browser policy suspended it (e.g. iOS Safari after a tab
  // switch). Defensive — shouldn't fire on a healthy page.
  let watchdogTimer: number | null = null;

  if (typeof window !== "undefined") {
    try { muted = localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* noop */ }
  }

  const ensureContext = (): AudioContext | null => {
    if (ctx) return ctx;
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // Build the visualisation tap once. sink → analyser → destination.
    // Everything else connects to `sink` instead of `ctx.destination`.
    sink = ctx.createGain();
    sink.gain.value = 1;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.78;
    sink.connect(analyser);
    analyser.connect(ctx.destination);
    return ctx;
  };

  // Helper — the node every emitter should connect into (falls back to the
  // raw destination if the sink could not be created for any reason).
  const outNode = (c: AudioContext): AudioNode => sink ?? c.destination;

  const resolveAmbientFade = (
    profile: AmbientProfile,
    options?: AmbientProfileOptions,
  ): number => {
    const requested = options?.fadeSec;
    const fallback = profile === "silent" ? SILENT_AMBIENT_FADE_SEC : DEFAULT_AMBIENT_FADE_SEC;
    if (requested === undefined || !Number.isFinite(requested)) return fallback;
    return Math.max(0.02, Math.min(2.0, requested));
  };

  const holdAudioParam = (param: AudioParam, at: number, fallback = 0.0001) => {
    const maybeHold = param as AudioParam & {
      cancelAndHoldAtTime?: (cancelTime: number) => AudioParam;
    };
    if (typeof maybeHold.cancelAndHoldAtTime === "function") {
      maybeHold.cancelAndHoldAtTime(at);
      return;
    }
    const current = Number.isFinite(param.value) ? param.value : fallback;
    param.cancelScheduledValues(at);
    param.setValueAtTime(Math.max(current, fallback), at);
  };

  // ── Ambient profile builders ─────────────────────────────────────────
  // Each builder returns an AmbientLayer with a single fader that the
  // crossfade controller can ramp. The fader starts silent — connectLayer()
  // ramps it up after teardown of the previous layer.
  const buildAmbientLayer = (
    c: AudioContext,
    profile: AmbientProfile,
  ): AmbientLayer => {
    const fader = c.createGain();
    fader.gain.setValueAtTime(0.0001, c.currentTime);
    const layer: AmbientLayer = { profile, fader, sources: [], nodes: [fader] };

    // helper to wire a buffer-noise source through filters → fader
    const makeNoise = (
      seconds: number,
      brown: boolean,
    ): AudioBufferSourceNode => {
      const len = c.sampleRate * seconds;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      if (brown) {
        let last = 0;
        for (let i = 0; i < len; i++) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.4;
        }
      } else {
        // pinkish — single-pole filter on white
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + white * 0.0990460;
          b1 = 0.96300 * b1 + white * 0.2965164;
          b2 = 0.57000 * b2 + white * 1.0526913;
          data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
        }
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      return src;
    };

    // common swell — gentle LFO modulating a gain node
    const makeSwell = (rateHz: number, depth: number, base = 0.55): GainNode => {
      const g = c.createGain();
      g.gain.value = base;
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = rateHz;
      const lfoGain = c.createGain();
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain).connect(g.gain);
      lfo.start();
      layer.sources.push(lfo);
      layer.nodes.push(lfoGain);
      return g;
    };

    if (profile === "silent") {
      // no sources at all — fader stays silent forever
      return layer;
    }

    if (profile === "ocean") {
      const noise = makeNoise(6, true);
      const hp = c.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 60;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";  lp.frequency.value = 520; lp.Q.value = 0.7;
      const swell = makeSwell(0.14, 0.32);
      // tidal drift: 0.03 Hz adds a second slower modulation
      const drift = c.createOscillator();
      drift.type = "sine"; drift.frequency.value = 0.03;
      const driftGain = c.createGain();
      driftGain.gain.value = 0.12;
      drift.connect(driftGain).connect(swell.gain);
      drift.start();
      noise.connect(hp).connect(lp).connect(swell).connect(fader);
      noise.start();
      layer.sources.push(noise, drift);
      layer.nodes.push(hp, lp, swell, driftGain);
    } else if (profile === "storm") {
      // ocean bed + wind hiss (highpassed white noise) + low thunder rumble
      const ocean = makeNoise(6, true);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 0.7;
      const swell = makeSwell(0.18, 0.40, 0.65);
      ocean.connect(lp).connect(swell).connect(fader);
      ocean.start();

      const wind = makeNoise(3, false);
      const windHp = c.createBiquadFilter();
      windHp.type = "highpass"; windHp.frequency.value = 1200;
      const windLp = c.createBiquadFilter();
      windLp.type = "lowpass"; windLp.frequency.value = 4500;
      const windGain = c.createGain();
      windGain.gain.value = 0.25;
      const windLfo = c.createOscillator();
      windLfo.type = "sine"; windLfo.frequency.value = 0.09;
      const windLfoGain = c.createGain();
      windLfoGain.gain.value = 0.18;
      windLfo.connect(windLfoGain).connect(windGain.gain);
      windLfo.start();
      wind.connect(windHp).connect(windLp).connect(windGain).connect(fader);
      wind.start();

      layer.sources.push(ocean, wind, windLfo);
      layer.nodes.push(lp, swell, windHp, windLp, windGain, windLfoGain);
    } else if (profile === "wind") {
      // air + faint bird-like sine warbles
      const air = makeNoise(4, false);
      const hp = c.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 800;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 3500;
      const swell = makeSwell(0.07, 0.45, 0.40);
      air.connect(hp).connect(lp).connect(swell).connect(fader);
      air.start();
      layer.sources.push(air);
      layer.nodes.push(hp, lp, swell);
    } else if (profile === "fire") {
      // low crackling: noise → bandpass + amplitude LFO that "pops" irregularly
      const noise = makeNoise(2, false);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 1.4;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 2200;
      const swell = c.createGain();
      swell.gain.value = 0.35;
      // dual irregular LFOs for crackle
      const lfo1 = c.createOscillator();
      lfo1.type = "triangle"; lfo1.frequency.value = 3.7;
      const lfo1g = c.createGain();
      lfo1g.gain.value = 0.20;
      lfo1.connect(lfo1g).connect(swell.gain);
      const lfo2 = c.createOscillator();
      lfo2.type = "sine"; lfo2.frequency.value = 7.3;
      const lfo2g = c.createGain();
      lfo2g.gain.value = 0.12;
      lfo2.connect(lfo2g).connect(swell.gain);
      lfo1.start(); lfo2.start();
      noise.connect(bp).connect(lp).connect(swell).connect(fader);
      noise.start();
      layer.sources.push(noise, lfo1, lfo2);
      layer.nodes.push(bp, lp, swell, lfo1g, lfo2g);
    } else if (profile === "earth") {
      // subsonic rumble — very low triangle + tight lowpass
      const osc1 = c.createOscillator();
      osc1.type = "sine"; osc1.frequency.value = 38;
      const osc2 = c.createOscillator();
      osc2.type = "sine"; osc2.frequency.value = 55;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 200;
      const swell = makeSwell(0.05, 0.25, 0.55);
      osc1.connect(lp);
      osc2.connect(lp);
      lp.connect(swell).connect(fader);
      osc1.start(); osc2.start();
      layer.sources.push(osc1, osc2);
      layer.nodes.push(lp, swell);
    } else if (profile === "cosmic") {
      // pink noise barely audible + a couple of high sine drones
      const noise = makeNoise(4, false);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 1800;
      const ng = c.createGain();
      ng.gain.value = 0.18;
      noise.connect(lp).connect(ng).connect(fader);
      noise.start();

      const drone1 = c.createOscillator();
      drone1.type = "sine"; drone1.frequency.value = 220;
      const drone2 = c.createOscillator();
      drone2.type = "sine"; drone2.frequency.value = 330;
      const dg = c.createGain();
      dg.gain.value = 0.06;
      const dSwell = makeSwell(0.04, 0.40, 0.5);
      drone1.connect(dSwell);
      drone2.connect(dSwell);
      dSwell.connect(dg).connect(fader);
      drone1.start(); drone2.start();
      layer.sources.push(noise, drone1, drone2);
      layer.nodes.push(lp, ng, dSwell, dg);
    } else if (profile === "monitor") {
      // hospital monitor beep ambient — periodic short blips, very soft
      const blipBus = c.createGain();
      blipBus.gain.value = 0.6;
      blipBus.connect(fader);
      layer.nodes.push(blipBus);
      // dispatch a soft sine blip every ~1.0s by precomputing oscillator
      // chunks across a 60s window. The watchdog will rebuild on profile
      // change — this is a fire-and-forget pattern.
      const startAt = c.currentTime;
      const beepCount = 60; // 60s of beeps
      for (let i = 0; i < beepCount; i++) {
        const t = startAt + i * 1.0;
        const osc = c.createOscillator();
        osc.type = "sine"; osc.frequency.setValueAtTime(880, t);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.04, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(g).connect(blipBus);
        osc.start(t);
        osc.stop(t + 0.22);
        layer.sources.push(osc);
        layer.nodes.push(g);
      }
    } else if (profile === "electric") {
      // 60 Hz hum + 120 Hz harmonic + occasional spark via filtered noise
      const hum = c.createOscillator();
      hum.type = "sine"; hum.frequency.value = 60;
      const harm = c.createOscillator();
      harm.type = "sine"; harm.frequency.value = 120;
      const harmG = c.createGain();
      harmG.gain.value = 0.4;
      harm.connect(harmG);
      const hg = c.createGain();
      hg.gain.value = 0.10;
      hum.connect(hg);
      harmG.connect(hg);
      hg.connect(fader);
      hum.start(); harm.start();

      const noise = makeNoise(2, false);
      const hp = c.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 3000;
      const ng = c.createGain();
      ng.gain.value = 0.04;
      const sparkLfo = c.createOscillator();
      sparkLfo.type = "square"; sparkLfo.frequency.value = 0.6;
      const sparkLg = c.createGain();
      sparkLg.gain.value = 0.10;
      sparkLfo.connect(sparkLg).connect(ng.gain);
      sparkLfo.start();
      noise.connect(hp).connect(ng).connect(fader);
      noise.start();
      layer.sources.push(hum, harm, noise, sparkLfo);
      layer.nodes.push(harmG, hg, hp, ng, sparkLg);
    } else if (profile === "garden") {
      // soft wind + airy whistles approximating distant birdsong
      const air = makeNoise(4, false);
      const hp = c.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 500;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 2200;
      const swell = makeSwell(0.10, 0.30, 0.35);
      air.connect(hp).connect(lp).connect(swell).connect(fader);
      air.start();

      // a slow chirping sine for the bird vibe — varying with a square LFO
      const bird = c.createOscillator();
      bird.type = "sine"; bird.frequency.value = 2600;
      const birdG = c.createGain();
      birdG.gain.value = 0.0;
      const birdLfo = c.createOscillator();
      birdLfo.type = "sine"; birdLfo.frequency.value = 0.22;
      const birdLg = c.createGain();
      birdLg.gain.value = 0.018;
      birdLfo.connect(birdLg).connect(birdG.gain);
      birdLfo.start();
      bird.connect(birdG).connect(fader);
      bird.start();
      layer.sources.push(air, bird, birdLfo);
      layer.nodes.push(hp, lp, swell, birdG, birdLg);
    } else if (profile === "clockwork") {
      // mechanical tick every 2s + soft pulse
      const tickBus = c.createGain();
      tickBus.gain.value = 0.30;
      tickBus.connect(fader);
      layer.nodes.push(tickBus);
      const startAt = c.currentTime;
      // schedule 120 ticks (~4 min)
      for (let i = 0; i < 120; i++) {
        const t = startAt + i * 2.0;
        const noise = makeNoise(0.05, false);
        const hp = c.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 2000;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        noise.connect(hp).connect(g).connect(tickBus);
        noise.start(t);
        noise.stop(t + 0.08);
        layer.sources.push(noise);
        layer.nodes.push(hp, g);
      }
    }

    return layer;
  };

  // Tear down a layer with a short fade. Disconnects every owned node.
  const teardownLayer = (layer: AmbientLayer, fadeSec = DEFAULT_AMBIENT_FADE_SEC) => {
    if (!ctx) return;
    const now = ctx.currentTime;
    const fade = Math.max(0.02, fadeSec);
    try {
      holdAudioParam(layer.fader.gain, now);
      layer.fader.gain.linearRampToValueAtTime(0.0001, now + fade);
    } catch { /* noop */ }
    const cutoff = now + fade + 0.04;
    for (const s of layer.sources) {
      try { s.stop(cutoff); } catch { /* noop */ }
    }
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        for (const s of layer.sources) {
          try { s.disconnect(); } catch { /* noop */ }
        }
        for (const n of layer.nodes) {
          try { n.disconnect(); } catch { /* noop */ }
        }
      }, (fade + 0.16) * 1000);
    }
  };

  // Crossfade controller — swaps ambientLayer with a short fade.
  const setAmbientProfile = (
    name: AmbientProfile,
    options?: AmbientProfileOptions,
  ): void => {
    currentProfile = name;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    const fade = resolveAmbientFade(name, options);

    // already on this profile and a layer is live — nothing to do
    if (ambientLayer && ambientLayer.profile === name) return;

    // master gain MUST exist; if start() never ran, create it now so the
    // ambient bed has a fader to route through.
    if (!master) {
      master = c.createGain();
      master.gain.setValueAtTime(muted ? 0.0001 : 0.18, c.currentTime);
      master.connect(outNode(c));
    }

    // Build the next layer through the singleton fader. The default fade is
    // deliberately short: route changes should feel smooth without leaving two
    // procedural beds audibly phasing over each other.
    const next = buildAmbientLayer(c, name);
    next.fader.connect(master);
    const now = c.currentTime;
    // Silent profile stays at 0.
    next.fader.gain.cancelScheduledValues(now);
    next.fader.gain.setValueAtTime(0.0001, now);
    if (name !== "silent") {
      next.fader.gain.linearRampToValueAtTime(1.0, now + fade);
    }

    if (ambientLayer) {
      teardownLayer(ambientLayer, fade);
    }
    ambientLayer = next;
  };

  const getAmbientProfile = (): AmbientProfile => currentProfile;

  const start = async () => {
    // Always nudge a suspended context back to running before anything
    // else — autoplay policy may have parked it.
    if (ctx && ctx.state === "suspended") {
      try { await ctx.resume(); } catch { /* noop */ }
    }
    if (started) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") {
      try { await c.resume(); } catch { return; }
    }

    // master gain — owned at module scope so setMuted() can ramp it.
    // If setAmbientProfile() already built one, reuse it instead of
    // double-creating (which would orphan the existing layer's fader).
    if (!master) {
      master = c.createGain();
      master.gain.setValueAtTime(0.0001, c.currentTime);
      master.gain.exponentialRampToValueAtTime(
        muted ? 0.0001 : 0.18,
        c.currentTime + 5,
      );
      master.connect(outNode(c));
    }

    // Build the initial ambient layer ONLY if no layer has been chosen
    // yet (the page may have already called setAmbientProfile before
    // start fired — in that case the layer is live and we leave it).
    if (!ambientLayer) {
      const initial = buildAmbientLayer(c, currentProfile);
      initial.fader.connect(master);
      const now = c.currentTime;
      initial.fader.gain.cancelScheduledValues(now);
      initial.fader.gain.setValueAtTime(0.0001, now);
      if (currentProfile !== "silent") {
        initial.fader.gain.linearRampToValueAtTime(1.0, now + 2.0);
      }
      ambientLayer = initial;
    }

    // Watchdog — every 5s, ensure the context is running. iOS Safari has
    // a habit of suspending on tab background; this brings us back the
    // moment the user is looking again.
    if (typeof window !== "undefined" && watchdogTimer === null) {
      watchdogTimer = window.setInterval(() => {
        if (ctx && ctx.state === "suspended") {
          try { void ctx.resume(); } catch { /* noop */ }
        }
      }, 5000);
    }

    started = true;
  };

  const setMuted = (m: boolean) => {
    muted = m;
    if (typeof window !== "undefined") {
      try { localStorage.setItem(STORAGE_KEY, m ? "1" : "0"); } catch { /* noop */ }
    }
    if (!ctx || !master) return;
    const target = m ? 0.0001 : 0.18;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(target, ctx.currentTime + 0.8);
  };

  const oneShot = (
    type: OscillatorType,
    f0: number,
    f1: number,
    duration: number,
    peakGain: number,
  ) => {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") { try { c.resume(); } catch { /* noop */ } }
    const now = c.currentTime;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peakGain, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400;
    lp.Q.value = 0.5;
    osc.connect(g).connect(lp).connect(outNode(c));
    osc.start(now);
    osc.stop(now + duration + 0.05);
  };

  const chime = () => oneShot("sine", 880, 1320, 0.30, 0.05);
  const bell  = () => {
    oneShot("sine", 480, 480, 1.4, 0.06);
    oneShot("sine", 720, 720, 1.2, 0.04);
    oneShot("sine", 960, 960, 1.0, 0.025);
  };
  const thud  = () => oneShot("sine", 180, 80, 0.42, 0.10);
  const refuse = () => oneShot("sine", 260, 200, 0.30, 0.05);
  const spark = () => {
    oneShot("triangle", 1100, 720, 0.16, 0.05);
    oneShot("sine", 540, 760, 0.40, 0.04);
  };

  const playTone = (freq: number, durationSec = 0.3) => {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    const now = c.currentTime;
    const dur = Math.max(0.05, Math.min(2, durationSec));
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(Math.max(40, Math.min(8000, freq)), now);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.06, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(outNode(c));
    osc.start(now);
    osc.stop(now + dur + 0.05);
    osc.onended = () => {
      try { osc.disconnect(); } catch { /* noop */ }
      try { g.disconnect(); } catch { /* noop */ }
    };
  };

  /**
   * playNote — single pitched triangle oscillator with ADSR, routed through
   * the master sink so /signal's analyser sees it. Used by /waves PhaseChart
   * candle taps and any future scalar-note callers.
   *
   * midi: MIDI note number (A4 = 69). durationMs: how long the note sustains
   * before release (default 220ms). Total envelope length is ~ durationMs +
   * release(~280ms).
   */
  const playNote = (midi: number, durationMs = 220) => {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    const now = c.currentTime;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const sustainSec = Math.max(0.04, durationMs / 1000);
    const attack = 0.008;
    const decay  = 0.08;
    const release = 0.28;
    const sustainLvl = 0.45;
    const peak = 0.07;

    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.linearRampToValueAtTime(peak * sustainLvl, now + attack + decay);
    const releaseStart = now + attack + decay + sustainSec;
    g.gain.setValueAtTime(peak * sustainLvl, releaseStart);
    g.gain.linearRampToValueAtTime(0.0001, releaseStart + release);

    // gentle highpass to remove sub-rumble + soft lowpass so it sits in mix
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 4200;
    lp.Q.value = 0.5;

    osc.connect(g).connect(lp).connect(outNode(c));
    osc.start(now);
    const stopAt = releaseStart + release + 0.05;
    osc.stop(stopAt);
    osc.onended = () => {
      try { osc.disconnect(); } catch { /* noop */ }
      try { g.disconnect(); } catch { /* noop */ }
      try { lp.disconnect(); } catch { /* noop */ }
    };
  };

  // each concern is a voice. dragging the compass holds these tones.
  const CONCERN_VOICES: Record<string, ConcernVoice> = {
    memory:     { type: "sine",     freq: 174,  pitchRange:  50, gain: 0.05, lp: 1200 },
    work:       { type: "square",   freq: 220,  pitchRange:  80, gain: 0.025, lp: 900 },
    love:       { type: "sine",     freq: 392,  pitchRange:  90, gain: 0.045 },
    prayer:     { type: "sine",     freq: 587,  pitchRange: 120, gain: 0.035 },
    risk:       { type: "sawtooth", freq: 233,  pitchRange: 140, gain: 0.020, lp: 800 },
    future:     { type: "triangle", freq: 698,  pitchRange: 160, gain: 0.030 },
    body:       { type: "sine",     freq: 130,  pitchRange:  40, gain: 0.055, lp: 700 },
    friendship: { type: "triangle", freq: 466,  pitchRange: 100, gain: 0.035 },
  };

  type ToneHandle = {
    osc: OscillatorNode;
    g: GainNode;
    lp?: BiquadFilterNode;
  };
  const liveTones = new Map<string, ToneHandle>();

  const holdConcernTone = (id: string, value: number) => {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") { try { c.resume(); } catch { /* noop */ } }
    const voice = CONCERN_VOICES[id];
    if (!voice) return;

    const targetFreq = voice.freq + (value / 100 - 0.5) * voice.pitchRange;
    const targetGain = voice.gain * (0.3 + (value / 100) * 0.7);
    const now = c.currentTime;

    let handle = liveTones.get(id);
    if (!handle) {
      const osc = c.createOscillator();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(targetFreq, now);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(targetGain, now + 0.10);
      let chainTail: AudioNode = g;
      let lp: BiquadFilterNode | undefined;
      if (voice.lp) {
        lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = voice.lp;
        lp.Q.value = 0.6;
        g.connect(lp);
        chainTail = lp;
      }
      osc.connect(g);
      chainTail.connect(outNode(c));
      osc.start();
      handle = { osc, g, lp };
      liveTones.set(id, handle);
    } else {
      handle.osc.frequency.exponentialRampToValueAtTime(Math.max(40, targetFreq), now + 0.04);
      handle.g.gain.exponentialRampToValueAtTime(Math.max(0.0001, targetGain), now + 0.04);
    }
  };

  const releaseConcernTone = (id: string) => {
    if (!ctx) return;
    const handle = liveTones.get(id);
    if (!handle) return;
    const now = ctx.currentTime;
    handle.g.gain.cancelScheduledValues(now);
    handle.g.gain.setValueAtTime(Math.max(handle.g.gain.value, 0.0001), now);
    handle.g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    handle.osc.stop(now + 0.7);
    liveTones.delete(id);
  };

  const releaseAllConcernTones = () => {
    Array.from(liveTones.keys()).forEach(releaseConcernTone);
  };

  /**
   * Play your sigil as music. Each concern is a voice in a soft chord.
   * Vertex distances (concern values) drive amplitude envelopes that
   * stagger across the 8 voices over ~10 seconds.
   */
  const playSigilPhrase = async (concerns: Record<string, number>) => {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") { try { await c.resume(); } catch { return; } }

    const now = c.currentTime;
    const ORDER = ["prayer","future","work","risk","body","love","memory","friendship"];

    // master mixer for the phrase
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.9, now + 0.4);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 11.5);
    // a gentle reverb-feel via a delayed feedback path
    const delay = c.createDelay(2.0);
    delay.delayTime.value = 0.18;
    const feedback = c.createGain();
    feedback.gain.value = 0.32;
    const wet = c.createGain();
    wet.gain.value = 0.38;
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(outNode(c));
    master.connect(outNode(c));
    master.connect(delay);

    ORDER.forEach((id, i) => {
      const voice = CONCERN_VOICES[id];
      if (!voice) return;
      const v = concerns[id] ?? 50;
      const norm = v / 100;
      // skip near-silent voices
      if (norm < 0.18) return;
      const f = voice.freq + (norm - 0.5) * voice.pitchRange;
      const startAt = now + i * 0.45;
      const peakAt  = startAt + 0.6 + norm * 1.2;
      const endAt   = peakAt + 2.5 + norm * 4.0;

      const osc = c.createOscillator();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(f, startAt);
      // very slow detune drift for life
      osc.frequency.linearRampToValueAtTime(f * (1 + (norm - 0.5) * 0.01), endAt);

      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, startAt);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, voice.gain * (0.4 + norm * 0.7) * 1.6), peakAt);
      g.gain.exponentialRampToValueAtTime(0.0001, endAt);

      let chainTail: AudioNode = g;
      let lp: BiquadFilterNode | undefined;
      if (voice.lp) {
        lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = voice.lp;
        lp.Q.value = 0.6;
        g.connect(lp);
        chainTail = lp;
      }
      osc.connect(g);
      chainTail.connect(master);
      osc.start(startAt);
      osc.stop(endAt + 0.1);
    });

    // small final bell on the dominant concern
    const topConcern = ORDER.reduce((best, k) => (concerns[k] ?? 0) > (concerns[best] ?? 0) ? k : best, ORDER[0]);
    const tv = CONCERN_VOICES[topConcern];
    if (tv) {
      setTimeout(() => {
        const t = c.currentTime;
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(tv.freq * 2, t);
        const og = c.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        o.connect(og).connect(master);
        o.start(t);
        o.stop(t + 1.7);
      }, 9500);
    }

    // wait for the phrase to finish
    await new Promise((r) => setTimeout(r, 11800));
  };

  /**
   * Generative composer.
   *
   * Four concurrent layers — bass drone, melody, chord pad, shimmer — all
   * scheduled into the existing AudioContext and routed through the master
   * sink so the /signal analyser captures the music in real time.
   *
   * Strategy: pre-compute the full note sequence at compose start, then run
   * a 100ms look-ahead scheduler that arms WebAudio nodes 500ms in advance.
   * stop() schedules a 1.5s fade-out on all live envelopes and cancels any
   * notes still pending in the queue.
   */
  const composeMusic = (opts: ComposeOpts = {}): ComposeHandle | null => {
    // stop any in-progress piece first — only one composition at a time.
    if (currentComposition) {
      try { currentComposition.stop(); } catch { /* noop */ }
      currentComposition = null;
    }
    if (muted) return null;
    const c = ensureContext();
    if (!c) return null;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }

    const concerns = opts.concerns ?? {};
    const duration = Math.max(20, Math.min(180, opts.duration ?? 60));

    // Parse the prompt (if any) before resolving tempo/scale, so prompt
    // hints can OVERRIDE the concern-derived defaults.
    const promptMods = parsePromptMods(opts.prompt);

    const baseTempo = pickTempo(opts.tempo, concerns);
    const tempo = Math.max(40, Math.min(180, baseTempo + promptMods.tempoDelta));
    // Prompt scale overrides "auto"; explicit opts.scale still wins.
    let scaleName: Exclude<ScaleName, "auto">;
    if (opts.scale && opts.scale !== "auto") {
      scaleName = opts.scale;
    } else if (promptMods.scale) {
      scaleName = promptMods.scale;
    } else if (opts.prompt?.trim()) {
      scaleName = pickPromptFallbackScale(opts.prompt.trim().toLowerCase());
    } else {
      scaleName = pickScale(opts.scale ?? "auto", concerns);
    }
    const degrees = SCALE_DEGREES[scaleName];
    const secPerBeat = 60 / tempo;

    // Oceanic coda — appended unless explicitly disabled or the piece is
    // too short to host one (< 18s leaves no room for the regular layers).
    const wantCoda = opts.oceanicCoda !== false && duration >= 18;
    const CODA_LEN = 12;
    // Time inside the piece when the coda begins. Regular layers must end
    // by this point; melody/chord/shim cursors are capped against it.
    const codaStartOffset = wantCoda ? duration - CODA_LEN : duration;

    // root: MIDI 57 = A3 for the bass anchor; melody plays in A4 range.
    const BASS_MIDI = 45;   // A2 = 110 Hz
    const MELODY_MIDI = 69; // A4 = 440 Hz
    const CHORD_MIDI = 57;  // A3 = 220 Hz
    const SHIMMER_MIDI = 93; // A6 = 1760 Hz

    const t0 = c.currentTime;
    const tEnd = t0 + duration;
    // Time at which the regular layers must fully fade and the coda begins.
    const tCodaStart = t0 + codaStartOffset;

    // Per-composition bus so stop() can hit one fader to silence everything.
    const bus = c.createGain();
    bus.gain.setValueAtTime(0.0001, t0);
    bus.gain.linearRampToValueAtTime(1, t0 + 0.8);
    bus.connect(outNode(c));

    // Track every oscillator we start so we can disconnect them on stop().
    const liveOscs: OscillatorNode[] = [];
    const liveGains: GainNode[] = [];
    let stopped = false;
    // Look-ahead scheduler timers (window.setInterval id).
    let schedulerTimer: number | null = null;

    // Helper: spawn an oscillator with ADSR envelope and route through bus.
    const spawnNote = (
      type: OscillatorType,
      freq: number,
      startAt: number,
      noteDur: number,
      attack: number,
      decay: number,
      sustainLvl: number,
      release: number,
      peak: number,
      detuneCents = 0,
    ) => {
      if (stopped) return;
      try {
        const osc = c.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, startAt);
        if (detuneCents !== 0) osc.detune.setValueAtTime(detuneCents, startAt);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, startAt);
        // attack
        g.gain.linearRampToValueAtTime(peak, startAt + attack);
        // decay → sustain
        g.gain.linearRampToValueAtTime(peak * sustainLvl, startAt + attack + decay);
        // hold sustain until release begins
        const releaseStart = Math.max(startAt + attack + decay, startAt + noteDur);
        g.gain.setValueAtTime(peak * sustainLvl, releaseStart);
        // release
        g.gain.linearRampToValueAtTime(0.0001, releaseStart + release);
        osc.connect(g).connect(bus);
        osc.start(startAt);
        const stopAt = releaseStart + release + 0.05;
        osc.stop(stopAt);
        osc.onended = () => {
          try { osc.disconnect(); } catch { /* noop */ }
          try { g.disconnect(); } catch { /* noop */ }
        };
        liveOscs.push(osc);
        liveGains.push(g);
      } catch { /* noop */ }
    };

    // The regular-layers envelope ends at tCodaStart (or tEnd if no coda).
    // Layers do their natural fade-out leading up to this boundary; the
    // coda block (below) takes over for the final CODA_LEN seconds.
    const tLayersEnd = wantCoda ? tCodaStart : tEnd;
    // Drone peak — doubled if the user asked for "drone" emphasis.
    const dronePeak = promptMods.droneEmphasis ? 0.16 : 0.08;
    // LFO depth — wider when emphasizing.
    const droneLfoCents = promptMods.droneEmphasis ? 4 : 2;

    // ── Layer 1: BASS DRONE ─────────────────────────────────────────
    // Sustained low oscillator, full piece, with a very slow LFO on pitch.
    {
      const droneFreq = midiHz(BASS_MIDI);
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(droneFreq, t0);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(dronePeak, t0 + 4);
      // Hold until the coda's fade-in window starts (4s before tCodaStart).
      const fadeStart = Math.max(t0 + 4, tLayersEnd - (wantCoda ? 4 : 6));
      g.gain.setValueAtTime(dronePeak, fadeStart);
      g.gain.linearRampToValueAtTime(0.0001, tLayersEnd);
      // ±2 cents LFO at 0.07 Hz for warmth.
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.07, t0);
      const lfoGain = c.createGain();
      lfoGain.gain.setValueAtTime(droneLfoCents, t0); // detune units = cents
      lfo.connect(lfoGain).connect(osc.detune);
      osc.connect(g).connect(bus);
      osc.start(t0);
      lfo.start(t0);
      osc.stop(tLayersEnd + 0.2);
      lfo.stop(tLayersEnd + 0.2);
      const cleanup = () => {
        try { osc.disconnect(); } catch { /* noop */ }
        try { lfo.disconnect(); } catch { /* noop */ }
        try { lfoGain.disconnect(); } catch { /* noop */ }
        try { g.disconnect(); } catch { /* noop */ }
      };
      osc.onended = cleanup;
      liveOscs.push(osc, lfo);
      liveGains.push(g);
    }

    // Container for nodes owned by the optional fire layer and the coda.
    // These need explicit cleanup on stop() since they live outside the
    // liveOscs/liveGains tracking arrays.
    type Disconnectable = { disconnect: () => void };
    const extraNodes: Disconnectable[] = [];
    const extraSources: AudioScheduledSourceNode[] = [];

    // ── Optional layer: FIRE NOISE WASH ─────────────────────────────
    // Filtered white noise at low volume — adds a crackly, atmospheric
    // bed when the prompt mentions fire/burn/flame. Cleaned up on stop().
    if (promptMods.addFireWash) {
      try {
        const len = c.sampleRate * 2; // 2s loop of white noise
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1800;
        lp.Q.value = 0.5;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.05, t0 + 6);
        const firePeakEnd = Math.max(t0 + 6, tLayersEnd - 3);
        g.gain.setValueAtTime(0.05, firePeakEnd);
        g.gain.linearRampToValueAtTime(0.0001, tLayersEnd);
        src.connect(lp).connect(g).connect(bus);
        src.start(t0);
        src.stop(tLayersEnd + 0.1);
        src.onended = () => {
          try { src.disconnect(); } catch { /* noop */ }
          try { lp.disconnect(); } catch { /* noop */ }
          try { g.disconnect(); } catch { /* noop */ }
        };
        extraSources.push(src);
        extraNodes.push(lp, g);
      } catch { /* noop */ }
    }

    // ── Pre-compute note events (Layers 2, 3, 4) ────────────────────
    // Each event carries an absolute AudioContext time so the scheduler
    // just dispatches whichever events fall inside the look-ahead window.
    type NoteEvent = {
      at: number;     // absolute ctx time
      kind: "mel" | "chord" | "shim" | "bell" | "rain";
      freq: number;   // base freq (chord uses array-of-three; we expand)
      freq2?: number; // chord voice 2
      freq3?: number; // chord voice 3
      freq4?: number; // chord voice 4 (dense-mode)
      dur: number;
    };
    const events: NoteEvent[] = [];

    // ── Layer 2: MELODY ─────────────────────────────────────────────
    // Weighted random walk on scale degrees with a pull toward the tonic.
    // Notes are grouped into phrases of 4-8 notes separated by breath gaps.
    {
      // deterministic-ish RNG seeded by the timestamp + concerns sum
      const concernSum = (Object.values(concerns) as number[]).reduce(
        (a, b) => a + (b ?? 0), 0,
      );
      let seed = (Math.floor(t0 * 1000) ^ Math.floor(concernSum * 1000)) >>> 0;
      const rand = () => {
        // xorshift32
        seed ^= seed << 13; seed >>>= 0;
        seed ^= seed >>> 17; seed >>>= 0;
        seed ^= seed << 5;  seed >>>= 0;
        return (seed >>> 0) / 0xffffffff;
      };

      let degIdx = 0; // start on tonic
      let octave = 0; // 0 = base, +1 = jump up
      let cursor = t0 + 2; // melody enters after 2s
      // last 6 seconds reserved for fade — or, if a coda is queued, end
      // 4s before the coda begins (the bus has already started fading then).
      const melEnd = wantCoda ? tCodaStart - 4 : tEnd - 6;
      while (cursor < melEnd) {
        const phraseLen = 4 + Math.floor(rand() * 5); // 4-8 notes
        for (let n = 0; n < phraseLen && cursor < melEnd; n++) {
          // random walk: ±1 step usually, occasional ±2.
          const stepMag = rand() < 0.78 ? 1 : 2;
          const stepDir = rand() < 0.5 ? -1 : 1;
          // pull toward tonic when wandered
          const gravity = degIdx === 0 ? 0 : (degIdx > 3 ? -1 : (degIdx < -3 ? 1 : 0));
          const useGravity = rand() < 0.28;
          degIdx += useGravity ? gravity : stepDir * stepMag;
          // clamp to a comfortable range
          if (degIdx > 6) degIdx = 6;
          if (degIdx < -6) degIdx = -6;
          // occasional octave jump
          if (rand() < 0.06) octave = octave === 0 ? 1 : 0;

          // Map degIdx → semitone offset within scale. Wrap with octave shift.
          const idx = ((degIdx % degrees.length) + degrees.length) % degrees.length;
          const octShift = Math.floor(degIdx / degrees.length) * 12 + octave * 12;
          const semis = degrees[idx] + octShift;
          const freq = midiHz(MELODY_MIDI + semis);

          // note length: 1 or 2 beats with occasional half-beat
          const beats = rand() < 0.15 ? 0.5 : (rand() < 0.7 ? 1 : 2);
          const dur = beats * secPerBeat;
          events.push({ at: cursor, kind: "mel", freq, dur });
          cursor += dur;
        }
        // breath gap between phrases — 1 to 3 beats, stretched in sparse mode
        cursor += (1 + Math.floor(rand() * 3)) * secPerBeat * promptMods.melodyDensity;
      }

      // ── Layer 3: CHORD PAD ──────────────────────────────────────
      // Triads from the scale, changing every 4 beats. Use the canonical
      // i / IV / V / vi rotation indexed into our mode's degrees.
      const chordRoots = [0, 3, 4, 5]; // scale-degree indices for the rotation
      const chordDur = 4 * secPerBeat;
      let chordCursor = t0 + 1; // pad enters after 1s
      const chordEnd = wantCoda ? tCodaStart - 3 : tEnd - 5;
      let ri = 0;
      while (chordCursor < chordEnd) {
        const root = chordRoots[ri % chordRoots.length];
        const third = (root + 2) % degrees.length;
        const fifth = (root + 4) % degrees.length;
        // Dense mode: add a seventh on top.
        const seventh = (root + 6) % degrees.length;
        const f1 = midiHz(CHORD_MIDI + degrees[root]);
        const f2 = midiHz(CHORD_MIDI + degrees[third]);
        const f3 = midiHz(CHORD_MIDI + degrees[fifth] + 12); // +1 octave for openness
        const f4 = promptMods.chordVoiceBoost
          ? midiHz(CHORD_MIDI + degrees[seventh] + 12)
          : undefined;
        events.push({
          at: chordCursor,
          kind: "chord",
          freq: f1,
          freq2: f2,
          freq3: f3,
          freq4: f4,
          dur: chordDur,
        });
        chordCursor += chordDur;
        ri++;
      }

      // ── Layer 4: SHIMMER ────────────────────────────────────────
      // Sparse high notes — one every 4-8 beats, very soft.
      let shimCursor = t0 + 5;
      const shimEnd = wantCoda ? tCodaStart - 2 : tEnd - 4;
      while (shimCursor < shimEnd) {
        // Dense mode: tighter step gaps for more shimmer.
        const stepBeats = Math.max(
          1,
          Math.round((4 + Math.floor(rand() * 5)) / promptMods.shimmerBoost),
        );
        const idx = Math.floor(rand() * degrees.length);
        const semis = degrees[idx];
        const freq = midiHz(SHIMMER_MIDI + semis);
        events.push({ at: shimCursor, kind: "shim", freq, dur: 2.0 });
        shimCursor += stepBeats * secPerBeat;
      }

      // ── Optional layer: BELLS ───────────────────────────────────
      // High triangle hits with very long bell-like release. Sparse, ~one
      // every 6-12 beats, scattered across the upper octave.
      if (promptMods.addBells) {
        let bellCursor = t0 + 8;
        const bellEnd = wantCoda ? tCodaStart - 3 : tEnd - 5;
        while (bellCursor < bellEnd) {
          const idx = Math.floor(rand() * degrees.length);
          const semis = degrees[idx];
          // bell sits an octave above the shimmer for clarity
          const freq = midiHz(SHIMMER_MIDI + 12 + semis);
          events.push({ at: bellCursor, kind: "bell", freq, dur: 2.5 });
          bellCursor += (6 + Math.floor(rand() * 7)) * secPerBeat;
        }
      }

      // ── Optional layer: RAIN PLUCKS ─────────────────────────────
      // Quick low-velocity triangle plucks at random pitches in the
      // mid-low range — random patter, ~3-6 hits per second.
      if (promptMods.addRain) {
        let rainCursor = t0 + 3;
        const rainEnd = wantCoda ? tCodaStart - 2 : tEnd - 4;
        while (rainCursor < rainEnd) {
          const idx = Math.floor(rand() * degrees.length);
          const semis = degrees[idx];
          // mid range, between melody and bass
          const freq = midiHz(MELODY_MIDI - 12 + semis);
          events.push({ at: rainCursor, kind: "rain", freq, dur: 0.18 });
          rainCursor += 0.18 + rand() * 0.22; // ~3-6 Hz patter
        }
      }
    }

    // Sort the queue chronologically; the scheduler walks it in order.
    events.sort((a, b) => a.at - b.at);

    // ── Oceanic coda ────────────────────────────────────────────────
    // A 12-second sea outro that takes over once the regular layers
    // finish fading. Two low sines (root + perfect fifth) for the swell,
    // a high cluster of three partials for sparkle, and a filtered noise
    // wash. A 0.14 Hz LFO breathes the coda gain like a single ocean
    // swell. The very last 2s do an exponential fade-out to silence.
    if (wantCoda) {
      try {
        // Per-coda master gain — separate from the main bus so we can
        // schedule its own envelope cleanly and tear it down on stop().
        const codaMaster = c.createGain();
        codaMaster.gain.setValueAtTime(0.0001, tCodaStart);
        codaMaster.connect(bus);
        extraNodes.push(codaMaster);

        // Volume envelope: 0 → 0.18 → 0 across the 12s, with a hard
        // exponential drop in the last 2s.
        const tFadeIn = tCodaStart + 6; // peak swell at 6s
        const tHoldEnd = tCodaStart + (CODA_LEN - 2); // start exp fade
        const tCodaEnd = tCodaStart + CODA_LEN;
        codaMaster.gain.linearRampToValueAtTime(0.18, tFadeIn);
        codaMaster.gain.linearRampToValueAtTime(0.18, tHoldEnd);
        codaMaster.gain.exponentialRampToValueAtTime(0.0001, tCodaEnd);

        // 0.14 Hz LFO breathing on the coda master gain — one full
        // swell cycle across the 12s. Authored as an additive offset.
        const lfo = c.createOscillator();
        lfo.type = "sine";
        lfo.frequency.setValueAtTime(0.14, tCodaStart);
        const lfoGain = c.createGain();
        lfoGain.gain.setValueAtTime(0.06, tCodaStart);
        lfo.connect(lfoGain).connect(codaMaster.gain);
        lfo.start(tCodaStart);
        lfo.stop(tCodaEnd + 0.2);
        extraSources.push(lfo);
        extraNodes.push(lfoGain);

        // Root + perfect fifth low sines, slowly detuning ±10 cents.
        const rootMidi = BASS_MIDI; // A2
        const fifthMidi = BASS_MIDI + 7;
        const rootFreq = midiHz(rootMidi);
        const fifthFreq = midiHz(fifthMidi);

        const buildSwellSine = (freq: number, detuneSign: number) => {
          const osc = c.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, tCodaStart);
          // detune from 0 → ±10 cents across the coda
          osc.detune.setValueAtTime(0, tCodaStart);
          osc.detune.linearRampToValueAtTime(detuneSign * 10, tCodaEnd);
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, tCodaStart);
          // 6s fade-in on the layer itself, sustained, then short fade
          g.gain.linearRampToValueAtTime(0.32, tCodaStart + 6);
          g.gain.setValueAtTime(0.32, tHoldEnd);
          g.gain.linearRampToValueAtTime(0.0001, tCodaEnd);
          osc.connect(g).connect(codaMaster);
          osc.start(tCodaStart);
          osc.stop(tCodaEnd + 0.2);
          extraSources.push(osc);
          extraNodes.push(g);
        };
        buildSwellSine(rootFreq, +1);
        buildSwellSine(fifthFreq, -1);

        // High cluster of three sine partials at root * 2, * 3, * 5.
        // Long ADSR (attack 2s, release 4s) — very soft.
        const buildHighPartial = (mult: number, peak: number) => {
          const osc = c.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(rootFreq * mult, tCodaStart);
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, tCodaStart);
          // attack 2s
          g.gain.linearRampToValueAtTime(peak, tCodaStart + 2);
          // sustain until release window
          const relStart = Math.max(tCodaStart + 2, tCodaEnd - 4);
          g.gain.setValueAtTime(peak, relStart);
          // release 4s
          g.gain.linearRampToValueAtTime(0.0001, relStart + 4);
          osc.connect(g).connect(codaMaster);
          osc.start(tCodaStart);
          osc.stop(tCodaEnd + 0.2);
          extraSources.push(osc);
          extraNodes.push(g);
        };
        buildHighPartial(2, 0.05);
        buildHighPartial(3, 0.035);
        buildHighPartial(5, 0.018);

        // Filtered noise wash — white noise → biquad LP @ 800 Hz, vol 0.06.
        const nlen = c.sampleRate * 3;
        const nbuf = c.createBuffer(1, nlen, c.sampleRate);
        const ndata = nbuf.getChannelData(0);
        for (let i = 0; i < nlen; i++) ndata[i] = Math.random() * 2 - 1;
        const nsrc = c.createBufferSource();
        nsrc.buffer = nbuf;
        nsrc.loop = true;
        const nlp = c.createBiquadFilter();
        nlp.type = "lowpass";
        nlp.frequency.setValueAtTime(800, tCodaStart);
        nlp.Q.value = 0.5;
        const ng = c.createGain();
        ng.gain.setValueAtTime(0.0001, tCodaStart);
        ng.gain.linearRampToValueAtTime(0.06, tCodaStart + 6);
        ng.gain.setValueAtTime(0.06, tHoldEnd);
        ng.gain.linearRampToValueAtTime(0.0001, tCodaEnd);
        nsrc.connect(nlp).connect(ng).connect(codaMaster);
        nsrc.start(tCodaStart);
        nsrc.stop(tCodaEnd + 0.2);
        extraSources.push(nsrc);
        extraNodes.push(nlp, ng);
      } catch { /* noop */ }
    }

    // ── Look-ahead scheduler ────────────────────────────────────────
    // Every 100ms, arm any events whose start time is within 500ms.
    let qIdx = 0;
    const LOOK_AHEAD = 0.5;

    const tick = () => {
      if (stopped) return;
      if (!ctx) return;
      const now = ctx.currentTime;
      while (qIdx < events.length && events[qIdx].at <= now + LOOK_AHEAD) {
        const ev = events[qIdx++];
        if (ev.kind === "mel") {
          // triangle, ADSR (attack 30ms, decay 200ms, sustain 0.4, release 600ms)
          spawnNote("triangle", ev.freq, ev.at, ev.dur, 0.03, 0.20, 0.4, 0.6, 0.18);
        } else if (ev.kind === "chord") {
          // three (or four, in dense mode) voices with slight detune for richness
          spawnNote("sine", ev.freq,        ev.at, ev.dur, 0.20, 0.30, 0.6, 1.0, 0.12, 0);
          if (ev.freq2 !== undefined)
            spawnNote("sine", ev.freq2,     ev.at, ev.dur, 0.20, 0.30, 0.6, 1.0, 0.10, +5);
          if (ev.freq3 !== undefined)
            spawnNote("sine", ev.freq3,     ev.at, ev.dur, 0.20, 0.30, 0.6, 1.0, 0.08, -10);
          if (ev.freq4 !== undefined)
            spawnNote("sine", ev.freq4,     ev.at, ev.dur, 0.25, 0.35, 0.55, 1.0, 0.06, +8);
        } else if (ev.kind === "bell") {
          // bell — high triangle with bell-like decay (sharp attack, very long release)
          spawnNote("triangle", ev.freq, ev.at, ev.dur, 0.005, 0.18, 0.18, 2.2, 0.07);
          // a small detuned partial 7 semitones up for a struck shimmer
          spawnNote("sine", ev.freq * 1.498, ev.at, ev.dur, 0.005, 0.20, 0.12, 1.8, 0.035, +6);
        } else if (ev.kind === "rain") {
          // rain pluck — very short triangle blip, low velocity
          spawnNote("triangle", ev.freq, ev.at, ev.dur, 0.003, 0.05, 0.0, 0.18, 0.04);
        } else { // shim
          spawnNote("sine", ev.freq, ev.at, ev.dur, 0.10, 0.40, 0.4, 1.2, 0.05);
        }
      }
      if (qIdx >= events.length && now >= tEnd) {
        // piece is done — let stop() do graceful cleanup
        handle.stop();
      }
    };

    if (typeof window !== "undefined") {
      schedulerTimer = window.setInterval(tick, 100);
      // also run once immediately to arm anything in the first 500ms.
      tick();
    }

    const handle: ComposeHandle = {
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (schedulerTimer !== null && typeof window !== "undefined") {
          try { window.clearInterval(schedulerTimer); } catch { /* noop */ }
          schedulerTimer = null;
        }
        if (!ctx) {
          if (currentComposition === handle) currentComposition = null;
          return;
        }
        const now = ctx.currentTime;
        // 1.5s fade-out on the bus, then cancel pending oscs.
        try {
          bus.gain.cancelScheduledValues(now);
          bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), now);
          bus.gain.linearRampToValueAtTime(0.0001, now + 1.5);
        } catch { /* noop */ }
        // For oscillators whose envelope extends past the fade, stop them
        // shortly after the fade completes.
        const cutoff = now + 1.7;
        for (const o of liveOscs) {
          try { o.stop(cutoff); } catch { /* noop */ }
        }
        // Stop coda + fire scheduled sources (noise loops, swell sines, LFO).
        for (const s of extraSources) {
          try { s.stop(cutoff); } catch { /* noop */ }
        }
        // Disconnect the bus + extras after the fade completes.
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            try { bus.disconnect(); } catch { /* noop */ }
            for (const n of extraNodes) {
              try { n.disconnect(); } catch { /* noop */ }
            }
            for (const s of extraSources) {
              try { s.disconnect(); } catch { /* noop */ }
            }
          }, 1800);
        }
        if (currentComposition === handle) currentComposition = null;
      },
      end: tEnd,
      duration,
    };

    currentComposition = handle;
    return handle;
  };

  const playAudioClip = async (data: ArrayBuffer): Promise<ComposeHandle | null> => {
    if (currentComposition) {
      try { currentComposition.stop(); } catch { /* noop */ }
      currentComposition = null;
    }
    if (muted) return null;
    const c = ensureContext();
    if (!c) return null;
    if (c.state === "suspended") { try { await c.resume(); } catch { return null; } }

    let buffer: AudioBuffer;
    try {
      buffer = await c.decodeAudioData(data.slice(0));
    } catch {
      return null;
    }

    const t0 = c.currentTime;
    const source = c.createBufferSource();
    const bus = c.createGain();
    source.buffer = buffer;
    bus.gain.setValueAtTime(0.0001, t0);
    bus.gain.linearRampToValueAtTime(0.95, t0 + 0.08);
    bus.gain.setValueAtTime(0.95, t0 + Math.max(0.1, buffer.duration - 0.45));
    bus.gain.linearRampToValueAtTime(0.0001, t0 + buffer.duration);
    source.connect(bus).connect(outNode(c));

    let stopped = false;
    const handle: ComposeHandle = {
      end: t0 + buffer.duration,
      duration: buffer.duration,
      stop: () => {
        if (stopped) return;
        stopped = true;
        const now = c.currentTime;
        holdAudioParam(bus.gain, now);
        bus.gain.linearRampToValueAtTime(0.0001, now + 0.35);
        try { source.stop(now + 0.4); } catch { /* noop */ }
        if (currentComposition === handle) currentComposition = null;
      },
    };

    source.onended = () => {
      try { source.disconnect(); } catch { /* noop */ }
      try { bus.disconnect(); } catch { /* noop */ }
      if (currentComposition === handle) currentComposition = null;
    };
    source.start(t0);
    currentComposition = handle;
    return handle;
  };

  instance = {
    start,
    setMuted,
    isMuted: () => muted,
    getAudioTime: () => (started && ctx ? ctx.currentTime : null),
    // Lazily creates the context on first call so /signal can hook the
    // analyser even before start() runs. Returns null only on platforms
    // without Web Audio at all.
    getAnalyser: () => {
      if (!analyser) ensureContext();
      return analyser;
    },
    getAudioContext: () => {
      if (!ctx) ensureContext();
      return ctx;
    },
    chime, bell, thud, refuse, spark,
    playTone,
    playNote,
    holdConcernTone, releaseConcernTone, releaseAllConcernTones,
    playSigilPhrase,
    composeMusic,
    playAudioClip,
    getCurrentComposition,
    setAmbientProfile,
    getAmbientProfile,
  };
  return instance;
}
