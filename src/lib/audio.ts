// Procedural Atlantic + per-page ambient profiles. Brown noise → lowpass →
// gain, with a 0.14 Hz swell LFO and a 0.03 Hz drift LFO modulating the
// gain so the noise breathes like waves. No samples, no assets — just the
// Web Audio graph. setAmbientProfile() swaps the ambient layer with a
// short crossfade so each page can set its own bed. The whole graph exits
// through one disciplined master bus (gentle compressor → safety limiter →
// headroom trim) so nothing the site makes can ever arrive loud, and
// setScaleRegister() glides the ambient bed along the manifold's spectral
// register (plan W3): cosmic = dark and slow, atomic = open and quick.

import type { ConcernKey } from "@/lib/types";
import { entryScaleFor, spectralRegisterFor } from "@/lib/scale";
import { registerGlideTargets } from "@/lib/audio-register";

// The named ambient beds each page can request. Profiles swap through the
// singleton audio engine so route changes do not accidentally start parallel
// ambient graphs.
export type AmbientProfile =
  | "ocean"      // brown noise + swell LFO — default Atlantic
  | "aphros"     // bright surf, foam hiss, shell-like partials
  | "tide"       // slow lunar water, low buoy pulse
  | "waves"      // phasey stereo-feeling swell + soft clicks
  | "watch"      // watch ticks over far water
  | "pretext"    // breathy paper, vocal-ish vowel drone
  | "storm"      // ocean + wind hiss + thunder rumble
  | "wind"       // pink-ish airy noise + faint bird-like sines
  | "fire"       // band-passed crackle
  | "earth"      // subsonic rumble
  | "cosmic"     // vacuum hush + sparse deep drones + rare pulsar ticks
  | "monitor"    // hospital beep ambient (subliminal)
  | "electric"   // 60 Hz hum + occasional spark
  | "garden"     // gentle wind + filtered bird chatter
  | "clockwork"  // faint mechanical ticks + soft pulse
  | "archive"    // dry paper room, low shelf resonance
  | "entry"      // intimate page turn + reading room hum
  | "atlas"      // compass drone, map-paper air
  | "colophon"   // printed matter, quiet press bed
  | "compare"    // two low tones beating against one another
  | "kept"       // held shelf, glassy memory shimmer
  | "reading"    // quiet candle + near-field breath
  | "signal"     // radio bed, nearly silent but alive
  | "vacuum"     // zero-point seethe: high thin hiss beating over a deep floor
  | "beyond"     // folded-wave shimmer and slow interference
  | "circularity"// rotating Fourier hums
  | "flowers"    // bees, petals, brighter garden air
  | "light"      // color instrument halo
  | "sine"       // clean oscillator laboratory
  | "time"       // chronograph ticks + manifold drone
  | "silent";    // no ambient at all, kept for emergency hard-mute routes

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
  buzz: () => void;      // short, low contact feedback
  // pitched single-note triangle oscillator with ADSR. used by /waves
  // PhaseChart so each candle clicks at a pitch picked from the phase scale.
  // `delaySec` schedules the tone into the future — /zeus uses this so a bolt
  // at the edge of the sky arrives at the ear a beat after the eye caught it,
  // and that perceptual latency IS the sky's depth.
  playTone: (freq: number, durationSec?: number, delaySec?: number) => void;
  playNote: (midi: number, durationMs?: number) => void;
  /**
   * A three-layer thunder: a sub-bass thump (the crack near the ear), a
   * mid-band roll (the discharge), and a filtered-noise rumble tail (echoes
   * off atmosphere). `energy` scales the sub-bass depth and rumble length —
   * bigger bolts ring lower and rumble longer. `delaySec` schedules the whole
   * clap into the future and quiets it with 1 / (1 + delaySec) so a distant
   * strike sounds distant, not just late. `layers`: 3 = full (default), 2 =
   * drop the noise tail (medium tier), 1 = sub-bass only (low tier).
   */
  playThunder: (energy: number, delaySec?: number, layers?: number) => void;
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
  // With { loop: true } the clip repeats seamlessly until stop() is called.
  playAudioClip: (data: ArrayBuffer, opts?: { loop?: boolean }) => Promise<ComposeHandle | null>;
  // peek at the active composition, or null if none.
  getCurrentComposition: () => ComposeHandle | null;
  // Swap the ambient bed through the singleton engine with a short fade.
  // Pages call this on mount so each route gets its own atmosphere
  // instead of every page playing the sea.
  setAmbientProfile: (name: AmbientProfile, options?: AmbientProfileOptions) => void;
  // Read back the active profile, mostly for debugging / tests.
  getAmbientProfile: () => AmbientProfile;
  // Glide the ambient bed toward the spectral register for manifold
  // position s (log10 meters — lib/scale). Safe to call every frame: tiny
  // moves short-circuit, and before audio starts it just records the
  // target for when the bed comes up.
  setScaleRegister: (s: number) => void;
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

