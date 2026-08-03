"use client";

/**
 * RoomTemplate — the distilled shape of a room, ready to copy.
 *
 * This file compiles and runs (a field of breathing motes wired to every bus
 * the site owns) but is deliberately NOT registered as a route. To build a
 * new room: read docs/new-room.md, decide the room's place in the cosmology
 * (§1 there), copy this file under a new name, and replace the mote field
 * with your material. The numbered sections below are the contract — every
 * law they demonstrate is binding (INSPIRATION.md §5, docs/gesture-grammar.md).
 *
 * What this template is NOT: a component to extend or import. Copy it.
 * Rooms own their material completely; only the buses are shared.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";

// ——— 1. Determinism: every generated thing is a pure function of a seed.
// The site-wide idiom — an inline integer hash + mulberry32. No Math.random,
// no Date.now in anything that renders (interaction timestamps are fine).

function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) & 0xffffffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Mote = { id: number; seed: number; nx: number; ny: number; born: number };

// ——— 8a. Persistence: versioned key, capped population, graceful retirement.
const STORAGE_KEY = "objetdart:room-template:v1";
const MAX_MOTES = 16;

export default function RoomTemplate() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const motesRef = useRef<Mote[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // Load what was kept; the room remembers.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { motes?: Mote[] };
        if (Array.isArray(parsed.motes)) motesRef.current = parsed.motes.slice(-MAX_MOTES);
      }
    } catch {
      /* a fresh field */
    }
    setHasKept(motesRef.current.length > 0);

    const save = () => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ motes: motesRef.current }));
      } catch {
        /* noop */
      }
      setHasKept(motesRef.current.length > 0);
    };

    // ——— 4/8b. State the hand can read: tilt and agitation feed the render.
    let tiltX = 0;
    let agitation = 0;
    let lastTouchAt = performance.now(); // for the glimmer (7)
    let glimmerAt = 0;

    // ——— 5. The vessel: passive subscription. The candle owns permission —
    // a room NEVER requests; it simply receives nothing until granted.
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (!reduced) tiltX = Math.max(-1, Math.min(1, gamma / 45));
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        agitation = Math.min(1, agitation + intensity);
        haptics.chop();
      },
    });

    const addMote = (nx: number, ny: number) => {
      const m: Mote = {
        id: hashSeed(motesRef.current.length, Math.round(nx * 997), Math.round(ny * 991)),
        seed: hashSeed(Math.round(nx * 8191), Math.round(ny * 4093), motesRef.current.length),
        nx,
        ny,
        born: performance.now(),
      };
      motesRef.current.push(m);
      // Oldest retired gracefully — never silently truncated.
      if (motesRef.current.length > MAX_MOTES) motesRef.current.shift();
      save();
      return m;
    };

    // ——— 3. The grammar. Global verbs pre-wired; your material interprets
    // them. Thresholds come from gesture/core and NOWHERE else. Never bind
    // pinch/pan2 — ScaleTravel owns two-finger travel on axis rooms (10).
    const detachGestures = attachGestures(
      canvas,
      {
        tap: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // tutti — one synchronized soft pulse of everything alive.
            agitation = Math.min(1, agitation + 0.25);
            audio.chime();
            haptics.ripple(0.4);
            return;
          }
          if (e.fingers === 2) return; // step back — ScaleTravel's verb.
          // ——— 6. Two senses in the same frame: sight (render reads
          // agitation) + sound + touch, all scaled by intensity — never a
          // constant where the hand offered a magnitude.
          agitation = Math.min(1, agitation + 0.15 * e.intensity);
          audio.playNote(52 + Math.round(e.intensity * 12), 180);
          haptics.tap();
        },
        hold: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers !== 1) return; // 3-finger hold = time dilation: wire
          // your room's clock to ×0.25 while held (omitted in the template).
          if (e.phase === "enter" && e.tier >= 1) {
            // Plant at the touch tier — never silent, never late.
            const m = addMote(e.x / Math.max(1, width), e.y / Math.max(1, height));
            audio.spark();
            haptics.ripple(0.5);
            void m;
          }
          // ——— 4. Duration is an axis: keep deepening while held. A hold
          // that does the same thing at 900ms and 2400ms is a violation.
          if (e.phase === "tick") agitation = Math.min(1, agitation + e.elapsed / 60000);
          if (e.phase === "release" && e.tier >= 3) {
            // Ceremony: the room's ONE solemn act.
            audio.bell();
            haptics.bloom();
          }
        },
        drag: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3 && !reduced) {
            // Wind — the law layer pushes the whole material.
            tiltX = Math.max(-1, Math.min(1, tiltX + e.dx * 0.002));
          }
        },
        scrub: () => {
          lastTouchAt = performance.now();
          // Stir — a discovered verb; answer in your material.
          agitation = Math.min(1, agitation + 0.2);
          audio.playNote(64, 240);
          haptics.ripple(0.4);
        },
        rhythm: (e) => {
          // Entrain the room's clock to the hand's tempo for ~9s.
          if (e.stability > 0.7) agitation = Math.min(1, agitation + 0.1);
        },
      },
      { wheelZoom: false },
    );

    // ——— 2. The shared breath: every room breathes on the one clock.
    let raf = 0;
    const draw = () => {
      const t = audio.getAudioTime() ?? performance.now() / 1000;
      const breath = reduced ? 0 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;
      agitation *= 0.985;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#0a0d12";
      ctx.fillRect(0, 0, width, height);

      const now = performance.now();
      for (const m of motesRef.current) {
        const rng = mulberry32(m.seed);
        const wobble = reduced ? 0 : Math.sin(t * (0.4 + rng() * 0.5) + rng() * 7) * 4;
        const x = m.nx * width + wobble + tiltX * 18 * rng();
        const y = m.ny * height + (reduced ? 0 : Math.cos(t * 0.3 + rng() * 5) * 3);
        const r = 2.2 + rng() * 3 + breath * 1.6 + agitation * 3;
        ctx.beginPath();
        ctx.fillStyle = `rgba(243, 215, 122, ${0.35 + breath * 0.25 + agitation * 0.3})`;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // ——— 7. Glimmer: after ~20s idle, one physical hint. Never text.
      if (now - lastTouchAt > 20000 && now - glimmerAt > 6000 && !reduced) {
        glimmerAt = now;
      }
      if (glimmerAt && now - glimmerAt < 1600) {
        const u = (now - glimmerAt) / 1600;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(238, 234, 219, ${0.25 * (1 - u)})`;
        ctx.arc(width * 0.5, height * 0.6, 14 + u * 34, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // ——— 9. The keyboard dialect: nothing is touch-only.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        addMote(0.3 + 0.4 * mulberry32(hashSeed(motesRef.current.length))(), 0.5);
        audio.spark();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      observer.disconnect();
      detachGestures();
      detachVessel();
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, []);

  // ——— 8c. The quiet clear: the shared <LetGo> control at bottom-center of
  // every page that keeps things — hard to hit by accident, clear of browser
  // chrome, in the room's own words (lowercase, two of the three registers,
  // five words or fewer). Visible only when something stands. The act is an
  // exhale, never a blink-delete: in a real room, retire the population
  // gracefully over ~1.5-2s in its own material (a quick fade under reduced
  // motion). Storage is written empty at once — an empty room is a
  // remembered state, and starters never respawn over a deliberate clearing.
  const letGo = () => {
    motesRef.current = [];
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ motes: [] }));
    } catch {
      /* noop */
    }
    setHasKept(false);
    getFieldAudio().thud();
    haptics.roll();
  };

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#0a0d12" }}>
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="a field of motes"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <LetGo label="let the field go" onLetGo={letGo} visible={hasKept} />
      {/* ——— 10. Axis rooms mount ScaleTravel in their page.tsx:
          <ScaleTravel route="/your-room" /> — and NEVER bind pinch/pan2
          themselves. See docs/new-room.md §1 for the ordinal decision. */}
    </div>
  );
}
