"use client";

// Light-808 — polyphonic 808-style synth engine behind the /light instrument.
//
// Every touch owns a sustained voice: a sine sub + triangle overtone pushed
// through per-voice drive into a shared tanh saturator, low-shelf boost and
// compressor — the glue that makes plain oscillators read as 808s on phone
// speakers. Voices open with the classic pitch-knock (start sharp, fall into
// the note), sustain while held, glide when the finger slides, and release
// with a long boom when tapped instead of held.
//
// The engine rides the shared field-audio AudioContext and connects into its
// analyser tap, so /light visualisers and the global mute keep working.

import { getFieldAudio } from "@/lib/audio";

export type VoiceOpts = {
  // 0 = dark / closed filter, 1 = fully open. Mapped from touch height.
  brightness?: number;
};

export type Light808Engine = {
  noteOn: (id: string, freq: number, opts?: VoiceOpts) => void;
  glide: (id: string, freq: number, opts?: VoiceOpts) => void;
  noteOff: (id: string, opts?: { boom?: boolean }) => void;
  kick: (freq?: number) => void;
  // Scheduled one-shot roll of notes — powers replay and shake-strums.
  strum: (freqs: number[], spacingSec?: number) => void;
  // Performance macros driven by device tilt.
  setMacro: (macro: { cutoff?: number; vibrato?: number }) => void;
  setSubMode: (on: boolean) => void;
  getSubMode: () => boolean;
  stopAll: () => void;
};

type Voice = {
  oscs: OscillatorNode[];
  filter: BiquadFilterNode;
  env: GainNode;
  freq: number;
  baseCutoff: number;
  peak: number;
  startedAt: number;
};

const MAX_VOICES = 8;

let engine: Light808Engine | null = null;

