"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";
import SeaChart, { type SeaChartCandle } from "@/components/SeaChart";

/**
 * /pulse — hospital monitor for the body of the room.
 *
 * Four scrolling physiological channels (HR, BREATH, BP, BRAINWAVE) live in
 * the upper 60% of the viewport, each rendered into a ring-buffer trace on
 * a single 2D canvas. The lower 40% is a control rail: stress + rate
 * sliders, a defibrillate button, a pattern generator that produces a
 * fifth channel from procedural curves (tide / wave / seismic / breath /
 * storm), save+load to localStorage, and a SHARE button that base64-encodes
 * the pattern state into the URL hash.
 *
 * Audio is opt-in per channel — click a label to toggle a tick at each R
 * wave (HR) or other characteristic events. Defib plays a thud and a bell.
 *
 * The whole monitor is wired to the stress slider: stress raises HR,
 * widens HR variability, breaks breath into irregular bursts, and pushes
 * the brainwave into spikier territory.
 *
 * Single canvas, single RAF, no external libs.
 */

// ── constants ────────────────────────────────────────────────────────────
const BUFFER_LEN = 600;           // ~10s of samples at 60Hz, per channel
const SAMPLE_HZ  = 60;            // we advance one sample per frame
const PATTERN_LEN = 1800;         // 30s of pattern samples (60fps × 30s)
const PATTERN_KEY = "objetdart:patterns:v1";

type ChannelKey = "hr" | "breath" | "bp" | "brain";
type PatternKind = "tide" | "wave" | "seismic" | "breath" | "storm";

type Channel = {
  key: ChannelKey;
  label: string;
  color: string;        // CSS hex for the trace
  buffer: Float32Array; // ring buffer of normalised values (-1..1)
  cursor: number;       // current write index
  audio: boolean;       // tick audio enabled
  readout: string;      // human readout (e.g. "72 BPM")
};

type SavedPattern = {
  name: string;
  kind: PatternKind;
  // We persist the pattern parameters, not the samples themselves —
  // generators are deterministic given a kind + seed, and storing 1800
  // floats per saved pattern would balloon localStorage quickly.
  seed: number;
  createdAt: number;
};

// ── generators ───────────────────────────────────────────────────────────
// Each returns a length-PATTERN_LEN Float32Array of normalised samples in
// roughly [-1, 1]. Deterministic w.r.t. the supplied seed so the same name
// can be reproduced on share.
function rng(seed: number): () => number {
  // xorshift32
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    return (s >>> 0) / 0xffffffff;
  };
}

function generatePattern(kind: PatternKind, seed: number): Float32Array {
  const out = new Float32Array(PATTERN_LEN);
  const r = rng(seed);
  switch (kind) {
    case "tide": {
      // Two slow superposed sines — a 12s primary swell + 3.6s ripple.
      const phase = r() * Math.PI * 2;
      for (let i = 0; i < PATTERN_LEN; i++) {
        const t = i / SAMPLE_HZ;
        out[i] =
          Math.sin(t * (Math.PI * 2 / 12) + phase) * 0.7 +
          Math.sin(t * (Math.PI * 2 / 3.6)) * 0.18 +
          (r() - 0.5) * 0.04;
      }
      return out;
    }
    case "wave": {
      // Faster surf — 2.4s sine modulated by a 7s envelope, with breakers.
      for (let i = 0; i < PATTERN_LEN; i++) {
        const t = i / SAMPLE_HZ;
        const env = 0.6 + 0.4 * Math.sin(t * (Math.PI * 2 / 7));
        const breaker = Math.sin(t * (Math.PI * 2 / 2.4));
        out[i] = breaker * env + (r() - 0.5) * 0.06;
      }
      return out;
    }
    case "seismic": {
      // Low rumble baseline with rare large spikes (P / S wave bursts).
      let val = 0;
      let nextQuake = 80 + Math.floor(r() * 200);
      let quakeI = 0;
      for (let i = 0; i < PATTERN_LEN; i++) {
        // brownian drift toward 0
        val = val * 0.985 + (r() - 0.5) * 0.06;
        if (i === nextQuake) {
          quakeI = 30 + Math.floor(r() * 50);
          nextQuake = i + 220 + Math.floor(r() * 380);
        }
        if (quakeI > 0) {
          const k = quakeI / 50;
          val += Math.sin(i * 0.9) * k * 0.55;
          quakeI--;
        }
        out[i] = Math.max(-1, Math.min(1, val));
      }
      return out;
    }
    case "breath": {
      // Slow paced 5-second inhale/exhale with a 3s hold near peak.
      // Asymmetric — inhale faster than exhale.
      const cycle = 8 * SAMPLE_HZ; // samples per breath
      for (let i = 0; i < PATTERN_LEN; i++) {
        const u = (i % cycle) / cycle; // 0..1
        // piecewise: 0..0.3 inhale (sin from -1 → 1), 0.3..0.5 hold,
        // 0.5..1 exhale (cos from 1 → -1).
        let v: number;
        if (u < 0.3)      v = -Math.cos((u / 0.3) * Math.PI);
        else if (u < 0.5) v = 1;
        else              v = Math.cos(((u - 0.5) / 0.5) * Math.PI);
        out[i] = v * 0.85 + (r() - 0.5) * 0.03;
      }
      return out;
    }
    case "storm": {
      // Chaotic mixture — sum of detuned sines + bursts of noise +
      // crack-like impulses.
      let energy = 0;
      for (let i = 0; i < PATTERN_LEN; i++) {
        const t = i / SAMPLE_HZ;
        let v =
          Math.sin(t * 5.3) * 0.35 +
          Math.sin(t * 11.7) * 0.2 +
          Math.sin(t * 17.2) * 0.15;
        energy = Math.max(0, energy * 0.92 + (r() < 0.018 ? r() * 1.5 : 0));
        v += energy * (r() - 0.5);
        v += (r() - 0.5) * 0.18;
        out[i] = Math.max(-1, Math.min(1, v));
      }
      return out;
    }
  }
}

