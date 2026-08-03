"use client";

/**
 * /tissue — when one becomes many. The tissue band at ~10⁻⁴ m, between the
 * single cell below and the petal above (docs/plans/life-and-vista-bands.md §2).
 *
 * The invariant is an adhesion graph over a sheet of cells, plus each
 * cell's polarity (src/lib/sheet.ts). Everything here is a representation
 * of that graph: the soft body under the hand, the taut and slack bonds,
 * the fates the front lands as it sweeps — and, the load-bearing one, the
 * chord. Every cell sings the interval its coordination names: six
 * neighbours is the root, five a fifth, four a fourth, and down through the
 * thirds to the whole tone and the tritone of a cell adrift. Because the
 * table is injective, `chordDegreeCounts` reads the degree spectrum back
 * out of the chord; because ratio complexity rises strictly as degree
 * falls, a bond that lets go can only make the sheet rougher. You hear the
 * break before you see it.
 *
 * Alive at rest: the sheet seethes, breathes on the shared 7 s clock, and a
 * peristaltic wave crosses it while the differentiation front creeps over
 * the morphogen and lands fates behind itself. One finger stroked across it
 * divides the cells it passes, each daughter taking half the mother's area.
 * One finger held draws the sheet in at that point — apical constriction,
 * which is to say gastrulation — deepening the longer it is held, and held
 * past the ceremony the pit closes over into a second layer. Three fingers
 * touch the world-law: drag is adhesion, and a sheet let loose comes apart
 * into dissonance; hold dilates the clock to a quarter, which you see as
 * the front stalling; twist turns the body axis and the pattern with it. A
 * flick tears. Two fingers twist to the notation lens. Tilt is gravity, a
 * shake strains every bond, a knock rings the whole chord.
 *
 * The sheet persists in `objetdart:tissue:v1` with the quiet clear at the
 * bottom. Pinch is unbound — ScaleTravel owns it (the petal above, the
 * single cell below).
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import LetGo from "@/components/LetGo";
import {
  FATE_FRONT_SEC,
  INNER_FATE,
  MAX_CELLS,
  advance,
  buildSheet,
  chordOf,
  commitFates,
  constrict,
  degreesOf,
  dissonance,
  divideCell,
  distToSegment2,
  fateFront,
  hashSeed,
  morphogenAt,
  morphogenField,
  nearestCell,
  packSheet,
  relaxConstriction,
  sealPit,
  strainOf,
  tearAcross,
  unpackSheet,
  voiceOf,
  type Chord,
  type MorphogenField,
  type Sheet,
  type SheetPack,
} from "@/lib/sheet";

const STORE_KEY = "objetdart:tissue:v1";
/** D3 — the root the whole sheet's harmony stands on. */
const ROOT_HZ = 146.83;
const TARGET_CELLS = 320;
const MOTES = 60;

/** Fate → tint. The sealed inner layer is bone; the surface is a garden. */
const FATE_TINT: string[] = [
  "231, 172, 82",
  "134, 186, 168",
  "150, 178, 226",
  "226, 140, 108",
  "242, 238, 230",
];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

type Stored = { sheet?: SheetPack; cleared?: boolean };

