"use client";

// Voice engine behind /timbre — renders any TimbreSpec (including blends
// between instruments) as sound, live.
//
// Each touch owns a voice: a pair of oscillators sharing a PeriodicWave
// built from the spec's harmonic recipe (the second one detuned for string
// shimmer), plus a filtered noise loop for breath or bridge buzz, through a
// lowpass that tracks the spec's brightness and an envelope that knows the
// difference between plucked (fall away) and bowed/blown (hold). Morphing a
// held note swaps the PeriodicWave and re-aims envelope, filter, noise and
// vibrato — the note keeps sounding while it changes species.
//
// Rides the shared field-audio AudioContext and analyser tap, like the
// other room engines.

import { getFieldAudio } from "@/lib/audio";
import { HARMONIC_COUNT, type TimbreSpec } from "@/lib/timbre";

export type TimbreEngine = {
  noteOn: (id: string, freq: number, spec: TimbreSpec) => void;
  glide: (id: string, freq: number) => void;
  morph: (id: string, spec: TimbreSpec) => void;
  noteOff: (id: string) => void;
  stopAll: () => void;
};

type Voice = {
  oscs: [OscillatorNode, OscillatorNode];
  detuneBase: [number, number];
  noiseGain: GainNode;
  noiseFilter: BiquadFilterNode;
  vibratoDepth: GainNode;
  filter: BiquadFilterNode;
  env: GainNode;
  freq: number;
  spec: TimbreSpec;
  peak: number;
  startedAt: number;
};

const MAX_VOICES = 6;

let engine: TimbreEngine | null = null;

