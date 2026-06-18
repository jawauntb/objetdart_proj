"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio, parsePromptMods, pickPromptFallbackScale } from "@/lib/audio";
import type { ComposeHandle, ScaleName } from "@/lib/audio";
import { useField } from "@/store/field";
import type { ConcernKey } from "@/lib/types";
import WaterText from "@/components/WaterText";

// Same mapping as audio.ts — duplicated here only so the UI can label the
// chosen mood/tempo without having to call into the engine. Keep in sync.
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

function deriveScale(concerns: Record<ConcernKey, number>): Exclude<ScaleName, "auto"> {
  const entries = Object.entries(concerns) as Array<[ConcernKey, number]>;
  if (entries.length === 0) return "ionian";
  let top: ConcernKey = entries[0][0];
  let topV = entries[0][1];
  for (const [k, v] of entries) if (v > topV) { top = k; topV = v; }
  return CONCERN_TO_SCALE[top] ?? "ionian";
}

function deriveTempo(concerns: Record<ConcernKey, number>): number {
  const pressure = (concerns.risk ?? 0) + (concerns.work ?? 0);
  const stillness = (concerns.prayer ?? 0) + (concerns.memory ?? 0);
  if (pressure > 130) return 110;
  if (stillness > 130) return 62;
  return 80;
}

/**
 * /signal — the room made audible.
 *
 * The whole site already breathes (ambient ocean, concern tones, sigil
 * phrases). This page is just the FFT made visible. Three layers ride
 * over a deep indigo field:
 *
 *   1. spectrum band — 256 bins, amber→cyan, low frequencies on the left
 *   2. waveform band — pale cream time-domain line, glow underneath
 *   3. nautilus spiral — time-domain samples wrapped around a logarithmic
 *      spiral. Each angle is one sample; radius is r₀·e^(b·θ) + amplitude.
 *
 * Music is also waves. The page exists to make that visible.
 */

// Number of spectrum bars rendered — must match the draw loop. Pulled out
// so the click handler can map x → bin without drifting from the visual.
const NBINS = 256;
// transient distortion lifetime, seconds
const DISTORT_LIFE = 0.5;

// preset concern shapes — clicking the dial cycles through them
const PHRASES: ReadonlyArray<{ name: string; weights: Record<string, number> }> = [
  { name: "love",       weights: { love: 92, friendship: 70, body: 60, memory: 45, prayer: 55, future: 60, work: 25, risk: 25 } },
  { name: "prayer",     weights: { prayer: 96, memory: 70, love: 55, future: 50, body: 40, friendship: 35, work: 20, risk: 18 } },
  { name: "work",       weights: { work: 92, future: 78, risk: 60, body: 45, prayer: 30, love: 35, friendship: 30, memory: 35 } },
  { name: "risk",       weights: { risk: 96, work: 70, future: 65, body: 55, love: 30, prayer: 30, memory: 25, friendship: 30 } },
  { name: "friendship", weights: { friendship: 92, love: 70, memory: 60, body: 50, work: 35, prayer: 40, future: 45, risk: 30 } },
  { name: "memory",     weights: { memory: 96, prayer: 65, love: 55, friendship: 55, body: 40, work: 30, future: 25, risk: 22 } },
  { name: "future",     weights: { future: 96, work: 70, prayer: 55, love: 50, risk: 55, body: 40, memory: 30, friendship: 35 } },
  { name: "body",       weights: { body: 96, love: 60, prayer: 50, friendship: 55, work: 40, memory: 40, future: 35, risk: 30 } },
];