export default function TissueSheet() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const dissolveRef = useRef(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const audio = getFieldAudio();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let scale = 1;
    let raf = 0;
    let last = performance.now();
    let localT = 0;

    // ——— the world-law ———
    let timeScale = 1;
    let timeScaleTarget = 1;
    let adhesion = 0.62;
    let adhesionTarget = 0.62;
    let axis = 0;
    let axisTarget = 0;
    let agitation = 0;
    let gx = 0;
    let gy = 0;
    let gxTarget = 0;
    let gyTarget = 0;

    // ——— the frame ———
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;

    // ——— the hand ———
    let pitActive = false;
    let pitX = 0;
    let pitY = 0;
    let pitAmount = 0;
    let pitSealed = false;
    let lastPitToneAt = 0;
    let strokeX = 0;
    let strokeY = 0;
    let strokeRun = 0;
    let strokeLive = false;
    let selIdx = -1;
    let kbCharge = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let glimmerIdx = -1;
    let wavePeriod = 6.4;
    let leaving = 0;

    // ——— the sheet ———
    let cleared = false;
    let visited = false;
    let sheet: Sheet | null = null;
    let field: MorphogenField = morphogenField(0x715);

    const lit = new Float32Array(MAX_CELLS);
    const morph = new Float64Array(MAX_CELLS);
    let degrees = new Uint8Array(MAX_CELLS);
    let prevLive = new Uint8Array(0);
    let chord: Chord = { degree: [], num: [], den: [], ratio: [], weight: [] };
    let rough = 0;
    let chordAt = 0;
    let breakSoundAt = 0;
    let lastBreathVoice = -1;
    let voiceCursor = 0;
    let dirty = false;
    let savedAt = performance.now();

    // The starter sheet: the room is already living when anyone arrives.
    const freshSheet = (): Sheet => {
      const ar = Math.max(0.3, width / Math.max(1, height));
      // the ellipse keeps about π/4 of the lattice, so aim high
      let cols = Math.round(Math.sqrt((TARGET_CELLS * 1.28 * ar) / 0.866));
      cols = clamp(cols, 9, 30);
      let rows = clamp(Math.round((TARGET_CELLS * 1.28) / cols), 9, 30);
      while (cols * rows > MAX_CELLS - 40) rows -= 1;
      const s = buildSheet(hashSeed(0x715, cols, rows), cols, rows, 0.07, MAX_CELLS, true);
      // A patch of tissue is never found undifferentiated: the front has
      // been running a while before anyone arrives.
      s.t = FATE_FRONT_SEC * 0.5;
      commitFates(s, morphogenField(s.seed), 0);
      return s;
    };

    const recomputeChord = () => {
      if (!sheet) return;
      degrees = degreesOf(sheet, degrees);
      chord = chordOf(degrees, sheet.n);
      rough = dissonance(chord);
    };

    // ——— persistence ———
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        visited = true;
        const parsed = JSON.parse(raw) as Stored;
        cleared = parsed.cleared === true;
        sheet = unpackSheet(parsed.sheet);
      }
    } catch {
      /* a fresh sheet */
    }

    const save = () => {
      try {
        const payload: Stored = sheet && sheet.n > 0 ? { sheet: packSheet(sheet), cleared } : { cleared: true };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* noop */
      }
      dirty = false;
      savedAt = performance.now();
      setHasKept(!!sheet && sheet.n > 0);
    };

    // ——— sound: the sheet, heard ———
    const soundCell = (i: number, dur = 0.34) => {
      if (!sheet || i < 0 || i >= sheet.n) return;
      try {
        audio.playTone(voiceOf(degrees[i], ROOT_HZ), dur);
      } catch {
        /* the sea is not awake */
      }
      lit[i] = 1;
    };

    /** The whole chord at once — the room stating itself. */
    const soundChord = (dur = 1.1) => {
      for (let k = 0; k < chord.ratio.length; k++) {
        const f = ROOT_HZ * chord.ratio[k];
        const w = chord.weight[k];
        window.setTimeout(() => {
          try {
            audio.playTone(f, dur * (0.5 + w));
          } catch {
            /* noop */
          }
        }, k * 42);
      }
      if (sheet) for (let i = 0; i < sheet.n; i++) lit[i] = Math.max(lit[i], 0.55);
    };

    const setLens = (snapped: number) => {
      if (snapped === lensSnapped) return;
      lensSnapped = snapped;
      lensTarget = snapped;
      try {
        haptics.lens();
        if (snapped === 1) audio.chime();
        else audio.playTone(ROOT_HZ * 0.5, 0.4);
      } catch {
        /* noop */
      }
    };

    // ——— geometry ———
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(240, r.width);
      height = Math.max(320, r.height);
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (sheet) {
        scale = Math.min(width / (2 * sheet.spanX), height / (2 * sheet.spanY)) * 0.86;
      }
    };
    resize();
    if (!sheet && !cleared) {
      sheet = freshSheet();
      field = morphogenField(sheet.seed);
      resize();
      recomputeChord();
      save();
    } else if (sheet) {
      field = morphogenField(sheet.seed);
      recomputeChord();
      if (!visited) save();
      else setHasKept(sheet.n > 0);
    } else {
      setHasKept(false);
    }
    if (sheet) prevLive = new Uint8Array(sheet.ecap);

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toSheet = (cx: number, cy: number) => ({
      x: (clamp(cx - rectLeft, 0, width) - width / 2) / scale,
      y: (clamp(cy - rectTop, 0, height) - height / 2) / scale,
    });

    // ——— the acts ———
    const divideAt = (x: number, y: number) => {
      if (!sheet) return;
      const i = nearestCell(sheet, x, y, 1.4);
      if (i < 0) return;
      if (sheet.n >= sheet.cap) {
        try {
          audio.refuse();
        } catch {
          /* noop */
        }
        return;
      }
      const j = divideCell(sheet, i, hashSeed(i, sheet.n, Math.round(x * 977)));
      if (j < 0) return;
      lit[i] = 1;
      lit[j] = 1;
      recomputeChord();
      soundCell(j, 0.22);
      try {
        audio.spark();
        haptics.detent();
      } catch {
        /* noop */
      }
      dirty = true;
    };

    const strainAll = (amount: number) => {
      if (!sheet) return;
      for (let i = 0; i < sheet.n; i++) {
        const a = hashSeed(i, Math.round(amount * 1000));
        sheet.px[i] += (((a % 1000) / 1000) * 2 - 1) * amount * 0.5;
        sheet.py[i] += (((((a / 1000) | 0) % 1000) / 1000) * 2 - 1) * amount * 0.5;
      }
    };

    // ——— the grammar ———
    const detachGestures = attachGestures(
      wrap,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) return; // ScaleTravel's step back
          if (e.fingers === 3) {
            soundChord(1.4);
            try {
              haptics.ripple(0.45);
            } catch {
              /* noop */
            }
            return;
          }
          if (e.fingers !== 1 || !sheet) return;
          const p = toSheet(e.x, e.y);
          const i = nearestCell(sheet, p.x, p.y, 1.1);
          if (i >= 0) {
            selIdx = i;
            soundCell(i, 0.26 + e.intensity * 0.3);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          stirTurbulence(0.05);
          try {
            audio.playTone(ROOT_HZ * 0.5, 0.3);
            haptics.tap();
          } catch {
            /* noop */
          }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the law layer: the room's clock, held at a quarter
            if (e.phase === "enter") {
              timeScaleTarget = 0.25;
              try {
                audio.playTone(ROOT_HZ * 0.25, 0.9);
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            if (e.phase === "release") timeScaleTarget = 1;
            return;
          }
          if (e.fingers !== 1 || !sheet) return;
          const p = toSheet(e.x, e.y);
          if (e.phase === "enter") {
            pitActive = true;
            pitSealed = false;
            pitX = p.x;
            pitY = p.y;
            pitAmount = 0;
            selIdx = nearestCell(sheet, p.x, p.y, 1.2);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          if (e.phase === "release") {
            pitActive = false;
            return;
          }
          // Duration is the axis: the pit keeps deepening the longer the
          // finger stays, and past the ceremony it closes over for good.
          pitX = p.x;
          pitY = p.y;
          pitAmount = clamp01(e.elapsed / 2600);
          const now = performance.now();
          if (now - lastPitToneAt > 260) {
            lastPitToneAt = now;
            // the fold falls as it deepens — the sheet going down in pitch
            try {
              audio.playTone(ROOT_HZ * (1 - pitAmount * 0.42), 0.5);
              haptics.roll();
            } catch {
              /* noop */
            }
          }
          if (e.tier >= 3 && !pitSealed) {
            const n = sealPit(sheet, pitX, pitY, 2.1);
            if (n > 0) {
              pitSealed = true;
              recomputeChord();
              try {
                audio.bell();
                haptics.bloom();
              } catch {
                /* noop */
              }
              dirty = true;
            }
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          if (!sheet) return;
          if (e.fingers === 3) {
            // the world-law: cadherin. Let it go and the sheet lets go.
            const before = adhesionTarget;
            adhesionTarget = clamp01(adhesionTarget + e.dx * 0.0022);
            if (Math.floor(before * 8) !== Math.floor(adhesionTarget * 8)) {
              try {
                haptics.detent();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (e.fingers !== 1) return;
          const p = toSheet(e.x, e.y);
          if (e.phase === "start") {
            strokeLive = true;
            strokeRun = 0;
            strokeX = p.x;
            strokeY = p.y;
            return;
          }
          if (e.phase === "end") {
            strokeLive = false;
            return;
          }
          if (!strokeLive) {
            strokeLive = true;
            strokeX = p.x;
            strokeY = p.y;
            return;
          }
          // The hand pushes the material it passes through...
          const dxs = p.x - strokeX;
          const dys = p.y - strokeY;
          const step = Math.sqrt(dxs * dxs + dys * dys);
          for (let i = 0; i < sheet.n; i++) {
            const d2 = distToSegment2(sheet.px[i], sheet.py[i], strokeX, strokeY, p.x, p.y);
            if (d2 > 1.6) continue;
            const w = (1 - Math.sqrt(d2) / 1.27) * 0.5;
            sheet.px[i] += dxs * w;
            sheet.py[i] += dys * w;
          }
          // ...and the cells along the stroke divide as it passes.
          strokeRun += step;
          if (strokeRun > 0.55) {
            strokeRun = 0;
            divideAt(p.x, p.y);
          }
          strokeX = p.x;
          strokeY = p.y;
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          if (!sheet) return;
          // a flick tears: the bonds the line crosses let go at once
          const p = toSheet(e.x, e.y);
          const len = clamp(e.speed / 260, 1.2, 7);
          const cut = tearAcross(
            sheet,
            p.x - Math.cos(e.angle) * len,
            p.y - Math.sin(e.angle) * len,
            p.x + Math.cos(e.angle) * len,
            p.y + Math.sin(e.angle) * len,
          );
          if (cut > 0) {
            recomputeChord();
            stirTurbulence(0.14);
            try {
              audio.playTone(ROOT_HZ * chord.ratio[chord.ratio.length - 1], 0.5);
              haptics.chop();
            } catch {
              /* noop */
            }
            dirty = true;
          }
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the season: the body axis turns, and the pattern with it
            axisTarget += e.angle * 0.9;
            return;
          }
          if (e.phase === "move") lensTarget = clamp01(lensTarget + e.angle / 1.7);
          else if (e.phase === "end") setLens(lensTarget > 0.5 ? 1 : 0);
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          if (!sheet) return;
          // a circling hand swirls the sheet and strains what it turns
          const p = toSheet(e.cx, e.cy);
          const w = clamp(e.angularVelocity * 0.02, -0.25, 0.25);
          for (let i = 0; i < sheet.n; i++) {
            const dx = sheet.px[i] - p.x;
            const dy = sheet.py[i] - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > 9) continue;
            const f = (1 - Math.sqrt(d2) / 3) * w;
            sheet.px[i] += -dy * f;
            sheet.py[i] += dx * f;
          }
          try {
            audio.playTone(ROOT_HZ * 1.5, 0.3);
            haptics.ripple(0.3);
          } catch {
            /* noop */
          }
        },
        rhythm: (e) => {
          // the sheet takes the hand's tempo for its contraction wave
          if (e.stability > 0.65 && e.bpm > 24) {
            wavePeriod = clamp(60 / e.bpm, 0.6, 12);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel ———
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduced) {
          gxTarget = 0;
          gyTarget = 0;
          return;
        }
        gxTarget = clamp(gamma / 45, -1, 1) * 1.6;
        gyTarget = clamp(beta / 60, -1, 1) * 1.6;
      },
      shake: ({ intensity }) => {
        if (reduced || !sheet) return;
        lastInteractionAt = performance.now();
        agitation = Math.min(1, agitation + intensity);
        strainAll(0.12 + intensity * 0.22);
        stirTurbulence(0.2 + intensity * 0.3);
        try {
          audio.thud();
          haptics.chop();
        } catch {
          /* noop */
        }
        dirty = true;
      },
      knock: () => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        soundChord(0.9);
        try {
          audio.thud();
          haptics.detent();
        } catch {
          /* noop */
        }
      },
    });

    // ——— keyboard ———
    const moveSel = (dx: number, dy: number) => {
      if (!sheet || sheet.n === 0) return;
      if (selIdx < 0) {
        selIdx = nearestCell(sheet, 0, 0);
        return;
      }
      const cx = sheet.px[selIdx];
      const cy = sheet.py[selIdx];
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < sheet.n; i++) {
        if (i === selIdx) continue;
        const ax = sheet.px[i] - cx;
        const ay = sheet.py[i] - cy;
        const along = ax * dx + ay * dy;
        if (along <= 0.05) continue;
        const across = Math.abs(ax * dy - ay * dx);
        const score = along + across * 2.5;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best >= 0) selIdx = best;
      soundCell(selIdx, 0.18);
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (!sheet) return;
      if (ev.key === "Escape") {
        if (lensSnapped === 1) setLens(0);
        selIdx = -1;
        kbCharge = 0;
        pitActive = false;
        return;
      }
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        moveSel(
          ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0,
          ev.key === "ArrowDown" ? 1 : ev.key === "ArrowUp" ? -1 : 0,
        );
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (selIdx < 0) selIdx = nearestCell(sheet, 0, 0);
        if (selIdx < 0) return;
        if (!ev.repeat) {
          // a press divides, as a stroke does
          divideAt(sheet.px[selIdx], sheet.py[selIdx]);
          kbCharge = 0;
          return;
        }
        // and a held key draws the sheet in, as a dwell does
        kbCharge = clamp01(kbCharge + 0.035);
        pitActive = true;
        pitX = sheet.px[selIdx];
        pitY = sheet.py[selIdx];
        pitAmount = kbCharge;
        const now = performance.now();
        if (now - lastPitToneAt > 260) {
          lastPitToneAt = now;
          try {
            audio.playTone(ROOT_HZ * (1 - kbCharge * 0.42), 0.5);
            haptics.roll();
          } catch {
            /* noop */
          }
        }
        if (kbCharge >= 1 && !pitSealed) {
          const n = sealPit(sheet, pitX, pitY, 2.1);
          if (n > 0) {
            pitSealed = true;
            recomputeChord();
            try {
              audio.bell();
              haptics.bloom();
            } catch {
              /* noop */
            }
            dirty = true;
          }
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        kbCharge = 0;
        pitActive = false;
        pitSealed = false;
      }
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);

    // ——— motes: the medium the sheet sits in ———
    const motes = new Float32Array(MOTES * 3);
    {
      let a = 0x9e3779b9;
      for (let i = 0; i < MOTES; i++) {
        a = (Math.imul(a ^ (a >>> 15), 0x01000193) >>> 0) || 1;
        motes[i * 3] = (a % 10000) / 10000;
        a = (Math.imul(a ^ (a >>> 13), 0x01000193) >>> 0) || 1;
        motes[i * 3 + 1] = (a % 10000) / 10000;
        a = (Math.imul(a ^ (a >>> 11), 0x01000193) >>> 0) || 1;
        motes[i * 3 + 2] = 0.4 + ((a % 1000) / 1000) * 1.4;
      }
    }

    // ——— the loop ———
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      adhesion += (adhesionTarget - adhesion) * Math.min(1, dt * 3);
      axis += (axisTarget - axis) * Math.min(1, dt * 3);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      gx += (gxTarget - gx) * Math.min(1, dt * 2.5);
      gy += (gyTarget - gy) * Math.min(1, dt * 2.5);
      agitation *= Math.exp(-dt * 1.4);
      if (!reduced) localT += dt * timeScale;
      if (leaving > 0) leaving = Math.max(0, leaving - dt * 0.7);
      for (let i = 0; i < lit.length; i++) if (lit[i] > 0) lit[i] = Math.max(0, lit[i] - dt * 1.5);

      const audioT = audio.getAudioTime();
      const awake = audioT !== null;
      const t = audioT ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // ——— the body ———
      if (sheet && sheet.n > 0) {
        if (pitActive) constrict(sheet, pitX, pitY, 2.1, pitAmount);
        else relaxConstriction(sheet, dt * timeScale, 0.55);

        advance(sheet, dt * timeScale, {
          gx: reduced ? 0 : gx,
          gy: reduced ? 0 : gy,
          agitation: reduced ? 0 : 0.32 + agitation * 2.4,
          adhesion,
          homeK: 5.5,
        });
        commitFates(sheet, field, axis);

        // A bond that let go is heard before it is seen: the two cells it
        // held drop a degree, and the interval they now sing is rougher.
        let broke = 0;
        let brokeAt = -1;
        for (let e = 0; e < sheet.ecount; e++) {
          if (prevLive[e] === 1 && sheet.live[e] === 0) {
            broke += 1;
            brokeAt = sheet.ea[e];
          }
          prevLive[e] = sheet.live[e];
        }
        if (broke > 0) {
          recomputeChord();
          dirty = true;
          if (now - breakSoundAt > 110) {
            breakSoundAt = now;
            soundCell(brokeAt, 0.4);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
        } else if (now - chordAt > 400) {
          chordAt = now;
          recomputeChord();
        }

        // Once a breath, one voice of the chord speaks on its own — the
        // sheet is alive whether or not a hand is on it.
        const breathIdx = Math.floor(t * 0.14);
        if (awake && !reduced && breathIdx !== lastBreathVoice && breath > 0.9 && chord.ratio.length > 0) {
          lastBreathVoice = breathIdx;
          voiceCursor = (voiceCursor + 1) % chord.ratio.length;
          try {
            audio.playTone(ROOT_HZ * chord.ratio[voiceCursor], 1.6);
          } catch {
            /* noop */
          }
        }
      }

      // ——— render ———
      const warm = clamp01(rough / 4);
      const bg = ctx.createRadialGradient(
        width / 2,
        height * 0.46,
        12,
        width / 2,
        height * 0.46,
        Math.max(width, height) * 0.8,
      );
      bg.addColorStop(0, `rgb(${16 + warm * 16}, ${15 + warm * 2}, ${19 - warm * 4})`);
      bg.addColorStop(1, "rgb(6, 7, 10)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // the medium, drifting
      if (lens < 0.9) {
        ctx.fillStyle = `rgba(150, 168, 200, ${0.075 * (1 - lens)})`;
        ctx.beginPath();
        for (let i = 0; i < MOTES; i++) {
          const mx = (motes[i * 3] + (reduced ? 0 : Math.sin(localT * 0.1 + i) * 0.03)) * width;
          const my = (motes[i * 3 + 1] + (reduced ? 0 : Math.cos(localT * 0.08 + i * 1.7) * 0.03)) * height;
          const rr = motes[i * 3 + 2] * (1 + breath * 0.25);
          ctx.moveTo(mx + rr, my);
          ctx.arc(mx, my, rr, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      if (sheet && sheet.n > 0) {
        const n = sheet.n;
        const ox = width / 2;
        const oy = height / 2;
        const alpha = (1 - leaving) * clamp01(1 - lens * 0.35);
        const front = fateFront(sheet.t);

        // the morphogen, once per frame, for the front contour
        for (let i = 0; i < n; i++) {
          morph[i] = morphogenAt(field, sheet.px[i] / sheet.spanX, sheet.py[i] / sheet.spanY, axis);
        }

        // — the pit's throat, under everything —
        let deepest = 0;
        let deepX = 0;
        let deepY = 0;
        for (let i = 0; i < n; i++) {
          if (sheet.depth[i] > deepest) {
            deepest = sheet.depth[i];
            deepX = sheet.px[i];
            deepY = sheet.py[i];
          }
        }
        if (deepest > 0.02) {
          const px = ox + deepX * scale;
          const py = oy + deepY * scale;
          const rr = 2.4 * scale;
          const g = ctx.createRadialGradient(px, py, 1, px, py, rr);
          g.addColorStop(0, `rgba(2, 3, 5, ${0.8 * deepest})`);
          g.addColorStop(1, "rgba(2, 3, 5, 0)");
          ctx.fillStyle = g;
          ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2);
        }

        // — the bloom: each cell's own faint halo, one batched fill, so the
        // sheet glows rather than sits flat on the dark —
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const rr = sheet.r[i] * scale * 1.7 * (1 - sheet.depth[i] * 0.5);
          const px = ox + sheet.px[i] * scale;
          const py = oy + sheet.py[i] * scale;
          ctx.moveTo(px + rr, py);
          ctx.arc(px, py, rr, 0, Math.PI * 2);
        }
        ctx.fillStyle = `rgba(150, 128, 96, ${0.055 * alpha})`;
        ctx.fill();

        // — the cells: batched fills, one per fate and brightness band —
        // The morphogen is visible as light on the sheet long before the
        // front reaches it and commits a fate: the gradient is already
        // there, and differentiation is only the reading of it.
        const waveK = reduced ? 0 : (Math.PI * 2) / Math.max(0.4, wavePeriod);
        const bandAlpha = [0.3, 0.44, 0.62];
        for (let f = 0; f <= INNER_FATE; f++) {
          for (let band = 0; band < 3; band++) {
            ctx.beginPath();
            let any = false;
            for (let i = 0; i < n; i++) {
              if (sheet.fate[i] !== f) continue;
              const m = morph[i];
              let b = m < 0.36 ? 0 : m < 0.68 ? 1 : 2;
              b = clamp(b - Math.round(sheet.depth[i] * 2), 0, 2);
              if (b !== band) continue;
              // a peristaltic wave crossing the sheet — cells swell and pass it on
              const wave = reduced
                ? 0
                : Math.sin(localT * waveK - (sheet.px[i] / Math.max(0.001, sheet.spanX)) * 2.2) * 0.08;
              const rr =
                sheet.r[i] * scale * (0.78 + wave + breath * 0.05 + lit[i] * 0.4) * (1 - sheet.depth[i] * 0.45);
              if (rr <= 0.2) continue;
              const px = ox + sheet.px[i] * scale;
              const py = oy + sheet.py[i] * scale;
              ctx.moveTo(px + rr, py);
              ctx.arc(px, py, rr, 0, Math.PI * 2);
              any = true;
            }
            if (!any) continue;
            const boost = f === INNER_FATE ? 1.25 : 1;
            ctx.fillStyle = `rgba(${FATE_TINT[f]}, ${bandAlpha[band] * boost * alpha})`;
            ctx.fill();
            // the membrane: every cell is bounded, and you can see the bound
            ctx.strokeStyle = `rgba(${FATE_TINT[f]}, ${(0.32 + band * 0.16) * boost * alpha})`;
            ctx.lineWidth = 0.9;
            ctx.stroke();
          }
        }

        // — the adhesion graph: four batched strokes, bucketed by strain —
        // Taut bonds glow warm; a bond near its breaking strain runs hot.
        const BUCKETS = 4;
        const bucketTint = ["118, 138, 158", "168, 190, 206", "231, 172, 82", "226, 120, 90"];
        const bucketAlpha = [0.2, 0.34, 0.5, 0.72];
        const bucketWidth = [0.8, 1, 1.2, 1.6];
        for (let b = 0; b < BUCKETS; b++) {
          ctx.beginPath();
          let any = false;
          for (let e = 0; e < sheet.ecount; e++) {
            if (!sheet.live[e]) continue;
            const st = strainOf(sheet, e);
            const bi = st < -0.04 ? 0 : st < 0.16 ? 1 : st < 0.4 ? 2 : 3;
            if (bi !== b) continue;
            const a = sheet.ea[e];
            const c = sheet.eb[e];
            ctx.moveTo(ox + sheet.px[a] * scale, oy + sheet.py[a] * scale);
            ctx.lineTo(ox + sheet.px[c] * scale, oy + sheet.py[c] * scale);
            any = true;
          }
          if (!any) continue;
          ctx.strokeStyle = `rgba(${bucketTint[b]}, ${bucketAlpha[b] * alpha * (1 + lens * 0.8)})`;
          ctx.lineWidth = bucketWidth[b];
          ctx.stroke();
        }

        // — the differentiation front: the contour where the sweep is now —
        // Under a three-finger hold this line visibly crawls; that is what
        // the quarter-speed clock looks like.
        if (front > 0.001 && front < 0.999) {
          ctx.beginPath();
          let any = false;
          for (let e = 0; e < sheet.ecount; e++) {
            if (!sheet.live[e]) continue;
            const a = sheet.ea[e];
            const c = sheet.eb[e];
            if (morph[a] > front === morph[c] > front) continue;
            ctx.moveTo(ox + sheet.px[a] * scale, oy + sheet.py[a] * scale);
            ctx.lineTo(ox + sheet.px[c] * scale, oy + sheet.py[c] * scale);
            any = true;
          }
          if (any) {
            ctx.strokeStyle = `rgba(242, 238, 230, ${(0.4 + breath * 0.2) * alpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }

        // — the polarity: each cell's apical face, one batched stroke —
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const px = ox + sheet.px[i] * scale;
          const py = oy + sheet.py[i] * scale;
          const r0 = sheet.r[i] * scale * 0.35;
          const r1 = sheet.r[i] * scale * 0.92;
          ctx.moveTo(px + Math.cos(sheet.pol[i]) * r0, py + Math.sin(sheet.pol[i]) * r0);
          ctx.lineTo(px + Math.cos(sheet.pol[i]) * r1, py + Math.sin(sheet.pol[i]) * r1);
        }
        ctx.strokeStyle = `rgba(242, 238, 230, ${(0.09 + lens * 0.26) * alpha})`;
        ctx.lineWidth = 0.7;
        ctx.stroke();

        // — what has just been touched, lit —
        ctx.beginPath();
        let anyLit = false;
        for (let i = 0; i < n; i++) {
          if (lit[i] <= 0.02) continue;
          const px = ox + sheet.px[i] * scale;
          const py = oy + sheet.py[i] * scale;
          const rr = sheet.r[i] * scale * (1.1 + lit[i] * 0.9);
          ctx.moveTo(px + rr, py);
          ctx.arc(px, py, rr, 0, Math.PI * 2);
          anyLit = true;
        }
        if (anyLit) {
          ctx.strokeStyle = `rgba(248, 240, 224, ${0.4 * alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // — the hand's mark —
        if (selIdx >= 0 && selIdx < n) {
          const px = ox + sheet.px[selIdx] * scale;
          const py = oy + sheet.py[selIdx] * scale;
          ctx.strokeStyle = "rgba(242, 238, 230, 0.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, sheet.r[selIdx] * scale * 1.7 + 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (glimmerIdx >= 0 && glimmerIdx < n && now - glimmerAt < 1700) {
          const u = (now - glimmerAt) / 1700;
          ctx.strokeStyle = `rgba(238, 234, 219, ${0.3 * (1 - u)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(
            ox + sheet.px[glimmerIdx] * scale,
            oy + sheet.py[glimmerIdx] * scale,
            4 + u * 42,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }

        // — the notation lens: the chord the topology is singing —
        if (lens > 0.5) {
          const la = (lens - 0.5) / 0.5;
          ctx.globalAlpha = la;
          ctx.font = "300 11px ui-monospace, 'SF Mono', Menlo, monospace";
          ctx.textAlign = "left";
          const base = height - 104;
          ctx.fillStyle = "rgba(206, 222, 250, 0.72)";
          ctx.fillText(
            chord.num.map((num, k) => `${num}/${chord.den[k]}`).join(" · "),
            18,
            base,
          );
          ctx.fillText(
            `${n} cells · adhesion ${(adhesion * 100).toFixed(0)} · roughness ${rough.toFixed(2)}`,
            18,
            base + 17,
          );
          // the degree spectrum, as bars — the graph seen as its own chord
          const bw = Math.min(26, (width - 44) / 7);
          for (let k = 0; k < chord.weight.length; k++) {
            const h = chord.weight[k] * 46;
            ctx.fillStyle = `rgba(231, 172, 82, ${0.34 + chord.weight[k] * 0.5})`;
            ctx.fillRect(18 + k * (bw + 4), base + 58 - h, bw, h);
          }
          ctx.globalAlpha = 1;
        }
      }

      // ——— glimmer: after ~20s idle, one cell answers on its own
      if (sheet && sheet.n > 0 && now - lastInteractionAt > 20000 && now - glimmerAt > 6500 && !reduced) {
        glimmerAt = now;
        glimmerIdx = Math.floor((hashSeed(Math.round(now / 6500)) % 10000) / 10000 * sheet.n);
        lit[glimmerIdx] = 0.5;
      }

      // ——— the world-law, felt at the edge: a loose sheet reads warm
      if (rough > 1.2) {
        const heat = clamp01((rough - 1.2) / 3);
        const g = ctx.createLinearGradient(0, 0, width, 0);
        g.addColorStop(0, `rgba(200, 92, 40, ${heat * 0.1})`);
        g.addColorStop(0.5, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(200, 92, 40, ${heat * 0.1})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }

      if (dirty && now - savedAt > 4000) save();

      // the sheet coming apart, when it has been let go
      if (dissolveRef.current && sheet) {
        leaving = Math.max(leaving, 0.02);
        let live = 0;
        for (let e = 0; e < sheet.ecount; e++) if (sheet.live[e]) live += 1;
        if (live > 0) {
          let cut = Math.max(1, Math.ceil(live * dt * 2.4));
          for (let e = 0; e < sheet.ecount && cut > 0; e++) {
            if (!sheet.live[e]) continue;
            sheet.live[e] = 0;
            cut -= 1;
          }
          recomputeChord();
        } else if (sheet.n > 0) {
          sheet.n = Math.max(0, sheet.n - Math.max(1, Math.ceil(sheet.n * dt * 3)));
        } else {
          dissolveRef.current = false;
          sheet = null;
        }
      }
    };
    raf = requestAnimationFrame(draw);

    const onHide = () => {
      if (dirty) save();
    };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      if (dirty) save();
      observer.disconnect();
      detachGestures();
      detachVessel();
      document.removeEventListener("visibilitychange", onHide);
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
    };
  }, []);

  const letGo = () => {
    // the sheet comes apart bond by bond, then the cells go with it
    dissolveRef.current = true;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ cleared: true }));
    } catch {
      /* noop */
    }
    setHasKept(false);
    try {
      getFieldAudio().thud();
      haptics.roll();
    } catch {
      /* noop */
    }
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="a sheet of cells that holds itself together"
      style={{
        position: "fixed",
        inset: 0,
        background: "#06070a",
        outline: "none",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <LetGo label="let the sheet go" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
