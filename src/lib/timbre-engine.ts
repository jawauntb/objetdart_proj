"use client";

// Voice engine behind /timbre and /instrument — the one shared layer that
// renders any TimbreBlend as sound.
//
// Two physical models, matching the atlas (src/lib/timbre.ts):
//
// - Strings are Karplus-Strong: an actual delay-line string (inline
//   AudioWorklet — native DelayNodes cannot loop shorter than one render
//   quantum, which would cap string pitch near 375 Hz) excited by a
//   deterministic noise burst, combed at the pluck point, damped by loop
//   feedback and a loop lowpass, with hammer thump / pick click transients
//   and body formants. Highs die faster than lows for free — that is what
//   the loop *is*.
// - Bowed/blown voices are a sawtooth source through fixed bore/body
//   formants with envelope-coupled brightness (brass blooms open with
//   loudness), onset pitch bend (brass rises from below, a bow settles from
//   above), bow-scratch/reed-chiff onsets, breath noise that follows the
//   envelope, and delayed vibrato.
//
// A blend position between two instruments runs both models at once with
// equal-power crossfade — morphing swaps physics, not just tone color.
// Rides the shared field-audio AudioContext and analyser tap.

import { getFieldAudio } from "@/lib/audio";
import { crossfadeGains, type Formant, type StringModel, type TimbreBlend, type TimbreSpec, type WindModel } from "@/lib/timbre";

export type TimbreEngine = {
  noteOn: (id: string, freq: number, blend: TimbreBlend) => void;
  glide: (id: string, freq: number) => void;
  morph: (id: string, blend: TimbreBlend) => void;
  noteOff: (id: string) => void;
  stopAll: () => void;
};

type Sub = {
  key: string;
  fade: GainNode;
  setFreq: (freq: number) => void;
  noteOff: () => void;
  stop: (fadeSec: number) => void;
};

type Voice = {
  subs: Map<string, Sub>;
  master: GainNode;
  freq: number;
  blend: TimbreBlend;
  startedAt: number;
};

const MAX_VOICES = 6;

// The Karplus-Strong string, as an AudioWorklet processor. Registered from
// an inline blob so the model ships with the code, not as an asset.
const STRING_PROCESSOR = `
class OdaString extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "frequency", defaultValue: 220, minValue: 20, maxValue: 16000, automationRate: "k-rate" },
      { name: "feedback", defaultValue: 0.995, minValue: 0, maxValue: 0.99995, automationRate: "k-rate" },
      { name: "cutoff", defaultValue: 4000, minValue: 100, maxValue: 16000, automationRate: "k-rate" },
    ];
  }
  constructor() {
    super();
    this.buf = new Float32Array(Math.ceil(sampleRate / 18) + 8);
    this.w = 0;
    this.lp = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "pluck") this.pluck(e.data);
    };
  }
  pluck(m) {
    const len = this.buf.length;
    const N = Math.max(2, Math.min(len - 4, Math.round(sampleRate / Math.max(20, m.frequency))));
    let seed = (m.seed | 0) || 123456789;
    const rnd = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed >>> 0) / 4294967295) * 2 - 1;
    };
    // deterministic noise burst, lowpassed to the excitation hardness
    const n = new Float32Array(N);
    const a = Math.min(1, (2 * Math.PI * m.brightness) / sampleRate);
    let acc = 0;
    for (let i = 0; i < N; i++) { acc += a * (rnd() - acc); n[i] = acc; }
    // pluck-point comb notches the series where the finger touched
    const d = Math.max(1, Math.round(N * Math.max(0.02, Math.min(0.5, m.position))));
    for (let i = 0; i < N; i++) {
      const c = n[i] - 0.9 * (i >= d ? n[i - d] : 0);
      // write into the loop segment about to be read (behind the head)
      this.buf[(((this.w - N + i) % len) + len) % len] += c * m.amp * 2.4;
    }
  }
  process(_inputs, outputs, params) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const len = this.buf.length;
    const N = Math.max(2, sampleRate / Math.max(20, params.frequency[0]));
    const fb = params.feedback[0];
    const a = Math.min(1, (2 * Math.PI * params.cutoff[0]) / sampleRate);
    for (let i = 0; i < out.length; i++) {
      const r = this.w - N;
      const ri = Math.floor(r);
      const frac = r - ri;
      const i0 = ((ri % len) + len) % len;
      const i1 = (i0 + 1) % len;
      const y = this.buf[i0] + (this.buf[i1] - this.buf[i0]) * frac;
      this.lp += a * (y - this.lp);
      this.buf[this.w] = this.lp * fb;
      out[i] = y;
      this.w = (this.w + 1) % len;
    }
    return true;
  }
}
registerProcessor("oda-string", OdaString);
`;