export function setScaleRegister(s: number): void {
  getFieldAudio().setScaleRegister(s);
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
    // Breathing LFOs the spectral register may retime, with their authored
    // rates. Only the shared swells register here — texture LFOs (fire
    // crackle, bird chirp) keep their own clocks.
    swellLfos: { osc: OscillatorNode; baseHz: number }[];
  };
  let ambientLayer: AmbientLayer | null = null;
  let currentProfile: AmbientProfile = "ocean";

  // ── Scale → spectral register state (plan W3) ────────────────────────
  // setScaleRegister(s) glides the ambient bed toward the register for a
  // manifold position: a register lowpass spliced between the ambient
  // master and the sink, a breath LFO riding its center, and a rate scale
  // on the layers' swell LFOs. Before audio exists we only remember the
  // target; tiny moves short-circuit so callers may fire every frame.
  const REGISTER_GLIDE_SEC = 1.5;
  const REGISTER_EPSILON = 0.02; // decades of |Δs| below which calls no-op
  let registerTargetS: number | null = null;
  let registerAppliedS: number | null = null;
  let registerRateScale = 1;
  type RegisterChain = {
    lp: BiquadFilterNode;
    shelf: BiquadFilterNode;
    breath: OscillatorNode;
    breathDepth: GainNode;
  };
  let registerChain: RegisterChain | null = null;
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
    // Build the visualisation tap once. sink → analyser → master bus →
    // destination. Everything else connects to `sink` instead of
    // `ctx.destination` (light-808 connects straight into the analyser —
    // downstream of the sink, still upstream of the bus discipline).
    sink = ctx.createGain();
    sink.gain.value = 1;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.78;
    sink.connect(analyser);
    // Master bus discipline (plan W3). The analyser stays pre-bus so FFT
    // readers (/signal, the jewel, light-808's tap) see the raw field;
    // after it, a gentle glue compressor (soft knee, low ratio, slow
    // release) evens the sum, a hard-safety limiter catches anything that
    // stacks up, and a headroom trim keeps the whole site shy of loud.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -30;
    glue.knee.value = 24;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.02;
    glue.release.value = 0.6;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 3;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.3;
    const headroom = ctx.createGain();
    headroom.gain.value = 0.85;
    analyser.connect(glue);
    glue.connect(limiter);
    limiter.connect(headroom);
    headroom.connect(ctx.destination);
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
    const layer: AmbientLayer = {
      profile, fader, sources: [], nodes: [fader], swellLfos: [],
    };

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

    // common swell — gentle LFO modulating a gain node. New layers are born
    // already breathing at the current register's rate scale.
    const makeSwell = (rateHz: number, depth: number, base = 0.55): GainNode => {
      const g = c.createGain();
      g.gain.value = base;
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = rateHz * registerRateScale;
      const lfoGain = c.createGain();
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain).connect(g.gain);
      lfo.start();
      layer.sources.push(lfo);
      layer.nodes.push(lfoGain);
      layer.swellLfos.push({ osc: lfo, baseHz: rateHz });
      return g;
    };

    const addNoiseBed = ({
      seconds = 4,
      brown = false,
      hp,
      lp,
      bp,
      q = 1,
      gain = 0.22,
      swellRate = 0.08,
      swellDepth = 0.18,
      swellBase = 0.45,
    }: {
      seconds?: number;
      brown?: boolean;
      hp?: number;
      lp?: number;
      bp?: number;
      q?: number;
      gain?: number;
      swellRate?: number;
      swellDepth?: number;
      swellBase?: number;
    }) => {
      const noise = makeNoise(seconds, brown);
      const gainNode = c.createGain();
      gainNode.gain.value = gain;
      const swell = makeSwell(swellRate, swellDepth, swellBase);
      let node: AudioNode = noise;
      if (hp) {
        const filter = c.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = hp;
        node.connect(filter);
        node = filter;
        layer.nodes.push(filter);
      }
      if (bp) {
        const filter = c.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = bp;
        filter.Q.value = q;
        node.connect(filter);
        node = filter;
        layer.nodes.push(filter);
      }
      if (lp) {
        const filter = c.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = lp;
        filter.Q.value = q;
        node.connect(filter);
        node = filter;
        layer.nodes.push(filter);
      }
      node.connect(gainNode).connect(swell).connect(fader);
      noise.start();
      layer.sources.push(noise);
      layer.nodes.push(gainNode, swell);
    };

    const addDrone = (
      freqs: number[],
      {
        type = "sine",
        gain = 0.035,
        swellRate = 0.04,
        swellDepth = 0.18,
        filter,
      }: {
        type?: OscillatorType;
        gain?: number;
        swellRate?: number;
        swellDepth?: number;
        filter?: number;
      } = {},
    ) => {
      const bus = c.createGain();
      bus.gain.value = gain;
      const swell = makeSwell(swellRate, swellDepth, 0.5);
      let destination: AudioNode = swell;
      if (filter) {
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = filter;
        destination = lp;
        lp.connect(swell);
        layer.nodes.push(lp);
      }
      for (const freq of freqs) {
        const osc = c.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        osc.connect(destination);
        osc.start();
        layer.sources.push(osc);
      }
      swell.connect(bus).connect(fader);
      layer.nodes.push(bus, swell);
    };

    const addPulseTrain = ({
      freq,
      every,
      count,
      gain = 0.035,
      decay = 0.14,
      type = "sine",
      startOffset = 0,
    }: {
      freq: number;
      every: number;
      count: number;
      gain?: number;
      decay?: number;
      type?: OscillatorType;
      startOffset?: number;
    }) => {
      const bus = c.createGain();
      bus.gain.value = 1;
      bus.connect(fader);
      layer.nodes.push(bus);
      const startAt = c.currentTime + startOffset;
      for (let i = 0; i < count; i++) {
        const t = startAt + i * every;
        const osc = c.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        osc.connect(g).connect(bus);
        osc.start(t);
        osc.stop(t + decay + 0.04);
        layer.sources.push(osc);
        layer.nodes.push(g);
      }
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
      layer.swellLfos.push({ osc: drift, baseHz: 0.03 });
    } else if (profile === "aphros") {
      // Aphrodite foam: bright surf, shell-like partials, airy sparkle.
      addNoiseBed({ seconds: 5, brown: true, hp: 90, lp: 900, gain: 0.18, swellRate: 0.16, swellDepth: 0.28 });
      addNoiseBed({ seconds: 3, hp: 1800, lp: 6200, gain: 0.035, swellRate: 0.31, swellDepth: 0.24 });
      addDrone([523.25, 659.25, 783.99], { gain: 0.018, swellRate: 0.06, swellDepth: 0.20, filter: 1800 });
    } else if (profile === "tide") {
      // Lunar tide: slower and darker than ocean, with a distant buoy pulse.
      addNoiseBed({ seconds: 7, brown: true, hp: 45, lp: 380, gain: 0.22, swellRate: 0.055, swellDepth: 0.34, swellBase: 0.5 });
      addDrone([73.42, 110], { type: "triangle", gain: 0.022, swellRate: 0.025, swellDepth: 0.16, filter: 260 });
      addPulseTrain({ freq: 220, every: 5.6, count: 48, gain: 0.018, decay: 0.32, startOffset: 1.2 });
    } else if (profile === "waves") {
      // Study waves: thinner surf plus phase ticks that feel analytic.
      addNoiseBed({ seconds: 4, brown: true, hp: 110, lp: 760, gain: 0.15, swellRate: 0.21, swellDepth: 0.30 });
      addDrone([146.83, 220, 293.66], { gain: 0.018, swellRate: 0.11, swellDepth: 0.22, filter: 900 });
      addPulseTrain({ freq: 587.33, every: 3.0, count: 80, gain: 0.016, decay: 0.09, type: "triangle" });
    } else if (profile === "watch") {
      // Watch: precise ticks over a thin, far-water floor. Triangle ticks —
      // square edges read as alarm, not escapement (W3 retune).
      addNoiseBed({ seconds: 5, brown: true, hp: 120, lp: 460, gain: 0.08, swellRate: 0.08, swellDepth: 0.18 });
      addDrone([196, 392], { gain: 0.012, swellRate: 0.033, swellDepth: 0.12, filter: 800 });
      addPulseTrain({ freq: 1200, every: 1.0, count: 240, gain: 0.018, decay: 0.04, type: "triangle" });
    } else if (profile === "pretext") {
      // Text room: breathy paper noise with a soft vowel-like drone.
      addNoiseBed({ seconds: 4, hp: 350, lp: 2200, gain: 0.075, swellRate: 0.12, swellDepth: 0.18 });
      addDrone([174.61, 261.63, 349.23], { type: "sine", gain: 0.02, swellRate: 0.05, swellDepth: 0.22, filter: 1200 });
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
      // Deep space, not surf: almost-vacuum hush (thin, quiet, no swell),
      // sparse pure drones, and rare soft pulsar ticks. Avoids the brown/
      // pink + swell LFO that made the old bed read as ocean waves.
      const hush = makeNoise(8, false);
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 420;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      lp.Q.value = 0.4;
      const hushG = c.createGain();
      hushG.gain.value = 0.028;
      hush.connect(hp).connect(lp).connect(hushG).connect(fader);
      hush.start();

      // very slow, dry sine stack — no swell LFO (that was the "wave" feel)
      const droneGain = c.createGain();
      droneGain.gain.value = 0.022;
      droneGain.connect(fader);
      const freqs = [55, 82.5, 165, 247.5];
      for (const f of freqs) {
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        const g = c.createGain();
        // stagger levels so the bed isn't a chord blob
        g.gain.value = f < 100 ? 0.55 : f < 200 ? 0.28 : 0.16;
        osc.connect(g).connect(droneGain);
        osc.start();
        layer.sources.push(osc);
        layer.nodes.push(g);
      }

      // rare soft pulsar ticks — space radio, not surf
      const tickBus = c.createGain();
      tickBus.gain.value = 0.7;
      tickBus.connect(fader);
      const startAt = c.currentTime + 2.4;
      for (let i = 0; i < 36; i++) {
        const t = startAt + i * 3.8 + (i % 3) * 0.15;
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1480 + (i % 5) * 40, t);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.018, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        osc.connect(g).connect(tickBus);
        osc.start(t);
        osc.stop(t + 0.12);
        layer.sources.push(osc);
        layer.nodes.push(g);
      }

      layer.sources.push(hush);
      layer.nodes.push(hp, lp, hushG, droneGain, tickBus);
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
    } else if (profile === "archive") {
      // Archive: dry paper air and a low shelf resonance.
      addNoiseBed({ seconds: 5, hp: 700, lp: 2400, gain: 0.045, swellRate: 0.04, swellDepth: 0.10 });
      addDrone([130.81, 196], { gain: 0.012, swellRate: 0.018, swellDepth: 0.10, filter: 650 });
    } else if (profile === "entry") {
      // Single entry: closer paper, tiny page-turn ticks.
      addNoiseBed({ seconds: 4, hp: 900, lp: 3000, gain: 0.038, swellRate: 0.06, swellDepth: 0.12 });
      addDrone([164.81, 246.94], { gain: 0.012, swellRate: 0.025, swellDepth: 0.11, filter: 720 });
      addPulseTrain({ freq: 740, every: 7.0, count: 36, gain: 0.012, decay: 0.08, type: "triangle", startOffset: 2.4 });
    } else if (profile === "atlas") {
      // Atlas: compass drone and map-paper air.
      addNoiseBed({ seconds: 5, hp: 500, lp: 1800, gain: 0.05, swellRate: 0.05, swellDepth: 0.12 });
      addDrone([98, 146.83, 220], { type: "triangle", gain: 0.022, swellRate: 0.032, swellDepth: 0.18, filter: 820 });
      addPulseTrain({ freq: 392, every: 4.5, count: 60, gain: 0.014, decay: 0.16, type: "sine", startOffset: 0.7 });
    } else if (profile === "colophon") {
      // Colophon: quiet print-shop press, almost still.
      addNoiseBed({ seconds: 6, hp: 260, lp: 1500, gain: 0.035, swellRate: 0.026, swellDepth: 0.08 });
      addPulseTrain({ freq: 180, every: 6.0, count: 48, gain: 0.009, decay: 0.05, type: "triangle", startOffset: 1.8 });
    } else if (profile === "compare") {
      // Compare: two low tones gently beating against each other.
      addNoiseBed({ seconds: 5, hp: 300, lp: 1400, gain: 0.03, swellRate: 0.04, swellDepth: 0.10 });
      addDrone([174.61, 179.2, 261.63, 268.4], { gain: 0.016, swellRate: 0.027, swellDepth: 0.16, filter: 900 });
    } else if (profile === "kept") {
      // Kept: shelf resonance with a glassy memory shimmer.
      addNoiseBed({ seconds: 5, hp: 600, lp: 2200, gain: 0.035, swellRate: 0.04, swellDepth: 0.12 });
      addDrone([220, 329.63, 659.25], { gain: 0.014, swellRate: 0.035, swellDepth: 0.16, filter: 1400 });
    } else if (profile === "reading") {
      // Reading: near-field breath and candle room tone.
      addNoiseBed({ seconds: 5, hp: 180, lp: 1300, gain: 0.05, swellRate: 0.11, swellDepth: 0.14 });
      addDrone([196, 293.66], { gain: 0.012, swellRate: 0.033, swellDepth: 0.12, filter: 760 });
    } else if (profile === "signal") {
      // Signal: nearly silent radio carrier so composition pages don't inherit sea.
      addNoiseBed({ seconds: 3, hp: 2200, lp: 5200, gain: 0.022, swellRate: 0.17, swellDepth: 0.16 });
      addDrone([440, 441.8], { gain: 0.006, swellRate: 0.021, swellDepth: 0.08, filter: 1200 });
    } else if (profile === "vacuum") {
      // The zero-point field near the bottom of the axis: nothing is
      // happening and it never stops. A thin high seethe (this band rings
      // high and quick), two partials a hair apart so the bed beats at the
      // band's own breath rate, a deep floor underneath for body, and rare
      // grains. Quiet by construction — presence, not volume.
      const reg = spectralRegisterFor(entryScaleFor("/quarks") ?? -17);
      const beatHz = reg.lfoHz;
      // The quickness lives in the beat between the two close partials, not in
      // the swells — a difference frequency survives the register's rate scale,
      // where a fast LFO would turn to tremolo when travel glides the bed.
      addNoiseBed({ seconds: 5, hp: 1500, lp: 5200, gain: 0.026, swellRate: beatHz * 0.10, swellDepth: 0.30, swellBase: 0.40 });
      addNoiseBed({ seconds: 7, brown: true, hp: 40, lp: 200, gain: 0.055, swellRate: beatHz * 0.04, swellDepth: 0.18, swellBase: 0.5 });
      addDrone([523.25, 1046.5, 1046.5 + beatHz], { type: "sine", gain: 0.009, swellRate: beatHz * 0.06, swellDepth: 0.22, filter: 2400 });
      addPulseTrain({ freq: 1975.53, every: 3.1, count: 78, gain: 0.007, decay: 0.045, type: "sine", startOffset: 1.3 });
    } else if (profile === "beyond") {
      // Beyond: folded-wave interference, no obvious natural source.
      addNoiseBed({ seconds: 4, hp: 1400, lp: 4800, gain: 0.04, swellRate: 0.19, swellDepth: 0.22 });
      addDrone([123.47, 185, 277.18, 415.3], { type: "sine", gain: 0.02, swellRate: 0.037, swellDepth: 0.24, filter: 1600 });
    } else if (profile === "circularity") {
      // Circularity: rotating Fourier partials.
      addDrone([110, 220, 330, 440], { type: "sine", gain: 0.022, swellRate: 0.09, swellDepth: 0.20, filter: 1400 });
      addPulseTrain({ freq: 660, every: 2.25, count: 96, gain: 0.012, decay: 0.08, type: "triangle", startOffset: 0.4 });
    } else if (profile === "flowers") {
      // Flowers: brighter garden air, bees, and petal tremble.
      addNoiseBed({ seconds: 4, hp: 650, lp: 2600, gain: 0.065, swellRate: 0.13, swellDepth: 0.20 });
      addDrone([246.94, 493.88, 987.77], { type: "sine", gain: 0.014, swellRate: 0.18, swellDepth: 0.18, filter: 2400 });
      addPulseTrain({ freq: 1760, every: 5.3, count: 48, gain: 0.01, decay: 0.06, type: "sine", startOffset: 1.1 });
    } else if (profile === "light") {
      // Light instrument: luminous halo around the playable notes.
      addDrone([261.63, 392, 523.25, 784], { type: "sine", gain: 0.016, swellRate: 0.06, swellDepth: 0.18, filter: 2200 });
      addNoiseBed({ seconds: 3, hp: 3000, lp: 6800, gain: 0.018, swellRate: 0.23, swellDepth: 0.20 });
    } else if (profile === "sine") {
      // Sine lab: clean low oscillator reference and a metered ping.
      addDrone([110, 220], { type: "sine", gain: 0.018, swellRate: 0.12, swellDepth: 0.12, filter: 900 });
      addPulseTrain({ freq: 880, every: 4.0, count: 60, gain: 0.012, decay: 0.10, type: "sine" });
    } else if (profile === "time") {
      // Time: chronograph ticks over a slow manifold drone.
      addDrone([82.41, 164.81, 329.63], { type: "triangle", gain: 0.018, swellRate: 0.02, swellDepth: 0.12, filter: 900 });
      addPulseTrain({ freq: 1320, every: 1.0, count: 240, gain: 0.015, decay: 0.035, type: "triangle" });
      addPulseTrain({ freq: 660, every: 5.0, count: 48, gain: 0.014, decay: 0.18, type: "triangle", startOffset: 0.5 });
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

  // Route the ambient master toward the sink — through the register chain
  // when one has been built. Called wherever master is created and when the
  // chain first splices in.
  const wireMasterOut = (c: AudioContext) => {
    if (!master) return;
    try { master.disconnect(); } catch { /* noop */ }
    if (registerChain) master.connect(registerChain.lp);
    else master.connect(outNode(c));
  };

  // Glide every register-bound param toward the targets for scale position
  // s over REGISTER_GLIDE_SEC. Builds the chain lazily (neutral, fully
  // open) on first use so rooms that never touch the manifold pay nothing.
  const applyRegister = (c: AudioContext, s: number) => {
    if (!master) return;
    if (!registerChain) {
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 12000; // transparent until the first glide lands
      lp.Q.value = 0.5;
      const shelf = c.createBiquadFilter();
      shelf.type = "highshelf";
      shelf.frequency.value = 1700;
      shelf.gain.value = 0;
      const breath = c.createOscillator();
      breath.type = "sine";
      breath.frequency.value = 0.16; // coast-neutral until retargeted
      const breathDepth = c.createGain();
      breathDepth.gain.value = 0;
      breath.connect(breathDepth).connect(lp.frequency);
      breath.start();
      lp.connect(shelf);
      shelf.connect(outNode(c));
      registerChain = { lp, shelf, breath, breathDepth };
      wireMasterOut(c);
    }
    const targets = registerGlideTargets(spectralRegisterFor(s));
    const now = c.currentTime;
    const end = now + REGISTER_GLIDE_SEC;
    const glide = (param: AudioParam, to: number) => {
      // Not holdAudioParam — the shelf gain is legitimately ≤ 0 and must
      // not be floored. Mid-glide retargets pick up from the current value.
      try {
        param.cancelScheduledValues(now);
        param.setValueAtTime(
          Number.isFinite(param.value) ? param.value : to, now,
        );
        param.linearRampToValueAtTime(to, end);
      } catch { /* noop */ }
    };
    glide(registerChain.lp.frequency, targets.cutoffHz);
    glide(registerChain.shelf.gain, targets.shelfDb);
    glide(registerChain.breath.frequency, targets.breathHz);
    glide(registerChain.breathDepth.gain, targets.breathDepthHz);
    registerRateScale = targets.rateScale;
    if (ambientLayer) {
      for (const { osc, baseHz } of ambientLayer.swellLfos) {
        glide(osc.frequency, baseHz * targets.rateScale);
      }
    }
  };

  // If a target arrived before the bed existed, land it now. Called once
  // master + ambient are up (start / first setAmbientProfile).
  const applyPendingRegister = (c: AudioContext) => {
    if (registerTargetS === null || registerAppliedS !== null) return;
    registerAppliedS = registerTargetS;
    applyRegister(c, registerTargetS);
  };

  const setScaleRegister = (s: number) => {
    if (!Number.isFinite(s)) return;
    registerTargetS = s;
    // No context or no ambient master yet — safe no-op, target recorded.
    if (!ctx || !master) return;
    if (
      registerAppliedS !== null &&
      Math.abs(s - registerAppliedS) < REGISTER_EPSILON
    ) return;
    registerAppliedS = s;
    applyRegister(ctx, s);
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
      wireMasterOut(c);
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
    // A register target may have arrived before the bed existed.
    applyPendingRegister(c);
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
      wireMasterOut(c);
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

    // Land any register target recorded while audio was still down.
    applyPendingRegister(c);

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
    options: {
      attack?: number;
      cutoff?: number;
      q?: number;
      stopPadding?: number;
    } = {},
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
    g.gain.exponentialRampToValueAtTime(peakGain, now + (options.attack ?? 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = options.cutoff ?? 2400;
    lp.Q.value = options.q ?? 0.5;
    osc.connect(g).connect(lp).connect(outNode(c));
    osc.start(now);
    osc.stop(now + duration + (options.stopPadding ?? 0.05));
    osc.onended = () => {
      try { osc.disconnect(); } catch { /* noop */ }
      try { g.disconnect(); } catch { /* noop */ }
      try { lp.disconnect(); } catch { /* noop */ }
    };
  };

  // One-shot palette, retuned toward beauty (plan W3): melodic material
  // never attacks under 10ms, upper partials are lowpassed, and every
  // default gain sits a step lower — the bar is 2am on headphones. Each
  // keeps its identity: the chime still lifts, the bell still tolls, the
  // thud still lands, refuse still declines, spark still glints.
  const chime = () => oneShot("sine", 880, 1320, 0.38, 0.04, { attack: 0.028, cutoff: 1900 });
  const bell  = () => {
    oneShot("sine", 480, 480, 1.5, 0.05,  { attack: 0.030, cutoff: 1400 });
    oneShot("sine", 720, 720, 1.3, 0.032, { attack: 0.036, cutoff: 1400 });
    oneShot("sine", 960, 960, 1.1, 0.018, { attack: 0.045, cutoff: 1200 });
  };
  const thud  = () => oneShot("sine", 180, 80, 0.42, 0.085, { attack: 0.016, cutoff: 700 });
  const refuse = () => oneShot("sine", 260, 200, 0.34, 0.04, { attack: 0.022, cutoff: 1100 });
  const spark = () => {
    oneShot("triangle", 1100, 720, 0.18, 0.032, { attack: 0.012, cutoff: 1700 });
    oneShot("sine", 540, 760, 0.42, 0.032, { attack: 0.020, cutoff: 1600 });
  };

  const buzz = () => {
    oneShot("sawtooth", 148, 112, 0.058, 0.016, {
      attack: 0.004,
      cutoff: 620,
      q: 0.55,
      stopPadding: 0.02,
    });
  };

  const playTone = (freq: number, durationSec = 0.3, delaySec = 0) => {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    const delay = Math.max(0, Math.min(1.2, delaySec));
    const now = c.currentTime + delay;
    const dur = Math.max(0.05, Math.min(2, durationSec));
    // distance attenuation — a far tone is quieter, not just late.
    const atten = 1 / (1 + delay * 1.2);
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(Math.max(40, Math.min(8000, freq)), now);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05 * atten, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(outNode(c));
    osc.start(now);
    osc.stop(now + dur + 0.05);
    osc.onended = () => {
      try { osc.disconnect(); } catch { /* noop */ }
      try { g.disconnect(); } catch { /* noop */ }
    };
  };

  // A three-layer thunder. /zeus's discharges and distant flashes route
  // through here so the sky sounds like a sky, not a sine. Kept in the shared
  // audio module so every downstream route (analyser, master compressor, mute
  // bit) applies without a private bus. See FieldAudio.playThunder above for
  // the shape.
  const playThunder = (energy: number, delaySec = 0, layers = 3) => {
    if (muted) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    const delay = Math.max(0, Math.min(1.2, delaySec));
    const now = c.currentTime + delay;
    const e = Math.max(0.05, Math.min(2.5, energy));
    // 1 / (1 + delay) so a far strike also sounds farther, not merely late.
    const atten = 1 / (1 + delay * 1.4);
    // sub-bass drops as energy climbs — the biggest bolts feel like a floor
    const subHz = Math.max(22, 60 - e * 18);
    const midHz = Math.max(90, 200 - e * 70);
    const noiseCenterHz = Math.max(400, 1200 - e * 400);
    const attack = 0.006;
    const bodyDur = 0.35 + e * 0.35;
    const tailDur = 0.6 + e * 1.6;

    // sub-bass sine — the crack near the ear
    const sub = c.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(subHz, now);
    const subG = c.createGain();
    subG.gain.setValueAtTime(0.0001, now);
    subG.gain.exponentialRampToValueAtTime(0.09 * atten, now + attack);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + bodyDur * 2.2);
    sub.connect(subG).connect(outNode(c));
    sub.start(now);
    sub.stop(now + bodyDur * 2.2 + 0.05);
    sub.onended = () => {
      try { sub.disconnect(); } catch { /* noop */ }
      try { subG.disconnect(); } catch { /* noop */ }
    };

    if (layers < 2) return;

    // mid-band triangle glide — the discharge pop
    const mid = c.createOscillator();
    mid.type = "triangle";
    mid.frequency.setValueAtTime(midHz, now);
    mid.frequency.exponentialRampToValueAtTime(Math.max(50, midHz * 0.55), now + bodyDur);
    const midG = c.createGain();
    midG.gain.setValueAtTime(0.0001, now);
    midG.gain.exponentialRampToValueAtTime(0.05 * atten, now + attack * 1.6);
    midG.gain.exponentialRampToValueAtTime(0.0001, now + bodyDur * 1.1);
    const midLp = c.createBiquadFilter();
    midLp.type = "lowpass";
    midLp.frequency.value = Math.max(220, noiseCenterHz * 1.4);
    midLp.Q.value = 0.6;
    mid.connect(midG).connect(midLp).connect(outNode(c));
    mid.start(now);
    mid.stop(now + bodyDur * 1.1 + 0.05);
    mid.onended = () => {
      try { mid.disconnect(); } catch { /* noop */ }
      try { midG.disconnect(); } catch { /* noop */ }
      try { midLp.disconnect(); } catch { /* noop */ }
    };

    if (layers < 3) return;

    // rumble tail — band-passed noise, the atmosphere carrying the discharge
    const sampleRate = c.sampleRate;
    const bufLen = Math.max(1, Math.floor(sampleRate * (tailDur + 0.2)));
    const buf = c.createBuffer(1, bufLen, sampleRate);
    const data = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < bufLen; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      data[i] = brown * 3.2;
    }
    const noise = c.createBufferSource();
    noise.buffer = buf;
    const noiseBp = c.createBiquadFilter();
    noiseBp.type = "bandpass";
    noiseBp.frequency.value = noiseCenterHz;
    noiseBp.Q.value = 1.2;
    const noiseG = c.createGain();
    noiseG.gain.setValueAtTime(0.0001, now);
    noiseG.gain.exponentialRampToValueAtTime(0.04 * atten, now + 0.05);
    noiseG.gain.exponentialRampToValueAtTime(0.0001, now + tailDur);
    noise.connect(noiseBp).connect(noiseG).connect(outNode(c));
    noise.start(now);
    noise.stop(now + tailDur + 0.1);
    noise.onended = () => {
      try { noise.disconnect(); } catch { /* noop */ }
      try { noiseBp.disconnect(); } catch { /* noop */ }
      try { noiseG.disconnect(); } catch { /* noop */ }
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
    const attack = 0.014;
    const decay  = 0.08;
    const release = 0.28;
    const sustainLvl = 0.45;
    const peak = 0.06;

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
    lp.frequency.value = 3400;
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
  // W3 retune: the square (work) and saw (risk) keep their grain as
  // identity but sit behind lower lowpasses at lower gains, and the bare
  // triangles take a lid so their odd partials never glare.
  const CONCERN_VOICES: Record<string, ConcernVoice> = {
    memory:     { type: "sine",     freq: 174,  pitchRange:  50, gain: 0.05, lp: 1200 },
    work:       { type: "square",   freq: 220,  pitchRange:  80, gain: 0.020, lp: 640 },
    love:       { type: "sine",     freq: 392,  pitchRange:  90, gain: 0.045 },
    prayer:     { type: "sine",     freq: 587,  pitchRange: 120, gain: 0.035 },
    risk:       { type: "sawtooth", freq: 233,  pitchRange: 140, gain: 0.016, lp: 600 },
    future:     { type: "triangle", freq: 698,  pitchRange: 160, gain: 0.028, lp: 2200 },
    body:       { type: "sine",     freq: 130,  pitchRange:  40, gain: 0.055, lp: 700 },
    friendship: { type: "triangle", freq: 466,  pitchRange: 100, gain: 0.032, lp: 1900 },
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
          spawnNote("triangle", ev.freq, ev.at, ev.dur, 0.03, 0.20, 0.4, 0.6, 0.15);
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
          // bell — high triangle, struck softly (12ms attack, very long release)
          spawnNote("triangle", ev.freq, ev.at, ev.dur, 0.012, 0.18, 0.18, 2.2, 0.06);
          // a small detuned partial 7 semitones up for a struck shimmer
          spawnNote("sine", ev.freq * 1.498, ev.at, ev.dur, 0.012, 0.20, 0.12, 1.8, 0.03, +6);
        } else if (ev.kind === "rain") {
          // rain pluck — short triangle blip, low velocity, rounded onset
          spawnNote("triangle", ev.freq, ev.at, ev.dur, 0.010, 0.05, 0.0, 0.18, 0.035);
        } else { // shim
          spawnNote("sine", ev.freq, ev.at, ev.dur, 0.10, 0.40, 0.4, 1.2, 0.045);
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

  const playAudioClip = async (
    data: ArrayBuffer,
    opts: { loop?: boolean } = {},
  ): Promise<ComposeHandle | null> => {
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

    const loop = opts.loop === true;
    const t0 = c.currentTime;
    const source = c.createBufferSource();
    const bus = c.createGain();
    source.buffer = buffer;
    source.loop = loop;
    bus.gain.setValueAtTime(0.0001, t0);
    bus.gain.linearRampToValueAtTime(0.95, t0 + 0.08);
    if (!loop) {
      // one-shot: fade the tail so it doesn't cut abruptly. Looping clips
      // skip this so the gain stays flat across the seam between repeats.
      bus.gain.setValueAtTime(0.95, t0 + Math.max(0.1, buffer.duration - 0.45));
      bus.gain.linearRampToValueAtTime(0.0001, t0 + buffer.duration);
    }
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
    chime, bell, thud, refuse, spark, buzz,
    playTone,
    playThunder,
    playNote,
    holdConcernTone, releaseConcernTone, releaseAllConcernTones,
    playSigilPhrase,
    composeMusic,
    playAudioClip,
    getCurrentComposition,
    setAmbientProfile,
    getAmbientProfile,
    setScaleRegister,
  };
  return instance;
}