export function getTimbreEngine(): TimbreEngine {
  if (engine) return engine;

  const audio = getFieldAudio();
  let bus: GainNode | null = null;
  let vibratoLfo: OscillatorNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  const voices = new Map<string, Voice>();

  const ensure = (): AudioContext | null => {
    const c = audio.getAudioContext();
    if (!c) return null;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    if (!bus) {
      const out: AudioNode = audio.getAnalyser() ?? c.destination;

      bus = c.createGain();
      bus.gain.value = 1;

      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 20;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;

      const master = c.createGain();
      master.gain.value = 0.85;

      bus.connect(comp);
      comp.connect(master);
      master.connect(out);

      vibratoLfo = c.createOscillator();
      vibratoLfo.type = "sine";
      vibratoLfo.frequency.value = 5;
      vibratoLfo.start();

      const seconds = 1.2;
      noiseBuffer = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      let seed = 0x9e3779b9;
      for (let i = 0; i < data.length; i++) {
        // deterministic xorshift noise — the same breath every visit
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
      }
    }
    return c;
  };

  const clampFreq = (freq: number) => Math.max(20, Math.min(16000, freq));

  const waveFor = (c: AudioContext, spec: TimbreSpec) => {
    const real = new Float32Array(HARMONIC_COUNT + 1);
    const imag = new Float32Array(HARMONIC_COUNT + 1);
    for (let i = 0; i < HARMONIC_COUNT; i++) imag[i + 1] = spec.harmonics[i];
    return c.createPeriodicWave(real, imag);
  };

  const cutoffFor = (freq: number, spec: TimbreSpec) =>
    Math.max(300, Math.min(14000, freq * spec.brightness));

  const noiseFilterSettings = (spec: TimbreSpec, freq: number) =>
    spec.noiseColor === "breath"
      ? { type: "bandpass" as const, frequency: 2400, q: 0.7 }
      : { type: "highpass" as const, frequency: Math.min(9000, freq * 5), q: 1.4 };

  // Aim the envelope at where this spec wants a held note to live: bowed and
  // blown voices hold their sustain level, plucked and struck voices fall
  // away on the spec's own decay clock.
  const aimEnvelope = (c: AudioContext, voice: Voice, from: "start" | "morph") => {
    const { env, spec, peak } = voice;
    const now = c.currentTime;
    env.gain.cancelScheduledValues(now);
    if (from === "start") {
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(peak, now + Math.max(0.002, spec.attack));
    } else {
      env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), now);
    }
    const settleAt = from === "start" ? now + Math.max(0.002, spec.attack) : now;
    if (spec.sustain > 0.02) {
      env.gain.setTargetAtTime(peak * spec.sustain, settleAt, 0.12);
    } else {
      env.gain.setTargetAtTime(0.0001, settleAt, Math.max(0.08, spec.decay / 3));
    }
  };

  const applySpec = (c: AudioContext, voice: Voice, spec: TimbreSpec) => {
    const now = c.currentTime;
    const wave = waveFor(c, spec);
    voice.spec = spec;
    voice.oscs[0].setPeriodicWave(wave);
    voice.oscs[1].setPeriodicWave(wave);
    voice.detuneBase = [0, spec.detune];
    voice.oscs[1].detune.setTargetAtTime(spec.detune, now, 0.05);
    voice.vibratoDepth.gain.setTargetAtTime(spec.vibratoCents, now, 0.1);
    voice.filter.frequency.setTargetAtTime(cutoffFor(voice.freq, spec), now, 0.06);
    const noiseSettings = noiseFilterSettings(spec, voice.freq);
    voice.noiseFilter.type = noiseSettings.type;
    voice.noiseFilter.frequency.setTargetAtTime(noiseSettings.frequency, now, 0.08);
    voice.noiseFilter.Q.value = noiseSettings.q;
    voice.noiseGain.gain.setTargetAtTime(spec.noise * voice.peak * 0.9, now, 0.08);
  };

  const killVoice = (id: string, release: number) => {
    const c = audio.getAudioContext();
    const voice = voices.get(id);
    if (!voice) return;
    voices.delete(id);
    if (!c) return;
    const now = c.currentTime;
    try {
      voice.env.gain.cancelScheduledValues(now);
      voice.env.gain.setValueAtTime(Math.max(0.0001, voice.env.gain.value), now);
      voice.env.gain.exponentialRampToValueAtTime(0.0001, now + release);
      voice.noiseGain.gain.setTargetAtTime(0.0001, now, release / 3);
    } catch { /* noop */ }
    const stopAt = now + release + 0.08;
    for (const osc of voice.oscs) {
      try { osc.stop(stopAt); } catch { /* noop */ }
    }
    const cleanup = [...voice.oscs, voice.filter, voice.env, voice.noiseGain, voice.noiseFilter, voice.vibratoDepth];
    voice.oscs[0].onended = () => {
      for (const node of cleanup) {
        try { node.disconnect(); } catch { /* noop */ }
      }
    };
  };

  const noteOn = (id: string, rawFreq: number, spec: TimbreSpec) => {
    if (audio.isMuted()) return;
    const c = ensure();
    if (!c || !bus || !vibratoLfo || !noiseBuffer) return;
    if (voices.has(id)) killVoice(id, 0.03);
    if (voices.size >= MAX_VOICES) {
      let oldest: string | null = null;
      let oldestAt = Infinity;
      voices.forEach((voice, key) => {
        if (voice.startedAt < oldestAt) { oldestAt = voice.startedAt; oldest = key; }
      });
      if (oldest) killVoice(oldest, 0.05);
    }

    const freq = clampFreq(rawFreq);
    const now = c.currentTime;
    const peak = 0.16 / (1 + voices.size * 0.14);

    const wave = waveFor(c, spec);
    const oscA = c.createOscillator();
    oscA.setPeriodicWave(wave);
    oscA.frequency.value = freq;
    const oscB = c.createOscillator();
    oscB.setPeriodicWave(wave);
    oscB.frequency.value = freq;
    oscB.detune.value = spec.detune;
    const oscBGain = c.createGain();
    oscBGain.gain.value = 0.5;

    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoffFor(freq, spec);
    filter.Q.value = 0.7;

    const env = c.createGain();
    env.gain.value = 0.0001;

    const noiseSrc = c.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;
    const noiseFilter = c.createBiquadFilter();
    const noiseSettings = noiseFilterSettings(spec, freq);
    noiseFilter.type = noiseSettings.type;
    noiseFilter.frequency.value = noiseSettings.frequency;
    noiseFilter.Q.value = noiseSettings.q;
    const noiseGain = c.createGain();
    noiseGain.gain.value = spec.noise * peak * 0.9;

    const vibratoDepth = c.createGain();
    vibratoDepth.gain.value = spec.vibratoCents;
    vibratoLfo.connect(vibratoDepth);
    vibratoDepth.connect(oscA.detune);
    vibratoDepth.connect(oscB.detune);

    oscA.connect(filter);
    oscB.connect(oscBGain).connect(filter);
    noiseSrc.connect(noiseFilter).connect(noiseGain).connect(env);
    filter.connect(env).connect(bus);
    oscA.start(now);
    oscB.start(now);
    noiseSrc.start(now);
    oscA.onended = () => { try { noiseSrc.stop(); noiseSrc.disconnect(); } catch { /* noop */ } };

    const voice: Voice = {
      oscs: [oscA, oscB],
      detuneBase: [0, spec.detune],
      noiseGain,
      noiseFilter,
      vibratoDepth,
      filter,
      env,
      freq,
      spec,
      peak,
      startedAt: now,
    };
    voices.set(id, voice);
    aimEnvelope(c, voice, "start");
  };

  const glide = (id: string, rawFreq: number) => {
    const c = audio.getAudioContext();
    const voice = voices.get(id);
    if (!c || !voice) return;
    const freq = clampFreq(rawFreq);
    if (Math.abs(freq - voice.freq) < 0.01) return;
    const now = c.currentTime;
    for (const osc of voice.oscs) {
      try {
        const current = Math.max(20, osc.frequency.value);
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(current, now);
        osc.frequency.exponentialRampToValueAtTime(freq, now + 0.07);
      } catch { /* noop */ }
    }
    voice.freq = freq;
    voice.filter.frequency.setTargetAtTime(cutoffFor(freq, voice.spec), now, 0.06);
  };

  const morph = (id: string, spec: TimbreSpec) => {
    const c = audio.getAudioContext();
    const voice = voices.get(id);
    if (!c || !voice) return;
    const wasHolding = voice.spec.sustain > 0.02;
    applySpec(c, voice, spec);
    const holdsNow = spec.sustain > 0.02;
    // crossing between families re-aims the envelope: a plucked note bowed
    // mid-flight swells back, a bowed note plucked mid-flight starts falling
    if (wasHolding !== holdsNow || holdsNow) aimEnvelope(c, voice, "morph");
  };

  const noteOff = (id: string) => {
    const voice = voices.get(id);
    if (!voice) return;
    killVoice(id, Math.max(0.06, voice.spec.release));
  };

  const stopAll = () => {
    [...voices.keys()].forEach((id) => killVoice(id, 0.1));
  };

  engine = { noteOn, glide, morph, noteOff, stopAll };
  return engine;
}
