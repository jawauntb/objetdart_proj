"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";

/**
 * /watch — the "object that emanates."
 *
 * A still life of a room at night with a window onto the sea. The candle
 * is the absolute centerpiece: multi-layer flame, sparks, smoke that
 * curls toward the cursor. Around it, small magical instruments —
 * a ticking clock, a music box that plays a tiny generative melody, a
 * picture frame whose image morphs as a procedural sea scene. The window
 * occasionally shows a small boat passing by. The wall breathes warm and
 * cool with the time of day. Rare whisper-words float through the room.
 */

type Spark = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number };
type Whisper = { text: string; x: number; y: number; t0: number; duration: number; hovered: boolean };

export default function Watch() {
  // page-specific ambient bed: precise ticks over far water
  useEffect(() => { getFieldAudio().setAmbientProfile("watch"); }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [whisperState, setWhisperState] = useState<Whisper | null>(null);

  const cursor = useRef({ x: -9999, y: -9999, tx: -9999, ty: -9999, over: false });
  const lit = useRef({ candle: 0, glass: 0, book: 0, record: 0, window: 0, clock: 0, music: 0, frame: 0 });

  // candle alive / snuff state.
  const candleState = useRef({
    alive: 1,
    flameScale: 1,
    pressStart: 0,
    snuffStart: 0,
  });

  // sparks rising from the flame.
  const sparks = useRef<Spark[]>([]);

  // record state.
  const record = useRef({
    playing: false,
    sinceStart: 0,
    spin: 0,
    spinDir: 1,
    mood: 0,
    clickCount: 0,
    lastClickAt: 0,
    clickTimer: null as ReturnType<typeof setTimeout> | null,
  });

  // book.
  const book = useRef({
    openUntil: 0,
    pageTurn: 0,
    pageTurnStart: 0,
    pageIdx: 0,
  });

  // glass fill.
  const glass = useRef({
    fill: 0,
    overflowAt: 0,
  });
  const glassRipples = useRef<Array<{ t0: number }>>([]);

  // window reflection + breath fog.
  const windowRefl = useRef({
    offsetX: 0,
    offsetY: 0,
    targetX: 0,
    targetY: 0,
    taps: 0,
    lastTapAt: 0,
    scintUntil: 0,
  });
  const windowBreath = useRef<Array<{ x: number; y: number; t0: number }>>([]);

  // a small boat that occasionally drifts across the window. boat.x is
  // a fraction of window width; boat.dir is +1 left→right or -1.
  const boat = useRef({
    active: false,
    x: -0.2,
    dir: 1,
    speed: 0.02, // window-widths per second
    bobPhase: 0,
    spawnAt: performance.now() + 6000,
  });

  // music box state — a small playing scheduler.  When `playingUntil` is in
  // the future, we render a wound-up animation.
  const musicBox = useRef({
    playingUntil: 0,
    spin: 0,
    lastNoteAt: 0,
    noteIdx: 0,
  });

  // picture frame state — a procedural sea scene that morphs by phase.
  const frame = useRef({
    morphPhase: 0,
    lastTapAt: 0,
  });

  // wall marks.
  const wallMarks = useRef<Array<{ x: number; y: number; t0: number }>>([]);

  // next whisper time.
  const whisperNextAt = useRef(performance.now() + 12000);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = window.innerWidth * dpr;
      cv.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // geometry — re-derive object positions every frame to follow viewport.
    const geometry = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const winLeft = w * 0.20;
      const winRight = w * 0.80;
      const winTop = h * 0.10;
      const winBottom = h * 0.52;
      const sillY = winBottom + 8;
      const tableTop = sillY + 18;
      const tableBottom = h * 0.96;

      // Candle is the centerpiece — moved closer to center, slightly larger.
      const candleX = w * 0.50;
      // small objects on either side of the candle.
      const glassX = candleX - w * 0.13;
      const bookX = candleX + w * 0.12;
      const recordX = candleX + w * 0.24;
      // a clock on the wall above the window, music box on the windowsill,
      // a picture frame to the LEFT of the window.
      const clockX = w * 0.50;
      const clockY = winTop - 50;
      const musicX = w * 0.62;
      const musicY = sillY - 8;
      const frameX = winLeft - 60;
      const frameY = winTop + (winBottom - winTop) * 0.35;
      const yLine = tableTop + (tableBottom - tableTop) * 0.42;

      return {
        w, h,
        winLeft, winRight, winTop, winBottom, sillY, tableTop, tableBottom,
        candle: { x: candleX, y: yLine, w: 26, h: 100, hitR: 80 },
        glass:  { x: glassX,  y: yLine + 16, w: 30, h: 50, hitR: 56 },
        book:   { x: bookX,   y: yLine + 8,  w: 60, h: 16, hitR: 50 },
        record: { x: recordX, y: yLine + 6,  r: 30, hitR: 50 },
        clock:  { x: clockX,  y: clockY,    r: 22, hitR: 36 },
        music:  { x: musicX,  y: musicY,    w: 42, h: 28, hitR: 36 },
        frame:  { x: frameX,  y: frameY,    w: 56, h: 44, hitR: 40 },
      };
    };

    const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) =>
      x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

    type HitKind =
      | "candle" | "glass" | "book" | "record" | "window" | "wall" | "page"
      | "clock" | "music" | "frame" | "boat" | "whisper";
    const hitTest = (x: number, y: number): HitKind => {
      const g = geometry();
      // candle (big body + flame area)
      if (Math.hypot(x - g.candle.x, y - (g.candle.y - g.candle.h / 2)) < 44) return "candle";
      // clock (small disk above window)
      if (Math.hypot(x - g.clock.x, y - g.clock.y) < g.clock.r + 8) return "clock";
      // music box (rect on sill)
      if (
        x >= g.music.x - g.music.w / 2 && x <= g.music.x + g.music.w / 2 &&
        y >= g.music.y - g.music.h && y <= g.music.y + 4
      ) return "music";
      // picture frame (rect on left of window)
      if (
        x >= g.frame.x - g.frame.w / 2 && x <= g.frame.x + g.frame.w / 2 &&
        y >= g.frame.y - g.frame.h / 2 && y <= g.frame.y + g.frame.h / 2
      ) return "frame";
      // boat (if active) — check inside window's sea band
      if (boat.current.active) {
        const bx = g.winLeft + boat.current.x * (g.winRight - g.winLeft);
        const by = g.winTop + (g.winBottom - g.winTop) * 0.80;
        if (Math.hypot(x - bx, y - by) < 26) return "boat";
      }
      // whisper hovers
      if (whisperState && performance.now() - whisperState.t0 < whisperState.duration) {
        if (Math.hypot(x - whisperState.x, y - whisperState.y) < 60) return "whisper";
      }
      // glass
      if (Math.hypot(x - g.glass.x, y - (g.glass.y - g.glass.h / 2)) < 32) return "glass";
      // book
      const isBookOpen = performance.now() < book.current.openUntil;
      if (isBookOpen) {
        const pageW = g.book.w + 30;
        const pageH = g.book.h + 36;
        if (
          x >= g.book.x - pageW / 2 && x <= g.book.x + pageW / 2 &&
          y >= g.book.y - pageH && y <= g.book.y
        ) return "page";
      } else {
        if (Math.abs(x - g.book.x) < g.book.w / 1.4 && Math.abs(y - (g.book.y - g.book.h / 2)) < 18) return "book";
      }
      // record
      if (Math.hypot(x - g.record.x, y - g.record.y) < g.record.r + 6) return "record";
      // window pane
      if (inRect(x, y, { x: g.winLeft + 3, y: g.winTop + 3, w: (g.winRight - g.winLeft) - 6, h: (g.winBottom - g.winTop) - 6 })) {
        return "window";
      }
      return "wall";
    };

    // ── pointer interaction ──────────────────────────────────────
    const onMove = (e: PointerEvent) => {
      cursor.current.tx = e.clientX;
      cursor.current.ty = e.clientY;
      cursor.current.over = true;
      const g = geometry();
      const inWindow =
        e.clientX >= g.winLeft && e.clientX <= g.winRight &&
        e.clientY >= g.winTop && e.clientY <= g.winBottom;
      if (inWindow) {
        const last = windowBreath.current[windowBreath.current.length - 1];
        if (!last || performance.now() - last.t0 > 200) {
          windowBreath.current.push({ x: e.clientX, y: e.clientY, t0: performance.now() });
          if (windowBreath.current.length > 8) windowBreath.current.shift();
        }
      }
    };
    const onLeave = () => { cursor.current.over = false; };

    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    const recordState = record.current;
    const cancelLongPress = () => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      candleState.current.pressStart = 0;
    };

    const onPointerDown = (e: PointerEvent) => {
      const what = hitTest(e.clientX, e.clientY);
      if (what === "candle" && candleState.current.alive > 0.5) {
        candleState.current.pressStart = performance.now();
        longPressTimer = setTimeout(() => {
          if (candleState.current.pressStart > 0) {
            candleState.current.alive = 0;
            candleState.current.snuffStart = performance.now();
            const audio = getFieldAudio();
            audio.thud();
            useField.getState().recordTape("candle", 0.4, "watch:snuff");
          }
          longPressTimer = null;
        }, 800);
      }
    };
    const onPointerUp = () => { cancelLongPress(); };
    const onPointerCancel = () => { cancelLongPress(); };

    const playMusicBoxMelody = () => {
      const audio = getFieldAudio();
      // a small generative C-major-ish phrase (8 notes)
      // pitches in MIDI: choose a pleasant pentatonic
      const tonics = [60, 62, 64, 67, 69, 72, 74, 76]; // C, D, E, G, A, C5, D5, E5
      // randomize order with bias forward
      let cursorIdx = 0;
      const playOne = () => {
        if (cursorIdx >= 8) return;
        // walk: ±1 step with occasional skip
        const step = Math.random() < 0.65 ? 1 : (Math.random() < 0.5 ? -1 : 2);
        let nextIdx = cursorIdx + step;
        if (nextIdx < 0) nextIdx = 0;
        if (nextIdx >= tonics.length) nextIdx = tonics.length - 1;
        const midi = tonics[nextIdx];
        audio.playNote(midi, 180);
        cursorIdx++;
        if (cursorIdx < 8) window.setTimeout(playOne, 220);
      };
      window.setTimeout(playOne, 60);
      musicBox.current.playingUntil = performance.now() + 220 * 8 + 200;
      musicBox.current.noteIdx = 0;
    };

    const onClick = (e: MouseEvent) => {
      if (candleState.current.snuffStart > 0 && performance.now() - candleState.current.snuffStart < 250) {
        return;
      }
      const g = geometry();
      const x = e.clientX, y = e.clientY;
      const audio = getFieldAudio();
      const tape = useField.getState().recordTape;
      const what = hitTest(x, y);

      if (what === "candle") {
        if (candleState.current.alive < 0.5) {
          candleState.current.alive = 1;
          candleState.current.snuffStart = 0;
          audio.spark();
          tape("candle", 0.9, "watch:relight");
        } else {
          audio.spark();
          tape("candle", 0.9, "watch");
        }
        return;
      }

      if (what === "clock") {
        audio.chime();
        // gentle pendulum kick — set lit to 1
        lit.current.clock = 1;
        tape("object", 0.4, "clock");
        return;
      }

      if (what === "music") {
        playMusicBoxMelody();
        lit.current.music = 1;
        tape("sigil", 0.8, "music-box");
        return;
      }

      if (what === "frame") {
        // advance morph phase one stage
        frame.current.morphPhase = (frame.current.morphPhase + 1) % 5;
        frame.current.lastTapAt = performance.now();
        audio.bell();
        tape("object", 0.6, `frame:phase${frame.current.morphPhase}`);
        return;
      }

      if (what === "boat") {
        audio.chime();
        tape("object", 0.8, "watch:boat");
        // boat slows briefly so the chime feels acknowledged
        boat.current.speed *= 0.6;
        return;
      }

      if (what === "whisper") {
        // hovering/clicking a whisper makes it solid for 1.5s
        if (whisperState) {
          setWhisperState({ ...whisperState, hovered: true });
          audio.bell();
          tape("ripple", 0.6, `whisper:${whisperState.text}`);
        }
        return;
      }

      if (what === "glass") {
        glassRipples.current.push({ t0: performance.now() });
        if (glassRipples.current.length > 6) glassRipples.current.shift();
        if (glass.current.fill < 5) {
          glass.current.fill += 1;
          const detune = (glass.current.fill - 1) * 80;
          oneShotChime(audio, 880 + detune, 1320 + detune);
          tape("ripple", 0.5, `glass:${glass.current.fill}`);
        } else {
          glass.current.overflowAt = performance.now();
          oneShotDrop(audio);
          tape("ripple", 0.7, "glass:overflow");
        }
        return;
      }

      if (what === "book") {
        book.current.openUntil = performance.now() + 5000;
        book.current.pageIdx = 0;
        audio.thud();
        tape("object", 0.6, "book:open");
        return;
      }
      if (what === "page") {
        book.current.openUntil = Math.max(book.current.openUntil, performance.now() + 4000);
        book.current.pageTurnStart = performance.now();
        book.current.pageTurn = 0.0001;
        book.current.pageIdx = (book.current.pageIdx + 1) % 5;
        oneShotRustle(audio);
        tape("object", 0.4, `book:page${book.current.pageIdx}`);
        return;
      }

      if (what === "record") {
        const now = performance.now();
        if (now - record.current.lastClickAt > 380) {
          record.current.clickCount = 0;
        }
        record.current.clickCount += 1;
        record.current.lastClickAt = now;
        if (record.current.clickTimer !== null) {
          clearTimeout(record.current.clickTimer);
          record.current.clickTimer = null;
        }
        record.current.clickTimer = setTimeout(() => {
          const taps = record.current.clickCount;
          record.current.clickCount = 0;
          record.current.clickTimer = null;
          if (taps >= 3) {
            record.current.mood = (record.current.mood + 1) % MOOD_SHAPES.length;
            const shape = MOOD_SHAPES[record.current.mood];
            audio.bell();
            audio.playSigilPhrase(shape);
            record.current.playing = true;
            record.current.sinceStart = performance.now();
            tape("sigil", 1.0, `record:mood${record.current.mood}`);
            setTimeout(() => { record.current.playing = false; }, 12200);
          } else if (taps === 2) {
            record.current.spinDir *= -1;
            audio.chime();
            tape("object", 0.5, "record:flip");
          } else {
            if (record.current.playing) {
              record.current.playing = false;
              audio.thud();
              tape("object", 0.4, "record:stop");
            } else {
              record.current.playing = true;
              record.current.sinceStart = performance.now();
              audio.bell();
              const shape = MOOD_SHAPES[record.current.mood];
              audio.playSigilPhrase(shape);
              tape("sigil", 1.0, "record");
              setTimeout(() => { record.current.playing = false; }, 12200);
            }
          }
        }, 320);
        return;
      }

      if (what === "window") {
        const r = windowRefl.current;
        const now = performance.now();
        const cx = (g.winLeft + g.winRight) / 2;
        const cy = (g.winTop + g.winBottom) / 2;
        const dx = (x - cx) * 0.06;
        const dy = (y - cy) * 0.06;
        r.targetX = Math.max(-40, Math.min(40, r.targetX + dx));
        r.targetY = Math.max(-20, Math.min(20, r.targetY + dy));
        if (now - r.lastTapAt < 900) {
          r.taps += 1;
        } else {
          r.taps = 1;
        }
        r.lastTapAt = now;
        if (r.taps >= 3) {
          r.scintUntil = now + 1200;
        }
        oneShotChime(audio, 1180, 1480, 0.18);
        tape("ripple", 0.4, "window");
        return;
      }

      if (what === "wall") {
        wallMarks.current.push({ x, y, t0: performance.now() });
        if (wallMarks.current.length > 18) wallMarks.current.shift();
        tape("object", 0.3, "wall");
        return;
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    cv.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    cv.addEventListener("click", onClick);

    // ── whisper scheduler — every ~14-28s spawn a fresh one ────
    const whisperWords = ["listen", "stay", "breathe", "watch", "remember", "still"];
    const spawnWhisper = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const text = whisperWords[Math.floor(Math.random() * whisperWords.length)];
      // place it somewhere on the wall / above the table
      const x = w * (0.20 + Math.random() * 0.60);
      const y = h * (0.18 + Math.random() * 0.40);
      setWhisperState({ text, x, y, t0: performance.now(), duration: 4000, hovered: false });
    };
    const whisperCheck = window.setInterval(() => {
      const now = performance.now();
      if (now > whisperNextAt.current) {
        if (!reduce) spawnWhisper();
        whisperNextAt.current = now + 14000 + Math.random() * 14000;
      }
    }, 1200);

    // ── render loop ──────────────────────────────────────────────
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const g = geometry();
      const motion = reduce ? 0 : 1;

      const c = cursor.current;
      c.x += (c.tx - c.x) * 0.20;
      c.y += (c.ty - c.y) * 0.20;

      const dist = (ax: number, ay: number) => Math.hypot(c.x - ax, c.y - ay);
      const proximity = (d: number, max: number) => Math.max(0, 1 - d / max);
      const targetLit = {
        candle: proximity(dist(g.candle.x, g.candle.y - g.candle.h / 2), g.candle.hitR * 1.8),
        glass:  proximity(dist(g.glass.x,  g.glass.y),                   g.glass.hitR  * 1.8),
        book:   proximity(dist(g.book.x,   g.book.y),                    g.book.hitR   * 1.8),
        record: proximity(dist(g.record.x, g.record.y),                  g.record.hitR * 1.8),
        clock:  proximity(dist(g.clock.x,  g.clock.y),                   g.clock.hitR  * 1.8),
        music:  proximity(dist(g.music.x,  g.music.y),                   g.music.hitR  * 1.8),
        frame:  proximity(dist(g.frame.x,  g.frame.y),                   g.frame.hitR  * 1.8),
        window: (c.over &&
          c.x > g.winLeft - 60 && c.x < g.winRight + 60 &&
          c.y > g.winTop - 60 && c.y < g.winBottom + 60)
          ? 1 - Math.max(0,
              Math.max(g.winLeft - c.x, c.x - g.winRight, g.winTop - c.y, c.y - g.winBottom, 0)
            ) / 60
          : 0,
      };
      lit.current.candle += (targetLit.candle - lit.current.candle) * 0.10;
      lit.current.glass  += (targetLit.glass  - lit.current.glass)  * 0.10;
      lit.current.book   += (targetLit.book   - lit.current.book)   * 0.10;
      lit.current.record += (targetLit.record - lit.current.record) * 0.10;
      lit.current.window += (targetLit.window - lit.current.window) * 0.10;
      lit.current.clock  += (targetLit.clock  - lit.current.clock)  * 0.10;
      lit.current.music  += (targetLit.music  - lit.current.music)  * 0.10;
      lit.current.frame  += (targetLit.frame  - lit.current.frame)  * 0.10;

      const cs = candleState.current;
      if (cs.alive < 0.5) {
        const sinceSnuff = now - cs.snuffStart;
        const target = sinceSnuff < 600 ? Math.max(0, 1 - sinceSnuff / 600) : 0;
        cs.flameScale += (target - cs.flameScale) * (reduce ? 1 : 0.20);
      } else {
        cs.flameScale += (1 - cs.flameScale) * (reduce ? 1 : 0.16);
      }

      // ── time of day cycle (90s) ──
      const dayPhase = (t * (Math.PI * 2) / 90) % (Math.PI * 2);
      const sun = (Math.sin(dayPhase - Math.PI / 2) + 1) / 2;
      const dawnWarmth = Math.max(0, Math.sin(dayPhase)) * (1 - sun);

      const cold = 1 - cs.flameScale;

      // ── wall (with slow color breath tied to time of day) ──
      // breath: pulse around the base wall color over ~12s
      const breath = (Math.sin(t * 0.52) + 1) / 2; // 0..1
      const warmShift = (sun * 0.5) + (dawnWarmth * 0.8) + breath * 0.15;
      const wallR = 28 - cold * 16 + warmShift * 8;
      const wallG2 = 22 - cold * 10 + warmShift * 4;
      const wallB = 18 - cold * 2 + cold * 6 + breath * 2;
      const wallGrad = ctx.createLinearGradient(0, 0, 0, g.h);
      wallGrad.addColorStop(0, `rgba(${wallR | 0}, ${wallG2 | 0}, ${wallB | 0}, 1)`);
      wallGrad.addColorStop(1, `rgba(${(wallR * 0.5) | 0}, ${(wallG2 * 0.55) | 0}, ${(wallB * 0.8) | 0}, 1)`);
      ctx.fillStyle = wallGrad;
      ctx.fillRect(0, 0, g.w, g.h);

      // ── window: sky + sea ──
      const skyR = 10 + sun * 90 + dawnWarmth * 80;
      const skyG = 18 + sun * 110 + dawnWarmth * 60;
      const skyB = 34 + sun * 150 + dawnWarmth * 30;
      const seaR = 8 + sun * 30;
      const seaG = 18 + sun * 50;
      const seaB = 38 + sun * 70;

      const skyGrad = ctx.createLinearGradient(0, g.winTop, 0, g.winBottom * 0.7);
      skyGrad.addColorStop(0, `rgb(${skyR | 0}, ${skyG | 0}, ${skyB | 0})`);
      skyGrad.addColorStop(1, `rgb(${(skyR * 0.8) | 0}, ${(skyG * 0.8) | 0}, ${(skyB * 0.85) | 0})`);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(g.winLeft, g.winTop, g.winRight - g.winLeft, g.winBottom - g.winTop);

      const seaTop = g.winTop + (g.winBottom - g.winTop) * 0.65;
      const seaGrad = ctx.createLinearGradient(0, seaTop, 0, g.winBottom);
      seaGrad.addColorStop(0, `rgb(${(seaR + 10) | 0}, ${(seaG + 20) | 0}, ${(seaB + 20) | 0})`);
      seaGrad.addColorStop(1, `rgb(${seaR | 0}, ${seaG | 0}, ${seaB | 0})`);
      ctx.fillStyle = seaGrad;
      ctx.fillRect(g.winLeft, seaTop, g.winRight - g.winLeft, g.winBottom - seaTop);

      if (sun < 0.4) {
        const starAlpha = (0.4 - sun) * 2.2;
        ctx.fillStyle = `rgba(240, 244, 248, ${starAlpha})`;
        for (let i = 0; i < 40; i++) {
          const sx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
          const sy = (((Math.sin(i * 78.233) * 43758.5453) % 1) + 1) % 1;
          const x = g.winLeft + sx * (g.winRight - g.winLeft);
          const y = g.winTop + sy * (seaTop - g.winTop) * 0.95;
          const tw = 0.7 + 0.3 * Math.sin(t * 1.4 + i * 1.7);
          ctx.globalAlpha = starAlpha * tw;
          ctx.fillRect(x, y, 1.2, 1.2);
        }
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = `rgba(${(seaR + 40) | 0}, ${(seaG + 60) | 0}, ${(seaB + 70) | 0}, 0.45)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const y = seaTop + (i / 4) * (g.winBottom - seaTop) + 4;
        ctx.beginPath();
        for (let x = g.winLeft; x <= g.winRight; x += 4) {
          const phase = x * 0.02 + t * 0.4 + i * 0.7;
          const yy = y + Math.sin(phase) * 2 * motion;
          if (x === g.winLeft) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }

      // ── boat in the window (clip to pane) ──
      // Spawn if inactive and we passed boat.spawnAt
      if (!boat.current.active && now > boat.current.spawnAt) {
        boat.current.active = true;
        boat.current.dir = Math.random() < 0.5 ? 1 : -1;
        boat.current.x = boat.current.dir > 0 ? -0.15 : 1.15;
        boat.current.speed = 0.020 + Math.random() * 0.010;
      }
      if (boat.current.active) {
        const dt = motion ? Math.min(0.05, 1 / 60) : 0;
        boat.current.x += boat.current.dir * boat.current.speed * dt * 6;
        boat.current.bobPhase += dt * 1.2;
        if (boat.current.dir > 0 && boat.current.x > 1.2) {
          boat.current.active = false;
          boat.current.spawnAt = now + 14000 + Math.random() * 16000;
        } else if (boat.current.dir < 0 && boat.current.x < -0.2) {
          boat.current.active = false;
          boat.current.spawnAt = now + 14000 + Math.random() * 16000;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.winLeft + 3, seaTop, g.winRight - g.winLeft - 6, g.winBottom - seaTop);
        ctx.clip();
        const bx = g.winLeft + boat.current.x * (g.winRight - g.winLeft);
        const by = g.winTop + (g.winBottom - g.winTop) * 0.80 + Math.sin(boat.current.bobPhase) * 1.4;
        // hull
        ctx.fillStyle = "rgba(40, 30, 24, 0.92)";
        ctx.beginPath();
        ctx.moveTo(bx - 9, by);
        ctx.lineTo(bx + 9, by);
        ctx.lineTo(bx + 6, by + 4);
        ctx.lineTo(bx - 6, by + 4);
        ctx.closePath();
        ctx.fill();
        // mast
        ctx.strokeStyle = "rgba(40, 30, 24, 0.92)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx, by - 12);
        ctx.stroke();
        // sail (triangle)
        ctx.fillStyle = "rgba(232, 220, 200, 0.78)";
        ctx.beginPath();
        ctx.moveTo(bx, by - 12);
        ctx.lineTo(bx + 7, by - 1);
        ctx.lineTo(bx, by - 1);
        ctx.closePath();
        ctx.fill();
        // lantern dot — warm at night
        if (sun < 0.4) {
          ctx.fillStyle = `rgba(255, 200, 110, ${0.75})`;
          ctx.beginPath();
          ctx.arc(bx + (boat.current.dir > 0 ? 5 : -5), by - 6, 1.4, 0, 7);
          ctx.fill();
        }
        ctx.restore();
      }

      // window reflection (moon/sun)
      {
        const r = windowRefl.current;
        r.offsetX += (r.targetX - r.offsetX) * 0.08;
        r.offsetY += (r.targetY - r.offsetY) * 0.08;
        r.targetX *= 0.985;
        r.targetY *= 0.985;
        const reflX = (g.winLeft + g.winRight) / 2 + r.offsetX;
        const reflY = g.winTop + (g.winBottom - g.winTop) * (0.25 + (1 - sun) * 0.10) + r.offsetY;
        const reflR = 12 + (1 - sun) * 6;
        const isMoon = sun < 0.5;
        const reflColor = isMoon
          ? "rgba(238, 240, 250, 0.78)"
          : "rgba(255, 232, 178, 0.62)";
        const scintActive = now < r.scintUntil ? 1 : 0;
        const reflAlphaBase = isMoon ? 0.78 : 0.62;
        const reflPulse = scintActive
          ? 0.85 + 0.15 * Math.sin(t * 24)
          : 1.0;
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.winLeft + 3, g.winTop + 3, g.winRight - g.winLeft - 6, g.winBottom - g.winTop - 6);
        ctx.clip();
        const reflGrad = ctx.createRadialGradient(reflX, reflY, 0, reflX, reflY, reflR * 2.2);
        reflGrad.addColorStop(0, isMoon
          ? `rgba(245, 248, 255, ${reflAlphaBase * reflPulse})`
          : `rgba(255, 242, 196, ${reflAlphaBase * reflPulse})`);
        reflGrad.addColorStop(0.5, reflColor);
        reflGrad.addColorStop(1, isMoon
          ? "rgba(238, 240, 250, 0)"
          : "rgba(255, 232, 178, 0)");
        ctx.fillStyle = reflGrad;
        ctx.beginPath();
        ctx.arc(reflX, reflY, reflR * 2.2, 0, 7);
        ctx.fill();
        if (scintActive) {
          for (let i = 0; i < 6; i++) {
            const ang = (i / 6) * Math.PI * 2 + t * 1.6;
            const rr = reflR * (1.5 + 0.7 * Math.sin(t * 5 + i));
            const sxk = reflX + Math.cos(ang) * rr;
            const syk = reflY + Math.sin(ang) * rr;
            ctx.fillStyle = "rgba(255, 252, 240, 0.85)";
            ctx.fillRect(sxk, syk, 1.4, 1.4);
          }
        }
        ctx.restore();
      }

      // window frame
      const winGlow = lit.current.window;
      ctx.strokeStyle = `rgba(${(70 + winGlow * 40) | 0}, ${(50 + winGlow * 30) | 0}, ${(30 + winGlow * 20) | 0}, ${0.95})`;
      ctx.lineWidth = 6 + winGlow * 2;
      ctx.strokeRect(g.winLeft, g.winTop, g.winRight - g.winLeft, g.winBottom - g.winTop);
      ctx.lineWidth = 3 + winGlow * 1;
      ctx.beginPath();
      ctx.moveTo((g.winLeft + g.winRight) / 2, g.winTop);
      ctx.lineTo((g.winLeft + g.winRight) / 2, g.winBottom);
      ctx.moveTo(g.winLeft, (g.winTop + g.winBottom) / 2);
      ctx.lineTo(g.winRight, (g.winTop + g.winBottom) / 2);
      ctx.stroke();

      windowBreath.current = windowBreath.current.filter((b) => now - b.t0 < 1400);
      windowBreath.current.forEach((b) => {
        const age = (now - b.t0) / 1400;
        const r = 36 + age * 18;
        const a = 0.18 * (1 - age);
        const fg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
        fg.addColorStop(0, `rgba(245, 245, 250, ${a})`);
        fg.addColorStop(1, `rgba(245, 245, 250, 0)`);
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.winLeft + 3, g.winTop + 3, g.winRight - g.winLeft - 6, g.winBottom - g.winTop - 6);
        ctx.clip();
        ctx.fillStyle = fg;
        ctx.fillRect(b.x - r, b.y - r, r * 2, r * 2);
        ctx.restore();
      });

      // sill
      ctx.fillStyle = "rgba(76, 54, 34, 0.95)";
      ctx.fillRect(g.winLeft - 12, g.sillY, (g.winRight + 12) - (g.winLeft - 12), 14);

      // ── clock on the wall ──
      {
        const cl = g.clock;
        const clockAlive = lit.current.clock;
        // disk
        const baseColor = `rgba(${(232 + clockAlive * 20) | 0}, ${(218 + clockAlive * 16) | 0}, ${(192 + clockAlive * 10) | 0}, 0.92)`;
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(cl.x, cl.y, cl.r, 0, Math.PI * 2);
        ctx.fill();
        // rim
        ctx.strokeStyle = "rgba(40, 30, 22, 0.85)";
        ctx.lineWidth = 1.2 + clockAlive * 0.6;
        ctx.beginPath();
        ctx.arc(cl.x, cl.y, cl.r, 0, Math.PI * 2);
        ctx.stroke();
        // tick marks
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
          const r1 = cl.r - 4;
          const r2 = cl.r - 1;
          ctx.strokeStyle = "rgba(40, 30, 22, 0.55)";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(cl.x + Math.cos(a) * r1, cl.y + Math.sin(a) * r1);
          ctx.lineTo(cl.x + Math.cos(a) * r2, cl.y + Math.sin(a) * r2);
          ctx.stroke();
        }
        // hands — minute hand sweeps at audio LFO rate (0.14 Hz from ambient noise).
        // Use t * 0.14 * 2π as the canonical phase so we stay in sync.
        const lfoPhase = t * 0.14 * Math.PI * 2;
        const minAng = lfoPhase - Math.PI / 2;
        const hourAng = lfoPhase / 12 - Math.PI / 2;
        // minute (long)
        ctx.strokeStyle = "rgba(40, 30, 22, 0.92)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cl.x, cl.y);
        ctx.lineTo(cl.x + Math.cos(minAng) * (cl.r - 6), cl.y + Math.sin(minAng) * (cl.r - 6));
        ctx.stroke();
        // hour (short, thicker)
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(cl.x, cl.y);
        ctx.lineTo(cl.x + Math.cos(hourAng) * (cl.r - 12), cl.y + Math.sin(hourAng) * (cl.r - 12));
        ctx.stroke();
        // center pin
        ctx.fillStyle = "rgba(40, 30, 22, 0.92)";
        ctx.beginPath();
        ctx.arc(cl.x, cl.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        // pendulum dangle below (a tiny tick visualizer)
        const pSwing = Math.sin(t * 1.0) * 6;
        ctx.strokeStyle = "rgba(40, 30, 22, 0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cl.x, cl.y + cl.r);
        ctx.lineTo(cl.x + pSwing, cl.y + cl.r + 14);
        ctx.stroke();
        ctx.fillStyle = "rgba(200, 115, 42, 0.92)";
        ctx.beginPath();
        ctx.arc(cl.x + pSwing, cl.y + cl.r + 14, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── picture frame (procedural sea scene that morphs) ──
      {
        const fr = g.frame;
        const fAlive = lit.current.frame;
        // outer frame
        ctx.fillStyle = `rgba(${(60 + fAlive * 30) | 0}, ${(44 + fAlive * 16) | 0}, ${(30 + fAlive * 8) | 0}, 0.96)`;
        ctx.fillRect(fr.x - fr.w / 2, fr.y - fr.h / 2, fr.w, fr.h);
        // inner canvas
        const ix = fr.x - fr.w / 2 + 4;
        const iy = fr.y - fr.h / 2 + 4;
        const iw = fr.w - 8;
        const ih = fr.h - 8;
        // tween morphPhase between integers for smooth transitions
        const phase = frame.current.morphPhase;
        // small evolving sea scene: gradient sky + horizon + 3 wave lines.
        // The palette shifts with phase: 0 calm dawn, 1 noon, 2 dusk, 3 night, 4 storm.
        const palettes = [
          { sky: [60, 80, 110], sea: [40, 70, 110], wave: [200, 220, 230] },
          { sky: [110, 160, 210], sea: [40, 100, 160], wave: [240, 240, 240] },
          { sky: [180, 100, 70], sea: [80, 60, 100], wave: [240, 200, 180] },
          { sky: [20, 30, 60], sea: [10, 18, 40], wave: [200, 210, 240] },
          { sky: [50, 60, 80], sea: [30, 50, 80], wave: [255, 255, 255] },
        ];
        const pal = palettes[phase % palettes.length];
        const sg = ctx.createLinearGradient(0, iy, 0, iy + ih * 0.5);
        sg.addColorStop(0, `rgb(${pal.sky[0]}, ${pal.sky[1]}, ${pal.sky[2]})`);
        sg.addColorStop(1, `rgb(${pal.sky[0] * 0.8 | 0}, ${pal.sky[1] * 0.8 | 0}, ${pal.sky[2] * 0.85 | 0})`);
        ctx.fillStyle = sg;
        ctx.fillRect(ix, iy, iw, ih * 0.5);
        const sg2 = ctx.createLinearGradient(0, iy + ih * 0.5, 0, iy + ih);
        sg2.addColorStop(0, `rgb(${pal.sea[0]}, ${pal.sea[1]}, ${pal.sea[2]})`);
        sg2.addColorStop(1, `rgb(${pal.sea[0] * 0.6 | 0}, ${pal.sea[1] * 0.6 | 0}, ${pal.sea[2] * 0.7 | 0})`);
        ctx.fillStyle = sg2;
        ctx.fillRect(ix, iy + ih * 0.5, iw, ih * 0.5);
        // wave lines, animated subtly
        ctx.strokeStyle = `rgba(${pal.wave[0]}, ${pal.wave[1]}, ${pal.wave[2]}, 0.7)`;
        ctx.lineWidth = 0.8;
        for (let wi = 0; wi < 3; wi++) {
          const y = iy + ih * (0.55 + wi * 0.12);
          ctx.beginPath();
          for (let xx = ix; xx <= ix + iw; xx += 2) {
            const yy = y + Math.sin((xx - ix) * 0.18 + t * 0.6 * motion + wi) * 1.4;
            if (xx === ix) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        }
        // a tiny sun/moon disc
        const discX = ix + iw * 0.72;
        const discY = iy + ih * 0.28;
        ctx.fillStyle = phase === 3 ? "rgba(245, 248, 255, 0.92)" : "rgba(255, 220, 160, 0.92)";
        ctx.beginPath();
        ctx.arc(discX, discY, 3.4, 0, Math.PI * 2);
        ctx.fill();
        // proximity glow
        if (fAlive > 0.05) {
          ctx.strokeStyle = `rgba(220, 200, 160, ${0.4 * fAlive})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(fr.x - fr.w / 2 - 0.5, fr.y - fr.h / 2 - 0.5, fr.w + 1, fr.h + 1);
        }
        // morph ripple — when freshly tapped, an outward ring on the frame
        const sinceMorph = now - frame.current.lastTapAt;
        if (sinceMorph > 0 && sinceMorph < 700) {
          const p = sinceMorph / 700;
          const a = 0.55 * (1 - p);
          const rr = Math.max(fr.w, fr.h) * (0.4 + p * 0.5);
          ctx.strokeStyle = `rgba(220, 200, 160, ${a})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(fr.x, fr.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ── music box on the sill ──
      {
        const mb = g.music;
        const mAlive = lit.current.music;
        const playing = now < musicBox.current.playingUntil;
        if (playing) musicBox.current.spin += 0.04 * motion;
        // base box
        ctx.fillStyle = `rgba(${(70 + mAlive * 30) | 0}, ${(50 + mAlive * 18) | 0}, ${(32 + mAlive * 8) | 0}, 0.96)`;
        ctx.fillRect(mb.x - mb.w / 2, mb.y - mb.h, mb.w, mb.h);
        // gold trim
        ctx.strokeStyle = `rgba(${(180 + mAlive * 50) | 0}, ${(140 + mAlive * 50) | 0}, ${(60 + mAlive * 30) | 0}, 0.92)`;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(mb.x - mb.w / 2 + 2, mb.y - mb.h + 2, mb.w - 4, mb.h - 4);
        // tiny dancer/ballerina on top — rotates when playing
        const tx = mb.x;
        const ty = mb.y - mb.h - 6;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(musicBox.current.spin);
        ctx.fillStyle = "rgba(220, 200, 160, 0.95)";
        // body
        ctx.beginPath();
        ctx.arc(0, -3, 1.6, 0, Math.PI * 2);
        ctx.fill();
        // tutu
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.lineTo(4, 0);
        ctx.lineTo(2, 3);
        ctx.lineTo(-2, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // playing indicator — note glyphs floating above
        if (playing) {
          const noteCount = 3;
          for (let i = 0; i < noteCount; i++) {
            const ph = (now / 1000 * 1.6 + i * 1.4) % 1;
            const nx = tx + Math.sin(ph * 7 + i) * 6;
            const ny = ty - 16 - ph * 14;
            ctx.fillStyle = `rgba(255, 232, 178, ${0.8 * (1 - ph)})`;
            ctx.font = "10px serif";
            ctx.fillText("♪", nx, ny);
          }
        }
        // proximity glow
        if (mAlive > 0.05) {
          ctx.strokeStyle = `rgba(220, 200, 160, ${0.35 * mAlive})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(mb.x - mb.w / 2 - 0.5, mb.y - mb.h - 0.5, mb.w + 1, mb.h + 1);
        }
      }

      // ── wall marks ──
      wallMarks.current = wallMarks.current.filter((m) => now - m.t0 < 16000);
      wallMarks.current.forEach((m) => {
        const age = (now - m.t0) / 16000;
        const a = Math.max(0, 0.45 * (1 - age));
        ctx.fillStyle = `rgba(180, 152, 110, ${a})`;
        ctx.fillRect(m.x - 0.8, m.y - 0.8, 1.8, 1.8);
        if (age < 0.15) {
          const ringA = (0.15 - age) * 3;
          ctx.strokeStyle = `rgba(220, 200, 160, ${ringA * 0.5})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(m.x, m.y, 4 + age * 60, 0, 7);
          ctx.stroke();
        }
      });

      // ── table ──
      const tableY = g.tableTop;
      ctx.fillStyle = "rgba(48, 32, 22, 0.96)";
      ctx.fillRect(0, tableY, g.w, g.tableBottom - tableY);
      ctx.fillStyle = "rgba(120, 90, 60, 0.10)";
      ctx.fillRect(0, tableY, g.w, 5);

      // ── ambient candlelight halo over the whole interior ──
      const candleAlive = lit.current.candle * cs.flameScale;
      const flick = motion ? 1 + Math.sin(t * 3.4) * 0.06 + Math.sin(t * 7.1) * 0.03 : 1;
      const candleR = (220 + candleAlive * 100) * flick * Math.max(0.05, cs.flameScale);
      const candleXc = g.candle.x;
      const candleYc = g.candle.y - g.candle.h * 0.55;
      if (cs.flameScale > 0.02) {
        const candleHalo = ctx.createRadialGradient(candleXc, candleYc, 0, candleXc, candleYc, candleR);
        candleHalo.addColorStop(0, `rgba(255, 180, 110, ${(0.24 + candleAlive * 0.18) * cs.flameScale})`);
        candleHalo.addColorStop(0.4, `rgba(200, 115, 42, ${(0.12 + candleAlive * 0.10) * cs.flameScale})`);
        candleHalo.addColorStop(1, "rgba(200, 115, 42, 0)");
        ctx.fillStyle = candleHalo;
        ctx.beginPath();
        ctx.arc(candleXc, candleYc, candleR, 0, 7);
        ctx.fill();
      }

      // ── render candle (body + multi-layer flame) ──
      const candleColor = "rgba(242, 238, 230, 0.96)";
      ctx.fillStyle = candleColor;
      ctx.fillRect(g.candle.x - g.candle.w / 2, g.candle.y - g.candle.h, g.candle.w, g.candle.h);
      const candleStroke = lit.current.candle;
      ctx.strokeStyle = `rgba(${(21 + candleStroke * 120) | 0}, ${(23 + candleStroke * 90) | 0}, ${(26 + candleStroke * 40) | 0}, ${0.50 + candleStroke * 0.45})`;
      ctx.lineWidth = 1 + candleStroke * 1.6;
      ctx.strokeRect(g.candle.x - g.candle.w / 2, g.candle.y - g.candle.h, g.candle.w, g.candle.h);
      // soft wax drip lines on the side
      ctx.strokeStyle = "rgba(200, 192, 178, 0.45)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(g.candle.x - g.candle.w / 2 + 3, g.candle.y - g.candle.h + 18);
      ctx.lineTo(g.candle.x - g.candle.w / 2 + 3, g.candle.y - 10);
      ctx.moveTo(g.candle.x + g.candle.w / 2 - 4, g.candle.y - g.candle.h + 24);
      ctx.lineTo(g.candle.x + g.candle.w / 2 - 4, g.candle.y - 16);
      ctx.stroke();
      // wick
      ctx.strokeStyle = "rgba(21, 23, 26, 0.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(g.candle.x, g.candle.y - g.candle.h - 1);
      ctx.lineTo(g.candle.x, g.candle.y - g.candle.h - 11);
      ctx.stroke();

      // proximity vector to cursor — for flame lean and smoke direction.
      let leanX = 0;
      let pull = 0;
      if (c.over && cs.flameScale > 0.02) {
        const dx = c.x - g.candle.x;
        const dy = (c.y) - (g.candle.y - g.candle.h);
        const d = Math.hypot(dx, dy);
        pull = Math.max(0, 1 - d / 220);
        const bonus = pull > 0.6 ? (pull - 0.6) * 18 : 0;
        leanX = (dx / (d || 1)) * (pull * 6 + bonus);
      }

      const flameBase = g.candle.y - g.candle.h - 11;
      // Three / four layered flames each with slight independent wobble.
      if (cs.flameScale > 0.02) {
        const baseLayers = [
          { h: 26, w: 8, color: `rgba(255, 215, 150, ${0.92 * cs.flameScale})`, freq: 4.5, off: 0, leanMul: 0.6 },
          { h: 20, w: 6.4, color: `rgba(255, 200, 130, ${0.96 * cs.flameScale})`, freq: 5.8, off: 1.3, leanMul: 0.75 },
          { h: 14, w: 4.6, color: `rgba(255, 165, 90, ${0.98 * cs.flameScale})`, freq: 7.0, off: 2.4, leanMul: 0.9 },
          { h: 9,  w: 3.0, color: `rgba(255, 230, 200, 0.98)`, freq: 9.0, off: 3.7, leanMul: 1.1 },
        ];
        baseLayers.forEach((L) => {
          const wob = Math.sin(t * L.freq + L.off) * 0.7 * motion;
          const lh = L.h * cs.flameScale + wob;
          const lw = L.w * cs.flameScale;
          const lLean = leanX * L.leanMul;
          ctx.fillStyle = L.color;
          ctx.beginPath();
          ctx.moveTo(g.candle.x, flameBase);
          ctx.quadraticCurveTo(g.candle.x + lw + lLean, flameBase - lh * 0.55, g.candle.x + lLean * 0.5, flameBase - lh);
          ctx.quadraticCurveTo(g.candle.x - lw + lLean, flameBase - lh * 0.55, g.candle.x, flameBase);
          ctx.fill();
        });
        // bright core point at the very base
        ctx.fillStyle = `rgba(255, 250, 220, ${cs.flameScale})`;
        ctx.beginPath();
        ctx.arc(g.candle.x + leanX * 0.3, flameBase - 3 * cs.flameScale, 1.6 * cs.flameScale, 0, Math.PI * 2);
        ctx.fill();

        // ── sparks: spawn rarely; integrate; render ──
        // chance per frame scaled by motion + flame intensity.
        if (motion && Math.random() < 0.02 * cs.flameScale) {
          sparks.current.push({
            x: g.candle.x + (Math.random() - 0.5) * 4,
            y: flameBase - 8,
            vx: (Math.random() - 0.5) * 12 + leanX * 0.3,
            vy: -30 - Math.random() * 30,
            life: 0.8 + Math.random() * 0.6,
            maxLife: 0.8 + Math.random() * 0.6,
          });
          if (sparks.current.length > 24) sparks.current.shift();
        }
        const dt = motion ? 1 / 60 : 0;
        for (let i = sparks.current.length - 1; i >= 0; i--) {
          const sp = sparks.current[i];
          sp.life -= dt;
          if (sp.life <= 0) {
            sparks.current.splice(i, 1);
            continue;
          }
          sp.vx *= 0.985;
          sp.vy += 6 * dt; // very weak gravity
          sp.x += sp.vx * dt * 2;
          sp.y += sp.vy * dt * 2;
          const lr = sp.life / sp.maxLife;
          ctx.fillStyle = `rgba(255, 220, 140, ${lr * 0.85})`;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 1.0 + lr * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }

        // ── whisper trail of smoke toward cursor when proximate ──
        if (pull > 0.15 && motion) {
          ctx.save();
          ctx.strokeStyle = `rgba(245, 240, 230, ${0.18 * pull * cs.flameScale})`;
          ctx.lineWidth = 1.2;
          ctx.lineCap = "round";
          // bezier from above flame toward cursor
          const sx = g.candle.x + leanX * 0.4;
          const sy = flameBase - 18 * cs.flameScale;
          const cx1 = sx + (c.x - sx) * 0.35 + Math.sin(t * 2.6) * 8;
          const cy1 = sy - 30 + Math.cos(t * 1.8) * 6;
          const cx2 = sx + (c.x - sx) * 0.70 + Math.cos(t * 2.0) * 8;
          const cy2 = sy + (c.y - sy) * 0.40 + Math.sin(t * 2.2) * 6;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.bezierCurveTo(cx1, cy1, cx2, cy2, c.x, c.y);
          ctx.stroke();
          // a few discrete smoke puffs along the curve
          for (let i = 1; i <= 4; i++) {
            const tt = i / 5;
            // sample bezier at tt
            const px =
              (1 - tt) * (1 - tt) * (1 - tt) * sx +
              3 * (1 - tt) * (1 - tt) * tt * cx1 +
              3 * (1 - tt) * tt * tt * cx2 +
              tt * tt * tt * c.x;
            const py =
              (1 - tt) * (1 - tt) * (1 - tt) * sy +
              3 * (1 - tt) * (1 - tt) * tt * cy1 +
              3 * (1 - tt) * tt * tt * cy2 +
              tt * tt * tt * c.y;
            const rr = 1.4 + tt * 2.6;
            ctx.fillStyle = `rgba(245, 240, 230, ${0.10 * pull * (1 - tt) * cs.flameScale})`;
            ctx.beginPath();
            ctx.arc(px, py, rr, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      } else {
        const sinceSnuff = now - cs.snuffStart;
        if (sinceSnuff > 0 && sinceSnuff < 2200) {
          const sa = Math.max(0, 0.45 * (1 - sinceSnuff / 2200));
          ctx.strokeStyle = `rgba(220, 220, 230, ${sa})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(g.candle.x, flameBase);
          for (let i = 1; i <= 8; i++) {
            const yy = flameBase - i * 4;
            const sway = Math.sin(t * 2 + i * 0.8) * 3;
            ctx.lineTo(g.candle.x + sway, yy);
          }
          ctx.stroke();
        }
      }

      // ── glass ──
      const glassAlive = lit.current.glass;
      const gx = g.glass.x;
      const gy = g.glass.y;
      const gw = g.glass.w;
      const gh = g.glass.h;
      ctx.strokeStyle = `rgba(242, 238, 230, ${0.55 + glassAlive * 0.30})`;
      ctx.lineWidth = 1.4 + glassAlive * 1.2;
      ctx.beginPath();
      ctx.moveTo(gx - gw / 2, gy - gh);
      ctx.lineTo(gx - gw / 2 + 4, gy);
      ctx.lineTo(gx + gw / 2 - 4, gy);
      ctx.lineTo(gx + gw / 2, gy - gh);
      ctx.stroke();
      const fillT = Math.min(1, glass.current.fill / 5);
      const waterTop = gy - 2 - (gh - 4) * (0.20 + fillT * 0.78);
      const leftAtY = (y: number) => {
        const tInside = (gy - y) / gh;
        return gx - gw / 2 + 4 * (1 - tInside);
      };
      const rightAtY = (y: number) => {
        const tInside = (gy - y) / gh;
        return gx + gw / 2 - 4 * (1 - tInside);
      };
      const waterGrad = ctx.createLinearGradient(0, waterTop, 0, gy - 2);
      waterGrad.addColorStop(0, `rgba(180, 220, 230, ${0.55 + glassAlive * 0.15})`);
      waterGrad.addColorStop(1, `rgba(140, 190, 210, ${0.30 + glassAlive * 0.10})`);
      ctx.fillStyle = waterGrad;
      ctx.beginPath();
      ctx.moveTo(leftAtY(waterTop), waterTop);
      ctx.lineTo(rightAtY(waterTop), waterTop);
      ctx.lineTo(rightAtY(gy - 2), gy - 2);
      ctx.lineTo(leftAtY(gy - 2), gy - 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(220, 240, 250, ${0.55 + glassAlive * 0.20})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftAtY(waterTop), waterTop);
      ctx.lineTo(rightAtY(waterTop), waterTop);
      ctx.stroke();
      glassRipples.current = glassRipples.current.filter((r) => now - r.t0 < 1400);
      glassRipples.current.forEach((r) => {
        const age = (now - r.t0) / 1400;
        const w0 = (gw - 6) * (0.2 + age * 0.8);
        const a = 0.55 * (1 - age);
        ctx.strokeStyle = `rgba(220, 240, 250, ${a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(gx, waterTop, w0 / 2, 2, 0, 0, 7);
        ctx.stroke();
      });
      const sinceOverflow = now - glass.current.overflowAt;
      if (glass.current.overflowAt > 0 && sinceOverflow < 900) {
        const p = sinceOverflow / 900;
        const dropY = (gy - gh) + p * (gh + 16);
        const dropA = Math.max(0, 1 - p);
        ctx.fillStyle = `rgba(180, 220, 230, ${0.75 * dropA})`;
        ctx.beginPath();
        ctx.ellipse(gx + gw / 2 - 2, dropY, 1.6, 2.4, 0, 0, 7);
        ctx.fill();
      }

      // ── book ──
      const bookAlive = lit.current.book;
      const isBookOpen = now < book.current.openUntil;
      const bx = g.book.x;
      const by = g.book.y;
      const bw = g.book.w;
      const bh = g.book.h;
      if (!isBookOpen) {
        ctx.fillStyle = `rgba(${(60 + bookAlive * 40) | 0}, ${(40 + bookAlive * 18) | 0}, ${(28 + bookAlive * 6) | 0}, 0.95)`;
        ctx.fillRect(bx - bw / 2, by - bh, bw, bh);
        ctx.fillStyle = `rgba(240, 235, 220, ${0.75 + bookAlive * 0.15})`;
        ctx.fillRect(bx - bw / 2 + 2, by - bh + 2, bw - 4, bh - 5);
        ctx.fillStyle = `rgba(${(40 + bookAlive * 30) | 0}, ${(25 + bookAlive * 12) | 0}, ${(18 + bookAlive * 6) | 0}, 1)`;
        ctx.fillRect(bx - bw / 2, by - bh, bw, 3);
        if (bookAlive > 0.05) {
          ctx.strokeStyle = `rgba(220, 200, 160, ${0.35 * bookAlive})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx - bw / 2 - 0.5, by - bh - 0.5, bw + 1, bh + 1);
        }
      } else {
        const elapsed = (book.current.openUntil - now) / 5000;
        const pageW = bw + 30;
        const pageH = bh + 36;
        ctx.fillStyle = `rgba(244, 238, 222, ${0.92 * elapsed + 0.08})`;
        ctx.fillRect(bx - pageW / 2, by - pageH, pageW, pageH);
        ctx.strokeStyle = "rgba(60, 40, 24, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, by - pageH);
        ctx.lineTo(bx, by);
        ctx.stroke();
        const linesAcross = 6;
        const lineWiggle = (book.current.pageIdx % 3);
        ctx.strokeStyle = `rgba(60, 40, 24, ${0.30 * elapsed})`;
        for (let i = 0; i < linesAcross; i++) {
          const ly = by - pageH + 8 + i * 6;
          const trim = (i + lineWiggle) % 2 === 0 ? 6 : 12;
          ctx.beginPath();
          ctx.moveTo(bx - pageW / 2 + 6, ly);
          ctx.lineTo(bx - 3 - trim, ly);
          ctx.moveTo(bx + 3 + (trim - 6), ly);
          ctx.lineTo(bx + pageW / 2 - 6, ly);
          ctx.stroke();
        }
        if (book.current.pageTurn > 0) {
          const dt = (now - book.current.pageTurnStart) / 420;
          if (dt >= 1) {
            book.current.pageTurn = 0;
          } else {
            book.current.pageTurn = dt;
            const angle = dt * Math.PI;
            const halfW = pageW / 2 - 1;
            const scaleX = Math.cos(angle);
            ctx.save();
            ctx.translate(bx, by - pageH / 2);
            ctx.transform(scaleX, 0, 0, 1, 0, 0);
            const back = scaleX < 0;
            ctx.fillStyle = back
              ? "rgba(232, 220, 198, 0.95)"
              : "rgba(244, 238, 222, 0.95)";
            ctx.fillRect(0, -pageH / 2, halfW, pageH);
            ctx.strokeStyle = "rgba(60, 40, 24, 0.30)";
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(halfW * 0.1, -pageH / 2 + 8);
            ctx.lineTo(halfW * 0.9, -pageH / 2 + 8);
            ctx.stroke();
            ctx.restore();
          }
        }
        if (bookAlive > 0.05) {
          ctx.strokeStyle = `rgba(220, 200, 160, ${0.35 * bookAlive})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx - pageW / 2 - 0.5, by - pageH - 0.5, pageW + 1, pageH + 1);
        }
      }

      // ── record ──
      const recordAlive = lit.current.record;
      const rx = g.record.x;
      const ry = g.record.y;
      const rr = g.record.r;
      if (record.current.playing) {
        record.current.spin += (motion ? 1 : 0) * 0.06 * record.current.spinDir;
      } else {
        record.current.spin += (motion ? 1 : 0) * 0.01 * recordAlive * record.current.spinDir;
      }
      ctx.fillStyle = "rgba(30, 22, 16, 1)";
      ctx.beginPath();
      ctx.arc(rx, ry, rr + 6, 0, 7);
      ctx.fill();
      if (recordAlive > 0.02) {
        const rhg = ctx.createRadialGradient(rx, ry, rr * 0.6, rx, ry, rr + 18);
        rhg.addColorStop(0, `rgba(220, 200, 160, 0)`);
        rhg.addColorStop(1, `rgba(220, 200, 160, ${recordAlive * 0.18})`);
        ctx.fillStyle = rhg;
        ctx.beginPath();
        ctx.arc(rx, ry, rr + 18, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(${10 + recordAlive * 8}, ${10 + recordAlive * 8}, ${14 + recordAlive * 10}, 1)`;
      ctx.beginPath();
      ctx.arc(rx, ry, rr, 0, 7);
      ctx.fill();
      ctx.strokeStyle = `rgba(70, 64, 58, ${0.6 + recordAlive * 0.2})`;
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(rx, ry, rr - 4 - i * 4.5, 0, 7);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(record.current.spin);
      const moodColor = MOOD_COLORS[record.current.mood];
      ctx.fillStyle = `rgba(${moodColor[0]}, ${moodColor[1]}, ${moodColor[2]}, ${0.85 + recordAlive * 0.15})`;
      ctx.beginPath();
      ctx.arc(0, 0, rr * 0.36, 0, 7);
      ctx.fill();
      ctx.fillStyle = "rgba(15, 17, 22, 0.95)";
      ctx.beginPath();
      ctx.arc(rr * 0.18, 0, 1.6, 0, 7);
      ctx.fill();
      if (record.current.spinDir < 0) {
        ctx.fillStyle = "rgba(245, 240, 230, 0.85)";
        ctx.fillRect(-rr * 0.22 - 1, -1.2, 4, 2.4);
      }
      ctx.restore();
      ctx.fillStyle = "rgba(15, 17, 22, 1)";
      ctx.beginPath();
      ctx.arc(rx, ry, 2.4, 0, 7);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      cv.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      cv.removeEventListener("click", onClick);
      window.clearInterval(whisperCheck);
      if (longPressTimer !== null) clearTimeout(longPressTimer);
      if (recordState.clickTimer !== null) clearTimeout(recordState.clickTimer);
    };
  }, [whisperState]);

  // Whisper rendering uses a tiny overlay <div> rather than canvas — gives
  // us crisp italic typography matching the rest of the site, and the hover
  // state is easy to drive via React.
  const renderWhisper = () => {
    if (!whisperState) return null;
    const age = performance.now() - whisperState.t0;
    if (age > whisperState.duration) return null;
    // ease in/out
    const p = age / whisperState.duration;
    let alpha = whisperState.hovered ? 0.95 : 0.32;
    if (!whisperState.hovered) {
      // fade in 0..0.15, hold 0.15..0.85, fade out 0.85..1.0
      if (p < 0.15) alpha *= p / 0.15;
      else if (p > 0.85) alpha *= 1 - (p - 0.85) / 0.15;
    }
    return (
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: whisperState.x,
          top: whisperState.y,
          transform: "translate(-50%, -50%)",
          color: `rgba(245, 240, 230, ${alpha})`,
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 22,
          letterSpacing: "0.04em",
          pointerEvents: "none",
          transition: "color 320ms ease",
          textShadow: whisperState.hovered ? "0 0 18px rgba(255,200,130,0.5)" : "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >
        {whisperState.text}
      </div>
    );
  };

  return (
    <div
      data-touch-surface="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0a0c",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-label="a room at night with a window onto the sea — touch the things on the table"
        style={{
          display: "block",
          width: "100vw",
          height: "100vh",
          cursor: "crosshair",
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
        }}
      />
      {renderWhisper()}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

const MOOD_SHAPES: Array<Record<string, number>> = [
  { prayer: 70, future: 40, work: 30, risk: 25, body: 60, love: 65, memory: 80, friendship: 50 },
  { prayer: 50, future: 85, work: 45, risk: 30, body: 70, love: 80, memory: 35, friendship: 75 },
  { prayer: 30, future: 50, work: 80, risk: 85, body: 45, love: 35, memory: 70, friendship: 25 },
];

const MOOD_COLORS: Array<[number, number, number]> = [
  [200, 115, 42],
  [232, 180, 130],
  [120, 60, 80],
];

function oneShotChime(audio: ReturnType<typeof getFieldAudio>, f0: number, f1: number, dur = 0.30) {
  const ctx = audio.getAudioContext();
  if (!ctx) {
    audio.chime();
    return;
  }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(f0, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.05, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2400;
  osc.connect(g).connect(lp).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

function oneShotDrop(audio: ReturnType<typeof getFieldAudio>) {
  const ctx = audio.getAudioContext();
  if (!ctx) {
    audio.thud();
    return;
  }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1400, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.22);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);
  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.35);
}

function oneShotRustle(audio: ReturnType<typeof getFieldAudio>) {
  const ctx = audio.getAudioContext();
  if (!ctx) {
    audio.refuse();
    return;
  }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(620, now);
  osc.frequency.exponentialRampToValueAtTime(380, now + 0.14);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.03, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1600;
  osc.connect(g).connect(lp).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.20);
}
