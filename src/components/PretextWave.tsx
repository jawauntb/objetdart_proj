"use client";

import {
  layoutNextLineRange,
  materializeLineRange,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import { useEffect, useMemo, useRef, useState } from "react";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import WaterText from "@/components/WaterText";
import { getFieldAudio } from "@/lib/audio";
import { useGeneratedSpeech } from "@/lib/useGeneratedSpeech";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { onVisibility } from "@/lib/room-runtime";
import LetGo from "@/components/LetGo";

type MotionMode = "move" | "shift" | "shake" | "quake" | "wave" | "sine";
type PretextMark = { id: number; label: string; tone: "water" | "ember" | "voice"; strength: number };

type LaidLine = {
  text: string;
  top: number;
  width: number;
  phase: number;
};

const MODES: Array<{ key: MotionMode; label: string }> = [
  { key: "move", label: "move" },
  { key: "shift", label: "shift" },
  { key: "shake", label: "shake" },
  { key: "quake", label: "quake" },
  { key: "wave", label: "wave" },
  { key: "sine", label: "sine" },
];

const AMP_MIN = 0;
const AMP_MAX = 42;
const DENSITY_MIN = 0.4;
const DENSITY_MAX = 3;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const STARTER_TEXT =
  "type a sentence and the room will make a coast of it. the words keep their measure, then loosen into wave, quake, shake, and sine. drag across the words to play them, or press play and the line becomes a small instrument.";

const LOCAL_ENDINGS = [
  "the sentence leaves a bright edge on the harbor wall.",
  "a candle keeps time beside the soft machine.",
  "the phrase comes back with salt on its hands.",
  "each line makes room for the next small tide.",
];

function useElementWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function localFallback(prompt: string) {
  const clean = prompt.trim().replace(/\s+/g, " ");
  const seed = clean.length + clean.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const ending = LOCAL_ENDINGS[seed % LOCAL_ENDINGS.length];
  if (!clean) return STARTER_TEXT;
  return `${clean.toLowerCase()} is placed on the table and listened to slowly. the room measures it as tide, work, breath, and signal. ${ending}`;
}

function splitTokens(text: string) {
  return text.split(/(\s+)/).filter(Boolean);
}

function compactPhrase(text: string, max = 30): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function layoutText(prepared: PreparedTextWithSegments | null, width: number, lineHeight: number) {
  if (!prepared || width <= 0) return null;
  const lines: LaidLine[] = [];
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
  let top = 0;
  let safety = 0;

  while (safety++ < 140) {
    const inset = Math.sin((top / lineHeight) * 0.9) * Math.min(34, width * 0.04);
    const maxWidth = Math.max(180, width - Math.abs(inset) * 2);
    const range = layoutNextLineRange(prepared, cursor, maxWidth);
    if (!range) break;
    const line = materializeLineRange(prepared, range);
    lines.push({
      text: line.text,
      top,
      width: maxWidth,
      phase: lines.length * 0.42,
    });
    cursor = range.end;
    top += lineHeight;
  }

  return {
    lines,
    height: Math.max(lineHeight * 5, top + lineHeight * 0.8),
  };
}

export default function PretextWave() {
  const stageRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const width = useElementWidth(stageRef);
  const recordTape = useField((s) => s.recordTape);

  const [prompt, setPrompt] = useState("make this sentence into a playable tide");
  const [text, setText] = useState(STARTER_TEXT);
  const [font, setFont] = useState<string | null>(null);
  const [mode, setMode] = useState<MotionMode>("wave");
  const [playing, setPlaying] = useState(true);
  const [phase, setPhase] = useState(0);
  const [amp, setAmp] = useState(18);
  const [density, setDensity] = useState(1.2);
  const [status, setStatus] = useState("drag the words, or ask the room");
  const [generating, setGenerating] = useState(false);
  const [marks, setMarks] = useState<PretextMark[]>([]);
  const markIdRef = useRef(0);

  // Live mirrors so the direct-manipulation drag reads current values
  // without re-binding pointer handlers.
  const ampRef = useRef(amp);
  const densityRef = useRef(density);
  useEffect(() => { ampRef.current = amp; }, [amp]);
  useEffect(() => { densityRef.current = density; }, [density]);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const dragRef = useRef({
    active: false,
    id: -1,
    x0: 0,
    y0: 0,
    amp0: 18,
    den0: 1.2,
    moved: 0,
    lastFx: 0,
  });

  // ── frame-layer state (two/three-finger verbs) ─────────────────────
  // pinch scales the reading (a local zoom on the text), pan2/tilt shift
  // the field, twist(2) rotates the lens through the motion modes — the
  // same material read at a different level of description.
  const zoomRef = useRef({ cur: 1, target: 1 });
  const panRef = useRef({ curX: 0, curY: 0, targetX: 0, targetY: 0 });
  const lensTwistAccRef = useRef(0);
  // three fingers touch the law: drag is wind (a transient gust on amp),
  // hold is time dilation (the phase clock eases toward 1/4 speed), twist
  // is the season (a slow hue drift + which local ending gets picked).
  const timeScaleRef = useRef({ cur: 1, target: 1 });
  const seasonRef = useRef(0);
  const seasonTwistAccRef = useRef(0);
  const tuttiRef = useRef(0);
  const nightRef = useRef(false);
  const lastTouchAtRef = useRef(0);
  // rhythm: a steady tapped pulse entrains the tide's clock for a while
  const entrainRef = useRef({ bpm: 0, until: 0, lastBeat: -1 });

  // ── create/delete: the room's material is countable (a kept phrase).
  const KEPT_PHRASES_KEY = "objetdart:pretext-kept:v1";
  const [keptPhrases, setKeptPhrases] = useState<string[]>([]);
  const [chargePct, setChargePct] = useState(0);
  const [chargeMode, setChargeMode] = useState<"create" | "delete" | null>(null);
  const [chargePos, setChargePos] = useState({ x: 0, y: 0 });
  const keptPhrasesRef = useRef<string[]>([]);
  const textRef = useRef(text);
  useEffect(() => { textRef.current = text; }, [text]);
  useEffect(() => { keptPhrasesRef.current = keptPhrases; }, [keptPhrases]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEPT_PHRASES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) setKeptPhrases(parsed.filter((p) => typeof p === "string").slice(0, 8));
      }
    } catch { /* noop */ }
  }, []);

  const persistKept = (next: string[]) => {
    setKeptPhrases(next);
    try { localStorage.setItem(KEPT_PHRASES_KEY, JSON.stringify(next)); } catch { /* noop */ }
  };

  const keepCurrentPhrase = () => {
    const phrase = textRef.current.trim();
    if (!phrase) return;
    const already = keptPhrasesRef.current.includes(phrase);
    if (already) {
      persistKept(keptPhrasesRef.current.filter((p) => p !== phrase));
      haptics.roll();
      try { getFieldAudio().thud(); } catch { /* noop */ }
      addMark("released", "water", 0.5);
    } else {
      persistKept([phrase, ...keptPhrasesRef.current].slice(0, 8));
      haptics.bloom();
      try { getFieldAudio().bell(); } catch { /* noop */ }
      addMark("kept", "ember", 0.8);
      recordTape("kept", 0.8, "pretext:kept");
    }
  };

  const letGoKeptPhrases = () => {
    persistKept([]);
    haptics.roll();
    try { getFieldAudio().thud(); } catch { /* noop */ }
  };

  const { speaking, speechStatus, setSpeechStatus, speakText, stopSpeech } = useGeneratedSpeech({
    context: "pretext wave page, playable sentence, oceanic text instrument",
    doneStatus: "voice complete",
  });

  const addMark = (label: string, tone: PretextMark["tone"] = "water", strength = 0.5) => {
    const id = ++markIdRef.current;
    setMarks((current) => [...current.slice(-4), { id, label, tone, strength }]);
    window.setTimeout(() => {
      setMarks((current) => current.filter((mark) => mark.id !== id));
    }, 4600);
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    const ready = "fonts" in document ? document.fonts.ready : Promise.resolve();
    ready.then(() => {
      if (!probeRef.current) return;
      const cs = getComputedStyle(probeRef.current);
      setFont(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
    });
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let previous = performance.now();
    let sleeping = document.hidden;
    const offVisibility = onVisibility((hidden) => { sleeping = hidden; });
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const delta = Math.min(50, now - previous);
      previous = now;
      if (sleeping) return; // no draw while the tab/frame is hidden
      // three-finger hold dilates time: the phase clock eases toward 1/4.
      const ts = timeScaleRef.current;
      ts.cur += (ts.target - ts.cur) * 0.08;
      tuttiRef.current *= 0.92;
      // an entrained tide: the phase clock locks to the hand's tempo (one
      // full cycle per four beats) and the words brighten on every beat
      const en = entrainRef.current;
      const entrained = en.bpm > 0 && now < en.until;
      const advance = entrained
        ? delta * ((Math.PI * 2) / ((60000 / en.bpm) * 4))
        : delta * 0.0025;
      if (entrained) {
        const beatIdx = Math.floor(now / (60000 / en.bpm));
        if (beatIdx !== en.lastBeat) {
          en.lastBeat = beatIdx;
          tuttiRef.current = Math.max(tuttiRef.current, 0.28);
          try { getFieldAudio().playNote(52 + (beatIdx % 2) * 5, 70); } catch { /* noop */ }
        }
      }
      setPhase((value) => (value + advance * ts.cur) % (Math.PI * 2));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      offVisibility();
    };
  }, [playing]);

  const prepared = useMemo(() => {
    if (!font) return null;
    try {
      return prepareWithSegments(text, font);
    } catch {
      return null;
    }
  }, [font, text]);

  const lineHeight = width > 640 ? 50 : 38;
  const layout = useMemo(
    () => layoutText(prepared, Math.max(0, width - 2), lineHeight),
    [prepared, width, lineHeight],
  );

  const generate = async () => {
    const question = prompt.trim();
    if (!question || generating) return;
    stopSpeech(null);
    setGenerating(true);
    setStatus("asking the room");
    haptics.roll();
    recordTape("sigil", 0.45, "pretext:ask");
    addMark("asking", "voice", 0.62);
    try {
      const res = await fetch("/api/ask-the-room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error("api unavailable");
      const json = await res.json();
      if (typeof json.answer !== "string" || !json.answer.trim()) throw new Error("empty answer");
      setText(json.answer.trim());
      setSpeechStatus(null);
      setStatus(json.model ? `generated by ${json.model}` : "generated by the room");
      haptics.ripple(0.64);
      recordTape("sigil", 0.72, "pretext:generated");
      addMark("answered", "ember", 0.78);
    } catch {
      setText(localFallback(question));
      setSpeechStatus(null);
      setStatus("local fallback text");
      haptics.tap();
      recordTape("object", 0.38, "pretext:local");
      addMark("local", "water", 0.5);
    } finally {
      setGenerating(false);
    }
  };

  const speak = () => {
    haptics.roll();
    recordTape("sigil", 0.62, "pretext:voice");
    addMark(speaking ? "voice" : "speak", "voice", 0.72);
    void speakText(text);
  };

  const impulse = (nextMode: MotionMode) => {
    setMode(nextMode);
    setPlaying(true);
    if (nextMode === "shift") setPhase((value) => value + Math.PI * 0.55);
    if (nextMode === "shake") { setAmp(26); ampRef.current = 26; }
    if (nextMode === "quake") { setAmp(34); ampRef.current = 34; }
    if (nextMode === "move") { setAmp(14); ampRef.current = 14; }
    if (nextMode === "wave") { setAmp(20); ampRef.current = 20; }
    if (nextMode === "sine") { setAmp(18); ampRef.current = 18; }
    try { getFieldAudio().playNote(52 + MODES.findIndex((m) => m.key === nextMode) * 3, 130); } catch { /* noop */ }
    haptics.chop();
    recordTape("ripple", nextMode === "quake" ? 0.72 : 0.48, `pretext:${nextMode}`);
    addMark(nextMode, nextMode === "quake" || nextMode === "shake" ? "ember" : "water", 0.62);
  };

  const markControl = (label: string, value: string, strength = 0.42) => {
    haptics.tap();
    recordTape("object", strength, `pretext:${label}:${value}`);
    addMark(`${label} ${value}`, "water", strength);
  };

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    haptics.tap();
    try { if (next) getFieldAudio().chime(); else getFieldAudio().thud(); } catch { /* noop */ }
    recordTape("object", next ? 0.42 : 0.28, next ? "pretext:play" : "pretext:pause");
    addMark(next ? "play" : "pause", "water", next ? 0.52 : 0.42);
  };

  // Direct manipulation: dragging the words tunes the instrument.
  // Vertical drag drives amplitude, horizontal drag drives frequency.
  const tuneFromDrag = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const el = stageRef.current;
    const w = el ? Math.max(1, el.clientWidth) : window.innerWidth || 1;
    const h = el ? Math.max(1, el.clientHeight) : window.innerHeight || 1;
    const dx = clientX - drag.x0;
    const dy = clientY - drag.y0;
    drag.moved += Math.abs(dx) + Math.abs(dy);

    // Drag up = more amplitude; a full stage height ≈ full amplitude sweep.
    const nextAmp = clamp(drag.amp0 - (dy / h) * (AMP_MAX - AMP_MIN) * 1.6, AMP_MIN, AMP_MAX);
    // Drag right = higher frequency across the stage width.
    const nextDensity = clamp(drag.den0 + (dx / w) * (DENSITY_MAX - DENSITY_MIN) * 1.4, DENSITY_MIN, DENSITY_MAX);

    const roundedAmp = Math.round(nextAmp);
    const roundedDen = Number(nextDensity.toFixed(2));
    ampRef.current = roundedAmp;
    densityRef.current = roundedDen;
    setAmp(roundedAmp);
    setDensity(roundedDen);

    const now = performance.now();
    if (now - drag.lastFx > 90) {
      drag.lastFx = now;
      try {
        getFieldAudio().playNote(
          46 + Math.round((nextAmp / AMP_MAX) * 20) + Math.round(nextDensity * 4),
          80,
        );
      } catch { /* noop */ }
      try { haptics.ripple(0.2 + (nextAmp / AMP_MAX) * 0.3); } catch { /* noop */ }
      recordTape("ripple", 0.3 + (nextAmp / AMP_MAX) * 0.4, "pretext:drag");
    }
  };

  // ── the gesture surface ─────────────────────────────────────────────
  // One finger touches the material: drag tunes amp/frequency directly
  // (unchanged, re-expressed as a grammar drag), dwell/ceremony create and
  // delete a kept phrase. Two fingers touch the map: pinch zooms the
  // reading, twist rotates the lens through the motion modes, pan2 pans
  // the field. Three fingers touch the law: drag is wind, hold is time
  // dilation, twist is the season.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sealedRef = { current: false };

    // the instant of touch, below any gesture threshold — resuming motion
    // reads as immediate as the original raw handler (same precedent as
    // Jewel.tsx's onContact: not a classifier, just contact feedback).
    const onContact = () => {
      lastTouchAtRef.current = performance.now();
      setPlaying(true);
      try { haptics.tap(); } catch { /* noop */ }
    };
    stage.addEventListener("pointerdown", onContact);

    const detachGestures = attachGestures(
      stage,
      {
        drag: (e) => {
          lastTouchAtRef.current = performance.now();
          if (e.fingers === 3) {
            if (e.phase === "end") return;
            // wind: a gust pushes the tide forward or back.
            setPhase((v) => (v + e.dx * 0.004 + Math.PI * 2) % (Math.PI * 2));
            const now = performance.now();
            if (now - dragRef.current.lastFx > 220) {
              dragRef.current.lastFx = now;
              addMark("wind", "water", 0.5);
              recordTape("region", 0.4, "pretext:wind");
            }
            return;
          }
          if (e.fingers !== 1) return;
          const drag = dragRef.current;
          if (e.phase === "start") {
            drag.active = true;
            drag.x0 = e.x;
            drag.y0 = e.y;
            drag.amp0 = ampRef.current;
            drag.den0 = densityRef.current;
            drag.moved = 0;
            drag.lastFx = 0;
            return;
          }
          if (e.phase === "end") {
            const played = drag.moved > 8;
            drag.active = false;
            if (played) {
              addMark(`amp ${ampRef.current}`, "water", 0.44);
              setStatus(`amp ${ampRef.current} / freq ${densityRef.current.toFixed(2)}`);
            }
            return;
          }
          tuneFromDrag(e.x, e.y);
        },
        hold: (e) => {
          lastTouchAtRef.current = performance.now();
          if (e.fingers === 3) {
            // time dilation: the phase clock eases to 1/4 while held and
            // keeps slowing toward stillness the longer the hand stays.
            timeScaleRef.current.target = e.phase === "release"
              ? 1
              : Math.max(0.08, 0.25 - 0.17 * Math.min(1, e.elapsed / 4000));
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "enter") sealedRef.current = false;
          if (e.phase === "release") {
            setChargePct(0);
            setChargeMode(null);
            return;
          }
          if (e.tier < 2) {
            setChargePct(0);
            setChargeMode(null);
            return;
          }
          const already = keptPhrasesRef.current.includes(textRef.current.trim());
          setChargeMode(already ? "delete" : "create");
          setChargePct(Math.min(1, (e.elapsed - 900) / 1600));
          const rect = stage.getBoundingClientRect();
          setChargePos({ x: e.x - rect.left, y: e.y - rect.top });
          if (!sealedRef.current) {
            // dwell (tier 2) creates a new kept phrase; ceremony (tier 3)
            // on an existing one is the solemn act that lets it go.
            if (!already && e.tier >= 2) { sealedRef.current = true; keepCurrentPhrase(); }
            else if (already && e.tier >= 3) { sealedRef.current = true; keepCurrentPhrase(); }
          }
        },
        pinch: (e) => {
          lastTouchAtRef.current = performance.now();
          if (e.phase === "move") {
            zoomRef.current.target = Math.max(0.72, Math.min(1.5, zoomRef.current.target * e.scale));
          }
        },
        twist: (e) => {
          lastTouchAtRef.current = performance.now();
          if (e.fingers === 3) {
            // season — the room's slow cycle, advanced/rewound.
            if (e.phase === "start") seasonTwistAccRef.current = 0;
            if (e.phase === "move") seasonTwistAccRef.current += e.angle;
            if (e.phase === "end" && Math.abs(seasonTwistAccRef.current) > Math.PI / 2) {
              seasonRef.current = (seasonRef.current + (seasonTwistAccRef.current > 0 ? 1 : -1) + 8) % 8;
              haptics.lens();
              addMark("season", "water", 0.5);
            }
            return;
          }
          // two fingers rotate the lens: cycle the motion mode — the same
          // sentence read at a different level of description.
          if (e.phase === "start") lensTwistAccRef.current = 0;
          if (e.phase === "move") lensTwistAccRef.current += e.angle;
          if (e.phase === "end" && Math.abs(lensTwistAccRef.current) > Math.PI / 2) {
            const dir = lensTwistAccRef.current > 0 ? 1 : -1;
            const idx = MODES.findIndex((m) => m.key === modeRef.current);
            impulse(MODES[(idx + dir + MODES.length) % MODES.length].key);
            haptics.lens();
          }
        },
        pan2: (e) => {
          lastTouchAtRef.current = performance.now();
          if (e.phase !== "move") return;
          const maxPan = 60;
          panRef.current.targetX = Math.max(-maxPan, Math.min(maxPan, panRef.current.targetX + e.dx * 0.5));
          panRef.current.targetY = Math.max(-maxPan, Math.min(maxPan, panRef.current.targetY + e.dy * 0.5));
        },
        tap: (e) => {
          lastTouchAtRef.current = performance.now();
          if (e.fingers === 2) {
            // step back: nudge the zoom home, else pause, else reset to rest.
            if (Math.abs(zoomRef.current.target - 1) > 0.02) {
              zoomRef.current.target = 1;
            } else if (playingRef.current) {
              setPlaying(false);
            } else {
              setAmp(18); ampRef.current = 18;
              setDensity(1.2); densityRef.current = 1.2;
            }
            haptics.tap();
            return;
          }
          if (e.fingers === 3) {
            // tutti — one synchronized pulse of everything alive, as bright
            // as the chord landed.
            tuttiRef.current = 0.7 + e.intensity * 0.3;
            try { getFieldAudio().chime(); } catch { /* noop */ }
            haptics.ripple(0.4 + e.intensity * 0.3);
            addMark("tutti", "ember", 0.5 + e.intensity * 0.35);
            recordTape("sigil", 0.35 + e.intensity * 0.35, "pretext:tutti");
            return;
          }
          if (e.fingers !== 1) return;
          // one finger touches the material: a drop lands on the sentence —
          // the tide quickens where it fell, pitched by how high it landed
          const rect = stage.getBoundingClientRect();
          const yNorm = clamp((e.y - rect.top) / Math.max(1, rect.height), 0, 1);
          setPlaying(true);
          setPhase((v) => (v + 0.18 + e.intensity * 0.3) % (Math.PI * 2));
          try { getFieldAudio().playNote(48 + Math.round((1 - yNorm) * 16), 80 + Math.round(e.intensity * 100)); } catch { /* noop */ }
          haptics.ripple(0.16 + e.intensity * 0.36);
          recordTape("object", 0.3 + e.intensity * 0.35, "pretext:drop");
          // train tiers (1 / 3 / 5 / n from gesture/core): rapid taps recall,
          // crest, then flood the tide
          const trainTier = tapTrainTier(e.count);
          if (trainTier === 3 && e.count === 3) {
            // three taps turn the tide's pages: the next kept phrase takes
            // the water; with nothing kept, the swell simply rises
            const kept = keptPhrasesRef.current;
            if (kept.length > 0) {
              const at = kept.indexOf(textRef.current.trim());
              setText(kept[(at + 1 + kept.length) % kept.length]);
              addMark("recalled", "water", 0.55);
            } else {
              const swell = clamp(ampRef.current + 6, AMP_MIN, AMP_MAX);
              setAmp(swell); ampRef.current = swell;
            }
            try { getFieldAudio().playNote(55, 120); } catch { /* noop */ }
            try { getFieldAudio().playNote(62, 180); } catch { /* noop */ }
            haptics.ripple(0.45);
            recordTape("sigil", 0.5, "pretext:train-recall");
          } else if (trainTier === 5 && e.count === 5) {
            // five taps crest the tide: amplitude leaps and the meter
            // tightens — whitecaps in the sentence
            const crest = clamp(ampRef.current + 12, AMP_MIN, AMP_MAX);
            setAmp(crest); ampRef.current = crest;
            const stride = clamp(densityRef.current + 0.25, DENSITY_MIN, DENSITY_MAX);
            setDensity(Number(stride.toFixed(2))); densityRef.current = Number(stride.toFixed(2));
            try { getFieldAudio().bell(); } catch { /* noop */ }
            haptics.bloom();
            addMark("crest", "ember", 0.7);
            recordTape("sigil", 0.7, "pretext:train-crest");
          } else if (trainTier === "n") {
            // seven and beyond: the crescendo — every further tap floods the
            // words brighter and rings a rising note
            tuttiRef.current = 1;
            const flood = clamp(ampRef.current + 3, AMP_MIN, AMP_MAX);
            setAmp(flood); ampRef.current = flood;
            try { getFieldAudio().playNote(60 + (e.count - 7) * 2, 140); } catch { /* noop */ }
            if (e.count === 7) haptics.storm(); else haptics.ripple(0.55);
            recordTape("sigil", clamp(0.6 + (e.count - 7) * 0.08, 0.6, 1), "pretext:train-crescendo");
          }
        },
        scrub: (e) => {
          lastTouchAtRef.current = performance.now();
          // stir the tide: circling winds the phase with the finger — with
          // the clock the tide runs on, against it the tide runs back
          const dir = Math.sign(e.winding) || 1;
          const stirDepth = Math.min(1, Math.abs(e.winding) * 0.4 + Math.abs(e.angularVelocity) * 60);
          setPlaying(true);
          setPhase((v) => (v + dir * (0.25 + stirDepth * 0.5) + Math.PI * 2) % (Math.PI * 2));
          const now = performance.now();
          if (now - dragRef.current.lastFx > 220) {
            dragRef.current.lastFx = now;
            try { getFieldAudio().playNote(50 + (dir > 0 ? 4 : -3) + Math.round(stirDepth * 5), 110); } catch { /* noop */ }
            haptics.ripple(0.2 + stirDepth * 0.3);
            recordTape("ripple", 0.35 + stirDepth * 0.3, "pretext:stir");
          }
        },
        rhythm: (e) => {
          // a steady tapped pulse: the tide locks to your tempo and the
          // words brighten on every beat (read by the phase clock above)
          if (e.stability <= 0.7) return;
          entrainRef.current.bpm = Math.max(40, Math.min(150, e.bpm));
          entrainRef.current.until = performance.now() + 9000;
          setPlaying(true);
          try { getFieldAudio().chime(); } catch { /* noop */ }
          haptics.tap();
          addMark("entrained", "water", 0.55);
          recordTape("sigil", 0.5, "pretext:entrain");
        },
      },
      { wheelZoom: false },
    );

    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        panRef.current.targetX = Math.max(-40, Math.min(40, gamma * 0.7));
      },
      shake: ({ intensity }) => {
        tuttiRef.current = Math.max(tuttiRef.current, 0.4 + intensity * 0.5);
        haptics.chop();
      },
      knock: ({ intensity }) => {
        // a rap on the case rings the words — a harder rap rings brighter
        try { getFieldAudio().playNote(45 - Math.round(intensity * 6), 160 + Math.round(intensity * 120)); } catch { /* noop */ }
        try { getFieldAudio().chime(); } catch { /* noop */ }
        haptics.ripple(0.25 + intensity * 0.35);
        tuttiRef.current = Math.max(tuttiRef.current, 0.4 + intensity * 0.4);
      },
      flip: ({ faceDown }) => { nightRef.current = faceDown; },
    });

    // continuous eases for the frame-layer verbs — written straight to
    // style so they never trigger a React re-render.
    let raf = 0;
    let sleeping = document.hidden;
    const offVisibility = onVisibility((hidden) => { sleeping = hidden; });
    const ease = () => {
      raf = requestAnimationFrame(ease);
      if (sleeping) return;
      const z = zoomRef.current;
      z.cur += (z.target - z.cur) * 0.1;
      const p = panRef.current;
      p.curX += (p.targetX - p.curX) * 0.08;
      p.curY += (p.targetY - p.curY) * 0.08;
      stage.style.setProperty("--pretext-zoom", z.cur.toFixed(4));
      stage.style.setProperty("--pretext-pan-x", `${p.curX.toFixed(2)}px`);
      stage.style.setProperty("--pretext-pan-y", `${p.curY.toFixed(2)}px`);
      stage.style.setProperty("--pretext-season", `${((seasonRef.current / 8) * 360).toFixed(1)}deg`);
      stage.style.setProperty("--pretext-tutti", (1 + tuttiRef.current * 0.5).toFixed(3));
      stage.style.setProperty("--pretext-night", nightRef.current ? "0.4" : "0");
    };
    raf = requestAnimationFrame(ease);

    return () => {
      stage.removeEventListener("pointerdown", onContact);
      detachGestures();
      detachVessel();
      cancelAnimationFrame(raf);
      offVisibility();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pretext-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={stageRef}
        className={`pretext-stage pretext-stage--${mode}`}
        style={{
          "--pretext-amp": `${amp}px`,
          "--pretext-phase": `${phase}`,
          "--pretext-density": `${density}`,
          "--pretext-zoom": 1,
          "--pretext-pan-x": "0px",
          "--pretext-pan-y": "0px",
          "--pretext-season": "0deg",
          "--pretext-tutti": 1,
          "--pretext-night": 0,
        } as React.CSSProperties}
        aria-label="Playable text field. Drag to bend the words: up and down for amplitude, left and right for frequency."
        aria-describedby="pretext-gesture-hint"
      >
        <span ref={probeRef} className="pretext-probe">measure me</span>
        <div className="pretext-field" style={{ height: layout ? layout.height : undefined }} aria-live="polite">
          {!layout ? (
            <p className="pretext-fallback">{text}</p>
          ) : (
            layout.lines.map((line, lineIndex) => (
              <p
                key={`${line.text}-${lineIndex}`}
                className="pretext-line"
                style={{
                  top: line.top,
                  width: line.width,
                  "--line-phase": `${line.phase}`,
                } as React.CSSProperties}
              >
                {splitTokens(line.text).map((token, tokenIndex) => {
                  if (/^\s+$/.test(token)) return <span key={tokenIndex}>{token}</span>;
                  return (
                    <span
                      key={tokenIndex}
                      className="pretext-word"
                      style={{ "--word-index": `${tokenIndex}` } as React.CSSProperties}
                    >
                      {token}
                    </span>
                  );
                })}
              </p>
            ))
          )}
        </div>
        <div className="pretext-night-veil" aria-hidden="true" />
        {chargeMode && chargePct > 0 && (
          <div
            className={`pretext-charge pretext-charge--${chargeMode}`}
            aria-hidden="true"
            style={{
              left: chargePos.x,
              top: chargePos.y,
              width: 20 + chargePct * 52,
              height: 20 + chargePct * 52,
              opacity: 0.25 + chargePct * 0.55,
            }}
          />
        )}
      </div>

      <p id="pretext-gesture-hint" className="pretext-gesture-hint">
        drag <span aria-hidden="true">↔</span> frequency · <span aria-hidden="true">↕</span> amplitude
      </p>

      {keptPhrases.length > 0 && (
        <div className="pretext-kept" aria-label="kept phrases">
          {keptPhrases.slice(0, 6).map((phrase) => (
            <button
              key={phrase}
              type="button"
              title={phrase}
              onClick={() => {
                stopSpeech(null);
                setText(phrase);
                setSpeechStatus(null);
                haptics.ripple(0.4);
                addMark("recalled", "water", 0.5);
              }}
            >
              {compactPhrase(phrase)}
            </button>
          ))}
        </div>
      )}

      <LetGo label="let the kept phrases go" onLetGo={letGoKeptPhrases} visible={keptPhrases.length > 0} />

      <div className="pretext-title" aria-hidden="true">
        <span>pretext / playable sentence</span>
        <strong>
          <WaterText as="span" bobAmp={2.5} maxDisplace={7}>
            tide
          </WaterText>
        </strong>
      </div>

      <div className="pretext-state-strip" aria-hidden="true">
        <span className="pretext-state-pulse" />
        {marks.length === 0 ? (
          <span className="pretext-state-idle">{mode}</span>
        ) : (
          marks.map((mark) => (
            <span
              key={mark.id}
              className={`pretext-state-mark pretext-state-${mark.tone}`}
              style={{ opacity: 0.42 + mark.strength * 0.48 }}
            >
              {mark.label}
            </span>
          ))
        )}
      </div>

      <label className="pretext-mode-chip">
        <span>motion ·</span>
        <select
          value={mode}
          aria-label="motion mode"
          onChange={(event) => impulse(event.target.value as MotionMode)}
        >
          {MODES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>

      <MobileInstrumentPanel
        title="compose & tune"
        triggerLabel="compose"
      >
        <form
          className="pretext-prompt"
          aria-label="ask the room"
          onSubmit={(event) => {
            event.preventDefault();
            generate();
          }}
        >
          <label htmlFor="pretext-prompt-input">prompt or text</label>
          <textarea
            id="pretext-prompt-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="write the sentence you want the room to bend"
            rows={2}
            maxLength={400}
          />
          <div className="pretext-actions">
            <button type="submit" disabled={generating || !prompt.trim()}>
              {generating ? "generating" : "generate"}
            </button>
            <button
              type="button"
              onClick={() => {
                stopSpeech(null);
                setText(prompt.trim() || STARTER_TEXT);
                setSpeechStatus(null);
                haptics.ripple(0.44);
                recordTape("object", 0.46, "pretext:use-text");
                addMark("placed", "water", 0.5);
              }}
            >
              use text
            </button>
            <button type="button" onClick={speak}>
              {speaking ? "stop voice" : "speak"}
            </button>
          </div>
          <p className="t-mono pretext-status" aria-live="polite">{speechStatus ?? status}</p>
        </form>

        <div className="pretext-console" aria-label="text motion controls">
          <button type="button" className="pretext-run" onClick={togglePlay} aria-pressed={playing}>
            {playing ? "pause" : "play"}
          </button>
          <div className="pretext-modes" aria-label="motion modes">
            {MODES.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={mode === item.key}
                onClick={() => impulse(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="pretext-slider">
            <span>amp</span>
            <strong>{amp}</strong>
            <input
              type="range"
              min={AMP_MIN}
              max={AMP_MAX}
              value={amp}
              onChange={(event) => { const v = Number(event.target.value); setAmp(v); ampRef.current = v; }}
              onPointerUp={() => markControl("amp", String(amp), 0.44)}
              onKeyUp={() => markControl("amp", String(amp), 0.38)}
            />
          </label>
          <label className="pretext-slider">
            <span>freq</span>
            <strong>{density.toFixed(2)}</strong>
            <input
              type="range"
              min={DENSITY_MIN}
              max={DENSITY_MAX}
              step="0.05"
              value={density}
              onChange={(event) => { const v = Number(event.target.value); setDensity(v); densityRef.current = v; }}
              onPointerUp={() => markControl("freq", density.toFixed(2), 0.42)}
              onKeyUp={() => markControl("freq", density.toFixed(2), 0.36)}
            />
          </label>
        </div>
      </MobileInstrumentPanel>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .pretext-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          overflow: hidden;
          background:
            radial-gradient(circle at 18% 14%, rgba(200,115,42,0.16), transparent 30%),
            linear-gradient(150deg, #0c141d 0%, #16303a 52%, #ecebe1 52%, #f3efe6 100%);
          color: #15171a;
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .pretext-stage {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background:
            repeating-linear-gradient(0deg, rgba(21,23,26,0.045) 0 1px, transparent 1px 50px),
            linear-gradient(180deg, rgba(12,20,29,0) 0%, rgba(12,20,29,0) 46%, rgba(242,238,230,0.0) 46%);
          color: #15171a;
          padding: clamp(18px, 4vw, 44px);
          touch-action: none;
          cursor: grab;
          z-index: 0;
          filter: hue-rotate(var(--pretext-season, 0deg)) brightness(var(--pretext-tutti, 1));
        }
        .pretext-stage:active {
          cursor: grabbing;
        }
        .pretext-stage::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(90deg, rgba(44,74,92,0.10), transparent 34%, rgba(200,115,42,0.08)),
            radial-gradient(circle at 78% 24%, rgba(44,74,92,0.14), transparent 34%);
          pointer-events: none;
        }
        .pretext-night-veil {
          position: absolute;
          inset: 0;
          background: #05070a;
          opacity: var(--pretext-night, 0);
          transition: opacity 900ms ease;
          pointer-events: none;
          z-index: 1;
        }
        .pretext-charge {
          position: absolute;
          margin-left: -26px;
          margin-top: -26px;
          border-radius: 50%;
          pointer-events: none;
          z-index: 2;
          border: 1.5px solid rgba(255, 210, 160, 0.85);
        }
        .pretext-charge--delete {
          border-color: rgba(255, 130, 110, 0.85);
        }
        .pretext-field {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          transform:
            translateY(-50%)
            translate(var(--pretext-pan-x, 0px), var(--pretext-pan-y, 0px))
            scale(var(--pretext-zoom, 1));
          pointer-events: none;
        }
        .pretext-probe {
          position: absolute;
          left: -9999px;
          top: -9999px;
          visibility: hidden;
          font-family: var(--font-serif);
          font-size: clamp(28px, 4.4vw, 46px);
          font-style: italic;
          font-weight: 300;
        }
        .pretext-fallback,
        .pretext-line {
          font-family: var(--font-serif);
          font-size: clamp(28px, 4.4vw, 46px);
          font-style: italic;
          font-weight: 300;
          line-height: 1.12;
          letter-spacing: 0;
          color: rgba(24,30,36,0.92);
        }
        .pretext-fallback {
          position: relative;
          z-index: 1;
          margin: 0;
          padding: 0 clamp(18px, 4vw, 44px);
        }
        .pretext-line {
          position: absolute;
          z-index: 1;
          left: clamp(18px, 4vw, 44px);
          margin: 0;
          white-space: pre;
          will-change: transform;
          transform:
            translate3d(
              calc(sin((var(--pretext-phase) + var(--line-phase)) * var(--pretext-density)) * var(--pretext-amp) * 0.26),
              calc(cos((var(--pretext-phase) + var(--line-phase)) * var(--pretext-density)) * var(--pretext-amp) * 0.18),
              0
            );
        }
        .pretext-word {
          display: inline-block;
          will-change: transform, filter;
          transform:
            translateY(calc(sin((var(--pretext-phase) * var(--pretext-density)) + var(--line-phase) + (var(--word-index) * 0.48)) * var(--pretext-amp)));
        }
        .pretext-stage--move .pretext-word {
          transform:
            translateX(calc(cos(var(--pretext-phase) + (var(--word-index) * 0.7)) * var(--pretext-amp) * 0.6))
            translateY(calc(sin(var(--pretext-phase) + var(--line-phase)) * var(--pretext-amp) * 0.32));
        }
        .pretext-stage--shift .pretext-line {
          transform:
            translateX(calc(sin(var(--pretext-phase) + var(--line-phase)) * var(--pretext-amp) * 0.9));
        }
        .pretext-stage--shake .pretext-word {
          transform:
            translateX(calc(sin((var(--pretext-phase) * 7) + (var(--word-index) * 1.7)) * var(--pretext-amp) * 0.26))
            translateY(calc(cos((var(--pretext-phase) * 9) + var(--line-phase)) * var(--pretext-amp) * 0.18));
        }
        .pretext-stage--quake .pretext-line {
          filter: blur(0.2px);
          transform:
            translateX(calc(sin((var(--pretext-phase) * 10) + var(--line-phase)) * var(--pretext-amp) * 0.34))
            translateY(calc(cos((var(--pretext-phase) * 8) + var(--line-phase)) * var(--pretext-amp) * 0.28));
        }
        .pretext-stage--sine .pretext-word {
          transform:
            translateY(calc(sin((var(--word-index) * 0.72) + var(--pretext-phase)) * var(--pretext-amp) * 0.86))
            rotate(calc(cos((var(--word-index) * 0.5) + var(--pretext-phase)) * 1.5deg));
        }

        .pretext-title {
          position: fixed;
          z-index: 2;
          top: 72px;
          left: var(--pad-x);
          pointer-events: none;
        }
        .pretext-title span {
          display: block;
          margin-bottom: 6px;
          color: rgba(247,240,223,0.6);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0.02em;
          text-transform: lowercase;
        }
        .pretext-title strong {
          display: block;
          color: rgba(248,244,224,0.9);
          font-family: var(--font-serif);
          font-weight: 300;
          font-style: italic;
          font-size: clamp(52px, 9vw, 116px);
          line-height: 0.86;
          mix-blend-mode: overlay;
        }

        .pretext-gesture-hint {
          display: none;
          position: fixed;
          z-index: 2;
          left: 50%;
          bottom: 200px;
          margin: 0;
          padding: 8px 12px;
          border: 1px solid rgba(247,240,223,0.16);
          border-radius: 999px;
          background: rgba(7,15,23,0.42);
          color: rgba(247,240,223,0.62);
          font-family: var(--font-mono);
          font-size: 10px;
          line-height: 1;
          white-space: nowrap;
          pointer-events: none;
          transform: translateX(-50%);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        .pretext-state-strip {
          position: fixed;
          z-index: 3;
          top: 78px;
          right: var(--pad-x);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 7px;
          max-width: min(340px, 52vw);
          min-height: 31px;
          padding: 8px 12px;
          border: 1px solid rgba(247,240,223,0.16);
          border-radius: 999px;
          background: rgba(7,15,23,0.42);
          color: rgba(247,240,223,0.66);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          overflow: hidden;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          pointer-events: none;
        }
        .pretext-state-pulse {
          flex: 0 0 auto;
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: rgba(136,184,216,0.88);
          box-shadow: 0 0 14px rgba(136,184,216,0.44);
        }
        .pretext-state-idle,
        .pretext-state-mark {
          white-space: nowrap;
        }
        .pretext-state-water { color: rgba(174,218,233,0.86); }
        .pretext-state-ember { color: rgba(255,200,132,0.9); }
        .pretext-state-voice { color: rgba(242,238,230,0.82); }

        .pretext-mode-chip {
          display: none;
        }

        .pretext-prompt {
          position: fixed;
          z-index: 4;
          right: var(--pad-x);
          bottom: calc(122px + env(safe-area-inset-bottom, 0px));
          width: min(360px, calc(100vw - 2 * var(--pad-x)));
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          border: 1px solid rgba(247,240,223,0.14);
          border-radius: 10px;
          background: rgba(7,15,23,0.5);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 24px 60px rgba(0,0,0,0.32);
          color: rgba(247,240,223,0.92);
          pointer-events: auto;
        }
        .pretext-prompt label {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.04em;
          text-transform: lowercase;
          color: rgba(247,240,223,0.56);
        }
        .pretext-prompt textarea {
          width: 100%;
          resize: none;
          min-height: 52px;
          border: 1px solid rgba(247,240,223,0.18);
          border-radius: 6px;
          background: rgba(242,238,230,0.94);
          color: #15171a;
          padding: 10px;
          font-family: var(--font-serif);
          font-size: 17px;
          line-height: 1.32;
        }
        .pretext-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .pretext-actions button {
          flex: 1 1 84px;
          min-height: 44px;
          padding: 0 12px;
          border: 1px solid rgba(247,240,223,0.22);
          border-radius: 6px;
          background: rgba(247,240,223,0.06);
          color: inherit;
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.03em;
          text-transform: lowercase;
        }
        .pretext-actions button:disabled {
          cursor: default;
          opacity: 0.44;
        }
        .pretext-status {
          min-height: 14px;
          margin: 0;
          color: rgba(247,240,223,0.6);
          font-size: 11px;
        }

        .pretext-kept {
          position: fixed;
          z-index: 3;
          left: var(--pad-x);
          bottom: calc(200px + env(safe-area-inset-bottom, 0px));
          display: flex;
          align-items: center;
          gap: 6px;
          max-width: min(420px, calc(100vw - 2 * var(--pad-x)));
          overflow-x: auto;
          scrollbar-width: none;
          pointer-events: auto;
        }
        .pretext-kept::-webkit-scrollbar { display: none; }
        .pretext-kept button {
          flex: 0 0 auto;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border: 1px solid rgba(247,240,223,0.2);
          border-radius: 999px;
          background: rgba(7,15,23,0.5);
          color: rgba(247,240,223,0.78);
          padding: 5px 11px;
          font-family: var(--font-serif);
          font-style: italic;
          font-size: 11px;
          cursor: pointer;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        .pretext-console {
          position: fixed;
          z-index: 4;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: 92px minmax(0, 1.6fr) minmax(150px, 1fr) minmax(150px, 1fr);
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(247,240,223,0.13);
          border-radius: 10px;
          background: rgba(7,15,23,0.6);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 24px 70px rgba(0,0,0,0.36);
          pointer-events: auto;
        }
        .pretext-run,
        .pretext-slider {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(247,240,223,0.12);
          border-radius: 6px;
          background: rgba(247,240,223,0.055);
          color: rgba(247,240,223,0.9);
        }
        .pretext-run {
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 12px;
          text-transform: lowercase;
        }
        .pretext-run[aria-pressed="true"] {
          border-color: rgba(200,115,42,0.5);
          color: rgba(255,200,132,0.94);
        }
        .pretext-modes {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 6px;
        }
        .pretext-modes button {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(247,240,223,0.14);
          border-radius: 6px;
          background: rgba(247,240,223,0.05);
          color: rgba(247,240,223,0.82);
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
          text-transform: lowercase;
        }
        .pretext-modes button[aria-pressed="true"] {
          background: rgba(200,115,42,0.6);
          border-color: rgba(247,240,223,0.7);
          color: rgba(255,246,232,0.98);
        }
        .pretext-slider {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto 28px;
          gap: 4px 8px;
          align-items: center;
          padding: 7px 11px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgba(247,240,223,0.58);
        }
        .pretext-slider span {
          text-transform: lowercase;
          letter-spacing: 0.04em;
        }
        .pretext-slider strong {
          justify-self: end;
          color: rgba(255,200,132,0.94);
          font-family: var(--font-numerals, var(--font-mono));
          font-size: 13px;
          font-weight: 500;
        }
        .pretext-slider input {
          -webkit-appearance: none;
          appearance: none;
          grid-column: 1 / -1;
          width: 100%;
          height: 28px;
          margin: 0;
          background: transparent;
          accent-color: rgba(200,115,42,0.9);
          cursor: pointer;
        }
        .pretext-slider input::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(200,115,42,0.9), rgba(247,240,223,0.15));
        }
        .pretext-slider input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          margin-top: -6px;
          border: 0;
          border-radius: 4px;
          background: rgba(255,200,132,0.96);
          box-shadow: 0 0 14px rgba(200,115,42,0.7);
        }
        .pretext-slider input::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(200,115,42,0.9), rgba(247,240,223,0.15));
        }
        .pretext-slider input::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: 0;
          border-radius: 4px;
          background: rgba(255,200,132,0.96);
          box-shadow: 0 0 14px rgba(200,115,42,0.7);
        }

        body:has(.pretext-page) {
          overflow: hidden;
          background: #0c141d;
        }
        body:has(.pretext-page) header:not(.oda-site-header) {
          display: none !important;
        }
        body:has(.pretext-page) .oda-field-watch,
        body:has(.pretext-page) .oda-candle-mark,
        body:has(.pretext-page) .oda-tape-shell,
        body:has(.pretext-page) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 940px) {
          .pretext-title {
            top: 30px;
            left: 22px;
          }
          .pretext-title strong {
            font-size: clamp(46px, 13vw, 74px);
          }
          .pretext-state-strip {
            top: 34px;
            right: 16px;
            max-width: min(200px, 46vw);
          }
          .pretext-prompt {
            left: 12px;
            right: 12px;
            width: auto;
            bottom: calc(214px + env(safe-area-inset-bottom, 0px));
          }
          .pretext-console {
            left: 10px;
            right: 10px;
            bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            grid-template-columns: repeat(2, minmax(0, 1fr));
            max-height: min(46svh, 420px);
            overflow-y: auto;
          }
          .pretext-run {
            grid-column: 1 / -1;
          }
          .pretext-modes {
            grid-column: 1 / -1;
          }
        }
        @media (max-width: 520px) {
          .pretext-modes {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .pretext-slider {
            min-height: 52px;
          }
          .pretext-prompt textarea {
            font-size: 16px;
          }
        }
        @media (max-width: 720px) {
          .pretext-state-strip {
            top: 106px;
            right: 14px;
            max-width: min(180px, 48vw);
            min-height: 28px;
            padding: 7px 10px;
            font-size: 9px;
          }

          .pretext-gesture-hint {
            display: block;
            top: 148px;
            bottom: auto;
            padding: 7px 10px;
            font-size: 9px;
          }

          .pretext-mode-chip {
            position: fixed;
            z-index: 122;
            right: max(14px, env(safe-area-inset-right, 0px));
            bottom: calc(68px + env(safe-area-inset-bottom, 0px));
            min-height: 42px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(247,240,223,0.28);
            border-radius: 999px;
            padding: 0 13px;
            background: rgba(7,15,23,0.78);
            color: rgba(247,240,223,0.88);
            box-shadow: 0 12px 34px rgba(0,0,0,0.24);
            font-family: var(--font-mono);
            font-size: 9px;
            letter-spacing: 0.04em;
            text-transform: lowercase;
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
          }

          .pretext-mode-chip span {
            flex: none;
            color: rgba(247,240,223,0.54);
          }

          .pretext-mode-chip select {
            max-width: 88px;
            border: 0;
            padding: 6px 18px 6px 4px;
            color: inherit;
            background: transparent;
            font: inherit;
            text-transform: lowercase;
          }

          .mobile-instrument-panel__content > .pretext-console {
            margin-top: 10px !important;
          }

          .pretext-console {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }

          .pretext-run,
          .pretext-slider,
          .pretext-modes button {
            min-height: 48px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretext-line,
          .pretext-word {
            transform: none !important;
          }
        }
      `,
        }}
      />
    </div>
  );
}
