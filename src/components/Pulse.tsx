"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";

/**
 * /pulse - embodied rhythm instrument.
 *
 * Four physiological oscillators feed a full-screen membrane: heart, breath,
 * pressure, and mind. Touches add pressure blooms, the shock control briefly
 * collapses every channel, and generated patterns orbit the body as a fifth
 * rhythm that can be saved and shared through the URL hash.
 */

const BUFFER_LEN = 720;
const SAMPLE_HZ = 60;
const PATTERN_LEN = 1800;
const PATTERN_KEY = "objetdart:patterns:v1";

const CHANNEL_KEYS = ["hr", "breath", "bp", "brain"] as const;
const PATTERN_KINDS = ["tide", "wave", "seismic", "breath", "storm"] as const;

type ChannelKey = (typeof CHANNEL_KEYS)[number];
type PatternKind = (typeof PATTERN_KINDS)[number];

type Channel = {
  key: ChannelKey;
  label: string;
  readoutLabel: string;
  tone: string;
  midi: number;
  buffer: Float32Array;
  cursor: number;
};

type SavedPattern = {
  name: string;
  kind: PatternKind;
  seed: number;
  createdAt: number;
};

type PatternState = {
  kind: PatternKind;
  seed: number;
  samples: Float32Array;
};

type TouchBloom = {
  x: number;
  y: number;
  born: number;
  life: number;
  strength: number;
  hue: string;
};

type MeterState = {
  hr: number;
  breath: number;
  bp: string;
  brain: string;
  tension: number;
};

const CHANNEL_META: Record<ChannelKey, Omit<Channel, "buffer" | "cursor">> = {
  hr: { key: "hr", label: "heart", readoutLabel: "heart", tone: "#ff5d73", midi: 48 },
  breath: { key: "breath", label: "breath", readoutLabel: "breath", tone: "#58d9c8", midi: 57 },
  bp: { key: "bp", label: "pressure", readoutLabel: "pressure", tone: "#f2bf62", midi: 43 },
  brain: { key: "brain", label: "mind", readoutLabel: "mind", tone: "#b994ff", midi: 69 },
};

const PATTERN_COLORS: Record<PatternKind, string> = {
  tide: "#64c7ff",
  wave: "#64e0b7",
  seismic: "#f89a58",
  breath: "#d2b7ff",
  storm: "#ff6c81",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function colorAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean.length === 3
    ? clean.split("").map((ch) => ch + ch).join("")
    : clean, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17; s >>>= 0;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 0xffffffff;
  };
}

function generatePattern(kind: PatternKind, seed: number): Float32Array {
  const out = new Float32Array(PATTERN_LEN);
  const r = rng(seed);
  switch (kind) {
    case "tide": {
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
      for (let i = 0; i < PATTERN_LEN; i++) {
        const t = i / SAMPLE_HZ;
        const env = 0.6 + 0.4 * Math.sin(t * (Math.PI * 2 / 7));
        out[i] = Math.sin(t * (Math.PI * 2 / 2.4)) * env + (r() - 0.5) * 0.06;
      }
      return out;
    }
    case "seismic": {
      let val = 0;
      let nextQuake = 80 + Math.floor(r() * 200);
      let quakeI = 0;
      for (let i = 0; i < PATTERN_LEN; i++) {
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
        out[i] = clamp(val, -1, 1);
      }
      return out;
    }
    case "breath": {
      const cycle = 8 * SAMPLE_HZ;
      for (let i = 0; i < PATTERN_LEN; i++) {
        const u = (i % cycle) / cycle;
        let v: number;
        if (u < 0.3) v = -Math.cos((u / 0.3) * Math.PI);
        else if (u < 0.5) v = 1;
        else v = Math.cos(((u - 0.5) / 0.5) * Math.PI);
        out[i] = v * 0.85 + (r() - 0.5) * 0.03;
      }
      return out;
    }
    case "storm": {
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
        out[i] = clamp(v, -1, 1);
      }
      return out;
    }
  }
}

function makePattern(kind: PatternKind, seed = Math.floor(Math.random() * 0xffffffff)): PatternState {
  return { kind, seed, samples: generatePattern(kind, seed) };
}

function isPatternKind(value: string): value is PatternKind {
  return (PATTERN_KINDS as readonly string[]).includes(value);
}

function isSavedPattern(value: unknown): value is SavedPattern {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedPattern>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    typeof candidate.kind === "string" &&
    isPatternKind(candidate.kind) &&
    typeof candidate.seed === "number" &&
    Number.isFinite(candidate.seed) &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt)
  );
}

function makeChannels(): Record<ChannelKey, Channel> {
  return {
    hr: { ...CHANNEL_META.hr, buffer: new Float32Array(BUFFER_LEN), cursor: 0 },
    breath: { ...CHANNEL_META.breath, buffer: new Float32Array(BUFFER_LEN), cursor: 0 },
    bp: { ...CHANNEL_META.bp, buffer: new Float32Array(BUFFER_LEN), cursor: 0 },
    brain: { ...CHANNEL_META.brain, buffer: new Float32Array(BUFFER_LEN), cursor: 0 },
  };
}