export function getLight808(): Light808Engine {
  if (engine) return engine;

  const audio = getFieldAudio();
  let built = false;
  let bus: GainNode | null = null;
  let vibrato: GainNode | null = null;
  const voices = new Map<string, Voice>();
  let subMode = false;
  let macroCutoff = 0;

  const ensure = (): AudioContext | null => {
    const c = audio.getAudioContext();
    if (!c) return null;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    if (!built && bus == null) {
      const out: AudioNode = audio.getAnalyser() ?? c.destination;

      bus = c.createGain();
      bus.gain.value = 1;

      const shaper = c.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(2.6 * x);
      }
      shaper.curve = curve;
      shaper.oversample = "2x";

      const shelf = c.createBiquadFilter();
      shelf.type = "lowshelf";
      shelf.frequency.value = 110;
      shelf.gain.value = 6.5;

      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 22;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.16;

      const master = c.createGain();
      master.gain.value = 0.9;

      bus.connect(shaper);
      shaper.connect(shelf);
      shelf.connect(comp);
      comp.connect(master);
      master.connect(out);

      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 5.4;
      vibrato = c.createGain();
      vibrato.gain.value = 0; // depth in cents, set by tilt macro
      lfo.connect(vibrato);
      lfo.start();

      built = true;
    }
    return c;
  };

  const clampFreq = (freq: number) => Math.max(24, Math.min(6500, freq));

  const cutoffFor = (freq: number, brightness: number) =>
    Math.max(220, Math.min(9000, freq * (3 + brightness * 9)));

  const applyMacroCutoff = (c: AudioContext, voice: Voice) => {
    const target = Math.max(180, Math.min(11000, voice.baseCutoff * 2 ** (macroCutoff * 1.3)));
    voice.filter.frequency.cancelScheduledValues(c.currentTime);
    voice.filter.frequency.setTargetAtTime(target, c.currentTime, 0.06);
  };

  // Short filtered-noise transient so each hit has a beater click that
  // survives small speakers.
  const click = (c: AudioContext, at: number, gain: number) => {
    if (!bus) return;
    const len = Math.floor(c.sampleRate * 0.03);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    src.connect(hp).connect(g).connect(bus);
    src.start(at);
    src.stop(at + 0.04);
    src.onended = () => {
      try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch { /* noop */ }
    };
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
    } catch { /* noop */ }
    const stopAt = now + release + 0.08;
    for (const osc of voice.oscs) {
      try { osc.stop(stopAt); } catch { /* noop */ }
    }
    const cleanupTargets: { disconnect: () => void }[] = [...voice.oscs, voice.filter, voice.env];
    voice.oscs[0].onended = () => {
      for (const node of cleanupTargets) {
        try { node.disconnect(); } catch { /* noop */ }
      }
    };
  };

  const noteOn = (id: string, rawFreq: number, opts: VoiceOpts = {}) => {
    if (audio.isMuted()) return;
    const c = ensure();
    if (!c || !bus || !vibrato) return;
    if (voices.has(id)) killVoice(id, 0.03);
    if (voices.size >= MAX_VOICES) {
      let oldest: string | null = null;
      let oldestAt = Infinity;
      voices.forEach((voice, key) => {
        if (voice.startedAt < oldestAt) { oldestAt = voice.startedAt; oldest = key; }
      });
      if (oldest) killVoice(oldest, 0.05);
    }

    const freq = clampFreq(subMode ? rawFreq * 0.5 : rawFreq);
    const brightness = Math.max(0, Math.min(1, opts.brightness ?? 0.5));
    const now = c.currentTime;
    const isSub = freq < 130;

    // classic 808 knock — pitch starts sharp and falls into the note
    const dropRatio = isSub ? 3.1 : freq < 420 ? 2.1 : 1.5;
    const dropTime = isSub ? 0.055 : 0.03;

    const sine = c.createOscillator();
    sine.type = "sine";
    sine.frequency.setValueAtTime(freq * dropRatio, now);
    sine.frequency.exponentialRampToValueAtTime(freq, now + dropTime);

    const tri = c.createOscillator();
    tri.type = "triangle";
    tri.frequency.setValueAtTime(freq * dropRatio, now);
    tri.frequency.exponentialRampToValueAtTime(freq, now + dropTime);
    const triGain = c.createGain();
    triGain.gain.value = isSub ? 0.28 : 0.42;

    const drive = c.createGain();
    drive.gain.value = (isSub ? 2.3 : 1.4) * (subMode ? 1.35 : 1);

    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    const baseCutoff = cutoffFor(freq, brightness);
    filter.frequency.value = baseCutoff;
    filter.Q.value = 0.8;

    const peak = (isSub ? 0.30 : 0.20) / (1 + voices.size * 0.12);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.005);
    env.gain.linearRampToValueAtTime(peak * 0.62, now + 0.15);

    sine.connect(drive);
    tri.connect(triGain).connect(drive);
    drive.connect(filter).connect(env).connect(bus);
    try {
      vibrato.connect(sine.detune);
      vibrato.connect(tri.detune);
    } catch { /* noop */ }
    sine.start(now);
    tri.start(now);
    click(c, now, isSub ? 0.06 : 0.035);

    const voice: Voice = {
      oscs: [sine, tri],
      filter,
      env,
      freq,
      baseCutoff,
      peak,
      startedAt: now,
    };
    voices.set(id, voice);
    if (macroCutoff !== 0) applyMacroCutoff(c, voice);
  };

  const glide = (id: string, rawFreq: number, opts: VoiceOpts = {}) => {
    const c = audio.getAudioContext();
    const voice = voices.get(id);
    if (!c || !voice) return;
    const freq = clampFreq(subMode ? rawFreq * 0.5 : rawFreq);
    if (Math.abs(freq - voice.freq) < 0.01) {
      if (opts.brightness == null) return;
    }
    const now = c.currentTime;
    for (const osc of voice.oscs) {
      try {
        const current = Math.max(24, osc.frequency.value);
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(current, now);
        osc.frequency.exponentialRampToValueAtTime(freq, now + 0.085);
      } catch { /* noop */ }
    }
    voice.freq = freq;
    if (opts.brightness != null) {
      voice.baseCutoff = cutoffFor(freq, Math.max(0, Math.min(1, opts.brightness)));
      applyMacroCutoff(c, voice);
    }
  };

  const noteOff = (id: string, opts: { boom?: boolean } = {}) => {
    const voice = voices.get(id);
    if (!voice) return;
    const isSub = voice.freq < 130;
    const release = opts.boom
      ? (isSub ? 1.1 : 0.6)
      : (isSub ? 0.45 : 0.26);
    killVoice(id, release);
  };

  // Fully-scheduled one-shot boom, independent of the sustained voice map.
  const shot = (rawFreq: number, offsetSec: number, opts: { drop?: number; peak?: number; decay?: number } = {}) => {
    if (audio.isMuted()) return;
    const c = ensure();
    if (!c || !bus) return;
    const freq = clampFreq(rawFreq);
    const isSub = freq < 130;
    const at = c.currentTime + Math.max(0, offsetSec);
    const drop = opts.drop ?? (isSub ? 3.4 : 2.0);
    const peak = opts.peak ?? (isSub ? 0.30 : 0.18);
    const decay = opts.decay ?? (isSub ? 0.8 : 0.45);

    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * drop, at);
    osc.frequency.exponentialRampToValueAtTime(freq, at + (isSub ? 0.09 : 0.04));
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = Math.max(300, Math.min(6000, freq * 7));
    const drive = c.createGain();
    drive.gain.value = isSub ? 2.6 : 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(drive).connect(filter).connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + decay + 0.08);
    click(c, at, isSub ? 0.06 : 0.03);
    osc.onended = () => {
      try { osc.disconnect(); drive.disconnect(); filter.disconnect(); g.disconnect(); } catch { /* noop */ }
    };
  };

  const kick = (freq = 46) => {
    shot(freq, 0, { drop: 3.6, peak: 0.4, decay: 0.6 });
  };

  const strum = (freqs: number[], spacingSec = 0.07) => {
    freqs.forEach((freq, index) => shot(subMode ? freq * 0.5 : freq, index * spacingSec));
  };

  const setMacro = (macro: { cutoff?: number; vibrato?: number }) => {
    const c = audio.getAudioContext();
    if (macro.vibrato != null && vibrato && c) {
      const depth = Math.max(0, Math.min(1, macro.vibrato)) * 35; // cents
      vibrato.gain.setTargetAtTime(depth, c.currentTime, 0.08);
    }
    if (macro.cutoff != null) {
      macroCutoff = Math.max(-1, Math.min(1, macro.cutoff));
      if (c) voices.forEach((voice) => applyMacroCutoff(c, voice));
    }
  };

  const setSubMode = (on: boolean) => {
    if (subMode === on) return;
    subMode = on;
    const c = audio.getAudioContext();
    if (!c) return;
    // retune live voices so the flip is audible immediately
    voices.forEach((voice) => {
      const target = clampFreq(on ? voice.freq * 0.5 : voice.freq * 2);
      const now = c.currentTime;
      for (const osc of voice.oscs) {
        try {
          const current = Math.max(24, osc.frequency.value);
          osc.frequency.cancelScheduledValues(now);
          osc.frequency.setValueAtTime(current, now);
          osc.frequency.exponentialRampToValueAtTime(target, now + 0.18);
        } catch { /* noop */ }
      }
      voice.freq = target;
    });
  };

  const stopAll = () => {
    [...voices.keys()].forEach((id) => killVoice(id, 0.12));
  };

  engine = {
    noteOn,
    glide,
    noteOff,
    kick,
    strum,
    setMacro,
    setSubMode,
    getSubMode: () => subMode,
    stopAll,
  };
  return engine;
}
