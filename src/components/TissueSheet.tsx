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
 * Alive at rest: the sheet seethes, breathes on the shared 7 s clock, a
 * peristaltic wave crosses it, the differentiation front creeps over the
 * morphogen and lands fates behind itself — and, the room's own central
 * verb shown before it is asked for, a cell divides on its own every few
 * seconds, the news of it rippling outward through the plasm. One finger
 * stroked across it divides the cells it passes, each daughter taking half
 * the mother's area; a cell under the stroke visibly swells and starts to
 * pinch along its own spindle axis well before the stroke is long enough
 * to finish the division, so a stroke that stops short still shows the
 * hand what a longer one does. One finger held squarely on a single cell
 * draws it inward and, past the ceremony, resorbs it — apoptosis, its
 * neighbours (already each other's neighbours, in a hex sheet) closing the
 * gap it leaves without a new bond needing to be made. One finger held on
 * the gaps between cells is the field's own solemn act instead: apical
 * constriction deepening into gastrulation, closing over into a second
 * layer past the same ceremony. A touch that lands on neither still lands
 * somewhere — a ripple marks the point and nudges what plasm is near it.
 * Three fingers touch the world-law: drag is adhesion, and a sheet let
 * loose comes apart into dissonance; hold dilates the clock to a quarter,
 * which you see as the front stalling; twist turns the body axis and the
 * pattern with it; tap is tutti, one synchronized pulse of the whole
 * chord. A flick tears. Two fingers drag to pan the frame over the dense
 * sheet; two fingers twist to the notation lens. Tilt is gravity, a shake
 * strains every bond, a knock rings the whole chord, and turning the sheet
 * face-down is night. A press past the sheet's cap refuses visibly, not
 * only in sound.
 *
 * The sheet persists in `objetdart:tissue:v1` with the quiet clear at the
 * bottom. Pinch is unbound — ScaleTravel owns it (the petal above, the
 * single cell below). Pan2 stays here: the global frame verb, inspection of
 * a sheet that would otherwise sit still under the hand. Breath is left to
 * the candle, which already owns the microphone and the blow-out on every
 * route; the sheet has no wind register of its own left to give it — three
 * fingers already speak for the world-law here as adhesion, not weather.
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
  apoptose,
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
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";

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

    // ——— performance contract (room-runtime): governed detail, DPR ceiling,
    // and a hard sleep while the tab is hidden ———
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let sleeping = document.hidden;
    const offVis = onVisibility((hidden) => {
      sleeping = hidden;
      if (hidden) gov.force("sleep");
    });

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
    /** face-down is night: the sheet dims and slows until it's turned back */
    let night = 0;
    let nightTarget = 0;

    // ——— the frame ———
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    // two-finger drag pans the camera over the sheet (screen px). Targets
    // ease toward the hand; reduced motion snaps so the frame never lags.
    let viewX = 0;
    let viewY = 0;
    let viewTX = 0;
    let viewTY = 0;
    let lastPanCueAt = 0;

    // ——— the hand ———
    let pitActive = false;
    let pitX = 0;
    let pitY = 0;
    let pitAmount = 0;
    let pitSealed = false;
    let lastPitToneAt = 0;
    /** the last hold tick — a hold that turns into a drag never releases */
    let pitTickAt = 0;
    /** the one cell a hold landed squarely on — its own solemn act, not the field's */
    let holdCellIdx = -1;
    let holdResorbed = false;
    let strokeX = 0;
    let strokeY = 0;
    let strokeRun = 0;
    let strokeLive = false;
    /** the cell currently charging toward division under the stroke */
    let strokeCellIdx = -1;
    let selIdx = -1;
    let kbCharge = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let glimmerIdx = -1;
    /** a short stroke the idle sheet draws across itself — grammar §6 */
    let glimmerPath: { x: number; y: number }[] = [];
    /** the two daughters of the last mitosis, lit as a bloom */
    let bloomAt = 0;
    let bloomI = -1;
    let bloomJ = -1;
    let wavePeriod = 6.4;
    let leaving = 0;
    /** the room's own central verb, shown before it's asked for */
    let nextAutoDivideAt = performance.now() + 2600;

    // ——— the sheet ———
    let cleared = false;
    let visited = false;
    let sheet: Sheet | null = null;
    let field: MorphogenField = morphogenField(0x715);

    const lit = new Float32Array(MAX_CELLS);
    // No two cells in an epithelium look the same size. This is a drawing
    // variation only — the mechanical radius stays uniform so the lattice's
    // rest lengths remain satisfiable and bond colour reads real strain.
    const girth = new Float32Array(MAX_CELLS);
    for (let i = 0; i < MAX_CELLS; i++) girth[i] = 0.84 + ((hashSeed(i, 0x9a1) % 1000) / 1000) * 0.32;
    const morph = new Float64Array(MAX_CELLS);
    // How close a cell is to dividing (the stroke's charge) and how far a
    // held cell has drawn into itself toward apoptosis — both continuous,
    // both visible while they accumulate, per SPEC's continuity law.
    const divCharge = new Float32Array(MAX_CELLS);
    const resorb = new Float32Array(MAX_CELLS);
    // Touches and events that need a mark in the plasm at a point that may
    // not be any particular cell — a miss, a refusal, a division's ripple,
    // a resorption. Fixed-size ring so nothing allocates in the draw loop.
    const MAX_MARKS = 6;
    const markX = new Float32Array(MAX_MARKS);
    const markY = new Float32Array(MAX_MARKS);
    const markAt = new Float64Array(MAX_MARKS);
    const markKind = new Uint8Array(MAX_MARKS); // 0 miss, 1 division, 2 refuse, 3 apoptosis
    let markCursor = 0;
    const pushMark = (x: number, y: number, kind: number) => {
      markX[markCursor] = x;
      markY[markCursor] = y;
      markAt[markCursor] = performance.now();
      markKind[markCursor] = kind;
      markCursor = (markCursor + 1) % MAX_MARKS;
    };
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
      const ratio = resolveDpr(gov.tier(), { embedded, reducedMotion: reduced });
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

    const panLimit = () => {
      // enough travel to bring a sheet edge toward the centre — denser
      // sheets span more of the viewport, so the limit follows the lattice
      if (sheet) {
        return {
          x: Math.max(48, sheet.spanX * scale * 0.9),
          y: Math.max(48, sheet.spanY * scale * 0.9),
        };
      }
      return { x: width * 0.35, y: height * 0.35 };
    };

    const toSheet = (cx: number, cy: number) => ({
      x: (clamp(cx - rectLeft, 0, width) - width / 2 - viewX) / scale,
      y: (clamp(cy - rectTop, 0, height) - height / 2 - viewY) / scale,
    });

    // ——— the acts ———
    /** A cell resorbed: its own solemn act. Swaps `lit`/`girth`/charge
     * arrays alongside the sheet's own index swap, so nothing the room is
     * mid-animating jumps to a cell it was never happening to. */
    const resorbCell = (i: number) => {
      if (!sheet) return false;
      const lastCell = sheet.n - 1;
      const ok = apoptose(sheet, i);
      if (!ok) return false;
      if (i !== lastCell) {
        lit[i] = lit[lastCell];
        girth[i] = girth[lastCell];
        divCharge[i] = divCharge[lastCell];
      }
      lit[lastCell] = 0;
      divCharge[lastCell] = 0;
      resorb[i] = 0;
      if (selIdx === i || selIdx === lastCell) selIdx = -1;
      if (strokeCellIdx === i || strokeCellIdx === lastCell) strokeCellIdx = -1;
      return true;
    };

    const divideAt = (x: number, y: number, auto = false) => {
      if (!sheet) return;
      const i = nearestCell(sheet, x, y, 1.4);
      if (i < 0) return;
      if (sheet.n >= sheet.cap) {
        if (auto) return; // the sheet is full; ambient life just skips a beat
        pushMark(x, y, 2);
        try {
          audio.refuse();
          haptics.chop();
        } catch {
          /* noop */
        }
        return;
      }
      const j = divideCell(sheet, i, hashSeed(i, sheet.n, Math.round(x * 977)));
      if (j < 0) return;
      lit[i] = 1;
      lit[j] = 1;
      bloomAt = performance.now();
      bloomI = i;
      bloomJ = j;
      divCharge[i] = 0;
      divCharge[j] = 0;
      recomputeChord();
      soundCell(i, 0.18);
      soundCell(j, auto ? 0.3 : 0.22);
      pushMark(sheet.px[i], sheet.py[i], 1);
      try {
        audio.spark();
        if (auto) haptics.bloom();
        else haptics.detent();
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
      // On the CANVAS, not the wrapper (RoomTemplate §3). The engine takes
      // pointer capture on whatever it is mounted to, and the quiet clear
      // control is a DOM child of the wrapper — mounted there, the capture
      // swallowed its clicks and the control could never be pressed.
      canvas,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) return; // ScaleTravel's step back
          if (e.fingers === 3) {
            // three-finger tap = tutti (grammar §5): one synchronized pulse
            // of everything alive — the whole chord answers at once.
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
          // A tap that misses every cell still lands somewhere: a ripple
          // marks the point itself and nudges whatever plasm is nearby, so
          // the touch is never mute (grammar §6.4 — unbound gestures answer
          // gently, never invisibly).
          pushMark(p.x, p.y, 0);
          for (let k = 0; k < sheet.n; k++) {
            const dx = sheet.px[k] - p.x;
            const dy = sheet.py[k] - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > 6.5) continue;
            const d = Math.sqrt(d2) || 1;
            const f = (1 - d / 2.55) * 0.1 * (0.4 + e.intensity * 0.6);
            sheet.px[k] += (dx / d) * f;
            sheet.py[k] += (dy / d) * f;
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
          if (e.fingers !== 1) return;
          // an emptied room is not a dead end: dwell on the dark plants a
          // new epithelium, the same law that met the first visit.
          if (!sheet) {
            if (e.phase === "enter") {
              try {
                haptics.tap();
                audio.playTone(ROOT_HZ * 0.5, 0.35);
              } catch {
                /* noop */
              }
              return;
            }
            if (e.phase === "release") return;
            if (e.tier >= 2 || e.elapsed >= 900) {
              sheet = freshSheet();
              field = morphogenField(sheet.seed);
              prevLive = new Uint8Array(sheet.ecap);
              cleared = false;
              leaving = 0;
              recomputeChord();
              scale = Math.min(width / (2 * sheet.spanX), height / (2 * sheet.spanY)) * 0.86;
              setHasKept(true);
              save();
              try {
                audio.bell();
                haptics.bloom();
              } catch {
                /* noop */
              }
              dirty = true;
            }
            return;
          }
          const p = toSheet(e.x, e.y);
          if (e.phase === "enter") {
            pitTickAt = performance.now();
            pitSealed = false;
            pitX = p.x;
            pitY = p.y;
            pitAmount = 0;
            selIdx = nearestCell(sheet, p.x, p.y, 1.2);
            // A hold that lands squarely ON a cell targets that one cell —
            // its own solemn act (apoptosis) — never the field-wide pit. A
            // hold that lands in the gaps between cells is the field's act
            // (gastrulation) instead. The two never fire together.
            holdCellIdx = nearestCell(sheet, p.x, p.y, 0.5);
            holdResorbed = false;
            pitActive = holdCellIdx < 0;
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          if (e.phase === "release") {
            pitActive = false;
            holdCellIdx = -1;
            return;
          }
          pitTickAt = performance.now();
          pitX = p.x;
          pitY = p.y;

          if (holdCellIdx >= 0) {
            if (holdCellIdx >= sheet.n) {
              holdCellIdx = -1;
              return;
            }
            if (holdResorbed) return;
            // Duration is the axis: the cell draws into itself the longer
            // the hold stays, exactly as the field pit deepens — only here
            // the draw is one cell's, not a neighbourhood's.
            const amt = clamp01(e.elapsed / 2600);
            resorb[holdCellIdx] = amt;
            const now = performance.now();
            if (now - lastPitToneAt > 260) {
              lastPitToneAt = now;
              try {
                audio.playTone(ROOT_HZ * (1 - amt * 0.3), 0.4);
                haptics.roll();
              } catch {
                /* noop */
              }
            }
            if (e.tier >= 3) {
              holdResorbed = true;
              const cx = sheet.px[holdCellIdx];
              const cy = sheet.py[holdCellIdx];
              if (resorbCell(holdCellIdx)) {
                recomputeChord();
                pushMark(cx, cy, 3);
                try {
                  audio.thud();
                  haptics.bloom();
                } catch {
                  /* noop */
                }
                dirty = true;
              }
            }
            return;
          }

          // Duration is the axis: the pit keeps deepening the longer the
          // finger stays, and past the ceremony it closes over for good.
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
            // a hold that became a stroke is no longer a hold
            pitActive = false;
            strokeLive = true;
            strokeRun = 0;
            strokeX = p.x;
            strokeY = p.y;
            return;
          }
          if (e.phase === "end") {
            strokeLive = false;
            strokeCellIdx = -1;
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
          // ...and the cell nearest the stroke's tip visibly strains toward
          // division the whole time the run accumulates — continuously, not
          // only at the threshold — so a stroke that stops short still
          // taught the hand what a longer one does.
          strokeCellIdx = nearestCell(sheet, p.x, p.y, 1.3);
          strokeRun += step;
          if (strokeCellIdx >= 0) divCharge[strokeCellIdx] = clamp01(strokeRun / 0.55);
          if (strokeRun > 0.55) {
            strokeRun = 0;
            divideAt(p.x, p.y);
            strokeCellIdx = -1;
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
        pan2: (e) => {
          // the global frame verb: two fingers slide the camera over the
          // sheet. Pinch stays unbound — ScaleTravel owns scale travel.
          lastInteractionAt = performance.now();
          if (e.phase === "end") return;
          const lim = panLimit();
          // reduced motion: smaller steps, snapped with no ease lag
          const gain = reduced ? 0.55 : 1;
          viewTX = clamp(viewTX + e.dx * gain, -lim.x, lim.x);
          viewTY = clamp(viewTY + e.dy * gain, -lim.y, lim.y);
          if (reduced) {
            viewX = viewTX;
            viewY = viewTY;
          }
          if (e.phase === "start" || performance.now() - lastPanCueAt > 280) {
            lastPanCueAt = performance.now();
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
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
      flip: ({ faceDown }) => {
        // face-down is night: the sheet dims and slows almost still, and
        // wakes exactly where it left off when turned back over
        nightTarget = faceDown ? 1 : 0;
        lastInteractionAt = performance.now();
        if (faceDown) {
          try {
            audio.thud();
            haptics.roll();
          } catch {
            /* noop */
          }
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
        holdCellIdx = -1;
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
        if (!ev.repeat) {
          if (selIdx < 0) selIdx = nearestCell(sheet, 0, 0);
          if (selIdx < 0) return;
          // a press divides, as a stroke does
          divideAt(sheet.px[selIdx], sheet.py[selIdx]);
          kbCharge = 0;
          pitSealed = false;
          return;
        }
        // A held key always targets the one selected cell — the keyboard
        // has no notion of "the gaps between cells" the way a touch does —
        // so its ceremony is that cell's own solemn act: apoptosis. Once
        // resorbed, `selIdx` clears (there's nothing left to re-target),
        // so a still-held key must stop rather than pick a new cell.
        if (pitSealed || selIdx < 0 || selIdx >= sheet.n) return;
        kbCharge = clamp01(kbCharge + 0.035);
        resorb[selIdx] = kbCharge;
        const now = performance.now();
        if (now - lastPitToneAt > 260) {
          lastPitToneAt = now;
          try {
            audio.playTone(ROOT_HZ * (1 - kbCharge * 0.3), 0.4);
            haptics.roll();
          } catch {
            /* noop */
          }
        }
        if (kbCharge >= 1) {
          pitSealed = true;
          const cx = sheet.px[selIdx];
          const cy = sheet.py[selIdx];
          if (resorbCell(selIdx)) {
            recomputeChord();
            pushMark(cx, cy, 3);
            try {
              audio.thud();
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

    // ——— fidelity: a cached translucency + grain sprite, baked once ———
    // Real per-cell light transmission and cytoplasmic granularity would
    // need a createRadialGradient per cell if drawn live — forbidden inside
    // a per-element loop (SPEC's performance contract). Bake it once and
    // stamp it with drawImage instead: the cost per cell is one blit no
    // matter how many cells the sheet holds. The discrete-membrane look
    // stays intact — this shades within a cell's own disc, it never blends
    // neighbours together.
    const cellSprite = document.createElement("canvas");
    {
      const SP = 48;
      cellSprite.width = SP;
      cellSprite.height = SP;
      const sctx = cellSprite.getContext("2d");
      if (sctx) {
        const cx = SP / 2;
        const cy = SP / 2;
        const r = SP / 2;
        const g = sctx.createRadialGradient(cx - r * 0.24, cy - r * 0.3, r * 0.05, cx, cy, r);
        g.addColorStop(0, "rgba(255,255,255,0.55)");
        g.addColorStop(0.55, "rgba(255,255,255,0.14)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        sctx.fillStyle = g;
        sctx.beginPath();
        sctx.arc(cx, cy, r, 0, Math.PI * 2);
        sctx.fill();
        // cytoplasmic grain: a fixed, seeded scatter, so the sprite (and so
        // every cell's shading) is identical on every load
        let a = 0x51ed270b;
        for (let k = 0; k < 90; k++) {
          a = (Math.imul(a ^ (a >>> 15), 0x01000193) >>> 0) || 1;
          const ang = ((a % 6283) / 1000);
          a = (Math.imul(a ^ (a >>> 13), 0x01000193) >>> 0) || 1;
          const rad = Math.sqrt((a % 1000) / 1000) * r * 0.86;
          a = (Math.imul(a ^ (a >>> 11), 0x01000193) >>> 0) || 1;
          const bright = (a % 1000) / 1000 > 0.5;
          const sx = cx + Math.cos(ang) * rad;
          const sy = cy + Math.sin(ang) * rad;
          sctx.fillStyle = bright ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.12)";
          sctx.beginPath();
          sctx.arc(sx, sy, 0.6 + ((a >>> 3) % 100) / 260, 0, Math.PI * 2);
          sctx.fill();
        }
      }
    }

    // ——— the loop ———
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      if (sleeping) {
        // no simulation, no draw — the automaton scan and everything below
        // it is skipped entirely while the tab is hidden
        last = now;
        return;
      }
      const detail = detailForTier(tier);
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      adhesion += (adhesionTarget - adhesion) * Math.min(1, dt * 3);
      axis += (axisTarget - axis) * Math.min(1, dt * 3);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      if (reduced) {
        viewX = viewTX;
        viewY = viewTY;
      } else {
        viewX += (viewTX - viewX) * Math.min(1, dt * 14);
        viewY += (viewTY - viewY) * Math.min(1, dt * 14);
      }
      gx += (gxTarget - gx) * Math.min(1, dt * 2.5);
      gy += (gyTarget - gy) * Math.min(1, dt * 2.5);
      night += (nightTarget - night) * Math.min(1, dt * (reduced ? 8 : 2));
      agitation *= Math.exp(-dt * 1.4);
      if (!reduced) localT += dt * timeScale * (1 - night * 0.7);
      if (leaving > 0) leaving = Math.max(0, leaving - dt * 0.7);
      for (let i = 0; i < lit.length; i++) if (lit[i] > 0) lit[i] = Math.max(0, lit[i] - dt * 1.5);
      // the stroke's division-charge and a held cell's resorb amount both
      // fade back down whenever the hand isn't actively deepening them —
      // continuous in both directions, never a switch
      const activeStrokeCell = strokeLive ? strokeCellIdx : -1;
      const activeHoldCell = holdCellIdx >= 0 && now - pitTickAt <= 340 ? holdCellIdx : -1;
      for (let i = 0; i < divCharge.length; i++) {
        if (divCharge[i] > 0 && i !== activeStrokeCell) divCharge[i] = Math.max(0, divCharge[i] - dt * 0.9);
      }
      for (let i = 0; i < resorb.length; i++) {
        if (resorb[i] > 0 && i !== activeHoldCell) resorb[i] = Math.max(0, resorb[i] - dt * 0.7);
      }

      const audioT = audio.getAudioTime();
      const awake = audioT !== null;
      const t = audioT ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // ——— the body ———
      if (sheet && sheet.n > 0) {
        // A hold that turned into a drag or a flick never sends its release,
        // so the pit would stay pressed into the sheet forever. It lifts
        // when the ticks stop, exactly as a finger does.
        if (pitActive && now - pitTickAt > 340 && pitTickAt > 0) pitActive = false;
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

        // The room's own central verb, demonstrated before it's asked for:
        // a cell divides on its own every few seconds, from the very first
        // seconds a visitor arrives — not gated on idle, because the point
        // is to teach the hand what stroking does before the hand tries.
        if (!reduced && now >= nextAutoDivideAt && sheet.n < sheet.cap - 20) {
          nextAutoDivideAt = now + 3800 + (hashSeed(Math.round(now / 100)) % 2600);
          const k = hashSeed(Math.round(now / 71), sheet.n) % sheet.n;
          divideAt(sheet.px[k], sheet.py[k], true);
        }
      }

      // ——— render ———
      const warm = clamp01(rough / 4);
      const dim = 1 - night * 0.72;
      const bg = ctx.createRadialGradient(
        width / 2,
        height * 0.46,
        12,
        width / 2,
        height * 0.46,
        Math.max(width, height) * 0.8,
      );
      bg.addColorStop(0, `rgb(${(16 + warm * 16) * dim}, ${(15 + warm * 2) * dim}, ${(19 - warm * 4) * dim})`);
      bg.addColorStop(1, `rgb(${6 * dim}, ${7 * dim}, ${10 * dim})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // the medium, drifting — the count itself scales with the governed
      // detail tier, so a laboring frame simply carries fewer motes
      const moteCount = Math.max(4, Math.round(MOTES * detail.particles));
      if (lens < 0.9) {
        ctx.fillStyle = `rgba(150, 168, 200, ${0.075 * (1 - lens) * dim})`;
        ctx.beginPath();
        for (let i = 0; i < moteCount; i++) {
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
        const ox = width / 2 + viewX;
        const oy = height / 2 + viewY;
        const alpha = (1 - leaving) * clamp01(1 - lens * 0.35) * dim;
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
        // sheet glows rather than sits flat on the dark — skipped at the
        // lowest governed tier, where it is pure cost for little read —
        const highDetail = tier === "high" || tier === "medium";
        if (highDetail) {
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const rr =
              sheet.r[i] * scale * girth[i] * 1.75 * (1 - sheet.depth[i] * 0.5) * (1 - resorb[i] * 0.8);
            const px = ox + sheet.px[i] * scale;
            const py = oy + sheet.py[i] * scale;
            ctx.moveTo(px + rr, py);
            ctx.arc(px, py, rr, 0, Math.PI * 2);
          }
          ctx.fillStyle = `rgba(150, 128, 96, ${0.055 * alpha})`;
          ctx.fill();
        }

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
              // a cell charging toward division swells taut; one drawing
              // inward under a held finger shrinks toward its own centre —
              // both continuous, so the eye reads the accumulation itself
              const rr =
                sheet.r[i] * scale * girth[i] *
                (0.86 + wave + breath * 0.05 + lit[i] * 0.4 + divCharge[i] * 0.24) *
                (1 - sheet.depth[i] * 0.45) * (1 - resorb[i] * 0.88);
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
            // a thin bright inner rim on the same path — real membrane
            // thickness, light catching its inside edge, at zero extra cost
            // (no new path, no gradient, just a second stroke of the one
            // already built)
            if (highDetail) {
              ctx.strokeStyle = `rgba(252, 248, 238, ${(0.05 + band * 0.035) * boost * alpha})`;
              ctx.lineWidth = 0.4;
              ctx.stroke();
            }
          }
        }

        // — cytoplasm: transmitted light + grain, stamped from a cached
        // sprite (never a per-cell gradient — SPEC's performance contract)
        // so the cost per cell is one drawImage regardless of the sheet's
        // size. Reserved for the top governed tier, where it's a free read.
        if (highDetail && tier === "high" && cellSprite) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < n; i++) {
            const rr =
              sheet.r[i] * scale * girth[i] * (1 - sheet.depth[i] * 0.45) * (1 - resorb[i] * 0.88);
            if (rr <= 0.6) continue;
            const px = ox + sheet.px[i] * scale;
            const py = oy + sheet.py[i] * scale;
            const size = rr * 2.1;
            ctx.globalAlpha = (0.32 + lit[i] * 0.25) * alpha * (1 - sheet.depth[i] * 0.3);
            ctx.drawImage(cellSprite, px - size / 2, py - size / 2, size, size);
          }
          ctx.restore();
        }

        // — a cell charging toward division: the spindle axis itself grows
        // across it, the same axis `divideCell` actually splits along, so a
        // stroke that stops short still shows exactly what would happen —
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (divCharge[i] <= 0.03) continue;
          const px = ox + sheet.px[i] * scale;
          const py = oy + sheet.py[i] * scale;
          const spindle = sheet.pol[i] + Math.PI / 2;
          const len = sheet.r[i] * scale * girth[i] * 1.9 * divCharge[i];
          const dxp = Math.cos(spindle) * len;
          const dyp = Math.sin(spindle) * len;
          ctx.moveTo(px - dxp, py - dyp);
          ctx.lineTo(px + dxp, py + dyp);
        }
        ctx.strokeStyle = `rgba(248, 240, 224, ${0.55 * alpha})`;
        ctx.lineWidth = 1.1;
        ctx.stroke();

        // — a cell drawing into itself under a held finger: the rim it's
        // pulling away from stays lit a moment, an iris visibly closing —
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (resorb[i] <= 0.03) continue;
          const px = ox + sheet.px[i] * scale;
          const py = oy + sheet.py[i] * scale;
          const rr = sheet.r[i] * scale * girth[i] * (1 - sheet.depth[i] * 0.45);
          ctx.moveTo(px + rr, py);
          ctx.arc(px, py, rr, 0, Math.PI * 2);
        }
        ctx.strokeStyle = `rgba(226, 140, 108, ${0.5 * alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();

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
            const ma = morph[a];
            const mc = morph[c];
            if (ma > front === mc > front) continue;
            // the crossing point itself, so the front reads as a line and
            // not as a cage of whole bonds
            const u = (front - ma) / (mc - ma);
            const fx = ox + (sheet.px[a] + (sheet.px[c] - sheet.px[a]) * u) * scale;
            const fy = oy + (sheet.py[a] + (sheet.py[c] - sheet.py[a]) * u) * scale;
            const rr = 1.5 + breath * 0.7;
            ctx.moveTo(fx + rr, fy);
            ctx.arc(fx, fy, rr, 0, Math.PI * 2);
            any = true;
          }
          if (any) {
            ctx.fillStyle = `rgba(246, 240, 226, ${(0.5 + breath * 0.24) * alpha})`;
            ctx.fill();
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
        ctx.strokeStyle = `rgba(242, 238, 230, ${(0.07 + lens * 0.28) * alpha})`;
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
        // mitosis bloom — both daughters flash as one becoming two
        if (bloomI >= 0 && bloomJ >= 0 && now - bloomAt < 900) {
          const u = (now - bloomAt) / 900;
          const aBloom = (1 - u) * 0.55 * alpha;
          for (const bi of [bloomI, bloomJ]) {
            if (bi < 0 || bi >= n) continue;
            const px = ox + sheet.px[bi] * scale;
            const py = oy + sheet.py[bi] * scale;
            const rr = sheet.r[bi] * scale * (1.4 + u * 1.8);
            ctx.strokeStyle = `rgba(248, 232, 196, ${aBloom})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(px, py, rr, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        if (glimmerIdx >= 0 && glimmerIdx < n && now - glimmerAt < 2200) {
          const u = (now - glimmerAt) / 2200;
          // a short stroke path across a few cells — the sheet showing its verb
          if (glimmerPath.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(ox + glimmerPath[0].x * scale, oy + glimmerPath[0].y * scale);
            for (let k = 1; k < glimmerPath.length; k++) {
              ctx.lineTo(ox + glimmerPath[k].x * scale, oy + glimmerPath[k].y * scale);
            }
            ctx.strokeStyle = `rgba(238, 234, 219, ${0.42 * (1 - u) * alpha})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          ctx.strokeStyle = `rgba(238, 234, 219, ${0.28 * (1 - u)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(
            ox + sheet.px[glimmerIdx] * scale,
            oy + sheet.py[glimmerIdx] * scale,
            4 + u * 36,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }

        // — marks: a touch that missed, a division's ripple, a refusal, a
        // resorption — every one of them a ring at a point, not a cell, so
        // the plasm answers even where there is nothing to hit. Colour
        // alone tells the four apart; a refusal holds its radius rather
        // than growing, which is what makes it read as "no".
        const MARK_LIFE = 620;
        const markTint = ["150, 168, 200", "248, 240, 224", "226, 92, 64", "226, 140, 108"];
        for (let m = 0; m < MAX_MARKS; m++) {
          const age = now - markAt[m];
          if (markAt[m] <= 0 || age < 0 || age > MARK_LIFE) continue;
          const u = age / MARK_LIFE;
          const kind = markKind[m];
          const px = ox + markX[m] * scale;
          const py = oy + markY[m] * scale;
          const rr = kind === 2 ? 3 + u * 5 : 2 + u * (kind === 1 ? 26 : 20);
          ctx.strokeStyle = `rgba(${markTint[kind]}, ${(kind === 2 ? 0.6 : 0.4) * (1 - u) * alpha})`;
          ctx.lineWidth = kind === 2 ? 1.6 : 1;
          ctx.beginPath();
          ctx.arc(px, py, rr, 0, Math.PI * 2);
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

      // ——— glimmer: after ~20s idle, a short stroke crosses a few cells
      if (sheet && sheet.n > 0 && now - lastInteractionAt > 20000 && now - glimmerAt > 6500 && !reduced) {
        glimmerAt = now;
        glimmerIdx = Math.floor(((hashSeed(Math.round(now / 6500)) % 10000) / 10000) * sheet.n);
        lit[glimmerIdx] = 0.5;
        const ang = ((hashSeed(glimmerIdx, Math.round(now / 6500)) % 628) / 100) * 1;
        const step = 1.35;
        glimmerPath = [];
        for (let k = 0; k < 4; k++) {
          const gx = sheet.px[glimmerIdx] + Math.cos(ang) * step * (k - 0.5);
          const gy = sheet.py[glimmerIdx] + Math.sin(ang) * step * (k - 0.5);
          glimmerPath.push({ x: gx, y: gy });
          const ci = nearestCell(sheet, gx, gy, 1.2);
          if (ci >= 0) lit[ci] = Math.max(lit[ci], 0.45);
        }
        try {
          soundCell(glimmerIdx, 0.12);
        } catch {
          /* noop */
        }
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