// ── component ────────────────────────────────────────────────────────────
export default function Pulse() {
  // page-specific ambient bed: hospital monitor beep
  useEffect(() => { getFieldAudio().setAmbientProfile("monitor"); }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // controls (rendered state — read by RAF loop via refs to avoid re-binds)
  const [hr, setHr] = useState(72);
  const [breathRate, setBreathRate] = useState(13);
  const [stress, setStress] = useState(0.2);
  const [defibActive, setDefibActive] = useState(false);

  const hrRef = useRef(hr);
  const brRef = useRef(breathRate);
  const stressRef = useRef(stress);
  const defibRef = useRef(false);
  useEffect(() => { hrRef.current = hr; }, [hr]);
  useEffect(() => { brRef.current = breathRate; }, [breathRate]);
  useEffect(() => { stressRef.current = stress; }, [stress]);

  // audio toggles per channel
  const [audioHR, setAudioHR] = useState(false);
  const [audioBreath, setAudioBreath] = useState(false);
  const [audioBP, setAudioBP] = useState(false);
  const [audioBrain, setAudioBrain] = useState(false);
  const audioHRRef = useRef(audioHR);
  const audioBreathRef = useRef(audioBreath);
  const audioBPRef = useRef(audioBP);
  const audioBrainRef = useRef(audioBrain);
  useEffect(() => { audioHRRef.current = audioHR; }, [audioHR]);
  useEffect(() => { audioBreathRef.current = audioBreath; }, [audioBreath]);
  useEffect(() => { audioBPRef.current = audioBP; }, [audioBP]);
  useEffect(() => { audioBrainRef.current = audioBrain; }, [audioBrain]);

  // pattern state
  const [patternKind, setPatternKind] = useState<PatternKind>("tide");
  const [patternSeed, setPatternSeed] = useState<number>(() => Math.floor(Math.random() * 0xffffffff));
  const [patternSamples, setPatternSamples] = useState<Float32Array | null>(null);
  const [patternName, setPatternName] = useState("");
  const [saved, setSaved] = useState<SavedPattern[]>([]);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  // pattern-channel render mode: "line" (existing canvas trace) or
  // "candles" (SeaChart overlay populated from the pattern buffer).
  const [patternView, setPatternView] = useState<"line" | "candles">("line");
  // pullKey bumps when the pattern samples or cursor advances so the
  // embedded SeaChart re-pulls its candles.
  const [patternPullKey, setPatternPullKey] = useState(0);
  useEffect(() => {
    if (patternView !== "candles") return;
    const id = window.setInterval(() => setPatternPullKey((k) => k + 1), 500);
    return () => window.clearInterval(id);
  }, [patternView]);

  const patternRef = useRef<Float32Array | null>(null);
  useEffect(() => { patternRef.current = patternSamples; }, [patternSamples]);

  // store hook — used for the defib tape event
  const recordTape = useField((s) => s.recordTape);

  // readouts (rendered as React text, updated periodically from RAF)
  const [hrShown, setHrShown] = useState(72);
  const [bpShown, setBpShown] = useState({ sys: 118, dia: 76 });
  const [brShown, setBrShown] = useState(13);

  // ── channel definitions (stable refs, mutable buffers) ────────────────
  const channelsRef = useRef<Record<ChannelKey, Channel>>({
    hr:     { key: "hr",     label: "HR",     color: "#4af07a", buffer: new Float32Array(BUFFER_LEN), cursor: 0, audio: false, readout: "72 BPM" },
    breath: { key: "breath", label: "BREATH", color: "#4ad4f0", buffer: new Float32Array(BUFFER_LEN), cursor: 0, audio: false, readout: "13 BR"  },
    bp:     { key: "bp",     label: "BP",     color: "#f0c04a", buffer: new Float32Array(BUFFER_LEN), cursor: 0, audio: false, readout: "118/76" },
    brain:  { key: "brain",  label: "BRAIN",  color: "#b04af0", buffer: new Float32Array(BUFFER_LEN), cursor: 0, audio: false, readout: "α-β"    },
  });

  // ── on mount: load saved patterns + parse hash for shared pattern ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PATTERN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedPattern[];
        if (Array.isArray(parsed)) setSaved(parsed);
      }
    } catch { /* noop */ }

    // Parse shared pattern out of the location hash, if any.
    // Format: #p=<base64-encoded-json>
    if (typeof window !== "undefined" && window.location.hash.startsWith("#p=")) {
      try {
        const b64 = window.location.hash.slice(3);
        const json = atob(b64);
        const payload = JSON.parse(json) as { kind: PatternKind; seed: number; hr?: number; br?: number; stress?: number };
        if (payload.kind && typeof payload.seed === "number") {
          setPatternKind(payload.kind);
          setPatternSeed(payload.seed);
          setPatternSamples(generatePattern(payload.kind, payload.seed));
        }
        if (typeof payload.hr === "number")     setHr(Math.max(40, Math.min(180, payload.hr)));
        if (typeof payload.br === "number")     setBreathRate(Math.max(6, Math.min(30, payload.br)));
        if (typeof payload.stress === "number") setStress(Math.max(0, Math.min(1, payload.stress)));
      } catch { /* noop */ }
    }
  }, []);

  // ── RAF loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;

    // per-channel internal state for waveform generation
    const state = {
      // HR
      lastBeatT: 0,           // last time we kicked off a QRS
      qrsProgress: 0,         // 0..1, advances through the PQRST waveform
      qrsDur: 0.45,           // seconds to draw the full PQRST shape
      lastBpm: 72,            // last bpm used for the in-progress beat
      // BREATH
      breathPhase: 0,         // 0..2π
      // BP
      bpFastPhase: 0,         // fast pulse oscillator
      bpDriftPhase: 0,        // slow drift oscillator
      // BRAIN
      brainState: 0,          // smoothed value
      brainBurstUntil: 0,     // ms timestamp — bursts of larger amplitude
      // PATTERN
      patternCursor: 0,
      // DEFIB
      defibUntil: 0,          // ms timestamp until which all channels are flat
      defibKickedAt: 0,
      // readout throttle
      lastReadoutAt: 0,
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth || window.innerWidth;
      const h = cv.clientHeight || window.innerHeight;
      cv.width = Math.max(1, Math.floor(w * dpr));
      cv.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let lastT = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - lastT) / 1000); // seconds
      lastT = now;

      const w = cv.clientWidth || window.innerWidth;
      const h = cv.clientHeight || window.innerHeight;
      const mobile = w < 720;

      // background
      ctx.fillStyle = "#040810";
      ctx.fillRect(0, 0, w, h);

      // ── layout ────────────────────────────────────────────────────
      const mobileControlH = Math.min(390, h * 0.46);
      const mobileControlTop = h - 44 - mobileControlH;
      const mobileTraceTop = Math.max(132, Math.min(154, h * 0.18));
      const mobilePatternVisible = Boolean(patternRef.current);
      const mobileChannelCount = mobilePatternVisible ? 5 : 4;
      const upperH = Math.round(h * (mobile ? 0.54 : 0.6));
      const chGap = mobile ? 6 : 14;
      const pad = mobile ? 10 : 24;
      const drawableH = mobile
        ? Math.max(168, mobileControlTop - mobileTraceTop - 18)
        : upperH - pad * 2;
      const chH = mobile
        ? Math.max(32, Math.min(48, Math.floor((drawableH - chGap * (mobileChannelCount - 1)) / mobileChannelCount)))
        : 70;
      const labelW = mobile ? 58 : 88;
      const channelW = w - labelW - pad * 2;

      // pattern channel is rendered just below the main four (still
      // within the upper region if possible — otherwise overflows into
      // a thin band above the control region).
      const fourH = chH * 4 + chGap * 3;
      const startY = mobile
        ? mobileTraceTop
        : pad + Math.max(0, Math.min(20, upperH - fourH - 80) * 0.5);
      const channels = channelsRef.current;

      const stressV = stressRef.current;
      const inDefib = now < state.defibUntil;
      defibRef.current = inDefib;

      // ── advance synthesizers ──────────────────────────────────────
      // HR: time-to-next-beat with stress-modulated variability.
      {
        const baseHr = hrRef.current * (1 + stressV * 0.18);
        // smoothly approach the new bpm; lastBpm carries the actual beat-to-beat
        const period = 60 / baseHr;
        const sinceBeat = (now - state.lastBeatT) / 1000;
        // jitter the beat interval — wider with stress
        const variance = 0.04 + stressV * 0.12;
        const effectivePeriod = period * (1 + (Math.sin(now * 0.0023) * 0.5 + Math.sin(now * 0.0017) * 0.5) * variance);
        if (!inDefib && sinceBeat >= effectivePeriod) {
          state.lastBeatT = now;
          state.qrsProgress = 0;
          state.lastBpm = baseHr;
          // tick audio
          if (audioHRRef.current) {
            try { getFieldAudio().spark(); } catch { /* noop */ }
          }
        }
        if (state.qrsProgress < 1) state.qrsProgress = Math.min(1, state.qrsProgress + dt / state.qrsDur);
      }
      // BREATH: sinusoidal at breathRate, stress adds irregularity
      {
        const baseBr = brRef.current * (1 + stressV * 0.3);
        const breathHz = baseBr / 60;
        // stress modulates phase irregularly
        const wobble = Math.sin(now * 0.0011) * stressV * 0.6;
        state.breathPhase += dt * Math.PI * 2 * (breathHz + wobble * 0.1);
        // breath audio tick on inhale apex
        if (audioBreathRef.current && Math.sin(state.breathPhase) > 0.98 && Math.sin(state.breathPhase - dt * Math.PI * 2 * breathHz) <= 0.98) {
          try { getFieldAudio().chime(); } catch { /* noop */ }
        }
      }
      // BP: fast pulse on slow drift
      {
        const baseHr = hrRef.current * (1 + stressV * 0.18);
        state.bpFastPhase += dt * Math.PI * 2 * (baseHr / 60);
        state.bpDriftPhase += dt * Math.PI * 2 * 0.07;
      }
      // BRAIN: chaotic alpha with bursts (8-13Hz, with intermittent spikes)
      {
        if (now > state.brainBurstUntil && Math.random() < 0.012 + stressV * 0.02) {
          state.brainBurstUntil = now + 300 + Math.random() * 400;
        }
        const inBurst = now < state.brainBurstUntil;
        const amp = (0.4 + stressV * 0.6) * (inBurst ? 1.6 : 1.0);
        const alpha = Math.sin(now * 0.062) * Math.sin(now * 0.083) * 0.6;
        const beta  = Math.sin(now * 0.18) * 0.25;
        const noise = (Math.random() - 0.5) * 0.7;
        const target = (alpha + beta + noise) * amp;
        state.brainState = state.brainState * 0.55 + target * 0.45;
      }
      // PATTERN: advance cursor
      if (patternRef.current) {
        state.patternCursor = (state.patternCursor + 1) % patternRef.current.length;
      }

      // ── push samples into ring buffers ───────────────────────────
      // HR sample is the PQRST waveform at qrsProgress, anchored to lastBpm scale.
      const hrSample = inDefib ? 0 : qrstSample(state.qrsProgress);
      pushSample(channels.hr, hrSample);

      const breathSample = inDefib ? 0 : Math.sin(state.breathPhase) * 0.85;
      pushSample(channels.breath, breathSample);

      // BP: pulse + drift, kept positive-leaning (we render it as a bowed line above the centerline)
      const bpFast = Math.max(0, Math.sin(state.bpFastPhase)) ** 1.6;
      const bpDrift = Math.sin(state.bpDriftPhase) * 0.25;
      const bpSample = inDefib ? 0 : (bpFast * 0.7 + bpDrift) - 0.35;
      pushSample(channels.bp, bpSample);

      const brainSample = inDefib ? 0 : state.brainState;
      pushSample(channels.brain, brainSample);

      // ── readouts (throttle to ~3Hz) ──────────────────────────────
      if (now - state.lastReadoutAt > 333) {
        state.lastReadoutAt = now;
        const baseHr = hrRef.current * (1 + stressV * 0.18);
        setHrShown(Math.round(baseHr));
        const sysBase = 100 + stressV * 50;
        const sys = Math.round(sysBase + bpFast * 18 + bpDrift * 5);
        const dia = Math.round(sysBase * 0.65 + bpDrift * 4);
        setBpShown({ sys, dia });
        setBrShown(Math.round(brRef.current));
      }

      // ── draw channels ─────────────────────────────────────────────
      const order: ChannelKey[] = ["hr", "breath", "bp", "brain"];
      order.forEach((k, i) => {
        const y = startY + i * (chH + chGap);
        drawChannel(ctx, channels[k], pad, y, channelW + labelW, chH, labelW, reduce, inDefib);
      });

      // pattern channel — beneath the four main channels if the pattern is loaded.
      // Skipped on canvas when the user has switched the channel to candle view —
      // the inline SeaChart overlay paints those instead.
      if (patternRef.current && patternViewRef.current === "line") {
        const py = startY + 4 * (chH + chGap);
        drawPatternChannel(ctx, patternRef.current, state.patternCursor, pad, py, channelW + labelW, chH, labelW, reduce, patternKindRef.current);
      }

      // flat-line audio bell on restart from defib
      if (state.defibKickedAt && !inDefib && now - state.defibKickedAt > 1800 && now - state.defibKickedAt < 2200) {
        // single bell fire — protect by zeroing the marker
        try { getFieldAudio().bell(); } catch { /* noop */ }
        state.defibKickedAt = 0;
      }

      raf = requestAnimationFrame(draw);
    };

    // public hook for the defib button — set the timer via a window event
    const onDefib = () => {
      state.defibUntil = performance.now() + 2000;
      state.defibKickedAt = performance.now();
      try { getFieldAudio().thud(); } catch { /* noop */ }
    };
    window.addEventListener("oda:pulse:defib", onDefib);

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("oda:pulse:defib", onDefib);
    };
  }, []);

  // keep a ref so the RAF loop sees current pattern kind for color
  const patternKindRef = useRef<PatternKind>(patternKind);
  useEffect(() => { patternKindRef.current = patternKind; }, [patternKind]);
  const patternViewRef = useRef<"line" | "candles">(patternView);
  useEffect(() => { patternViewRef.current = patternView; }, [patternView]);

  // Build candles directly from the pattern buffer. Each candle covers a
  // chunk of CHUNK samples (= ~1s @60Hz, scaled to give 30 candles across
  // the buffer regardless of length). open = first sample, close = last,
  // high/low = extremes, volume = max abs delta.
  const patternSource = (i: number): SeaChartCandle => {
    const samples = patternSamples;
    if (!samples || samples.length === 0) {
      return { open: 0, close: 0, high: 0.1, low: -0.1, volume: 0.05 };
    }
    const COUNT = 30;
    const chunk = Math.max(1, Math.floor(samples.length / COUNT));
    const off = (i % COUNT) * chunk;
    const open = samples[off];
    const close = samples[Math.min(samples.length - 1, off + chunk - 1)];
    let high = open;
    let low = open;
    let maxD = 0;
    for (let k = 0; k < chunk; k++) {
      const v = samples[off + k];
      if (v == null) break;
      if (v > high) high = v;
      if (v < low) low = v;
      if (k > 0) {
        const d = Math.abs(v - samples[off + k - 1]);
        if (d > maxD) maxD = d;
      }
    }
    return { open, close, high, low, volume: maxD + 0.04 };
  };

  // ── handlers ──────────────────────────────────────────────────────────
  const onDefibrillate = useCallback(() => {
    setDefibActive(true);
    window.dispatchEvent(new Event("oda:pulse:defib"));
    recordTape("ripple", 1.0, "pulse/defib");
    window.setTimeout(() => setDefibActive(false), 2200);
  }, [recordTape]);

  const onGenerate = useCallback(() => {
    const seed = Math.floor(Math.random() * 0xffffffff);
    setPatternSeed(seed);
    setPatternSamples(generatePattern(patternKind, seed));
  }, [patternKind]);

  const onSavePattern = useCallback(() => {
    const name = (patternName || `${patternKind}-${Date.now().toString(36).slice(-4)}`).slice(0, 32);
    const entry: SavedPattern = { name, kind: patternKind, seed: patternSeed, createdAt: Date.now() };
    const next = [entry, ...saved.filter((s) => s.name !== name)].slice(0, 30);
    setSaved(next);
    try { localStorage.setItem(PATTERN_KEY, JSON.stringify(next)); } catch { /* noop */ }
    setPatternName("");
  }, [patternName, patternKind, patternSeed, saved]);

  const onLoadPattern = useCallback((p: SavedPattern) => {
    setPatternKind(p.kind);
    setPatternSeed(p.seed);
    setPatternSamples(generatePattern(p.kind, p.seed));
  }, []);

  const onDeletePattern = useCallback((name: string) => {
    const next = saved.filter((s) => s.name !== name);
    setSaved(next);
    try { localStorage.setItem(PATTERN_KEY, JSON.stringify(next)); } catch { /* noop */ }
  }, [saved]);

  const onShare = useCallback(() => {
    try {
      const payload = { kind: patternKind, seed: patternSeed, hr, br: breathRate, stress };
      const b64 = btoa(JSON.stringify(payload));
      const url = `${window.location.origin}${window.location.pathname}#p=${b64}`;
      void navigator.clipboard.writeText(url).then(
        () => setShareMsg("copied"),
        () => setShareMsg("could not copy"),
      );
      window.setTimeout(() => setShareMsg(null), 1800);
    } catch {
      setShareMsg("share failed");
      window.setTimeout(() => setShareMsg(null), 1800);
    }
  }, [patternKind, patternSeed, hr, breathRate, stress]);

  const onDownload = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    try {
      const data = cv.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = data;
      a.download = `pulse-${patternKind}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch { /* noop */ }
  }, [patternKind]);

  // ── readout overlays (positioned over the canvas) ─────────────────────
  // Hospital-style big Fraunces numerals for each channel.
  const readouts = useMemo(() => ([
    { key: "hr",     label: "HR",     big: `${hrShown}`,            unit: "BPM",      color: "#4af07a", audio: audioHR,     setAudio: setAudioHR },
    { key: "breath", label: "BREATH", big: `${brShown}`,            unit: "BR",       color: "#4ad4f0", audio: audioBreath, setAudio: setAudioBreath },
    { key: "bp",     label: "BP",     big: `${bpShown.sys}/${bpShown.dia}`, unit: "mmHg", color: "#f0c04a", audio: audioBP,     setAudio: setAudioBP },
    { key: "brain",  label: "BRAIN",  big: defibActive ? "—" : "α·β", unit: "EEG",    color: "#b04af0", audio: audioBrain,  setAudio: setAudioBrain },
  ]), [hrShown, brShown, bpShown, defibActive, audioHR, audioBreath, audioBP, audioBrain]);

  return (
    <div
      className="oda-pulse-root"
      data-touch-surface="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "#040810",
        overflow: "hidden",
        touchAction: "manipulation",
        color: "rgba(232,226,213,0.92)",
      }}
    >
      <canvas
        className="oda-pulse-canvas"
        ref={canvasRef}
        aria-label="pulse — hospital monitor for the room"
        style={{
          position: "absolute",
          inset: 0,
          width: "100vw",
          height: "100vh",
          display: "block",
        }}
      />

      {/* When the pattern channel is in candle view, overlay an inline
          SeaChart in the same band the canvas would have drawn the line in.
          Positioned to the LEFT so it doesn't collide with the right-edge
          readouts column. */}
      {patternView === "candles" && patternSamples && (
        <div
          className="oda-pulse-pattern-chart"
          style={{
            position: "absolute",
            left: "clamp(12px, 3vw, 32px)",
            // 4 channels * (chH=70+gap=14) ≈ 336px below the channels' startY.
            // Keep the embed above the control rail and global tape.
            top: "39.5vh",
            pointerEvents: "auto",
            zIndex: 4,
          }}
        >
          <SeaChart
            variant="inline"
            mode="candles"
            title={`pattern · ${patternKind}`}
            caption="candle view"
            width={"min(560px, calc(100vw - 24px))"}
            height={84}
            tickMs={0}
            source={patternSource}
            pullKey={patternPullKey}
            static
            feedToOcean={false}
            tapeLabel={`pulse/pattern/${patternKind}`}
            upColor={"#4af07a"}
            downColor={"#f06a6a"}
            background="rgba(8, 12, 24, 0.78)"
          />
        </div>
      )}

      {/* readout overlay column on the right of each channel */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          fontFamily: "var(--font-mono, ui-monospace)",
        }}
      >
        {/* readouts are positioned approximately — they hover near the right edge of each channel band */}
        <div
          className="oda-pulse-readouts"
          style={{
            position: "absolute",
            right: 24,
            top: 0,
            height: "60vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-around",
            alignItems: "flex-end",
            gap: 8,
            paddingTop: 24,
            paddingBottom: 24,
            pointerEvents: "auto",
          }}
        >
          {readouts.map((r) => (
            <div className="oda-pulse-readout" key={r.key} style={{ textAlign: "right", lineHeight: 1.0 }}>
              <button
                className="oda-pulse-audio-toggle"
                type="button"
                onClick={() => r.setAudio(!r.audio)}
                aria-label={`toggle ${r.label} audio`}
                aria-pressed={r.audio}
                style={{
                  background: "transparent",
                  border: "none",
                  color: r.audio ? r.color : "rgba(232,226,213,0.55)",
                  fontFamily: "inherit",
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  cursor: "pointer",
                  padding: "8px 8px",
                  minHeight: 44,
                  minWidth: 44,
                  textTransform: "uppercase",
                  filter: r.audio ? `drop-shadow(0 0 4px ${r.color})` : "none",
                }}
              >
                {r.label} {r.audio ? "●" : "○"}
              </button>
              <div
                className="oda-pulse-readout-value"
                style={{
                  fontFamily: "var(--font-fraunces, Georgia), serif",
                  fontWeight: 500,
                  fontSize: 32,
                  color: r.color,
                  letterSpacing: "-0.01em",
                  filter: `drop-shadow(0 0 6px ${r.color}55)`,
                }}
              >
                {r.big}
              </div>
              <div className="oda-pulse-readout-unit" style={{ fontSize: 10, opacity: 0.55, letterSpacing: "0.14em" }}>
                {r.unit}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* control rail — lower 40% */}
      <div
        className="oda-pulse-controls"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 44,
          height: "40vh",
          padding: "16px clamp(12px, 3vw, 32px)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 16,
          alignItems: "stretch",
          background: "linear-gradient(180deg, rgba(4,8,16,0) 0%, rgba(4,8,16,0.72) 14%, rgba(4,8,16,0.92) 100%)",
          borderTop: "1px solid rgba(74,240,122,0.08)",
        }}
      >
        {/* LEFT — sliders + defib */}
        <div style={panelStyle}>
          <div style={panelTitle}>vitals</div>
          <Slider label="HR"      min={40}  max={180} step={1}    value={hr}          onChange={setHr}          format={(v) => `${v} bpm`} color="#4af07a" />
          <Slider label="BREATH"  min={6}   max={30}  step={1}    value={breathRate}  onChange={setBreathRate}  format={(v) => `${v} br`}  color="#4ad4f0" />
          <Slider label="STRESS"  min={0}   max={1}   step={0.01} value={stress}      onChange={setStress}      format={(v) => `${Math.round(v * 100)}%`} color="#f06a6a" />
          <button
            type="button"
            onClick={onDefibrillate}
            disabled={defibActive}
            style={{
              marginTop: 6,
              padding: "12px 14px",
              minHeight: 48,
              fontSize: 16,
              fontFamily: "var(--font-mono, ui-monospace)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              cursor: defibActive ? "default" : "pointer",
              borderRadius: 4,
              border: `1px solid ${defibActive ? "rgba(240,90,80,0.35)" : "rgba(240,90,80,0.75)"}`,
              background: defibActive ? "rgba(240,90,80,0.20)" : "rgba(240,90,80,0.08)",
              color: defibActive ? "rgba(240,90,80,0.65)" : "#ff8a78",
              filter: defibActive ? "none" : "drop-shadow(0 0 8px rgba(240,90,80,0.55))",
              transition: "background 240ms, border-color 240ms",
            }}
          >
            {defibActive ? "⚡ charging" : "⚡ defibrillate"}
          </button>
        </div>

        {/* MIDDLE — pattern generator */}
        <div style={panelStyle}>
          <div style={panelTitle}>pattern</div>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <select
              value={patternKind}
              onChange={(e) => setPatternKind(e.target.value as PatternKind)}
              style={selectStyle}
              aria-label="pattern kind"
            >
              <option value="tide">tide</option>
              <option value="wave">wave</option>
              <option value="seismic">seismic</option>
              <option value="breath">breath</option>
              <option value="storm">storm</option>
            </select>
            <button type="button" onClick={onGenerate} style={btnStyle("#f0c04a")}>
              generate
            </button>
          </div>
          {/* view-mode toggle — switches the pattern channel between the
              default line trace and a candlestick representation. The
              currently-inactive button is the muted (disabled-style) one. */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setPatternView("line")}
              style={btnStyle("#4ad4f0", patternView !== "line")}
              aria-pressed={patternView === "line"}
            >
              line view
            </button>
            <button
              type="button"
              onClick={() => setPatternView("candles")}
              style={btnStyle("#f0c04a", patternView !== "candles")}
              aria-pressed={patternView === "candles"}
            >
              candle view
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={patternName}
              onChange={(e) => setPatternName(e.target.value)}
              placeholder="name…"
              aria-label="pattern name"
              style={inputStyle}
            />
            <button type="button" onClick={onSavePattern} disabled={!patternSamples} style={btnStyle("#4af07a", !patternSamples)}>
              save
            </button>
          </div>
          {saved.length > 0 && (
            <div
              style={{
                maxHeight: "16vh",
                overflowY: "auto",
                border: "1px solid rgba(232,226,213,0.12)",
                borderRadius: 4,
                padding: 4,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {saved.map((p) => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => onLoadPattern(p)}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: "rgba(232,226,213,0.86)",
                      fontFamily: "var(--font-mono, ui-monospace)",
                      fontSize: 12,
                      padding: "10px 6px",
                      minHeight: 44,
                      cursor: "pointer",
                      letterSpacing: "0.04em",
                    }}
                  >
                    <span style={{ opacity: 0.55, marginRight: 6 }}>{p.kind}</span>
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeletePattern(p.name)}
                    aria-label={`delete ${p.name}`}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "rgba(232,226,213,0.45)",
                      fontSize: 16,
                      cursor: "pointer",
                      padding: "8px 10px",
                      minHeight: 44,
                      minWidth: 44,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — share + download */}
        <div style={panelStyle}>
          <div style={panelTitle}>distribute</div>
          <button type="button" onClick={onShare} style={btnStyle("#4ad4f0")}>
            share link
          </button>
          <button type="button" onClick={onDownload} style={btnStyle("#b04af0")}>
            download png
          </button>
          {shareMsg && (
            <div
              style={{
                fontFamily: "var(--font-mono, ui-monospace)",
                fontSize: 11,
                letterSpacing: "0.1em",
                opacity: 0.7,
                marginTop: 2,
              }}
            >
              {shareMsg}
            </div>
          )}
          <WaterText
            as="div"
            bobAmp={1.5}
            style={{
              display: "block",
              marginTop: "auto",
              fontFamily: "var(--font-serif), Georgia, serif",
              fontStyle: "italic",
              fontSize: 13,
              color: "rgba(232,226,213,0.55)",
              textAlign: "right",
              lineHeight: 1.4,
            }}
          >
            the body keeps its own time
          </WaterText>
        </div>
      </div>

      <style>{`
        body:has(.oda-pulse-root) .oda-field-watch,
        body:has(.oda-pulse-root) .oda-candle-mark,
        body:has(.oda-pulse-root) .oda-sound-toggle {
          display: none !important;
        }
        @media (max-width: 720px) {
          .oda-pulse-root {
            overflow: hidden !important;
            --pulse-mobile-control-height: min(390px, 46svh);
            --pulse-mobile-control-bottom: calc(44px + env(safe-area-inset-bottom, 0px));
          }
          .oda-pulse-canvas {
            height: 100svh !important;
          }
          .oda-pulse-pattern-chart {
            left: 12px !important;
            right: 12px !important;
            top: calc(100svh - var(--pulse-mobile-control-height) - 128px) !important;
            max-width: calc(100vw - 24px);
          }
          .oda-pulse-pattern-chart > div {
            padding: 6px !important;
          }
          .oda-pulse-pattern-chart > div > div:first-child {
            font-size: 9px !important;
            margin-bottom: 2px !important;
          }
          .oda-pulse-pattern-chart canvas {
            height: 50px !important;
          }
          .oda-pulse-pattern-chart > div > div:last-child {
            display: none !important;
          }
          .oda-pulse-readouts {
            right: 8px !important;
            top: 138px !important;
            height: calc(100svh - var(--pulse-mobile-control-height) - 198px) !important;
            min-height: 168px !important;
            max-height: 244px !important;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
            gap: 2px !important;
          }
          .oda-pulse-readout {
            max-width: min(28vw, 104px);
          }
          .oda-pulse-readout-value {
            font-size: clamp(16px, 5.4vw, 24px) !important;
            line-height: 0.95 !important;
          }
          .oda-pulse-audio-toggle {
            min-height: 30px !important;
            min-width: 34px !important;
            font-size: 9px !important;
            letter-spacing: 0.08em !important;
            padding: 3px 4px !important;
          }
          .oda-pulse-readout-unit {
            font-size: 8px !important;
          }
          .oda-pulse-controls {
            grid-template-columns: 1fr !important;
            grid-auto-rows: max-content !important;
            height: var(--pulse-mobile-control-height) !important;
            bottom: var(--pulse-mobile-control-bottom) !important;
            padding: 8px 12px calc(18px + env(safe-area-inset-bottom, 0px)) !important;
            gap: 8px !important;
            overflow-y: auto;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
            align-items: start !important;
            align-content: start !important;
          }
          .oda-pulse-controls > div {
            padding: 10px 12px !important;
            gap: 8px !important;
            min-height: max-content !important;
          }
          .oda-pulse-controls input,
          .oda-pulse-controls select,
          .oda-pulse-controls button {
            max-width: 100%;
          }
          .oda-pulse-controls select,
          .oda-pulse-controls input[type="text"] {
            min-height: 40px !important;
            font-size: 14px !important;
          }
          .oda-pulse-controls button {
            min-height: 40px !important;
            font-size: 12px !important;
            letter-spacing: 0.1em !important;
          }
          .oda-pulse-controls [style*="display: flex"] {
            flex-wrap: wrap;
          }
        }
        .oda-pulse-controls input[type=range] {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 44px;
          background: transparent;
          touch-action: manipulation;
        }
        @media (max-width: 720px) {
          .oda-pulse-controls input[type=range] {
            height: 34px;
          }
        }
        .oda-pulse-controls input[type=range]::-webkit-slider-runnable-track {
          height: 2px;
          background: rgba(232,226,213,0.25);
        }
        .oda-pulse-controls input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          margin-top: -11px;
          border-radius: 50%;
          background: var(--thumb-color, #4af07a);
          box-shadow: 0 0 8px var(--thumb-color, #4af07a);
          cursor: pointer;
          border: none;
        }
        @media (max-width: 720px) {
          .oda-pulse-controls input[type=range]::-webkit-slider-thumb {
            width: 20px;
            height: 20px;
            margin-top: -9px;
          }
        }
        .oda-pulse-controls input[type=range]::-moz-range-track {
          height: 2px;
          background: rgba(232,226,213,0.25);
        }
        .oda-pulse-controls input[type=range]::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--thumb-color, #4af07a);
          box-shadow: 0 0 8px var(--thumb-color, #4af07a);
          cursor: pointer;
          border: none;
        }
        @media (max-width: 720px) {
          .oda-pulse-controls input[type=range]::-moz-range-thumb {
            width: 20px;
            height: 20px;
          }
        }
      `}</style>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function pushSample(ch: Channel, v: number): void {
  ch.buffer[ch.cursor] = v;
  ch.cursor = (ch.cursor + 1) % ch.buffer.length;
}

/**
 * Sample a normalised PQRST waveform at progress `p` in [0, 1].
 * Returns roughly [-0.4, 1.0] — R peak hits 1.0, S dip near -0.4.
 *
 * Shape (approximate timings within one beat):
 *   0.00 - 0.08  baseline
 *   0.08 - 0.16  P wave (small bump)
 *   0.16 - 0.22  baseline (PR segment)
 *   0.22 - 0.26  Q dip
 *   0.26 - 0.30  R spike up
 *   0.30 - 0.34  S dip
 *   0.34 - 0.50  baseline (ST)
 *   0.50 - 0.62  T wave (broad bump)
 *   0.62 - 1.00  baseline
 */
function qrstSample(p: number): number {
  if (p < 0.08)        return 0;
  if (p < 0.16)        return Math.sin(((p - 0.08) / 0.08) * Math.PI) * 0.18; // P
  if (p < 0.22)        return 0;
  if (p < 0.26)        return -((p - 0.22) / 0.04) * 0.18;                     // Q descent
  if (p < 0.30)        return -0.18 + ((p - 0.26) / 0.04) * 1.18;              // R ascent → peak 1.0
  if (p < 0.34)        return 1.0  - ((p - 0.30) / 0.04) * 1.40;               // S descent to -0.40
  if (p < 0.38)        return -0.40 + ((p - 0.34) / 0.04) * 0.40;              // S recovery
  if (p < 0.50)        return 0;
  if (p < 0.62)        return Math.sin(((p - 0.50) / 0.12) * Math.PI) * 0.28; // T
  return 0;
}

function drawChannel(
  ctx: CanvasRenderingContext2D,
  ch: Channel,
  x: number,
  y: number,
  totalW: number,
  h: number,
  labelW: number,
  reduce: boolean,
  inDefib: boolean,
): void {
  // background — faint dark green grid
  ctx.fillStyle = "rgba(20, 32, 22, 0.6)";
  ctx.fillRect(x, y, totalW, h);

  // grid
  ctx.strokeStyle = "rgba(74, 240, 122, 0.06)";
  ctx.lineWidth = 1;
  const gridStep = 14;
  for (let gx = x + labelW + gridStep; gx < x + totalW; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.stroke();
  }
  for (let gy = y + gridStep; gy < y + h; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x + labelW, gy);
    ctx.lineTo(x + totalW, gy);
    ctx.stroke();
  }

  // label region — left
  ctx.fillStyle = "rgba(232, 226, 213, 0.78)";
  ctx.font = '11px var(--font-mono, ui-monospace)';
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(ch.label, x + 6, y + h * 0.5);
  if (ch.audio) {
    ctx.fillStyle = ch.color;
    ctx.fillRect(x + 2, y + 4, 2, h - 8);
  }

  // trace
  const traceX = x + labelW;
  const traceW = totalW - labelW - 6;
  const mid = y + h * 0.5;
  const amp = h * 0.4;

  if (inDefib) {
    // flatline
    ctx.strokeStyle = ch.color;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = ch.color;
    ctx.shadowBlur = reduce ? 0 : 4;
    ctx.beginPath();
    ctx.moveTo(traceX, mid);
    ctx.lineTo(traceX + traceW, mid);
    ctx.stroke();
    ctx.shadowBlur = 0;
    return;
  }

  // Draw the ring buffer from oldest → newest, scrolling right-to-left.
  // The newest sample (cursor - 1) sits at the right edge.
  const buf = ch.buffer;
  const N = buf.length;
  const startIdx = ch.cursor; // oldest sample lives here
  ctx.strokeStyle = ch.color;
  ctx.lineWidth = 1.6;
  ctx.shadowColor = ch.color;
  ctx.shadowBlur = reduce ? 0 : 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const idx = (startIdx + i) % N;
    const sx = traceX + (i / (N - 1)) * traceW;
    const sy = mid - buf[idx] * amp;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawPatternChannel(
  ctx: CanvasRenderingContext2D,
  samples: Float32Array,
  cursor: number,
  x: number,
  y: number,
  totalW: number,
  h: number,
  labelW: number,
  reduce: boolean,
  kind: PatternKind,
): void {
  const colors: Record<PatternKind, string> = {
    tide:    "#6ad0ff",
    wave:    "#8ae0c8",
    seismic: "#ffae6a",
    breath:  "#d6b8ff",
    storm:   "#ff7a86",
  };
  const color = colors[kind];

  ctx.fillStyle = "rgba(8, 12, 24, 0.6)";
  ctx.fillRect(x, y, totalW, h);

  // label
  ctx.fillStyle = "rgba(232, 226, 213, 0.78)";
  ctx.font = '11px var(--font-mono, ui-monospace)';
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(kind.toUpperCase(), x + 6, y + h * 0.5);

  const traceX = x + labelW;
  const traceW = totalW - labelW - 6;
  const mid = y + h * 0.5;
  const amp = h * 0.42;
  const N = samples.length;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.shadowColor = color;
  ctx.shadowBlur = reduce ? 0 : 5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  // Render the entire pattern across the channel width, with a marker
  // at the current cursor position to show "now" within the loop.
  const STRIDE = Math.max(1, Math.floor(N / Math.max(1, traceW * 1.5)));
  let first = true;
  for (let i = 0; i < N; i += STRIDE) {
    const sx = traceX + (i / (N - 1)) * traceW;
    const sy = mid - samples[i] * amp;
    if (first) { ctx.moveTo(sx, sy); first = false; }
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // cursor marker
  const cx = traceX + (cursor / (N - 1)) * traceW;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, mid - samples[cursor] * amp, 2.4, 0, Math.PI * 2);
  ctx.fill();
}

// ── styled sub-components ────────────────────────────────────────────────

function Slider({
  label, min, max, step, value, onChange, format, color,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  color: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-mono, ui-monospace)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "rgba(232,226,213,0.78)",
        }}
      >
        <span>{label}</span>
        <span style={{ color }}>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        style={
          { ["--thumb-color" as string]: color, fontSize: 16 } as React.CSSProperties
        }
      />
    </label>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 14px",
  border: "1px solid rgba(232,226,213,0.10)",
  borderRadius: 6,
  background: "rgba(8,14,22,0.55)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  minHeight: 0,
};

const panelTitle: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace)",
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  opacity: 0.55,
  marginBottom: 2,
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 10px",
  minHeight: 44,
  background: "rgba(4,8,16,0.85)",
  color: "rgba(232,226,213,0.92)",
  border: "1px solid rgba(232,226,213,0.22)",
  borderRadius: 4,
  fontFamily: "var(--font-mono, ui-monospace)",
  fontSize: 16,
  letterSpacing: "0.06em",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  minHeight: 44,
  background: "rgba(4,8,16,0.85)",
  color: "rgba(232,226,213,0.92)",
  border: "1px solid rgba(232,226,213,0.22)",
  borderRadius: 4,
  fontFamily: "var(--font-mono, ui-monospace)",
  fontSize: 16,
  letterSpacing: "0.04em",
  outline: "none",
};

function btnStyle(color: string, disabled = false): React.CSSProperties {
  return {
    padding: "10px 14px",
    minHeight: 44,
    fontSize: 13,
    fontFamily: "var(--font-mono, ui-monospace)",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: disabled ? "default" : "pointer",
    borderRadius: 4,
    border: `1px solid ${disabled ? "rgba(232,226,213,0.18)" : color + "aa"}`,
    background: disabled ? "rgba(232,226,213,0.05)" : color + "18",
    color: disabled ? "rgba(232,226,213,0.4)" : color,
    transition: "background 200ms, border-color 200ms",
  };
}