let engine: TimbreEngine | null = null;

export function getTimbreEngine(): TimbreEngine {
  if (engine) return engine;

  const audio = getFieldAudio();
  let bus: GainNode | null = null;
  let vibratoLfo: OscillatorNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let workletReady = false;
  let workletLoading = false;
  let pluckSeed = 0x2545f491;
  const voices = new Map<string, Voice>();

  const nextSeed = () => {
    pluckSeed ^= pluckSeed << 13; pluckSeed ^= pluckSeed >>> 17; pluckSeed ^= pluckSeed << 5;
    return pluckSeed | 0;
  };

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
      master.gain.value = 0.9;

      bus.connect(comp);
      comp.connect(master);
      master.connect(out);

      vibratoLfo = c.createOscillator();
      vibratoLfo.type = "sine";
      vibratoLfo.frequency.value = 5.2;
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
    if (!workletReady && !workletLoading && typeof AudioWorkletNode !== "undefined" && c.audioWorklet) {
      workletLoading = true;
      const url = URL.createObjectURL(new Blob([STRING_PROCESSOR], { type: "application/javascript" }));
      c.audioWorklet.addModule(url).then(
        () => { workletReady = true; URL.revokeObjectURL(url); },
        () => { workletLoading = false; URL.revokeObjectURL(url); },
      );
    }
    return c;
  };

  const clampFreq = (freq: number) => Math.max(20, Math.min(16000, freq));

  const formantChain = (c: AudioContext, formants: Formant[]) => {
    const nodes = formants.map((f) => {
      const peak = c.createBiquadFilter();
      peak.type = "peaking";
      peak.frequency.value = f.freq;
      peak.Q.value = f.q;
      peak.gain.value = f.gain;
      return peak;
    });
    for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
    return nodes;
  };

  const burst = (
    c: AudioContext,
    dest: AudioNode,
    opts: { at: number; dur: number; gain: number; filter: (f: BiquadFilterNode) => void },
  ) => {
    if (!noiseBuffer) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = c.createBiquadFilter();
    opts.filter(filter);
    const g = c.createGain();
    g.gain.setValueAtTime(opts.gain, opts.at);
    g.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.dur);
    src.connect(filter).connect(g).connect(dest);
    src.start(opts.at);
    src.stop(opts.at + opts.dur + 0.02);
    src.onended = () => { try { src.disconnect(); filter.disconnect(); g.disconnect(); } catch { /* noop */ } };
  };

  // ── the string family: Karplus-Strong courses + transients + body ──────
  const buildStringSub = (c: AudioContext, spec: TimbreSpec & StringModel, freq: number, dest: AudioNode, fadeTo: number): Sub => {
    const now = c.currentTime;
    const fade = c.createGain();
    fade.gain.value = fadeTo;
    const outGain = c.createGain();
    outGain.gain.value = spec.gain * 0.4;

    const body = formantChain(c, spec.formants);
    let tail: AudioNode = outGain;
    if (body.length > 0) {
      body[body.length - 1].connect(outGain);
      tail = body[0];
    }

    let shaper: WaveShaperNode | null = null;
    if (spec.buzz > 0) {
      // jawari — the bridge grazes the string and folds the top of the wave
      shaper = c.createWaveShaper();
      const curve = new Float32Array(512);
      const drive = 1 + spec.buzz * 4;
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
      }
      shaper.curve = curve;
      shaper.connect(tail);
      tail = shaper;
    }

    const courses: AudioWorkletNode[] = [];
    const fallbacks: { osc: OscillatorNode; filter: BiquadFilterNode; env: GainNode }[] = [];
    const courseFreq = (base: number, index: number) =>
      spec.strings === 1 ? base : base * 2 ** (((index === 0 ? -1 : 1) * spec.courseDetune) / 2400);

    if (workletReady) {
      for (let i = 0; i < spec.strings; i++) {
        const f = courseFreq(freq, i);
        const node = new AudioWorkletNode(c, "oda-string", { numberOfInputs: 0, outputChannelCount: [1] });
        node.parameters.get("frequency")?.setValueAtTime(f, now);
        node.parameters.get("feedback")?.setValueAtTime(spec.feedback, now);
        node.parameters.get("cutoff")?.setValueAtTime(Math.min(14000, Math.max(600, freq * spec.loopCutoff)), now);
        node.port.postMessage({
          type: "pluck",
          frequency: f,
          brightness: spec.burstBrightness,
          position: spec.pluckPosition,
          amp: 0.9 / spec.strings,
          seed: nextSeed(),
        });
        node.connect(tail);
        courses.push(node);
      }
    } else {
      // Fallback while (or if) the worklet is unavailable: a swept-lowpass
      // saw pluck with the same ring time — rougher, but a pluck.
      for (let i = 0; i < spec.strings; i++) {
        const f = courseFreq(freq, i);
        const osc = c.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = f;
        const filter = c.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(spec.burstBrightness + freq * 2, now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.5), now + 0.6);
        const env = c.createGain();
        const ring = Math.max(0.2, Math.min(3, 1 / (freq * (1 - spec.feedback))));
        env.gain.setValueAtTime(0.5 / spec.strings, now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + ring);
        osc.connect(filter).connect(env).connect(tail);
        osc.start(now);
        osc.stop(now + ring + 0.1);
        fallbacks.push({ osc, filter, env });
      }
    }

    if (spec.thump > 0) {
      // hammer / soundboard knock
      const thump = c.createOscillator();
      thump.type = "sine";
      thump.frequency.setValueAtTime(120, now);
      thump.frequency.exponentialRampToValueAtTime(60, now + 0.07);
      const tg = c.createGain();
      tg.gain.setValueAtTime(spec.thump * 0.4, now);
      tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      thump.connect(tg).connect(outGain);
      thump.start(now);
      thump.stop(now + 0.12);
      thump.onended = () => { try { thump.disconnect(); tg.disconnect(); } catch { /* noop */ } };
    }
    if (spec.pick > 0) {
      burst(c, outGain, {
        at: now,
        dur: 0.02,
        gain: spec.pick * 0.16,
        filter: (f) => { f.type = "highpass"; f.frequency.value = 2500; },
      });
    }

    outGain.connect(fade);
    fade.connect(dest);

    let stopped = false;
    const teardown = (afterSec: number) => {
      window.setTimeout(() => {
        for (const node of courses) { try { node.disconnect(); } catch { /* noop */ } }
        for (const fb of fallbacks) { try { fb.osc.disconnect(); fb.filter.disconnect(); fb.env.disconnect(); } catch { /* noop */ } }
        try { shaper?.disconnect(); } catch { /* noop */ }
        for (const node of body) { try { node.disconnect(); } catch { /* noop */ } }
        try { outGain.disconnect(); fade.disconnect(); } catch { /* noop */ }
      }, afterSec * 1000);
    };

    return {
      key: spec.key,
      fade,
      setFreq: (f: number) => {
        const t = c.currentTime;
        courses.forEach((node, i) => {
          node.parameters.get("frequency")?.setTargetAtTime(courseFreq(f, i), t, 0.02);
          node.parameters.get("cutoff")?.setTargetAtTime(Math.min(14000, Math.max(600, f * spec.loopCutoff)), t, 0.03);
        });
        fallbacks.forEach((fb, i) => {
          fb.osc.frequency.setTargetAtTime(courseFreq(f, i), t, 0.02);
        });
      },
      noteOff: () => {
        // finger damping: the loop loses its feedback and the string mutes
        const t = c.currentTime;
        for (const node of courses) node.parameters.get("feedback")?.setTargetAtTime(0.55, t, 0.02);
        outGain.gain.setTargetAtTime(0.0001, t + 0.05, 0.08);
        teardown(1.2);
      },
      stop: (fadeSec: number) => {
        if (stopped) return;
        stopped = true;
        fade.gain.setTargetAtTime(0.0001, c.currentTime, fadeSec / 3);
        teardown(fadeSec + 0.2);
      },
    };
  };

  // ── the bowed/blown family: source + fixed formants + coupled brightness ──
  const buildWindSub = (c: AudioContext, spec: TimbreSpec & WindModel, freq: number, dest: AudioNode, fadeTo: number): Sub => {
    const now = c.currentTime;
    const fade = c.createGain();
    fade.gain.value = fadeTo;
    const outGain = c.createGain();
    outGain.gain.value = spec.gain * 0.3;

    const osc = c.createOscillator();
    osc.type = "sawtooth";
    // brass rises into the note from below; a bow catches sharp and settles
    osc.frequency.setValueAtTime(freq * spec.onsetBend, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + spec.onsetMs / 1000);

    const drive = c.createGain();
    drive.gain.value = 0.4;

    const formants = formantChain(c, spec.formants);

    const lowpass = c.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.Q.value = 0.6;
    // brightness is coupled to the envelope: closed at onset, blooming open
    const brightClosed = () => Math.min(14000, Math.max(300, freq * spec.brightBase));
    const brightOpen = () => Math.min(14000, Math.max(300, freq * (spec.brightBase + spec.brightEnv * 0.8)));
    lowpass.frequency.setValueAtTime(brightClosed(), now);
    lowpass.frequency.linearRampToValueAtTime(brightOpen(), now + Math.max(0.02, spec.attack * 1.4));

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(1, now + Math.max(0.004, spec.attack));
    env.gain.setTargetAtTime(0.8, now + Math.max(0.004, spec.attack), 0.15);

    osc.connect(drive);
    if (formants.length > 0) {
      drive.connect(formants[0]);
      formants[formants.length - 1].connect(lowpass);
    } else {
      drive.connect(lowpass);
    }
    lowpass.connect(env).connect(outGain);

    // breath rides the same envelope — it swells and dies with the tone
    let breathSrc: AudioBufferSourceNode | null = null;
    let breathNodes: AudioNode[] = [];
    if (spec.breath > 0 && noiseBuffer) {
      breathSrc = c.createBufferSource();
      breathSrc.buffer = noiseBuffer;
      breathSrc.loop = true;
      const band = c.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = spec.breathHz;
      band.Q.value = 0.8;
      const bg = c.createGain();
      bg.gain.value = spec.breath * 0.5;
      breathSrc.connect(band).connect(bg).connect(env);
      breathSrc.start(now);
      breathNodes = [band, bg];
    }

    // onset noise: bow scratch / reed chiff / lip noise
    if (spec.chiff > 0) {
      burst(c, outGain, {
        at: now,
        dur: 0.09,
        gain: spec.chiff * 0.22,
        filter: (f) => { f.type = "bandpass"; f.frequency.value = 2600; f.Q.value = 0.9; },
      });
    }

    // vibrato arrives after the note is planted
    const depth = c.createGain();
    depth.gain.setValueAtTime(0, now);
    depth.gain.setTargetAtTime(spec.vibratoCents, now + spec.vibratoDelayMs / 1000, 0.25);
    try { vibratoLfo?.connect(depth); depth.connect(osc.detune); } catch { /* noop */ }

    osc.start(now);
    outGain.connect(fade);
    fade.connect(dest);

    let stopped = false;
    const teardown = (stopAt: number) => {
      try { osc.stop(stopAt); } catch { /* noop */ }
      try { breathSrc?.stop(stopAt); } catch { /* noop */ }
      osc.onended = () => {
        const nodes: AudioNode[] = [osc, drive, ...formants, lowpass, env, outGain, fade, depth, ...breathNodes];
        if (breathSrc) nodes.push(breathSrc);
        for (const node of nodes) { try { node.disconnect(); } catch { /* noop */ } }
      };
    };

    return {
      key: spec.key,
      fade,
      setFreq: (f: number) => {
        const t = c.currentTime;
        try {
          const current = Math.max(20, osc.frequency.value);
          osc.frequency.cancelScheduledValues(t);
          osc.frequency.setValueAtTime(current, t);
          osc.frequency.exponentialRampToValueAtTime(f, t + 0.07);
        } catch { /* noop */ }
        lowpass.frequency.setTargetAtTime(Math.min(14000, Math.max(300, f * (spec.brightBase + spec.brightEnv * 0.8))), t, 0.06);
      },
      noteOff: () => {
        const t = c.currentTime;
        env.gain.cancelScheduledValues(t);
        env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), t);
        env.gain.setTargetAtTime(0.0001, t, spec.release / 3);
        lowpass.frequency.setTargetAtTime(brightClosed(), t, spec.release / 3);
        teardown(t + spec.release + 0.2);
      },
      stop: (fadeSec: number) => {
        if (stopped) return;
        stopped = true;
        const t = c.currentTime;
        fade.gain.setTargetAtTime(0.0001, t, fadeSec / 3);
        teardown(t + fadeSec + 0.15);
      },
    };
  };

  const buildSub = (c: AudioContext, spec: TimbreSpec, freq: number, dest: AudioNode, fadeTo: number): Sub =>
    spec.model === "string"
      ? buildStringSub(c, spec as TimbreSpec & StringModel, freq, dest, fadeTo)
      : buildWindSub(c, spec as TimbreSpec & WindModel, freq, dest, fadeTo);

  const wantedSubs = (blend: TimbreBlend): Array<{ spec: TimbreSpec; gain: number }> => {
    const g = crossfadeGains(blend.mix);
    const wanted: Array<{ spec: TimbreSpec; gain: number }> = [];
    if (g.lower > 0.003) wanted.push({ spec: blend.lower, gain: g.lower });
    if (g.upper > 0.003) wanted.push({ spec: blend.upper, gain: g.upper });
    return wanted;
  };

  const killVoice = (id: string, fadeSec: number) => {
    const voice = voices.get(id);
    if (!voice) return;
    voices.delete(id);
    for (const sub of voice.subs.values()) sub.stop(fadeSec);
    window.setTimeout(() => { try { voice.master.disconnect(); } catch { /* noop */ } }, (fadeSec + 0.4) * 1000);
  };

  const noteOn = (id: string, rawFreq: number, blend: TimbreBlend) => {
    if (audio.isMuted()) return;
    const c = ensure();
    if (!c || !bus) return;
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
    const master = c.createGain();
    master.gain.value = 0.9 / (1 + voices.size * 0.14);
    master.connect(bus);

    const voice: Voice = {
      subs: new Map(),
      master,
      freq,
      blend,
      startedAt: c.currentTime,
    };
    for (const want of wantedSubs(blend)) {
      voice.subs.set(want.spec.key, buildSub(c, want.spec, freq, master, want.gain));
    }
    voices.set(id, voice);
  };

  const glide = (id: string, rawFreq: number) => {
    const voice = voices.get(id);
    if (!voice) return;
    const freq = clampFreq(rawFreq);
    if (Math.abs(freq - voice.freq) < 0.01) return;
    voice.freq = freq;
    for (const sub of voice.subs.values()) sub.setFreq(freq);
  };

  const morph = (id: string, blend: TimbreBlend) => {
    const c = audio.getAudioContext();
    const voice = voices.get(id);
    if (!c || !voice) return;
    voice.blend = blend;
    const wanted = wantedSubs(blend);
    const wantedKeys = new Set(wanted.map((w) => w.spec.key));

    for (const [key, sub] of voice.subs) {
      if (!wantedKeys.has(key)) {
        sub.stop(0.12);
        voice.subs.delete(key);
      }
    }
    for (const want of wanted) {
      const existing = voice.subs.get(want.spec.key);
      if (existing) {
        existing.fade.gain.setTargetAtTime(want.gain, c.currentTime, 0.08);
      } else {
        // crossing into a new segment articulates the incoming instrument —
        // a string is re-plucked, a horn breathes in
        const sub = buildSub(c, want.spec, voice.freq, voice.master, 0.0001);
        sub.fade.gain.setTargetAtTime(want.gain, c.currentTime, 0.09);
        voice.subs.set(want.spec.key, sub);
      }
    }
  };

  const noteOff = (id: string) => {
    const voice = voices.get(id);
    if (!voice) return;
    voices.delete(id);
    for (const sub of voice.subs.values()) sub.noteOff();
    window.setTimeout(() => { try { voice.master.disconnect(); } catch { /* noop */ } }, 2000);
  };

  const stopAll = () => {
    [...voices.keys()].forEach((id) => killVoice(id, 0.1));
  };

  engine = { noteOn, glide, morph, noteOff, stopAll };
  return engine;
}