export default function Signal() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fftSmooth = useRef<Float32Array | null>(null);
  // active analyser — internal field by default, can swap to mic analyser
  const sourceAnalyser = useRef<AnalyserNode | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const micSource = useRef<MediaStreamAudioSourceNode | null>(null);

  // UI state
  const [audioStarted, setAudioStarted] = useState(false);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  // ── interactive layer ────────────────────────────────────────────────
  // Hovered = pointer is inside the spiral's outer radius. The RAF loop
  // reads this through a ref so we don't re-bind the loop per hover.
  const [spiralHover, setSpiralHover] = useState(false);
  const spiralHoverRef = useRef(false);
  useEffect(() => { spiralHoverRef.current = spiralHover; }, [spiralHover]);
  // accumulated spiral rotation phase, advanced each frame in the RAF loop.
  // The base rate is small (a slow drift) and hover ~3x's it.
  const spiralPhaseRef = useRef(0);
  // last layout values, written by the RAF loop so event handlers can do
  // accurate hit-tests without duplicating the layout math.
  const layoutRef = useRef({
    waveY: 0,
    waveAmp: 0,
    spiralR: 0,
    cx: 0,
    cy: 0,
  });
  // transient waveform distortions — visual-only displacement of the
  // rendered waveform at a given x, fading over DISTORT_LIFE seconds.
  type WaveDistortion = { x: number; amount: number; t0: number };
  const distortionsRef = useRef<WaveDistortion[]>([]);
  // active drag pointer (only one finger drives the "play" gesture)
  const wavePointerId = useRef<number | null>(null);
  const lastDragYRef = useRef<number | null>(null);
  const lastChimeAt = useRef<number>(0);

  // ── compose state ────────────────────────────────────────────────
  // composeHandle is held in a ref so the render loop can read end time
  // without re-rendering at 60fps; the visible flag drives the UI.
  const composeHandle = useRef<ComposeHandle | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeStart, setComposeStart] = useState(0);
  const [composeMeta, setComposeMeta] = useState<{
    scale: Exclude<ScaleName, "auto">;
    tempo: number;
    duration: number;
  } | null>(null);
  const [composeProgress, setComposeProgress] = useState(0);

  // ── prompt + coda toggle state ───────────────────────────────────
  // Free-form prompt text feeding the keyword parser in audio.ts. The
  // toggle defaults ON — the oceanic coda is part of the piece's
  // identity; users opt out, not in.
  const [promptText, setPromptText] = useState("");
  const promptTextRef = useRef("");
  const [oceanicCoda, setOceanicCoda] = useState(true);
  const updatePromptText = useCallback((value: string) => {
    promptTextRef.current = value;
    setPromptText(value);
  }, []);
  // live-derived chips so the user sees what the parser picked up
  const promptChips = useMemo(
    () => parsePromptMods(promptText).chips,
    [promptText],
  );

  // pull current field state so COMPOSE can use the user's actual concerns.
  const concerns = useField((s) => s.concerns);
  const recordTape = useField((s) => s.recordTape);

  // page-specific ambient bed: silent — composition plays unobstructed
  useEffect(() => {
    getFieldAudio().setAmbientProfile("silent", { fadeSec: 0.08 });
  }, []);

  // ── audio + visualiser bootstrap ─────────────────────────────────────
  const ensureAudio = useCallback(async () => {
    const audio = getFieldAudio();
    await audio.start();
    setAudioStarted(true);
    const a = audio.getAnalyser();
    if (a) sourceAnalyser.current = a;
  }, []);

  const playPhrase = useCallback(async (idx: number) => {
    const audio = getFieldAudio();
    await audio.start();
    setAudioStarted(true);
    const a = audio.getAnalyser();
    if (a && !micActive) sourceAnalyser.current = a;
    setPlaying(true);
    try {
      await audio.playSigilPhrase(PHRASES[idx].weights);
    } finally {
      setPlaying(false);
    }
  }, [micActive]);

  // The big play button (and any background click) — start audio, play the
  // current phrase so the visualiser has something rich to show.
  const onTapToListen = useCallback(async () => {
    await ensureAudio();
    if (!playing) {
      void playPhrase(phraseIdx);
    }
  }, [ensureAudio, playPhrase, playing, phraseIdx]);

  // ── COMPOSE ──────────────────────────────────────────────────────
  // Kicks off the generative composer with the user's current concern
  // vector. Captures derived scale + tempo for the UI label, and seeds
  // a progress timer that updates ~10x/s without thrashing rAF.
  const startCompose = useCallback(async (promptOverride?: string) => {
    const audio = getFieldAudio();
    await audio.start();
    audio.setAmbientProfile("silent", { fadeSec: 0.04 });
    setAudioStarted(true);
    const a = audio.getAnalyser();
    if (a && !micActive) sourceAnalyser.current = a;

    // stop any previous compose first
    if (composeHandle.current) {
      try { composeHandle.current.stop(); } catch { /* noop */ }
      composeHandle.current = null;
    }

    const duration = 75;
    // Resolve UI labels using the same precedence as the engine: explicit
    // prompt scale/tempo > concern-derived defaults. Keeps the on-screen
    // chip in sync with what the audio engine is actually doing.
    const prompt = (promptOverride ?? promptTextRef.current).trim();
    const mods = parsePromptMods(prompt);
    const baseTempo = deriveTempo(concerns);
    const tempo = Math.max(40, Math.min(180, baseTempo + mods.tempoDelta));
    const scale = mods.scale ?? (prompt ? pickPromptFallbackScale(prompt.toLowerCase()) : deriveScale(concerns));
    const handle = audio.composeMusic({
      concerns,
      duration,
      scale: mods.scale ?? "auto",
      prompt: prompt || undefined,
      oceanicCoda,
    });
    if (!handle) return;
    composeHandle.current = handle;
    setComposing(true);
    setComposeStart(Date.now());
    setComposeMeta({ scale, tempo, duration });
    setComposeProgress(0);
    recordTape("sigil", 1.0, "compose");
  }, [concerns, micActive, recordTape, oceanicCoda]);

  const submitPrompt = useCallback(
    (event?: React.SyntheticEvent<HTMLFormElement>) => {
      event?.preventDefault();
      event?.stopPropagation();
      const submittedPrompt = event
        ? String(new FormData(event.currentTarget).get("prompt") ?? "")
        : promptTextRef.current;
      promptTextRef.current = submittedPrompt;
      setPromptText(submittedPrompt);
      void startCompose(submittedPrompt);
    },
    [startCompose],
  );

  const stopCompose = useCallback(() => {
    if (composeHandle.current) {
      try { composeHandle.current.stop(); } catch { /* noop */ }
      composeHandle.current = null;
    }
    setComposing(false);
    setComposeProgress(0);
  }, []);

  // progress ticker — also detects natural end of piece.
  useEffect(() => {
    if (!composing || !composeMeta) return;
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - composeStart) / 1000;
      const p = Math.min(1, elapsed / composeMeta.duration);
      setComposeProgress(p);
      if (p >= 1) {
        // composition has played out — engine self-stops, mirror in UI
        composeHandle.current = null;
        setComposing(false);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [composing, composeMeta, composeStart]);

  // stop compose on unmount
  useEffect(() => {
    return () => {
      if (composeHandle.current) {
        try { composeHandle.current.stop(); } catch { /* noop */ }
        composeHandle.current = null;
      }
    };
  }, []);

  const cycleDial = useCallback(() => {
    const next = (phraseIdx + 1) % PHRASES.length;
    setPhraseIdx(next);
    void playPhrase(next);
  }, [phraseIdx, playPhrase]);

  const toggleMic = useCallback(async () => {
    if (micActive) {
      // tear down the mic graph and fall back to the internal analyser
      try { micSource.current?.disconnect(); } catch { /* noop */ }
      try { micAnalyser.current?.disconnect(); } catch { /* noop */ }
      micStream.current?.getTracks().forEach((t) => t.stop());
      micSource.current = null;
      micAnalyser.current = null;
      micStream.current = null;
      setMicActive(false);
      setMicError(null);
      const a = getFieldAudio().getAnalyser();
      if (a) sourceAnalyser.current = a;
      return;
    }
    setMicError(null);
    if (!navigator?.mediaDevices?.getUserMedia) {
      setMicError("microphone not available");
      return;
    }
    try {
      // make sure the audio context exists so we can wire the mic into it
      const audio = getFieldAudio();
      await audio.start();
      const ctx = audio.getAudioContext();
      if (!ctx) {
        setMicError("audio context unavailable");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const src = ctx.createMediaStreamSource(stream);
      const ana = ctx.createAnalyser();
      ana.fftSize = 2048;
      ana.smoothingTimeConstant = 0.78;
      // mic → analyser ONLY. Do NOT connect to destination — that would feed
      // the room speakers back into the mic and oscillate.
      src.connect(ana);
      micStream.current = stream;
      micSource.current = src;
      micAnalyser.current = ana;
      sourceAnalyser.current = ana;
      setMicActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMicError(msg.includes("denied") || msg.includes("Permission") ? "mic denied" : "mic unavailable");
      // fall back gracefully — keep the internal analyser
      const a = getFieldAudio().getAnalyser();
      if (a) sourceAnalyser.current = a;
      setMicActive(false);
    }
  }, [micActive]);

  // ── render loop ──────────────────────────────────────────────────────
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx2d = cv.getContext("2d");
    if (!ctx2d) return;

    // pull whatever analyser is already available (e.g. ambient ocean
    // already started by another route). null means "tap to listen".
    const audio = getFieldAudio();
    const initial = audio.getAnalyser();
    if (initial && !sourceAnalyser.current) sourceAnalyser.current = initial;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = window.innerWidth * dpr;
      cv.height = window.innerHeight * dpr;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // small RGB lerp
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const mix = (c1: [number, number, number], c2: [number, number, number], t: number) =>
      [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)] as const;

    // deterministic star field — frozen if reduced motion
    const STARS = Array.from({ length: 110 }, (_, i) => ({
      sx: ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1,
      sy: (((Math.sin(i * 78.233) * 43758.5453) % 1) + 1) % 1,
      ph: (Math.sin(i * 5.71) * 100) % 6.28,
    }));

    const draw = (now: number) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const t = (now - t0) / 1000;

      // ── 1. BACKGROUND ─────────────────────────────────────────────
      const bg = ctx2d.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0,    "#0a1322");
      bg.addColorStop(0.5,  "#15243a");
      bg.addColorStop(1,    "#0a1322");
      ctx2d.fillStyle = bg;
      ctx2d.fillRect(0, 0, w, h);

      // soft drifting noise/star field
      ctx2d.fillStyle = "rgba(220, 228, 240, 0.55)";
      for (let i = 0; i < STARS.length; i++) {
        const s = STARS[i];
        const x = s.sx * w;
        const y = s.sy * h;
        const tw = reduce ? 0.55 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.1 + s.ph));
        ctx2d.globalAlpha = 0.35 * tw;
        ctx2d.fillRect(x, y, 1.1, 1.1);
      }
      ctx2d.globalAlpha = 1;

      const an = sourceAnalyser.current;
      if (!an) {
        // visualiser idles until first tap — the prompt overlay handles UX
        raf = requestAnimationFrame(draw);
        return;
      }

      const binCount = an.frequencyBinCount;            // fftSize / 2
      const freqBuf = new Uint8Array(binCount);
      const timeBuf = new Uint8Array(an.fftSize);
      an.getByteFrequencyData(freqBuf);
      an.getByteTimeDomainData(timeBuf);

      // ── 2. SPECTRUM BAND ──────────────────────────────────────────
      // NBINS bins, EMA-smoothed, filled polygon + line on top.
      if (!fftSmooth.current || fftSmooth.current.length !== NBINS) {
        fftSmooth.current = new Float32Array(NBINS);
      }
      const smoothed = fftSmooth.current;
      // resample binCount → NBINS by averaging chunks
      const chunk = Math.max(1, Math.floor(binCount / NBINS));
      for (let i = 0; i < NBINS; i++) {
        let sum = 0;
        let count = 0;
        const start = i * chunk;
        const end = Math.min(binCount, start + chunk);
        for (let j = start; j < end; j++) { sum += freqBuf[j]; count++; }
        const cur = count > 0 ? sum / count / 255 : 0; // 0..1
        smoothed[i] = 0.5 * smoothed[i] + 0.5 * cur;
      }

      const specBaseline = h * 0.34;
      const specMax = 120;

      // filled area underneath — additive feel via low-alpha amber→cyan
      ctx2d.beginPath();
      ctx2d.moveTo(0, specBaseline);
      const AMBER: [number, number, number] = [255, 180, 110];
      const CYAN:  [number, number, number] = [120, 200, 235];
      for (let i = 0; i < NBINS; i++) {
        const x = (i / (NBINS - 1)) * w;
        const y = specBaseline - smoothed[i] * specMax;
        ctx2d.lineTo(x, y);
      }
      ctx2d.lineTo(w, specBaseline);
      ctx2d.closePath();
      // single gradient fill spanning amber → cyan
      const specFill = ctx2d.createLinearGradient(0, 0, w, 0);
      specFill.addColorStop(0,    "rgba(255, 180, 110, 0.18)");
      specFill.addColorStop(0.5,  "rgba(190, 190, 175, 0.14)");
      specFill.addColorStop(1,    "rgba(120, 200, 235, 0.18)");
      ctx2d.fillStyle = specFill;
      ctx2d.fill();

      // line on top — segmented so each segment is its own amber→cyan stop
      ctx2d.lineWidth = 1.4;
      ctx2d.lineJoin = "round";
      for (let i = 0; i < NBINS - 1; i++) {
        const x1 = (i / (NBINS - 1)) * w;
        const x2 = ((i + 1) / (NBINS - 1)) * w;
        const y1 = specBaseline - smoothed[i] * specMax;
        const y2 = specBaseline - smoothed[i + 1] * specMax;
        const tt = i / (NBINS - 1);
        const [r, g, b] = mix(AMBER, CYAN, tt);
        ctx2d.strokeStyle = `rgba(${r.toFixed(0)}, ${g.toFixed(0)}, ${b.toFixed(0)}, 0.85)`;
        ctx2d.beginPath();
        ctx2d.moveTo(x1, y1);
        ctx2d.lineTo(x2, y2);
        ctx2d.stroke();
      }

      // ── 3. WAVEFORM BAND ──────────────────────────────────────────
      const waveY = h * 0.65;
      const waveAmp = Math.min(110, h * 0.10);

      // prune expired distortions, then sum the surviving ones at each x.
      distortionsRef.current = distortionsRef.current.filter(
        (d) => (now - d.t0) / 1000 < DISTORT_LIFE,
      );
      const dist = distortionsRef.current;
      // For each rendered sample, the distortion is a sum of gaussian-like
      // pulses centered on each injection x, falling off in space AND time.
      const SIGMA_X = 80;
      const distortAt = (px: number): number => {
        if (dist.length === 0) return 0;
        let acc = 0;
        for (const d of dist) {
          const u = (now - d.t0) / 1000 / DISTORT_LIFE; // 0..1
          const timeFall = 1 - u; // linear decay over lifetime
          const dx = px - d.x;
          const spaceFall = Math.exp(-(dx * dx) / (2 * SIGMA_X * SIGMA_X));
          acc += d.amount * timeFall * spaceFall;
        }
        return acc;
      };

      // glow underneath — fat, low-alpha pass
      ctx2d.strokeStyle = "rgba(244, 238, 222, 0.18)";
      ctx2d.lineWidth = 6;
      ctx2d.lineJoin = "round";
      ctx2d.beginPath();
      for (let i = 0; i < timeBuf.length; i++) {
        const x = (i / (timeBuf.length - 1)) * w;
        const v = (timeBuf[i] - 128) / 128; // -1..1
        const y = waveY + v * waveAmp + distortAt(x);
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      ctx2d.stroke();

      // crisp line — pale cream
      ctx2d.strokeStyle = "rgba(244, 238, 222, 0.85)";
      ctx2d.lineWidth = 1.3;
      ctx2d.beginPath();
      for (let i = 0; i < timeBuf.length; i++) {
        const x = (i / (timeBuf.length - 1)) * w;
        const v = (timeBuf[i] - 128) / 128;
        const y = waveY + v * waveAmp + distortAt(x);
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      ctx2d.stroke();

      // ── 4. NAUTILUS SPIRAL ────────────────────────────────────────
      // log spiral, ~6 turns. Each angle samples the time-domain buffer.
      const cx = w * 0.5;
      const cy = h * 0.5;
      const turns = 6;
      const thetaMax = turns * Math.PI * 2;
      const b = 0.18;
      // base scale so the outer turn nearly fills the smaller viewport axis
      const aBase = Math.min(w, h) * 0.42 / Math.exp(b * thetaMax);
      const SAMPLES = 1200; // dense path for smooth stroke
      const spiralAmp = Math.min(w, h) * 0.07;
      // outer-turn radius — used for hover hit-testing.
      const spiralR = aBase * Math.exp(b * thetaMax);

      // publish layout so the event handlers can hit-test against the same
      // numbers we just rendered (avoids any layout drift on resize).
      layoutRef.current = { waveY, waveAmp, spiralR, cx, cy };

      // advance the spiral rotation phase — slow drift, faster on hover
      if (!reduce) {
        const baseRate = 0.10;     // rad/sec
        const hoverRate = 0.42;    // rad/sec (~4x base)
        const rate = spiralHoverRef.current ? hoverRate : baseRate;
        spiralPhaseRef.current += rate * (1 / 60);
      }
      const phase = spiralPhaseRef.current;

      // segmented stroke for amber→cyan colouring along path length
      ctx2d.lineWidth = 1.6;
      ctx2d.lineCap = "round";
      ctx2d.lineJoin = "round";
      let prevX = 0;
      let prevY = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const u = i / (SAMPLES - 1);
        const theta = u * thetaMax + phase;
        // sample the time-domain buffer evenly along the spiral
        const sIdx = Math.min(timeBuf.length - 1, Math.floor(u * timeBuf.length));
        const samp = (timeBuf[sIdx] - 128) / 128; // -1..1
        const r = aBase * Math.exp(b * (u * thetaMax)) + samp * spiralAmp;
        const x = cx + Math.cos(theta) * r;
        const y = cy + Math.sin(theta) * r;
        if (i === 0) { prevX = x; prevY = y; continue; }
        const [rr, gg, bb] = mix(AMBER, CYAN, u);
        // outer turns slightly more visible than inner; hover brightens a bit
        const alpha = (0.30 + u * 0.55) * (spiralHoverRef.current ? 1.15 : 1);
        ctx2d.strokeStyle = `rgba(${rr.toFixed(0)}, ${gg.toFixed(0)}, ${bb.toFixed(0)}, ${Math.min(1, alpha).toFixed(3)})`;
        ctx2d.beginPath();
        ctx2d.moveTo(prevX, prevY);
        ctx2d.lineTo(x, y);
        ctx2d.stroke();
        prevX = x;
        prevY = y;
      }

      // a faint inner pip — gives the spiral a center
      ctx2d.fillStyle = "rgba(255, 200, 150, 0.55)";
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, 2.2, 0, Math.PI * 2);
      ctx2d.fill();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // cleanup mic on unmount
  useEffect(() => {
    return () => {
      try { micSource.current?.disconnect(); } catch { /* noop */ }
      try { micAnalyser.current?.disconnect(); } catch { /* noop */ }
      micStream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Play a soft sine tone at a given Hz for a duration. Used by the
  // spectrum-bar tap interaction so the user can "play" the spectrum.
  // Routes through the engine's AudioContext so it's audible alongside
  // anything else playing, and gets analysed for the visualiser.
  const playFreq = useCallback(async (freq: number, durSec = 0.3) => {
    const audio = getFieldAudio();
    await audio.start();
    if (audio.isMuted()) return;
    audio.playTone(freq, durSec);
  }, []);

  // ── canvas pointer handlers ─────────────────────────────────────────
  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const cv = e.currentTarget;
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { waveY, waveAmp, spiralR, cx, cy } = layoutRef.current;
      const h = window.innerHeight;
      const specBaseline = h * 0.34;

      // ── spectrum bar tap (upper band) ──
      // Bars rise upward from specBaseline. Treat the whole region above the
      // baseline (with a tiny grace below) as tappable.
      if (y < specBaseline + 12) {
        const u = Math.max(0, Math.min(1, x / window.innerWidth));
        const bin = Math.floor(u * NBINS);
        // Map bin → frequency using the analyser's actual sample rate so the
        // tone matches what that bar is showing.
        const an = sourceAnalyser.current;
        if (an) {
          const c = getFieldAudio().getAudioContext();
          if (c) {
            const trueBin = u * an.frequencyBinCount;
            const freq = (trueBin * c.sampleRate) / an.fftSize;
            void playFreq(Math.max(60, Math.min(6000, freq)));
            return;
          }
        }
        // fallback when the analyser/context isn't ready yet — pleasant
        // pentatonic shape so the page still feels alive on first tap.
        const fallback = [220, 277, 330, 415, 494, 587, 698][bin % 7];
        void playFreq(fallback);
        return;
      }

      // ── waveform drag start (narrow horizontal band) ──
      if (waveAmp > 0 && Math.abs(y - waveY) < waveAmp + 14) {
        cv.setPointerCapture(e.pointerId);
        wavePointerId.current = e.pointerId;
        lastDragYRef.current = y;
        return;
      }

      // ── spiral click → bell swell.
      // The outer half of the spiral overlaps the spectrum + waveform bands,
      // so only the inner ~55% of the spiral's radius triggers the click.
      // The hover affordance still uses the full radius (see pointermove).
      const dRadius = Math.hypot(x - cx, y - cy);
      if (dRadius < spiralR * 0.55 && dRadius > spiralR * 0.05) {
        try { getFieldAudio().bell(); } catch { /* noop */ }
      }
    },
    [playFreq],
  );

  const onCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const cv = e.currentTarget;
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { spiralR, cx, cy, waveAmp } = layoutRef.current;

      // spiral hover state — match the click hit-test (inner core only).
      // The outer turns overlap the spectrum/waveform bands and we don't
      // want to claim those clicks visually with a cursor change.
      const dRadius = Math.hypot(x - cx, y - cy);
      setSpiralHover(dRadius < spiralR * 0.55 && dRadius > spiralR * 0.05);

      // active drag: inject a distortion proportional to the vertical delta
      if (wavePointerId.current === e.pointerId && waveAmp > 0) {
        const lastY = lastDragYRef.current ?? y;
        const dy = y - lastY;
        if (Math.abs(dy) > 0.5) {
          // signed amount clamped to ±waveAmp so the displacement stays in
          // the band visually.
          const amount = Math.max(-waveAmp, Math.min(waveAmp, dy * 3));
          distortionsRef.current.push({
            x,
            amount,
            t0: performance.now(),
          });
          // limit the buffer — keep last 80 only
          if (distortionsRef.current.length > 80) {
            distortionsRef.current = distortionsRef.current.slice(-80);
          }
          // throttled chime so it doesn't machine-gun on fast drags
          const now = performance.now();
          if (now - lastChimeAt.current > 140) {
            lastChimeAt.current = now;
            try { getFieldAudio().chime(); } catch { /* noop */ }
          }
          lastDragYRef.current = y;
        }
        // suppress the parent's onClick start handler
        e.stopPropagation();
      }
    },
    [],
  );

  const onCanvasPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (wavePointerId.current === e.pointerId) {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
        wavePointerId.current = null;
        lastDragYRef.current = null;
      }
    },
    [],
  );

  const onCanvasPointerLeave = useCallback(() => {
    setSpiralHover(false);
  }, []);

  const showTapPrompt = !audioStarted && !micActive;

  return (
    <div
      onClick={() => {
        // tapping anywhere starts the audio context if it hasn't been started
        if (!audioStarted) void ensureAudio();
      }}
      data-touch-surface="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a1322",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-label="signal — a real-time visualisation of the room's sound"
        onPointerDown={(e) => {
          // Stop propagation so the wrapper div's "tap to start audio" click
          // doesn't double-fire alongside our interactive layer.
          e.stopPropagation();
          if (!audioStarted) void ensureAudio();
          onCanvasPointerDown(e);
        }}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
        onPointerLeave={onCanvasPointerLeave}
        style={{
          display: "block",
          width: "100vw",
          height: "100vh",
          touchAction: "none",
          cursor: spiralHover ? "pointer" : "crosshair",
        }}
      />

      {/* caption — top center */}
      <div
        style={{
          position: "fixed",
          top: 92,
          left: 0,
          right: 0,
          textAlign: "center",
          pointerEvents: "none",
          color: "rgba(244, 238, 222, 0.92)",
        }}
      >
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "lowercase",
            opacity: 0.62,
            marginBottom: 10,
          }}
        >
          the room is making sound
        </div>
        <WaterText
          as="h1"
          bobAmp={0}
          style={{
            display: "block",
            margin: 0,
            fontFamily: "var(--font-numerals)",
            fontWeight: 300,
            fontSize: "clamp(40px, 7vw, 92px)",
            lineHeight: 1.0,
            letterSpacing: "-0.02em",
          }}
        >
          SIGNAL
        </WaterText>
      </div>

      {/* play button — large center prompt when nothing is playing yet */}
      {showTapPrompt && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void onTapToListen();
          }}
          aria-label="tap to listen"
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 132,
            height: 132,
            borderRadius: "50%",
            border: "1px solid rgba(244, 238, 222, 0.55)",
            background: "rgba(10, 19, 34, 0.55)",
            color: "rgba(244, 238, 222, 0.96)",
            fontFamily: "var(--font-text)",
            fontSize: 12,
            letterSpacing: "0.16em",
            textTransform: "lowercase",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            zIndex: 5,
          }}
        >
          tap to listen
        </button>
      )}

      {/* compose progress — only when composing */}
      {composing && composeMeta && (
        <div
          className="signal-compose-progress"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: "calc(128px + env(safe-area-inset-bottom))",
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              padding: "10px 22px",
              border: "1px solid rgba(244, 238, 222, 0.20)",
              borderRadius: 12,
              background: "rgba(10, 19, 34, 0.65)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
              color: "rgba(244, 238, 222, 0.92)",
              minWidth: 260,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                width: "100%",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 14,
                letterSpacing: "0.02em",
                color: "rgba(244, 238, 222, 0.82)",
              }}
            >
              <span>{composeMeta.scale}</span>
              <span>{composeMeta.tempo} bpm</span>
            </div>
            <div
              style={{
                width: 240,
                height: 2,
                background: "rgba(244, 238, 222, 0.18)",
                borderRadius: 2,
                overflow: "hidden",
              }}
              aria-label={`composition progress ${Math.round(composeProgress * 100)} percent`}
            >
              <div
                style={{
                  width: `${composeProgress * 100}%`,
                  height: "100%",
                  background:
                    "linear-gradient(90deg, rgba(255,180,110,0.85), rgba(120,200,235,0.85))",
                  transition: "width 120ms linear",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* compact footer rail — empty space remains click-through so the
          canvas stays playable above and around the controls. */}
      <div
        className="signal-footer"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: "calc(58px + env(safe-area-inset-bottom))",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "0 14px",
          pointerEvents: "none",
          zIndex: 20,
        }}
      >
        {!composing && (
          <div
            className="signal-prompt-panel"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              width: "min(560px, calc(100vw - 28px))",
              pointerEvents: "none",
            }}
          >
          <form
            className="signal-prompt-form"
            onSubmit={submitPrompt}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.stopPropagation();
              submitPrompt(e);
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            style={{
              pointerEvents: "auto",
              position: "relative",
              width: "100%",
            }}
          >
            <input
              type="text"
              inputMode="text"
              enterKeyHint="send"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              name="prompt"
              value={promptText}
              onChange={(e) => updatePromptText(e.target.value)}
              placeholder="describe the music — slow, dark, bells, rain…"
              aria-label="describe the music"
              className="signal-prompt-input"
              style={{
                width: "100%",
                boxSizing: "border-box",
                minHeight: 46,
                padding: "12px 58px 12px 20px",
                borderRadius: 24,
                border: "1px solid rgba(244, 238, 222, 0.62)",
                background: "rgba(7, 15, 27, 0.88)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                color: "rgba(244, 238, 222, 0.96)",
                textAlign: "left",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                // 16px prevents iOS from auto-zooming on focus
                fontSize: 16,
                outline: "none",
                letterSpacing: "0.005em",
                boxShadow: "0 0 0 1px rgba(120, 200, 235, 0.14), 0 10px 26px rgba(0, 0, 0, 0.28)",
              }}
            />
            <button
              type="submit"
              aria-label="compose prompt"
              title="compose prompt"
              className="signal-prompt-submit"
              style={{
                position: "absolute",
                top: "50%",
                right: 6,
                transform: "translateY(-50%)",
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "1px solid rgba(120, 200, 235, 0.45)",
                background: "rgba(120, 200, 235, 0.16)",
                color: "rgba(244, 238, 222, 0.96)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-text)",
                fontSize: 17,
                lineHeight: 1,
                cursor: "pointer",
                transition: "background 180ms ease, border-color 180ms ease, transform 180ms ease",
              }}
            >
              <span aria-hidden="true">↵</span>
            </button>
          </form>
          {/* parsed-modifier chips */}
          {promptChips.length > 0 && (
            <div
              className="signal-prompt-chips"
              style={{
                display: "flex",
                flexWrap: "nowrap",
                justifyContent: "flex-start",
                gap: 6,
                width: "100%",
                maxWidth: "100%",
                overflowX: "auto",
                paddingBottom: 1,
                scrollbarWidth: "none",
                pointerEvents: "auto",
              }}
            >
              {promptChips.map((chip) => (
                <span
                  key={chip}
                  className="t-mono"
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid rgba(244, 238, 222, 0.20)",
                    background: "rgba(10, 19, 34, 0.45)",
                    color: "rgba(244, 238, 222, 0.78)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
          {/* always-end-with-the-sea toggle */}
          <label
            className="signal-coda-toggle"
            onClick={(e) => e.stopPropagation()}
            style={{
              pointerEvents: "auto",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 2,
              minHeight: 44,
              padding: "0 8px",
              fontFamily: "var(--font-text)",
              fontSize: 11,
              letterSpacing: "0.10em",
              textTransform: "lowercase",
              color: "rgba(244, 238, 222, 0.72)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={oceanicCoda}
              onChange={(e) => setOceanicCoda(e.target.checked)}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                accentColor: "rgba(120, 200, 235, 0.85)",
                cursor: "pointer",
              }}
            />
            always end with the sea
          </label>
          </div>
        )}

        {/* control rail — compact and horizontally scrollable if the viewport
            is too narrow for every control to fit at 44px touch size. */}
        <div
          className="signal-control-rail"
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
        <div
          className="signal-control-cluster"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: "min(640px, calc(100vw - 28px))",
            minHeight: 52,
            overflowX: "auto",
            overflowY: "hidden",
            padding: "4px 8px",
            border: "1px solid rgba(244, 238, 222, 0.20)",
            borderRadius: 26,
            background: "rgba(10, 19, 34, 0.55)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            color: "rgba(244, 238, 222, 0.92)",
            pointerEvents: "auto",
            fontFamily: "var(--font-text)",
            fontSize: 12,
            letterSpacing: "0.06em",
            textTransform: "lowercase",
            scrollbarWidth: "none",
          }}
        >
          {/* compose — generative music, the centerpiece */}
          {!composing ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void startCompose(); }}
              aria-label="compose generative music from your field"
              style={{
                ...controlBtn(false),
                padding: "8px 18px",
                fontWeight: 500,
                letterSpacing: "0.14em",
                border: "1px solid rgba(255, 180, 110, 0.55)",
                background: "rgba(200, 115, 42, 0.10)",
              }}
            >
              <span aria-hidden="true" style={{ marginRight: 8, opacity: 0.8 }}>♪</span>
              compose
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); stopCompose(); }}
              aria-label="stop the composition"
              style={{
                ...controlBtn(true),
                padding: "8px 18px",
                letterSpacing: "0.14em",
              }}
            >
              <span aria-hidden="true" style={{ marginRight: 8, opacity: 0.85 }}>■</span>
              stop
            </button>
          )}

          <span className="signal-control-separator" style={{ opacity: 0.30 }}>·</span>

          {/* play / phrase dial */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); cycleDial(); }}
            aria-label={`play a phrase — currently ${PHRASES[phraseIdx].name}`}
            style={controlBtn(playing)}
          >
            <span aria-hidden="true" style={{ marginRight: 8, opacity: 0.7 }}>
              {playing ? "◉" : "▶"}
            </span>
            phrase · {PHRASES[phraseIdx].name}
          </button>

          <span className="signal-control-separator" style={{ opacity: 0.30 }}>·</span>

          {/* mic toggle — when active, a small pulsing amber dot announces
              the mic is live; when inactive, an "internal" label notes that
              we're analysing the engine's own output. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void toggleMic(); }}
            aria-pressed={micActive}
            aria-label={micActive ? "stop microphone visualisation" : "visualise microphone"}
            style={{ ...controlBtn(micActive), position: "relative" }}
          >
            <span aria-hidden="true" style={{ marginRight: 8, opacity: 0.75 }}>
              {micActive ? "●" : "○"}
            </span>
            mic
            {micActive ? (
              <span
                aria-hidden="true"
                className="signal-mic-dot"
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "rgba(255, 180, 110, 0.95)",
                  boxShadow: "0 0 6px rgba(255, 180, 110, 0.85)",
                }}
              />
            ) : (
              <span
                aria-hidden="true"
                style={{
                  marginLeft: 8,
                  opacity: 0.55,
                  fontStyle: "italic",
                  fontSize: 11,
                  letterSpacing: "0.04em",
                }}
              >
                internal
              </span>
            )}
          </button>

          {micError && (
            <span style={{ opacity: 0.7, fontStyle: "italic", marginLeft: 6 }}>
              {micError}
            </span>
          )}
        </div>
      </div>
      </div>

      <style>{`
        @keyframes signal-mic-dot-pulse {
          0%, 100% { opacity: 0.95; transform: scale(1); }
          50%      { opacity: 0.45; transform: scale(0.78); }
        }
        .signal-mic-dot { animation: signal-mic-dot-pulse 1.6s ease-in-out infinite; }
        .signal-prompt-input::placeholder { color: rgba(244, 238, 222, 0.62); }
        .signal-prompt-input:focus {
          border-color: rgba(120, 200, 235, 0.86) !important;
          box-shadow: 0 0 0 3px rgba(120, 200, 235, 0.16), 0 12px 30px rgba(0, 0, 0, 0.34) !important;
        }
        .signal-prompt-submit:hover,
        .signal-prompt-submit:focus-visible {
          border-color: rgba(120, 200, 235, 0.82) !important;
          background: rgba(120, 200, 235, 0.26) !important;
        }
        .signal-prompt-submit:active {
          transform: translateY(-50%) scale(0.96) !important;
        }
        .signal-control-cluster::-webkit-scrollbar,
        .signal-prompt-chips::-webkit-scrollbar {
          display: none;
        }
        @media (max-width: 620px) {
          .signal-footer {
            gap: 6px !important;
            bottom: calc(58px + env(safe-area-inset-bottom)) !important;
            padding: 0 10px !important;
          }
          .signal-compose-progress {
            bottom: calc(178px + env(safe-area-inset-bottom)) !important;
          }
          .signal-prompt-panel {
            width: calc(100vw - 20px) !important;
          }
          .signal-prompt-input {
            padding-left: 16px !important;
            padding-right: 54px !important;
          }
          .signal-prompt-submit {
            right: 6px !important;
          }
          .signal-control-cluster {
            max-width: calc(100vw - 20px) !important;
            flex-wrap: wrap !important;
            justify-content: center !important;
            border-radius: 18px !important;
            padding: 5px 8px !important;
          }
          .signal-control-separator {
            display: none !important;
          }
          .signal-control-cluster button {
            padding-left: 12px !important;
            padding-right: 12px !important;
          }
          .signal-bottom-inscription {
            bottom: calc(286px + env(safe-area-inset-bottom)) !important;
            font-size: 14px !important;
            opacity: 0.66;
          }
        }
        @media (max-height: 720px) {
          .signal-footer {
            bottom: calc(48px + env(safe-area-inset-bottom)) !important;
            gap: 5px !important;
          }
          .signal-coda-toggle {
            min-height: 34px !important;
          }
          .signal-control-cluster {
            min-height: 48px !important;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .signal-mic-dot { animation: none; }
        }
      `}</style>

      {/* bottom inscription */}
      <WaterText
        as="div"
        bobAmp={2}
        className="signal-bottom-inscription"
        style={{
          display: "block",
          position: "fixed",
          left: 0,
          right: 0,
          bottom: "calc(236px + env(safe-area-inset-bottom))",
          textAlign: "center",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 16,
          color: "rgba(242, 238, 230, 0.55)",
          pointerEvents: "none",
          letterSpacing: "0.005em",
          zIndex: 3,
        }}
      >
        music is also waves.
      </WaterText>
    </div>
  );
}

function controlBtn(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? "rgba(255, 180, 110, 0.70)" : "rgba(244, 238, 222, 0.30)"}`,
    background: active ? "rgba(200, 115, 42, 0.18)" : "transparent",
    color: "inherit",
    padding: "6px 12px",
    minHeight: 44,
    borderRadius: 999,
    fontFamily: "var(--font-text)",
    fontSize: 12,
    letterSpacing: "0.06em",
    textTransform: "lowercase",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    whiteSpace: "nowrap",
    transition: "background 240ms, border-color 240ms",
  };
}