export default function Pulse() {
  useEffect(() => { getFieldAudio().setAmbientProfile("monitor", { fadeSec: 0.8 }); }, []);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bloomsRef = useRef<TouchBloom[]>([]);
  const touchImpulseRef = useRef(0);
  const pointerRef = useRef({ active: false, id: -1, x: 0, y: 0, startX: 0, startY: 0, lastNote: 0 });
  const reduceMotionRef = useRef(false);
  const shockRef = useRef({ until: 0, armedBell: false, energy: 0 });
  const timersRef = useRef<number[]>([]);

  const [hr, setHr] = useState(72);
  const [breathRate, setBreathRate] = useState(13);
  const [stress, setStress] = useState(0.24);
  const [defibActive, setDefibActive] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState<Record<ChannelKey, boolean>>({
    hr: false,
    breath: false,
    bp: false,
    brain: false,
  });
  const [pattern, setPattern] = useState<PatternState>(() => makePattern("tide"));
  const [patternName, setPatternName] = useState("");
  const [saved, setSaved] = useState<SavedPattern[]>([]);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [meter, setMeter] = useState<MeterState>({
    hr: 72,
    breath: 13,
    bp: "118/76",
    brain: "alpha",
    tension: 24,
  });

  const hrRef = useRef(hr);
  const breathRef = useRef(breathRate);
  const stressRef = useRef(stress);
  const audioRef = useRef(audioEnabled);
  const patternRef = useRef(pattern);
  const channelsRef = useRef<Record<ChannelKey, Channel>>(makeChannels());
  const recordTape = useField((s) => s.recordTape);

  useEffect(() => { hrRef.current = hr; }, [hr]);
  useEffect(() => { breathRef.current = breathRate; }, [breathRate]);
  useEffect(() => { stressRef.current = stress; }, [stress]);
  useEffect(() => { audioRef.current = audioEnabled; }, [audioEnabled]);
  useEffect(() => { patternRef.current = pattern; }, [pattern]);
  useEffect(() => () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, delay: number) => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((timerId) => timerId !== id);
      fn();
    }, delay);
    timersRef.current.push(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const update = () => {
      reduceMotionRef.current = mq.matches;
    };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PATTERN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) setSaved(parsed.filter(isSavedPattern).slice(0, 30));
      }
    } catch { /* localStorage may be unavailable */ }

    if (!window.location.hash.startsWith("#p=")) return;
    try {
      const payload = JSON.parse(atob(window.location.hash.slice(3))) as {
        kind?: string;
        seed?: number;
        hr?: number;
        br?: number;
        stress?: number;
      };
      if (payload.kind && isPatternKind(payload.kind) && typeof payload.seed === "number") {
        setPattern(makePattern(payload.kind, payload.seed));
      }
      if (typeof payload.hr === "number") setHr(clamp(Math.round(payload.hr), 40, 180));
      if (typeof payload.br === "number") setBreathRate(clamp(Math.round(payload.br), 6, 30));
      if (typeof payload.stress === "number") setStress(clamp(payload.stress, 0, 1));
    } catch { /* malformed shares are ignored */ }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const channels = channelsRef.current;
    const render = {
      lastT: performance.now(),
      time: 0,
      beatAt: 0,
      qrs: 1,
      beatGlow: 0,
      breathPhase: 0,
      bpFast: 0,
      bpDrift: 0,
      brain: 0,
      brainBurstUntil: 0,
      patternCursor: 0,
      touchEnergy: 0,
      lastReadout: 0,
    };

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(root);
    window.addEventListener("resize", resize);

    let raf = 0;
    const draw = (now: number) => {
      const rawDt = Math.min(0.08, (now - render.lastT) / 1000);
      render.lastT = now;
      const reduce = reduceMotionRef.current;
      const dt = reduce ? rawDt * 0.18 : rawDt;
      render.time += dt;

      const rect = root.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const mobile = w < 720;
      const stressV = stressRef.current;
      const shock = shockRef.current;
      const inShock = now < shock.until;

      if (touchImpulseRef.current > 0) {
        render.touchEnergy = clamp(render.touchEnergy + touchImpulseRef.current, 0, 2.2);
        touchImpulseRef.current = 0;
      }
      render.touchEnergy *= Math.pow(0.012, rawDt / 2.4);
      shock.energy = Math.max(inShock ? 1 : 0, shock.energy * Math.pow(0.02, rawDt / 1.45));

      const effectiveHr = clamp(hrRef.current * (1 + stressV * 0.16) + render.touchEnergy * 9, 38, 220);
      const period = 60 / effectiveHr;
      const sinceBeat = (now - render.beatAt) / 1000;
      const variance = 0.028 + stressV * 0.11 + render.touchEnergy * 0.012;
      const wobble = (Math.sin(now * 0.0021) * 0.55 + Math.sin(now * 0.0013) * 0.45) * variance;

      if (!inShock && sinceBeat >= period * (1 + wobble)) {
        render.beatAt = now;
        render.qrs = 0;
        render.beatGlow = 1;
        if (audioRef.current.hr) {
          try { getFieldAudio().playNote(48 + Math.round(stressV * 12), 42); } catch { /* noop */ }
        }
      }
      if (render.qrs < 1) render.qrs = Math.min(1, render.qrs + dt / 0.45);
      render.beatGlow *= Math.pow(0.03, rawDt / 0.9);

      const breathHz = clamp((breathRef.current * (1 + stressV * 0.22) + render.touchEnergy * 1.2) / 60, 0.05, 0.9);
      const previousBreath = Math.sin(render.breathPhase);
      render.breathPhase += dt * Math.PI * 2 * (breathHz + Math.sin(now * 0.0011) * stressV * 0.025);
      const breathNow = Math.sin(render.breathPhase);
      if (!inShock && audioRef.current.breath && breathNow > 0.985 && previousBreath <= 0.985) {
        try { getFieldAudio().chime(); } catch { /* noop */ }
      }

      render.bpFast += dt * Math.PI * 2 * (effectiveHr / 60);
      render.bpDrift += dt * Math.PI * 2 * 0.072;
      if (!inShock && audioRef.current.bp && Math.sin(render.bpFast) > 0.994 && Math.sin(render.bpFast - dt * Math.PI * 2 * (effectiveHr / 60)) <= 0.994) {
        try { getFieldAudio().playNote(42, 36); } catch { /* noop */ }
      }

      if (!inShock && now > render.brainBurstUntil && Math.random() < 0.008 + stressV * 0.017 + render.touchEnergy * 0.002) {
        render.brainBurstUntil = now + 260 + Math.random() * 520;
        if (audioRef.current.brain) {
          try { getFieldAudio().spark(); } catch { /* noop */ }
        }
      }
      const burst = now < render.brainBurstUntil ? 1 : 0;
      const alpha = Math.sin(now * 0.061) * Math.sin(now * 0.079) * 0.55;
      const beta = Math.sin(now * 0.18 + render.touchEnergy) * 0.28;
      const noise = (Math.random() - 0.5) * (0.42 + stressV * 0.52);
      const brainTarget = (alpha + beta + noise) * (0.56 + stressV * 0.54 + burst * 0.38);
      render.brain = render.brain * 0.58 + brainTarget * 0.42;

      const patternNow = patternRef.current;
      render.patternCursor = (render.patternCursor + (reduce ? 1 : 2)) % patternNow.samples.length;
      const patternSample = patternNow.samples[render.patternCursor] ?? 0;

      pushSample(channels.hr, inShock ? 0 : qrstSample(render.qrs) + render.touchEnergy * 0.035);
      pushSample(channels.breath, inShock ? 0 : breathNow * (0.74 + render.touchEnergy * 0.08));
      const bpPulse = Math.max(0, Math.sin(render.bpFast)) ** 1.7;
      const bpDrift = Math.sin(render.bpDrift) * 0.24;
      pushSample(channels.bp, inShock ? 0 : bpPulse * 0.78 + bpDrift - 0.34 + render.touchEnergy * 0.025);
      pushSample(channels.brain, inShock ? 0 : clamp(render.brain + patternSample * 0.06, -1, 1));

      drawBackground(ctx, w, h, render.time, stressV, render.touchEnergy, shock.energy, reduce);
      const center = {
        x: w * (mobile ? 0.5 : 0.51),
        y: h * (mobile ? 0.43 : 0.49),
      };
      const baseR = Math.min(w, h) * (mobile ? 0.255 : 0.30);
      drawMembrane(ctx, center.x, center.y, baseR, render.time, render.beatGlow, stressV, render.touchEnergy, shock.energy, reduce);
      drawPatternOrbit(ctx, patternNow.samples, render.patternCursor, patternNow.kind, center.x, center.y, baseR * 1.38, render.time, reduce);

      const rings = [
        { key: "hr" as const, radius: baseR * 0.58, amp: baseR * 0.22, squash: 0.72, start: -0.90, span: 1.78 },
        { key: "breath" as const, radius: baseR * 0.83, amp: baseR * 0.16, squash: 0.69, start: -0.78, span: 1.55 },
        { key: "bp" as const, radius: baseR * 1.06, amp: baseR * 0.13, squash: 0.66, start: -0.84, span: 1.68 },
        { key: "brain" as const, radius: baseR * 1.24, amp: baseR * 0.12, squash: 0.63, start: -0.86, span: 1.74 },
      ];

      for (const ring of rings) {
        drawOrbitTrace(
          ctx,
          channels[ring.key],
          center.x,
          center.y,
          ring.radius,
          ring.amp,
          ring.squash,
          ring.start * Math.PI,
          ring.span * Math.PI,
          render.time,
          audioRef.current[ring.key],
          inShock,
          reduce,
        );
      }

      drawTouchBlooms(ctx, bloomsRef.current, now, reduce);
      drawNeedle(ctx, center.x, center.y, baseR, render.time, patternSample, render.beatGlow, shock.energy);

      if (shock.armedBell && now > shock.until + 120) {
        shock.armedBell = false;
        try { getFieldAudio().bell(); } catch { /* noop */ }
      }

      if (now - render.lastReadout > 220) {
        render.lastReadout = now;
        const sysBase = 104 + stressV * 45 + render.touchEnergy * 4;
        const sys = Math.round(sysBase + bpPulse * 20 + bpDrift * 8);
        const dia = Math.round(sysBase * 0.64 + bpDrift * 6);
        setMeter({
          hr: Math.round(effectiveHr),
          breath: Math.round(breathRef.current * (1 + stressV * 0.14)),
          bp: `${sys}/${dia}`,
          brain: inShock ? "flat" : burst ? "gamma" : stressV > 0.66 ? "beta" : "alpha",
          tension: Math.round(stressV * 100),
        });
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  const addBloom = useCallback((clientX: number, clientY: number, strength = 1, meta = "touch") => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    const xPct = rect.width > 0 ? x / rect.width : 0.5;
    const yPct = rect.height > 0 ? y / rect.height : 0.5;
    const kind = patternRef.current.kind;
    const hue = PATTERN_COLORS[kind];
    const now = performance.now();

    bloomsRef.current.push({
      x,
      y,
      born: now,
      life: 1500 + strength * 1100,
      strength,
      hue,
    });
    if (bloomsRef.current.length > 34) {
      bloomsRef.current.splice(0, bloomsRef.current.length - 34);
    }
    touchImpulseRef.current = clamp(touchImpulseRef.current + 0.18 + strength * 0.42, 0, 1.8);

    if (now - pointerRef.current.lastNote > 86) {
      pointerRef.current.lastNote = now;
      try {
        const note = 42 + Math.round((1 - yPct) * 25) + Math.round(xPct * 7);
        getFieldAudio().playNote(note, 76 + Math.round(strength * 70));
      } catch { /* noop */ }
      try { haptics.ripple(0.28 + strength * 0.34); } catch { /* noop */ }
      recordTape("ripple", clamp(0.28 + strength * 0.48, 0, 1), `pulse/${meta}`);
    }
  }, [recordTape]);

  const onCanvasPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
    void getFieldAudio().start();
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current.active = true;
    pointerRef.current.id = event.pointerId;
    pointerRef.current.x = event.clientX;
    pointerRef.current.y = event.clientY;
    pointerRef.current.startX = event.clientX - rect.left;
    pointerRef.current.startY = event.clientY - rect.top;
    addBloom(event.clientX, event.clientY, 1.05, "press");
  }, [addBloom]);

  const onCanvasPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current;
    if (!pointer.active || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    const distance = Math.hypot(dx, dy);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (distance < 9) return;
    addBloom(event.clientX, event.clientY, clamp(distance / 54, 0.28, 1.18), "shear");
  }, [addBloom]);

  const clearPointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current;
    if (pointer.id === event.pointerId) {
      pointer.active = false;
      pointer.id = -1;
    }
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
  }, []);

  const toggleAudio = useCallback((key: ChannelKey) => {
    void getFieldAudio().start();
    setAudioEnabled((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        if (next[key]) getFieldAudio().playNote(CHANNEL_META[key].midi + 12, 120);
        else getFieldAudio().thud();
      } catch { /* noop */ }
      try { haptics.tap(); } catch { /* noop */ }
      recordTape("sigil", next[key] ? 0.55 : 0.28, `pulse/${key}/${next[key] ? "listen" : "mute"}`);
      return next;
    });
  }, [recordTape]);

  const onDefibrillate = useCallback(() => {
    void getFieldAudio().start();
    const now = performance.now();
    shockRef.current = { until: now + 2050, armedBell: true, energy: 1 };
    setDefibActive(true);
    bloomsRef.current.push({
      x: (canvasRef.current?.clientWidth ?? window.innerWidth) * 0.5,
      y: (canvasRef.current?.clientHeight ?? window.innerHeight) * 0.5,
      born: now,
      life: 2500,
      strength: 1.8,
      hue: "#fff1d0",
    });
    try { getFieldAudio().thud(); } catch { /* noop */ }
    try { haptics.storm(); } catch { /* noop */ }
    recordTape("ripple", 1, "pulse/shock");
    schedule(() => setDefibActive(false), 2180);
  }, [recordTape, schedule]);

  const onPatternKind = useCallback((kind: PatternKind) => {
    void getFieldAudio().start();
    setPattern((prev) => makePattern(kind, prev.seed));
    try { getFieldAudio().playNote(55 + PATTERN_KINDS.indexOf(kind) * 3, 110); } catch { /* noop */ }
    recordTape("object", 0.38, `pulse/pattern/${kind}`);
  }, [recordTape]);

  const onGenerate = useCallback(() => {
    void getFieldAudio().start();
    setPattern((prev) => makePattern(prev.kind));
    touchImpulseRef.current = clamp(touchImpulseRef.current + 0.9, 0, 1.8);
    try {
      getFieldAudio().spark();
      schedule(() => {
        try { getFieldAudio().playNote(67, 120); } catch { /* noop */ }
      }, 90);
    } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    recordTape("sigil", 0.68, `pulse/generate/${patternRef.current.kind}`);
  }, [recordTape, schedule]);

  const onSavePattern = useCallback(() => {
    const name = (patternName || `${pattern.kind}-${Date.now().toString(36).slice(-4)}`).trim().slice(0, 32);
    const entry: SavedPattern = { name, kind: pattern.kind, seed: pattern.seed, createdAt: Date.now() };
    const next = [entry, ...saved.filter((item) => item.name !== name)].slice(0, 18);
    setSaved(next);
    try { localStorage.setItem(PATTERN_KEY, JSON.stringify(next)); } catch { /* noop */ }
    setPatternName("");
    setShareMsg("kept");
    schedule(() => setShareMsg(null), 1400);
    try { getFieldAudio().bell(); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    recordTape("kept", 0.72, `pulse/save/${name}`);
  }, [patternName, pattern, saved, recordTape, schedule]);

  const onLoadPattern = useCallback((entry: SavedPattern) => {
    setPattern(makePattern(entry.kind, entry.seed));
    touchImpulseRef.current = clamp(touchImpulseRef.current + 0.62, 0, 1.6);
    try { getFieldAudio().playNote(58 + PATTERN_KINDS.indexOf(entry.kind) * 4, 140); } catch { /* noop */ }
    try { haptics.ripple(0.48); } catch { /* noop */ }
    recordTape("object", 0.54, `pulse/load/${entry.name}`);
  }, [recordTape]);

  const onShare = useCallback(() => {
    try {
      const payload = { kind: pattern.kind, seed: pattern.seed, hr, br: breathRate, stress };
      const url = `${window.location.origin}${window.location.pathname}#p=${btoa(JSON.stringify(payload))}`;
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(url).then(
          () => setShareMsg("copied"),
          () => setShareMsg("hash set"),
        );
      } else {
        setShareMsg("hash set");
      }
      window.history.replaceState(null, "", url);
      schedule(() => setShareMsg(null), 1600);
      try { getFieldAudio().chime(); } catch { /* noop */ }
      recordTape("sigil", 0.52, "pulse/share");
    } catch {
      setShareMsg("share failed");
      schedule(() => setShareMsg(null), 1600);
    }
  }, [pattern, hr, breathRate, stress, recordTape, schedule]);

  const readouts = useMemo(() => ([
    { key: "hr" as const, label: CHANNEL_META.hr.readoutLabel, value: meter.hr, unit: "bpm", tone: CHANNEL_META.hr.tone },
    { key: "breath" as const, label: CHANNEL_META.breath.readoutLabel, value: meter.breath, unit: "br", tone: CHANNEL_META.breath.tone },
    { key: "bp" as const, label: CHANNEL_META.bp.readoutLabel, value: meter.bp, unit: "mm", tone: CHANNEL_META.bp.tone },
    { key: "brain" as const, label: CHANNEL_META.brain.readoutLabel, value: meter.brain, unit: "eeg", tone: CHANNEL_META.brain.tone },
  ]), [meter]);

  return (
    <div
      ref={rootRef}
      className="oda-pulse-root"
      data-touch-surface="true"
      data-pretext-ignore="true"
      aria-label="pulse rhythm oscillator"
    >
      <canvas
        ref={canvasRef}
        className="oda-pulse-canvas"
        aria-hidden="true"
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={clearPointer}
        onPointerCancel={clearPointer}
      />

      <div className="pulse-vital-strip" aria-label="pulse channels">
        {readouts.map((item) => (
          <button
            key={item.key}
            type="button"
            className="pulse-channel-stop"
            style={{ "--pulse-tone": item.tone } as CSSProperties}
            aria-pressed={audioEnabled[item.key]}
            onClick={() => toggleAudio(item.key)}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <em>{item.unit}</em>
          </button>
        ))}
      </div>

      <div className="pulse-state" aria-live="polite">
        <span>pulse</span>
        <strong>{pattern.kind}</strong>
        <i style={{ width: `${Math.max(8, meter.tension)}%` }} />
      </div>

      <div className="pulse-console" aria-label="pulse controls">
        <div className="pulse-sliders">
          <PulseSlider
            label="rate"
            min={40}
            max={180}
            step={1}
            value={hr}
            tone={CHANNEL_META.hr.tone}
            display={`${hr}`}
            onChange={(value) => {
              setHr(value);
              touchImpulseRef.current = clamp(touchImpulseRef.current + 0.12, 0, 1.2);
            }}
          />
          <PulseSlider
            label="breath"
            min={6}
            max={30}
            step={1}
            value={breathRate}
            tone={CHANNEL_META.breath.tone}
            display={`${breathRate}`}
            onChange={(value) => {
              setBreathRate(value);
              touchImpulseRef.current = clamp(touchImpulseRef.current + 0.10, 0, 1.2);
            }}
          />
          <PulseSlider
            label="tension"
            min={0}
            max={1}
            step={0.01}
            value={stress}
            tone="#ff8b5d"
            display={`${Math.round(stress * 100)}`}
            onChange={(value) => {
              setStress(value);
              touchImpulseRef.current = clamp(touchImpulseRef.current + 0.16, 0, 1.4);
            }}
          />
        </div>

        <div className="pulse-actions">
          <label className="pulse-select-wrap">
            <span>pattern</span>
            <select
              value={pattern.kind}
              onChange={(event) => {
                const next = event.target.value;
                if (isPatternKind(next)) onPatternKind(next);
              }}
              aria-label="pattern"
            >
              {PATTERN_KINDS.map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onGenerate}>cast</button>
          <input
            type="text"
            value={patternName}
            maxLength={32}
            placeholder="name"
            aria-label="pattern name"
            onChange={(event) => setPatternName(event.target.value)}
          />
          <button type="button" onClick={onSavePattern}>keep</button>
          <button type="button" onClick={onShare}>{shareMsg ?? "share"}</button>
          <button
            type="button"
            className="pulse-shock"
            onClick={onDefibrillate}
            disabled={defibActive}
          >
            {defibActive ? "clear" : "shock"}
          </button>
        </div>

        {saved.length > 0 && (
          <div className="pulse-saved" aria-label="saved pulse patterns">
            {saved.slice(0, 8).map((entry) => (
              <button
                type="button"
                key={`${entry.name}-${entry.seed}`}
                onClick={() => onLoadPattern(entry)}
                style={{ "--pulse-tone": PATTERN_COLORS[entry.kind] } as CSSProperties}
              >
                <span>{entry.kind}</span>
                {entry.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .oda-pulse-root {
          position: fixed;
          inset: 0;
          overflow: hidden;
          background: #080506;
          color: rgba(250, 238, 220, 0.94);
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .oda-pulse-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: crosshair;
          z-index: 0;
        }

        .pulse-vital-strip {
          position: fixed;
          z-index: 3;
          left: var(--pad-x);
          right: var(--pad-x);
          top: 76px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          pointer-events: auto;
        }

        .pulse-channel-stop {
          min-width: 0;
          min-height: 58px;
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto auto;
          gap: 2px 9px;
          align-items: end;
          border: 1px solid rgba(250, 238, 220, 0.15);
          border: 1px solid color-mix(in srgb, var(--pulse-tone) 35%, transparent);
          border-radius: 8px;
          background: rgba(10, 6, 7, 0.54);
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--pulse-tone) 12%, transparent), rgba(8, 5, 6, 0.50));
          color: rgba(250, 238, 220, 0.92);
          padding: 9px 11px;
          text-align: left;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: 0 18px 52px rgba(0, 0, 0, 0.20);
          cursor: pointer;
        }

        .pulse-channel-stop span {
          color: rgba(250, 238, 220, 0.74);
          color: color-mix(in srgb, var(--pulse-tone) 72%, rgba(250, 238, 220, 0.74));
          font-family: var(--font-mono);
          font-size: 10px;
          line-height: 1;
          text-transform: lowercase;
          letter-spacing: 0;
        }

        .pulse-channel-stop strong {
          grid-column: 1;
          color: rgba(255, 248, 234, 0.96);
          font-family: var(--font-numerals, var(--font-serif));
          font-size: clamp(18px, 2.4vw, 28px);
          font-weight: 500;
          line-height: 0.94;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .pulse-channel-stop em {
          grid-column: 2;
          grid-row: 1 / 3;
          align-self: center;
          color: rgba(250, 238, 220, 0.46);
          font-family: var(--font-mono);
          font-size: 9px;
          font-style: normal;
          text-transform: lowercase;
          writing-mode: vertical-rl;
        }

        .pulse-channel-stop[aria-pressed="true"] {
          box-shadow:
            0 18px 52px rgba(0, 0, 0, 0.22),
            0 0 24px rgba(250, 238, 220, 0.16);
          box-shadow:
            0 18px 52px rgba(0, 0, 0, 0.22),
            0 0 24px color-mix(in srgb, var(--pulse-tone) 28%, transparent);
        }

        .pulse-channel-stop[aria-pressed="true"] span::after {
          content: "";
          display: inline-block;
          width: 5px;
          height: 5px;
          margin-left: 6px;
          border-radius: 999px;
          background: var(--pulse-tone);
          box-shadow: 0 0 10px var(--pulse-tone);
          vertical-align: 1px;
        }

        .pulse-state {
          position: fixed;
          z-index: 2;
          left: var(--pad-x);
          top: 156px;
          display: inline-grid;
          grid-template-columns: auto auto 86px;
          gap: 10px;
          align-items: center;
          color: rgba(250, 238, 220, 0.58);
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0;
          text-transform: lowercase;
          pointer-events: none;
        }

        .pulse-state strong {
          color: rgba(250, 238, 220, 0.84);
          font-weight: 500;
        }

        .pulse-state i {
          display: block;
          height: 3px;
          min-width: 8px;
          border-radius: 999px;
          background: linear-gradient(90deg, #58d9c8, #f2bf62, #ff5d73);
          box-shadow: 0 0 16px rgba(255, 93, 115, 0.35);
        }

        .pulse-console {
          position: fixed;
          z-index: 4;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: calc(22px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: minmax(280px, 0.82fr) minmax(420px, 1.18fr);
          gap: 8px;
          align-items: stretch;
          padding: 8px;
          border: 1px solid rgba(250, 238, 220, 0.13);
          border-radius: 8px;
          background: rgba(10, 6, 7, 0.58);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 26px 70px rgba(0, 0, 0, 0.32);
        }

        .pulse-sliders {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          min-width: 0;
        }

        .pulse-slider {
          min-width: 0;
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto 28px;
          gap: 3px 8px;
          align-items: center;
          padding: 7px 9px;
          border: 1px solid rgba(250, 238, 220, 0.10);
          border-radius: 6px;
          background: rgba(250, 238, 220, 0.045);
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgba(250, 238, 220, 0.66);
        }

        .pulse-slider strong {
          color: var(--pulse-tone);
          font-family: var(--font-numerals, var(--font-mono));
          font-size: 13px;
          font-weight: 500;
        }

        .pulse-slider input {
          -webkit-appearance: none;
          appearance: none;
          grid-column: 1 / -1;
          width: 100%;
          height: 28px;
          margin: 0;
          background: transparent;
          accent-color: var(--pulse-tone);
        }

        .pulse-slider input::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--pulse-tone), rgba(250, 238, 220, 0.18));
        }

        .pulse-slider input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          margin-top: -6px;
          border: 0;
          border-radius: 3px;
          background: var(--pulse-tone);
          box-shadow: 0 0 12px var(--pulse-tone);
          cursor: pointer;
        }

        .pulse-slider input::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--pulse-tone), rgba(250, 238, 220, 0.18));
        }

        .pulse-slider input::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: 0;
          border-radius: 3px;
          background: var(--pulse-tone);
          box-shadow: 0 0 12px var(--pulse-tone);
          cursor: pointer;
        }

        .pulse-actions {
          display: grid;
          grid-template-columns: minmax(116px, 0.86fr) repeat(3, minmax(74px, 0.62fr)) minmax(78px, 0.62fr) minmax(84px, 0.64fr);
          gap: 8px;
          min-width: 0;
        }

        .pulse-actions button,
        .pulse-actions input,
        .pulse-select-wrap {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(250, 238, 220, 0.13);
          border-radius: 6px;
          background: rgba(250, 238, 220, 0.055);
          color: rgba(250, 238, 220, 0.88);
          font-family: var(--font-mono);
          font-size: 12px;
          letter-spacing: 0;
        }

        .pulse-actions button {
          cursor: pointer;
          text-transform: lowercase;
          transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
        }

        .pulse-actions button:hover {
          transform: translateY(-1px);
          background: rgba(250, 238, 220, 0.09);
          border-color: rgba(250, 238, 220, 0.24);
        }

        .pulse-actions button:disabled {
          cursor: default;
          opacity: 0.58;
          transform: none;
        }

        .pulse-actions input {
          padding: 0 12px;
          outline: none;
        }

        .pulse-actions input::placeholder {
          color: rgba(250, 238, 220, 0.42);
        }

        .pulse-select-wrap {
          display: grid;
          grid-template-columns: 1fr;
          grid-template-rows: auto 1fr;
          gap: 2px;
          padding: 7px 10px 6px;
        }

        .pulse-select-wrap span {
          color: rgba(250, 238, 220, 0.48);
          font-size: 9px;
        }

        .pulse-select-wrap select {
          min-width: 0;
          width: 100%;
          border: 0;
          outline: 0;
          background: transparent;
          color: rgba(250, 238, 220, 0.94);
          font: inherit;
          cursor: pointer;
        }

        .pulse-select-wrap option {
          background: #16090e;
          color: rgba(250, 238, 220, 0.94);
        }

        .pulse-shock {
          color: #fff0ce !important;
          border-color: rgba(255, 93, 115, 0.48) !important;
          background:
            linear-gradient(135deg, rgba(255, 93, 115, 0.18), rgba(242, 191, 98, 0.09)) !important;
          box-shadow: inset 0 0 0 1px rgba(255, 240, 206, 0.05);
        }

        .pulse-saved {
          grid-column: 1 / -1;
          display: flex;
          gap: 6px;
          overflow-x: auto;
          overscroll-behavior-x: contain;
          padding-top: 2px;
          scrollbar-width: none;
        }

        .pulse-saved::-webkit-scrollbar {
          display: none;
        }

        .pulse-saved button {
          flex: 0 0 auto;
          max-width: 180px;
          min-height: 32px;
          border: 1px solid rgba(250, 238, 220, 0.15);
          border: 1px solid color-mix(in srgb, var(--pulse-tone) 34%, transparent);
          border-radius: 999px;
          background: rgba(10, 6, 7, 0.58);
          background: color-mix(in srgb, var(--pulse-tone) 10%, rgba(10, 6, 7, 0.58));
          color: rgba(250, 238, 220, 0.82);
          padding: 0 11px;
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 10px;
          text-transform: lowercase;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .pulse-saved span {
          color: var(--pulse-tone);
          margin-right: 7px;
        }

        body:has(.oda-pulse-root) header {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.oda-pulse-root) .oda-field-watch,
        body:has(.oda-pulse-root) .oda-candle-mark,
        body:has(.oda-pulse-root) .oda-sound-toggle,
        body:has(.oda-pulse-root) .oda-tape-shell {
          display: none !important;
        }

        @media (max-width: 980px) {
          .pulse-console {
            grid-template-columns: 1fr;
          }

          .pulse-actions {
            grid-template-columns: minmax(118px, 1fr) repeat(5, minmax(72px, 0.7fr));
          }
        }

        @media (max-width: 720px) {
          .pulse-vital-strip {
            left: 12px;
            right: 12px;
            top: 70px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 7px;
          }

          .pulse-channel-stop {
            min-height: 48px;
            padding: 7px 9px;
          }

          .pulse-channel-stop strong {
            font-size: clamp(16px, 5.8vw, 22px);
          }

          .pulse-channel-stop em {
            font-size: 8px;
          }

          .pulse-state {
            top: 184px;
            left: 14px;
          }

          .pulse-console {
            left: 10px;
            right: 10px;
            bottom: calc(12px + env(safe-area-inset-bottom, 0px));
            max-height: min(47svh, 410px);
            overflow-y: auto;
            padding: 7px;
            gap: 7px;
          }

          .pulse-sliders {
            gap: 7px;
          }

          .pulse-slider {
            grid-template-rows: auto 24px;
            padding: 6px 8px;
            font-size: 9px;
          }

          .pulse-slider strong {
            font-size: 11px;
          }

          .pulse-slider input {
            height: 24px;
          }

          .pulse-actions {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 7px;
          }

          .pulse-actions button,
          .pulse-actions input,
          .pulse-select-wrap {
            min-height: 44px;
            font-size: 11px;
          }

          .pulse-select-wrap {
            padding: 5px 8px 4px;
          }

          .pulse-saved {
            padding-bottom: 1px;
          }
        }

        @media (max-width: 420px) {
          .pulse-console {
            max-height: min(50svh, 440px);
          }

          .pulse-sliders {
            grid-template-columns: 1fr;
          }

          .pulse-actions {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .pulse-state {
            display: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pulse-actions button {
            transition: none;
          }

          .pulse-actions button:hover {
            transform: none;
          }
        }
      `,
        }}
      />
    </div>
  );
}

function PulseSlider({
  label,
  min,
  max,
  step,
  value,
  display,
  tone,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  tone: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="pulse-slider" style={{ "--pulse-tone": tone } as CSSProperties}>
      <span>{label}</span>
      <strong>{display}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function pushSample(channel: Channel, value: number) {
  channel.buffer[channel.cursor] = clamp(value, -1.2, 1.2);
  channel.cursor = (channel.cursor + 1) % channel.buffer.length;
}

function qrstSample(p: number): number {
  if (p < 0.08) return 0;
  if (p < 0.16) return Math.sin(((p - 0.08) / 0.08) * Math.PI) * 0.18;
  if (p < 0.22) return 0;
  if (p < 0.26) return -((p - 0.22) / 0.04) * 0.18;
  if (p < 0.30) return -0.18 + ((p - 0.26) / 0.04) * 1.18;
  if (p < 0.34) return 1.0 - ((p - 0.30) / 0.04) * 1.4;
  if (p < 0.38) return -0.4 + ((p - 0.34) / 0.04) * 0.4;
  if (p < 0.50) return 0;
  if (p < 0.62) return Math.sin(((p - 0.50) / 0.12) * Math.PI) * 0.28;
  return 0;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  stress: number,
  touch: number,
  shock: number,
  reduce: boolean,
) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#12070a");
  bg.addColorStop(0.34, "#080506");
  bg.addColorStop(0.68, "#07100f");
  bg.addColorStop(1, "#190b10");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const cadence = reduce ? 0 : time;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 34; i++) {
    const y = (i / 33) * height;
    const hue = i % 3 === 0 ? "255, 93, 115" : i % 3 === 1 ? "88, 217, 200" : "242, 191, 98";
    ctx.strokeStyle = `rgba(${hue}, ${0.025 + stress * 0.035})`;
    ctx.lineWidth = i % 5 === 0 ? 1.2 : 0.7;
    ctx.beginPath();
    for (let x = -20; x <= width + 20; x += 24) {
      const yy = y
        + Math.sin(x * 0.008 + cadence * (0.32 + i * 0.004) + i) * (10 + stress * 18)
        + Math.sin(x * 0.021 - cadence * 0.7 + i * 1.7) * (3 + touch * 6);
      if (x <= -20) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 18; i++) {
    const x = (i / 17) * width;
    ctx.strokeStyle = `rgba(250, 238, 220, ${0.018 + shock * 0.04})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let y = -20; y <= height + 20; y += 28) {
      const xx = x + Math.sin(y * 0.009 + cadence * 0.2 + i) * (5 + stress * 9);
      if (y <= -20) ctx.moveTo(xx, y);
      else ctx.lineTo(xx, y);
    }
    ctx.stroke();
  }

  if (shock > 0.01) {
    ctx.fillStyle = `rgba(255, 241, 208, ${0.10 * shock})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();

  const veil = ctx.createLinearGradient(0, 0, 0, height);
  veil.addColorStop(0, "rgba(0, 0, 0, 0.26)");
  veil.addColorStop(0.38, "rgba(0, 0, 0, 0)");
  veil.addColorStop(1, "rgba(0, 0, 0, 0.42)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, width, height);
}

function drawMembrane(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  time: number,
  beat: number,
  stress: number,
  touch: number,
  shock: number,
  reduce: boolean,
) {
  const pulse = 1 + beat * 0.075 + touch * 0.026 - shock * 0.05;
  const inner = radius * (0.34 + beat * 0.035);
  const outer = radius * pulse;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.72);

  const core = ctx.createRadialGradient(0, 0, inner * 0.2, 0, 0, outer * 1.15);
  core.addColorStop(0, `rgba(255, 241, 208, ${0.22 + beat * 0.20 + shock * 0.22})`);
  core.addColorStop(0.16, `rgba(255, 93, 115, ${0.20 + stress * 0.16})`);
  core.addColorStop(0.48, `rgba(88, 217, 200, ${0.075 + touch * 0.05})`);
  core.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.ellipse(0, 0, outer * 1.18, outer, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 9; i++) {
    const u = i / 8;
    const r = mix(inner, outer, u) * (1 + Math.sin(time * (reduce ? 0 : 0.9) + i) * 0.012);
    ctx.strokeStyle = i % 2
      ? `rgba(88, 217, 200, ${0.10 + beat * 0.08})`
      : `rgba(255, 93, 115, ${0.11 + stress * 0.09 + shock * 0.08})`;
    ctx.lineWidth = 0.9 + (1 - u) * 1.1;
    ctx.beginPath();
    for (let p = 0; p <= 180; p++) {
      const a = (p / 180) * Math.PI * 2;
      const lobe = Math.sin(a * 4 + time * 1.4) * radius * (0.008 + stress * 0.006);
      const rr = r + lobe;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (p === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  for (let i = 0; i < 7; i++) {
    const a = i * (Math.PI * 2 / 7) + time * 0.16;
    const r0 = radius * 0.08;
    const r1 = radius * (0.66 + Math.sin(time + i) * 0.035);
    ctx.strokeStyle = `rgba(250, 238, 220, ${0.035 + beat * 0.05})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.quadraticCurveTo(
      Math.cos(a + 0.7) * radius * 0.34,
      Math.sin(a + 0.7) * radius * 0.34,
      Math.cos(a + 0.18) * r1,
      Math.sin(a + 0.18) * r1,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawOrbitTrace(
  ctx: CanvasRenderingContext2D,
  channel: Channel,
  cx: number,
  cy: number,
  radius: number,
  amp: number,
  squash: number,
  startAngle: number,
  angleSpan: number,
  time: number,
  listening: boolean,
  inShock: boolean,
  reduce: boolean,
) {
  const buf = channel.buffer;
  const count = buf.length;
  const tone = channel.tone;
  const spin = reduce ? 0 : Math.sin(time * 0.12 + channel.midi) * 0.035;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.strokeStyle = colorAlpha(tone, inShock ? 0.36 : 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < count; i += 8) {
    const u = i / (count - 1);
    const a = startAngle + angleSpan * u + spin;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius * squash;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = colorAlpha(tone, listening ? 0.92 : 0.72);
  ctx.shadowColor = tone;
  ctx.shadowBlur = reduce ? 0 : listening ? 15 : 8;
  ctx.lineWidth = listening ? 2.4 : 1.65;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const idx = (channel.cursor + i) % count;
    const u = i / (count - 1);
    const sample = inShock ? 0 : buf[idx];
    const a = startAngle + angleSpan * u + spin;
    const tremor = Math.sin(u * Math.PI * 8 + time * 1.2 + channel.midi) * amp * 0.025;
    const rr = radius + sample * amp + tremor;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * squash;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const latestIdx = (channel.cursor - 1 + count) % count;
  const a = startAngle + angleSpan + spin;
  const rr = radius + (inShock ? 0 : buf[latestIdx]) * amp;
  const x = cx + Math.cos(a) * rr;
  const y = cy + Math.sin(a) * rr * squash;
  ctx.shadowBlur = reduce ? 0 : 12;
  ctx.fillStyle = tone;
  ctx.beginPath();
  ctx.arc(x, y, listening ? 3.7 : 2.6, 0, Math.PI * 2);
  ctx.fill();

  if (radius > 150) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = colorAlpha(tone, 0.62);
    ctx.font = "11px var(--font-mono, ui-monospace)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelA = startAngle - 0.05 + spin;
    ctx.fillText(channel.label, cx + Math.cos(labelA) * (radius + 18), cy + Math.sin(labelA) * (radius + 18) * squash);
  }
  ctx.restore();
}

function drawPatternOrbit(
  ctx: CanvasRenderingContext2D,
  samples: Float32Array,
  cursor: number,
  kind: PatternKind,
  cx: number,
  cy: number,
  radius: number,
  time: number,
  reduce: boolean,
) {
  const tone = PATTERN_COLORS[kind];
  const count = samples.length;
  const stride = Math.max(2, Math.floor(count / 420));
  const spin = reduce ? 0 : time * 0.034;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = colorAlpha(tone, 0.42);
  ctx.shadowColor = tone;
  ctx.shadowBlur = reduce ? 0 : 10;
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < count; i += stride) {
    const u = i / (count - 1);
    const a = u * Math.PI * 2 + spin;
    const sample = samples[i];
    const braid = Math.sin(u * Math.PI * 12 + time * 0.7) * radius * 0.012;
    const rr = radius + sample * radius * 0.105 + braid;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.58;
    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.stroke();

  const a = (cursor / (count - 1)) * Math.PI * 2 + spin;
  const rr = radius + samples[cursor] * radius * 0.105;
  ctx.fillStyle = tone;
  ctx.shadowBlur = reduce ? 0 : 16;
  ctx.beginPath();
  ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.58, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTouchBlooms(
  ctx: CanvasRenderingContext2D,
  blooms: TouchBloom[],
  now: number,
  reduce: boolean,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = blooms.length - 1; i >= 0; i--) {
    const bloom = blooms[i];
    const age = now - bloom.born;
    if (age > bloom.life) {
      blooms.splice(i, 1);
      continue;
    }
    const t = age / bloom.life;
    const eased = 1 - Math.pow(1 - t, 3);
    const radius = (reduce ? 42 : 34 + eased * 230) * bloom.strength;
    const alpha = (1 - t) * (0.20 + bloom.strength * 0.16);
    ctx.strokeStyle = colorAlpha(bloom.hue, alpha);
    ctx.lineWidth = 1.2 + bloom.strength * 0.8;
    ctx.beginPath();
    ctx.ellipse(bloom.x, bloom.y, radius, radius * 0.52, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = colorAlpha(bloom.hue, alpha * 0.12);
    ctx.beginPath();
    ctx.ellipse(bloom.x, bloom.y, radius * 0.72, radius * 0.26, -0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawNeedle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  time: number,
  patternSample: number,
  beat: number,
  shock: number,
) {
  const angle = -Math.PI * 0.5 + patternSample * 0.5 + Math.sin(time * 0.7) * 0.05;
  const len = radius * (0.42 + beat * 0.1 + shock * 0.18);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const grad = ctx.createLinearGradient(0, 0, len, 0);
  grad.addColorStop(0, "rgba(255, 241, 208, 0)");
  grad.addColorStop(0.42, "rgba(255, 241, 208, 0.46)");
  grad.addColorStop(1, `rgba(255, 93, 115, ${0.58 + shock * 0.28})`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.3 + shock * 1.2;
  ctx.shadowColor = "#fff1d0";
  ctx.shadowBlur = 10 + shock * 12;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len, 0);
  ctx.stroke();
  ctx.fillStyle = `rgba(255, 241, 208, ${0.42 + beat * 0.32 + shock * 0.26})`;
  ctx.beginPath();
  ctx.arc(0, 0, 4 + beat * 5 + shock * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
