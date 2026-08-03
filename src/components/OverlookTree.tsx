"use client";

/**
 * /overlook — the whole tree kept in one glance (plan W8).
 *
 * The album's trunk and branches as one navigable, touchable view: the
 * scale axis drawn as a living tree — quarks at the roots, the fold at the
 * crown — with every band a living miniature in its own material idiom
 * (seething pairs, breathing shells, a dividing cell, a blooming flower,
 * a slow galaxy wheel...). Nothing here is hardcoded: the tree derives
 * structurally from the live travel graph (src/lib/overlook-tree.ts), so
 * a cosmology change in lib/scale.ts redraws the overlook for free —
 * trunk = the canonical chain walked up from the quarks; branches sprout
 * exactly where fork doors exist (flowers off the earth, the ground off
 * the atlas, beyond off the fold).
 *
 * Tap a node and its register chimes (spectralRegisterFor through the
 * manifold's monotone pitch law); hold and the vignette blooms while the
 * node's threads glow — the graph made visible; ceremony hold travels
 * there through the shared crossing presentation. Drag pans, twist raises
 * the lens (living tree ↔ the bare graph: hairlines, mono band ids, a
 * log₁₀ ruler — the notation surface). Three fingers touch the law: tap =
 * the tutti of tuttis (every node pulses in axis order, a glissando of
 * the entire site), hold = all vignettes slow ×0.25. Scrub sways the
 * whole tree; shake shivers it and a few leaves of light fall.
 *
 * This room is a VIEW of the axis, not a place on it — the /relativity
 * exemption: no scale address, no ScaleTravel mount. Pinch is therefore
 * bound in-room as zoom of the view (clamped, local): the one place on
 * the site where that is honest, because there is no band here for a
 * pinch to leave. Deterministic throughout; no persistence — the tree is
 * derived, never kept, so there is nothing to clear.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import {
  SCALE_BANDS,
  spectralRegisterFor,
  travelNeighbor,
  type ScaleBandId,
  type TravelDir,
} from "@/lib/scale";
import { deriveTree, layoutTree, type OverlookNode } from "@/lib/overlook-tree";
import { ScaleTravelOverlay, type EdgeUI } from "@/components/ScaleTravel";

const SCALE_S_KEY = "objetdart:scale:s";
const LEAF_MAX = 24;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 3;
// gyroscopic parallax: the trunk hangs deepest, branches nearer, the
// living miniatures nearest of all — three sheets of one tree
const PAR_MAX = 16;
const PAR_TRUNK = 0.45;
const PAR_BRANCH_STEP = 0.28;
const PAR_VIGNETTE = 0.18; // extra shift of the material inside each disc

// The tree, derived once from the live graph — the room never states the
// cosmology itself, it only draws what the doors say.
const TREE = deriveTree(SCALE_BANDS, (id, dir) =>
  travelNeighbor(id as ScaleBandId, dir as TravelDir),
);
const PLACE = layoutTree(TREE);
const NODES = TREE.nodes;
const MAX_DEPTH = Math.max(1, ...NODES.map((n) => n.depth));
const MAX_ABS_X = Math.max(1, ...NODES.map((n) => Math.abs(PLACE[n.id].x)));

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
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

/** Band center → a gentle audible chime: the register compressed through
 *  the manifold's monotone pitch law (power-compressed, clamped audible). */
function nodeHz(n: OverlookNode): number {
  const { baseHz } = spectralRegisterFor(n.s);
  return clamp(220 * Math.pow(baseHz / 220, 0.62), 60, 1250);
}

/** Ruler numeral: log₁₀ meters, thin and exact — lens view only. */
function rulerLabel(s: number): string {
  return `${s < 0 ? "−" : ""}${Math.abs(s) % 1 === 0 ? Math.abs(s) : Math.abs(s).toFixed(1)}`;
}

type Leaf = { x: number; y: number; vx: number; vy: number; born: number; seed: number };

// ——— the living miniatures ———
// Each vignette is a deterministic function of (its seed, the shared
// clock, the breath) in that room's own material idiom — never a
// screenshot, never a full sim. Static parts (disc, rim) are pre-rendered
// once per node; only the living material is drawn per frame.

type VignetteGeom = {
  rng: () => number;
  /** stars: unit spiral points (x, y, glow) */
  spiral: number[];
  /** molecules: atom offsets (x, y, r) around the bond center */
  atoms: number[];
  /** manifold: speck path phases */
  specks: number[];
  /** quarks: pair sites (x, y, phase) */
  pairs: number[];
  /** birds: per-bird lane, orbit radius, wing phase */
  flock: number[];
  /** space: web nodes (x, y, mass) */
  web: number[];
  /** olympus: ridge heights, far range → near */
  ridge: number[];
};

function buildGeom(id: string): VignetteGeom {
  const rng = mulberry32(hashSeed(`overlook:${id}`));
  const spiral: number[] = [];
  for (let i = 0; i < 42; i++) {
    const u = i / 42;
    const arm = i % 2 === 0 ? 0 : Math.PI;
    const a = arm + u * 4.4 + (rng() - 0.5) * 0.5;
    const rr = 0.12 + u * 0.82;
    spiral.push(Math.cos(a) * rr, Math.sin(a) * rr, 0.3 + rng() * 0.7);
  }
  const atoms: number[] = [];
  const count = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.7;
    const d = i === 0 ? 0 : 0.34 + rng() * 0.22;
    atoms.push(Math.cos(a) * d, Math.sin(a) * d, 0.1 + rng() * 0.08);
  }
  const specks: number[] = [];
  for (let i = 0; i < 5; i++) specks.push(rng());
  const pairs: number[] = [];
  for (let i = 0; i < 9; i++) pairs.push((rng() - 0.5) * 1.4, (rng() - 0.5) * 1.4, rng());
  const flock: number[] = [];
  for (let i = 0; i < 26; i++) flock.push(rng(), 0.25 + rng() * 0.55, rng() * 7);
  const web: number[] = [];
  for (let i = 0; i < 11; i++) web.push((rng() - 0.5) * 1.7, (rng() - 0.5) * 1.7, 0.25 + rng() * 0.75);
  const ridge: number[] = [];
  for (let i = 0; i < 18; i++) ridge.push(rng());
  return { rng, spiral, atoms, specks, pairs, flock, web, ridge };
}

const GEOM = new Map<string, VignetteGeom>(NODES.map((n) => [n.id, buildGeom(n.id)]));

/**
 * Draw one band's living material inside a disc of radius r at (0,0) —
 * the caller has already translated, clipped, and drawn the static base.
 * `t` rides the room's dilatable clock (frozen under reduced motion so
 * the vignettes hold still while structure and travel stay intact).
 */
function drawVignette(
  ctx: CanvasRenderingContext2D,
  id: string,
  r: number,
  t: number,
  breath: number,
) {
  const g = GEOM.get(id);
  if (!g) return;
  switch (id) {
    case "quarks": {
      // seething virtual pairs: born together, gone together
      for (let i = 0; i < g.pairs.length; i += 3) {
        const px = g.pairs[i] * r * 0.6;
        const py = g.pairs[i + 1] * r * 0.6;
        const ph = (t * (0.7 + g.pairs[i + 2] * 0.9) + g.pairs[i + 2] * 7) % 1;
        const a = Math.sin(ph * Math.PI);
        const sep = 2 + a * r * 0.1;
        ctx.fillStyle = `rgba(242, 197, 107, ${0.55 * a})`;
        ctx.beginPath();
        ctx.arc(px - sep, py, 1.2, 0, Math.PI * 2);
        ctx.arc(px + sep, py, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(120, 150, 180, ${0.3 * a})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(px - sep, py);
        ctx.lineTo(px + sep, py);
        ctx.stroke();
      }
      break;
    }
    case "atoms": {
      // electron shells breathing around a bright nucleus
      ctx.fillStyle = "rgba(255, 226, 170, 0.9)";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      for (let sh = 0; sh < 3; sh++) {
        const rr = r * (0.3 + sh * 0.24) * (1 + breath * 0.045);
        ctx.strokeStyle = `rgba(150, 180, 220, ${0.28 - sh * 0.06})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, Math.PI * 2);
        ctx.stroke();
        const a = t * (1.3 - sh * 0.35) + sh * 2.1;
        ctx.fillStyle = "rgba(207, 224, 255, 0.85)";
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "molecules": {
      // one molecule tumbling — a rigid body, softly foreshortened
      const rot = t * 0.5;
      const squash = 0.55 + 0.45 * Math.abs(Math.sin(t * 0.23 + 1));
      const px: number[] = [];
      for (let i = 0; i < g.atoms.length; i += 3) {
        const x = g.atoms[i] * r;
        const y = g.atoms[i + 1] * r;
        px.push(x * Math.cos(rot) - y * Math.sin(rot), (x * Math.sin(rot) + y * Math.cos(rot)) * squash);
      }
      ctx.strokeStyle = "rgba(180, 200, 190, 0.4)";
      ctx.lineWidth = 1;
      for (let i = 2; i < px.length; i += 2) {
        ctx.beginPath();
        ctx.moveTo(px[0], px[1]);
        ctx.lineTo(px[i], px[i + 1]);
        ctx.stroke();
      }
      for (let i = 0, k = 0; i < px.length; i += 2, k += 3) {
        ctx.fillStyle = k === 0 ? "rgba(238, 216, 176, 0.9)" : "rgba(150, 200, 190, 0.8)";
        ctx.beginPath();
        ctx.arc(px[i], px[i + 1], g.atoms[k + 2] * r * (k === 0 ? 1.4 : 1), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "organics": {
      // a carbon chain hunting its angle: the zig-zag opens and closes, and
      // the shimmer along it dies out as the tetrahedral angle arrives
      const fold = 0.5 - 0.5 * Math.cos(t * 0.19);
      const theta = mix(1.62, 1.911, fold); // toward 109.47°
      const strain = Math.abs(theta - 1.911) / 0.3;
      const half = (Math.PI - theta) / 2;
      const L = r * 0.23;
      const pts: number[] = [];
      let cx = 0;
      let cy = 0;
      pts.push(cx, cy);
      for (let i = 0; i < 6; i++) {
        const h = i % 2 === 0 ? -half : half;
        cx += Math.cos(h) * L;
        cy += Math.sin(h) * L;
        pts.push(cx, cy);
      }
      const shiftX = cx / 2;
      const tumble = Math.sin(t * 0.11) * 0.3;
      ctx.save();
      ctx.rotate(tumble);
      ctx.translate(-shiftX, 0);
      ctx.strokeStyle = `rgba(180, 200, 190, ${0.5 - strain * 0.15})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        if (i === 0) ctx.moveTo(pts[0], pts[1]);
        else ctx.lineTo(pts[i], pts[i + 1]);
      }
      ctx.stroke();
      for (let i = 0, k = 0; i < pts.length; i += 2, k++) {
        const end = k === pts.length / 2 - 1;
        ctx.fillStyle = end ? "rgba(226, 150, 130, 0.85)" : "rgba(150, 200, 190, 0.8)";
        ctx.beginPath();
        ctx.arc(pts[i], pts[i + 1], r * (end ? 0.085 : 0.065), 0, Math.PI * 2);
        ctx.fill();
        if (strain > 0.05) {
          // the beat you can hear: it fades as the geometry settles
          ctx.strokeStyle = `rgba(243, 211, 122, ${strain * 0.3 * (0.5 + 0.5 * Math.sin(t * 9 + k))})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(pts[i], pts[i + 1], r * 0.13, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
      break;
    }
    case "dna": {
      // the ladder that copies: two backbones winding, rungs between them,
      // the near strand passing in front of the far one every half turn
      const rows = 20;
      const amp = r * 0.4 * (1 + breath * 0.05);
      const turns = 2.1;
      const front: number[] = [];
      const back: number[] = [];
      for (let i = 0; i <= rows; i++) {
        const u = i / rows;
        const y = -r * 0.78 + u * r * 1.56;
        const ph = u * turns * Math.PI * 2 + t * 0.55;
        const xa = Math.sin(ph) * amp;
        const xb = -xa;
        const near = Math.cos(ph) * 0.5 + 0.5;
        ctx.strokeStyle = `rgba(${i % 2 ? 226 : 150}, ${i % 2 ? 170 : 200}, ${
          i % 2 ? 190 : 190
        }, ${0.16 + near * 0.34})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xa, y);
        ctx.lineTo(xb, y);
        ctx.stroke();
        front.push(xa, y);
        back.push(xb, y);
      }
      for (const strand of [back, front]) {
        ctx.strokeStyle = strand === front ? "rgba(240, 220, 180, 0.7)" : "rgba(150, 180, 220, 0.4)";
        ctx.lineWidth = strand === front ? 1.4 : 1;
        ctx.beginPath();
        for (let i = 0; i < strand.length; i += 2) {
          if (i === 0) ctx.moveTo(strand[0], strand[1]);
          else ctx.lineTo(strand[i], strand[i + 1]);
        }
        ctx.stroke();
      }
      break;
    }
    case "organelles": {
      // a membrane budget: as the crista folds deeper the outer wall smooths,
      // and the length of the line is kept either way
      const fold = 0.5 - 0.5 * Math.cos(t * 0.2);
      ctx.strokeStyle = "rgba(170, 200, 220, 0.45)";
      ctx.fillStyle = "rgba(50, 80, 100, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.62, r * 0.38 * (1 + breath * 0.04), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const lobes = 6;
      ctx.strokeStyle = `rgba(226, 200, 150, ${0.3 + fold * 0.35})`;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        const x = -r * 0.5 + u * r;
        const y = Math.sin(u * lobes * Math.PI) * r * 0.26 * fold;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // a smooth vesicle alongside: the same membrane, unfolded
      ctx.strokeStyle = `rgba(200, 220, 210, ${0.5 - fold * 0.2})`;
      ctx.beginPath();
      ctx.arc(r * 0.42, -r * 0.42, r * 0.13, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "cells": {
      // one cell forever mid-division: apart, and together again
      const ph = 0.5 - 0.5 * Math.cos((t * 0.22) % (Math.PI * 2));
      const d = ph * r * 0.42;
      ctx.strokeStyle = "rgba(170, 220, 200, 0.5)";
      ctx.fillStyle = "rgba(60, 110, 95, 0.25)";
      ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * d, 0, r * (0.4 - ph * 0.08) * (1 + breath * 0.03), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(220, 240, 225, 0.55)";
        ctx.beginPath();
        ctx.arc(s * d * 1.15, 0, r * 0.09, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(60, 110, 95, 0.25)";
      }
      break;
    }
    case "tissue": {
      // a sheet of cells, and one wave of polarity walking across it —
      // where the wave passes, the cells face the same way
      const cols = 5;
      const rows = 4;
      const cell = r * 0.3;
      const wave = (t * 0.24) % 1.6;
      for (let ry = 0; ry < rows; ry++) {
        for (let cxi = 0; cxi < cols; cxi++) {
          const x = (cxi - (cols - 1) / 2) * cell * 0.92 + (ry % 2 ? cell * 0.46 : 0);
          const y = (ry - (rows - 1) / 2) * cell * 0.8;
          const u = (x / r + 1) / 2;
          const near = Math.max(0, 1 - Math.abs(u - (wave - 0.3)) * 5);
          ctx.strokeStyle = `rgba(170, 220, 200, ${0.28 + near * 0.4})`;
          ctx.fillStyle = `rgba(60, 110, 95, ${0.16 + near * 0.2})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
            const px = x + Math.cos(a) * cell * 0.46;
            const py = y + Math.sin(a) * cell * 0.46;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          if (near > 0.1) {
            ctx.fillStyle = `rgba(232, 244, 236, ${near * 0.6})`;
            ctx.beginPath();
            ctx.arc(x, y - cell * 0.14, cell * 0.11, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      break;
    }
    case "drop": {
      // a trembling drop: mode-2 and mode-3 ripples on one meniscus
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const rr =
          r * 0.55 * (1 + 0.05 * Math.sin(2 * a + t * 2.6) + 0.032 * Math.sin(3 * a - t * 1.9));
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(90, 140, 175, 0.3)";
      ctx.fill();
      ctx.strokeStyle = "rgba(190, 220, 245, 0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(235, 245, 255, 0.5)";
      ctx.beginPath();
      ctx.arc(-r * 0.18, -r * 0.2, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "flowers": {
      // a bloom breathing between bud and open, petal by petal
      const open = 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(t * 0.16)) * (1 + breath * 0.06);
      const petals = 6;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + t * 0.05;
        const len = r * 0.52 * open;
        ctx.save();
        ctx.rotate(a);
        ctx.fillStyle = "rgba(226, 170, 190, 0.4)";
        ctx.strokeStyle = "rgba(240, 205, 215, 0.45)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.ellipse(len * 0.55, 0, len * 0.5, len * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = "rgba(243, 211, 122, 0.85)";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.1 * (0.8 + open * 0.4), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "birds": {
      // the flock as one animal: every bird on its own lane, all of them
      // wheeling one way, the wingbeats never quite together
      for (let i = 0; i < g.flock.length; i += 3) {
        const lane = g.flock[i];
        const rr = g.flock[i + 1];
        const wph = g.flock[i + 2];
        const a = t * (0.42 + rr * 0.3) + lane * Math.PI * 2;
        const x = Math.cos(a) * rr * r * 0.82;
        const y = Math.sin(a) * rr * r * 0.42 - r * 0.05;
        const wing = Math.abs(Math.sin(t * 5.5 + wph));
        const span = r * 0.075 * (0.35 + wing * 0.65);
        const lift = r * 0.05 * (1 - wing);
        ctx.strokeStyle = `rgba(226, 230, 238, ${0.3 + rr * 0.4})`;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x - span, y - lift);
        ctx.lineTo(x, y);
        ctx.lineTo(x + span, y - lift);
        ctx.stroke();
      }
      break;
    }
    case "coast": {
      // foam lapping a dark shore, line after line
      ctx.fillStyle = "rgba(30, 50, 65, 0.5)";
      ctx.fillRect(-r, 0, r * 2, r);
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.24 + i / 3) % 1;
        const y = r * (0.55 - ph * 0.5);
        const a = Math.sin(ph * Math.PI);
        ctx.strokeStyle = `rgba(235, 240, 235, ${0.4 * a})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let k = 0; k <= 16; k++) {
          const x = -r + (k / 16) * r * 2;
          const yy = y + Math.sin(x * 0.09 + t * 1.1 + i * 2) * r * 0.045;
          if (k === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      break;
    }
    case "olympus": {
      // the wanderer's view: ridges standing out of a fog whose altitude
      // breathes — raise it and the peaks become an archipelago
      const fogY = -r * 0.02 + Math.sin(t * 0.12) * r * 0.2;
      ctx.fillStyle = "rgba(226, 190, 150, 0.5)";
      ctx.beginPath();
      ctx.arc(r * 0.42, -r * 0.55, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
      for (let layer = 2; layer >= 0; layer--) {
        const scale = 0.4 + layer * 0.28;
        const baseY = -r * 0.1 + layer * r * 0.16;
        const shade = 0.1 + layer * 0.12;
        ctx.fillStyle = `rgba(${58 + layer * 22}, ${62 + layer * 20}, ${74 + layer * 18}, ${
          0.35 + shade
        })`;
        ctx.beginPath();
        ctx.moveTo(-r, r);
        for (let k = 0; k <= 12; k++) {
          const x = -r + (k / 12) * r * 2;
          const h = g.ridge[(layer * 6 + k) % g.ridge.length];
          const y = baseY - h * r * scale - Math.sin(k * 1.9 + layer) * r * 0.05;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(r, r);
        ctx.closePath();
        ctx.fill();
      }
      const fog = ctx.createLinearGradient(0, fogY - r * 0.16, 0, r);
      fog.addColorStop(0, "rgba(214, 220, 228, 0)");
      fog.addColorStop(0.35, "rgba(210, 216, 226, 0.45)");
      fog.addColorStop(1, "rgba(196, 205, 216, 0.72)");
      ctx.fillStyle = fog;
      ctx.fillRect(-r, fogY - r * 0.16, r * 2, r * 2);
      break;
    }
    case "atlas": {
      // parchment sheets adrift — the map loose over its territory
      for (let i = 0; i < 3; i++) {
        const ph = t * (0.1 + i * 0.03) + i * 2.3;
        const x = Math.sin(ph) * r * 0.22;
        const y = Math.cos(ph * 0.8) * r * 0.18 + (i - 1) * r * 0.16;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(ph * 0.6) * 0.16 + (i - 1) * 0.1);
        ctx.fillStyle = `rgba(233, 210, 168, ${0.16 + i * 0.05})`;
        ctx.strokeStyle = "rgba(233, 210, 168, 0.4)";
        ctx.lineWidth = 0.6;
        const w = r * 0.72;
        const h = r * 0.5;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.beginPath();
        ctx.moveTo(-w * 0.3, -h * 0.15);
        ctx.quadraticCurveTo(0, h * 0.1, w * 0.32, -h * 0.05);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case "earth": {
      // the ground: strata holding still, a slow pulse walking down
      const layers = 5;
      const ph = (t * 0.14) % 1;
      for (let i = 0; i < layers; i++) {
        const y0 = -r * 0.6 + (i / layers) * r * 1.2;
        const near = Math.max(0, 1 - Math.abs(i / layers - ph) * 4);
        ctx.fillStyle = `rgba(${170 + i * 8}, ${130 + i * 6}, ${86 + i * 4}, ${
          0.16 + i * 0.03 + near * 0.22
        })`;
        ctx.beginPath();
        for (let k = 0; k <= 14; k++) {
          const x = -r + (k / 14) * r * 2;
          const yy = y0 + Math.sin(x * 0.06 + i * 1.7) * r * 0.05;
          if (k === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.lineTo(r, y0 + r * 0.3);
        ctx.lineTo(-r, y0 + r * 0.3);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "stars": {
      // a galaxy wheel, turning at the pace galaxies do
      const rot = t * 0.06;
      ctx.save();
      ctx.rotate(rot);
      for (let i = 0; i < g.spiral.length; i += 3) {
        const glow = g.spiral[i + 2];
        ctx.fillStyle = `rgba(238, 232, 210, ${0.25 + glow * 0.5})`;
        const sz = 0.8 + glow * 1.1;
        ctx.fillRect(g.spiral[i] * r * 0.8 - sz / 2, g.spiral[i + 1] * r * 0.8 - sz / 2, sz, sz);
      }
      ctx.restore();
      ctx.fillStyle = "rgba(255, 240, 210, 0.7)";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "space": {
      // the web: light gathered where something invisible is dense, the
      // filaments between the knots drifting on the longest clock here
      const drift = Math.sin(t * 0.04) * r * 0.05;
      for (let i = 0; i < g.web.length; i += 3) {
        const xi = g.web[i] * r * 0.72 + drift;
        const yi = g.web[i + 1] * r * 0.72;
        for (let j = i + 3; j < g.web.length; j += 3) {
          const xj = g.web[j] * r * 0.72 + drift;
          const yj = g.web[j + 1] * r * 0.72;
          const d = Math.hypot(xj - xi, yj - yi);
          if (d > r * 0.72) continue;
          ctx.strokeStyle = `rgba(150, 170, 210, ${0.16 * (1 - d / (r * 0.72))})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(xi, yi);
          ctx.lineTo(xj, yj);
          ctx.stroke();
        }
      }
      for (let i = 0; i < g.web.length; i += 3) {
        const x = g.web[i] * r * 0.72 + drift;
        const y = g.web[i + 1] * r * 0.72;
        const m = g.web[i + 2];
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 0.02 + m * 6);
        ctx.fillStyle = `rgba(238, 232, 214, ${0.2 + m * 0.5})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.06 * m + 0.9, r * 0.024 * m + 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case "beyond": {
      // the wave-fold shimmer: rings interfering just past naming
      for (let i = 0; i < 4; i++) {
        const ph = (t * 0.2 + i / 4) % 1;
        const rr = r * (0.15 + ph * 0.75);
        const a = Math.sin(ph * Math.PI) * (0.3 + 0.12 * Math.sin(t * 1.7 + i * 2.4));
        ctx.strokeStyle = `rgba(180, 200, 245, ${Math.max(0, a)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "manifold": {
      // light-specks racing one fixed speed, bending around an unseen well
      for (let i = 0; i < g.specks.length; i++) {
        const ph = (t * 0.16 + g.specks[i]) % 1;
        const lane = (g.specks[i] - 0.5) * r * 1.1;
        const x = -r + ph * r * 2;
        const bend = Math.exp(-(x * x) / (r * r * 0.18)) * -Math.sign(lane) * r * 0.22;
        const y = lane + bend;
        ctx.fillStyle = "rgba(220, 232, 255, 0.8)";
        ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        ctx.strokeStyle = "rgba(200, 218, 250, 0.22)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.12, y - bend * 0.3);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      break;
    }
    default: {
      // a band this room has not yet learned to miniaturize: it breathes
      ctx.fillStyle = `rgba(231, 172, 82, ${0.3 + breath * 0.15})`;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export default function OverlookTree() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const router = useRouter();
  const [travelUi, setTravelUi] = useState<EdgeUI>({
    pressure: 0,
    towardLabel: null,
    crossing: false,
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state —————
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let last = performance.now();
    let localT = 0; // the dilatable clock every vignette breathes on
    let reduce = false;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let zoom = 1;
    let zoomTarget = 1;
    let camX = 0;
    let camY = 0;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let sway = 0; // the whole tree's lean, decaying
    let swayVel = 0;
    let shiver = 0;
    let parX = 0;
    let parY = 0;
    let parTX = 0;
    let parTY = 0;
    let leaving = false;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let glimmerIdx = 0;
    let lastTuttiAt = 0;
    let selIdx = -1; // keyboard walk over NODES (axis order)
    let kbCharge = 0;
    let lastChargeNoteAt = 0;
    const leaves: Leaf[] = [];
    let leafSerial = 0;
    const swell = new Array<number>(NODES.length).fill(0);
    const bloom = new Array<number>(NODES.length).fill(0);
    const edgeGlow = new Map<string, number>();
    const nodeScreen = NODES.map(() => ({ x: 0, y: 0, r: 0 }));
    const hold: { idx: number; done: boolean } = { idx: -1, done: false };
    let holdCharge = 0;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => {
      reduce = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => {
      try {
        audio().playNote(midi, ms);
      } catch {
        /* noop */
      }
    };
    const tone = (hz: number, sec = 0.9) => {
      try {
        audio().playTone(hz, sec);
      } catch {
        /* noop */
      }
    };

    // ————— static pre-render: each node's disc base, once —————
    const BASE_PX = 96;
    const baseDiscs = new Map<string, HTMLCanvasElement>();
    for (const n of NODES) {
      const c = document.createElement("canvas");
      c.width = BASE_PX * 2;
      c.height = BASE_PX * 2;
      const bctx = c.getContext("2d");
      if (!bctx) continue;
      const g = bctx.createRadialGradient(BASE_PX, BASE_PX, BASE_PX * 0.1, BASE_PX, BASE_PX, BASE_PX);
      g.addColorStop(0, "rgba(14, 18, 26, 0.92)");
      g.addColorStop(0.82, "rgba(8, 11, 17, 0.9)");
      g.addColorStop(1, "rgba(6, 8, 13, 0.2)");
      bctx.fillStyle = g;
      bctx.beginPath();
      bctx.arc(BASE_PX, BASE_PX, BASE_PX - 1, 0, Math.PI * 2);
      bctx.fill();
      const warm = n.route ? 0.22 : 0.1; // built rooms candle-warm, unbuilt embers
      bctx.strokeStyle = `rgba(231, 172, 82, ${warm})`;
      bctx.lineWidth = 2;
      bctx.beginPath();
      bctx.arc(BASE_PX, BASE_PX, BASE_PX - 2, 0, Math.PI * 2);
      bctx.stroke();
      baseDiscs.set(n.id, c);
    }

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(320, Math.floor(r.width));
      height = Math.max(480, Math.floor(r.height));
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (clientX: number, clientY: number) => ({
      x: clamp(clientX - rectLeft, 0, width),
      y: clamp(clientY - rectTop, 0, height),
    });

    // ————— geometry: tree space → screen —————
    // World: x in branch units off the trunk, y normalized 0 (quarks)..1
    // (the crown), both from the derived layout — the true log axis.
    // branch reach is clamped so the deepest branch still stands inside a
    // 390px view: the whole tree must hold in one glance before any pan
    const branchDx = () =>
      Math.min(clamp(width * 0.24, 64, 168), (width * 0.42) / MAX_ABS_X);
    const treeH = () => height * 0.72;
    const parFactor = (n: OverlookNode) =>
      PAR_TRUNK + PAR_BRANCH_STEP * Math.min(2, n.depth);
    const nodePoint = (n: OverlookNode) => {
      const p = PLACE[n.id];
      const swayHere = reduce
        ? 0
        : sway * Math.sin(localT * 1.6 + p.y * 3.1) * (0.35 + 0.65 * (p.y + n.depth / MAX_DEPTH)) +
          shiver * Math.sin(localT * 26 + n.order * 1.7) * 0.06;
      const wx = (p.x + swayHere * 0.35) * branchDx();
      const wy = (0.5 - p.y) * treeH();
      return {
        x: width / 2 + (wx + camX) * zoom + parX * parFactor(n),
        y: height * 0.5 + (wy + camY) * zoom + parY * parFactor(n),
      };
    };
    const nodeRadius = (i: number) => {
      const base = clamp(Math.min(width, height) * 0.055, 19, 30);
      const z = clamp(zoom, 0.7, 1.9);
      return base * z * (1 + swell[i] * 0.3 + bloom[i] * 0.85);
    };

    const nodeAt = (x: number, y: number): number => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < NODES.length; i++) {
        const d = Math.hypot(x - nodeScreen[i].x, y - nodeScreen[i].y);
        if (d < Math.max(30, nodeScreen[i].r + 10) && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    const chimeNode = (i: number, quiet = false) => {
      tone(nodeHz(NODES[i]), quiet ? 0.35 : 1.1);
      swell[i] = Math.max(swell[i], quiet ? 0.55 : 1);
      try {
        haptics.tap();
      } catch {
        /* noop */
      }
    };

    const glowNeighbors = (i: number, amount: number) => {
      const id = NODES[i].id;
      for (const e of TREE.edges) {
        if (e.a === id || e.b === id) {
          const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
          edgeGlow.set(key, Math.max(edgeGlow.get(key) ?? 0, amount));
          const otherId = e.a === id ? e.b : e.a;
          const oi = NODES.findIndex((n) => n.id === otherId);
          if (oi >= 0) swell[oi] = Math.max(swell[oi], amount * 0.4);
        }
      }
    };

    // the shared crossing presentation, exactly as the axis speaks it
    const travelTo = (i: number) => {
      const n = NODES[i];
      if (!n.route || leaving) return;
      leaving = true;
      try {
        haptics.crossing();
      } catch {
        /* noop */
      }
      try {
        window.sessionStorage.setItem(SCALE_S_KEY, String(n.s));
      } catch {
        /* noop */
      }
      setTravelUi({ pressure: 1, towardLabel: n.label, crossing: true });
      useField.getState().recordTape("region", 0.8, `overlook/travel:${n.id}`);
      window.setTimeout(() => router.push(n.route as string), 380);
    };

    // three-finger tap = the tutti of tuttis: every band pulses in axis
    // order — the whole site heard once, small to large, one glissando
    const tutti = () => {
      const now = performance.now();
      if (now - lastTuttiAt < 1600) return;
      lastTuttiAt = now;
      for (const n of NODES) {
        window.setTimeout(() => chimeNode(n.order, true), n.order * 80);
      }
      try {
        haptics.ripple(0.4);
      } catch {
        /* noop */
      }
    };

    const setLens = (snapped: number) => {
      if (snapped === lensSnapped) return;
      lensSnapped = snapped;
      lensTarget = snapped;
      try {
        haptics.lens();
      } catch {
        /* noop */
      }
      if (snapped === 1) {
        try {
          audio().chime();
        } catch {
          /* noop */
        }
      } else note(48, 160);
    };

    const stepBack = () => {
      // two-finger tap: the frame retreats one step — a raised lens lowers
      // first; then the view zooms out one gentle notch, never a jump
      if (lensSnapped === 1) {
        setLens(0);
        return;
      }
      zoomTarget = clamp(zoomTarget / 1.3, ZOOM_MIN, ZOOM_MAX);
      note(45, 140);
      try {
        haptics.tap();
      } catch {
        /* noop */
      }
    };

    const dropLeaves = (intensity: number) => {
      const n = Math.min(LEAF_MAX - leaves.length, 3 + Math.round(intensity * 4));
      for (let k = 0; k < n; k++) {
        const rng = mulberry32(hashSeed(`leaf:${leafSerial++}`));
        const src = NODES[Math.floor(rng() * NODES.length)];
        const p = nodePoint(src);
        leaves.push({
          x: p.x + (rng() - 0.5) * 30,
          y: p.y + (rng() - 0.5) * 20,
          vx: (rng() - 0.5) * 26,
          vy: 12 + rng() * 22,
          born: performance.now(),
          seed: rng() * 7,
        });
      }
    };

    // ————— gestures (grammar only; pinch is in-room here — see header) —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 2) {
          stepBack();
          return;
        }
        if (e.fingers === 3) {
          tutti();
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        const i = nodeAt(x, y);
        if (i >= 0) {
          chimeNode(i);
          return;
        }
        // open air: the tree acknowledges with the gentlest lean
        swayVel += (x > width / 2 ? 1 : -1) * 0.12 * (0.5 + e.intensity);
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers touch the law: every vignette slows ×0.25
          if (e.phase === "enter") {
            timeScaleTarget = 0.25;
            note(24, 500);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") {
          const { x, y } = toLocal(e.x, e.y);
          hold.idx = nodeAt(x, y);
          hold.done = false;
          holdCharge = 0;
          return;
        }
        if (e.phase === "release") {
          hold.idx = -1;
          holdCharge = 0;
          return;
        }
        if (hold.idx < 0) return;
        const i = hold.idx;
        // the vignette blooms larger and the neighbors' threads glow —
        // the graph made visible; duration keeps deepening it
        bloom[i] = Math.max(bloom[i], clamp01((e.elapsed - 250) / 2250));
        glowNeighbors(i, clamp01(e.elapsed / 1400));
        const n = NODES[i];
        if (n.route) {
          holdCharge = clamp01((e.elapsed - 250) / 2250);
          const now = performance.now();
          if (holdCharge > 0.15 && now - lastChargeNoteAt > 420) {
            lastChargeNoteAt = now;
            tone(nodeHz(n) * (1 + holdCharge * 0.06), 0.3);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
          if (e.tier >= 3 && !hold.done) {
            hold.done = true;
            travelTo(i);
          }
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // wind: the law leans the whole tree
          if (!reduce) swayVel += e.vx * 0.5;
          return;
        }
        if (e.fingers !== 1 || e.phase === "end") return;
        camX += e.dx / zoom;
        camY += e.dy / zoom;
      },
      pan2: (e) => {
        lastInteractionAt = performance.now();
        if (e.phase === "end") return;
        camX += e.dx / zoom;
        camY += e.dy / zoom;
      },
      pinch: (e) => {
        // In-room by design: /overlook has no scale address, so a pinch
        // zooms the VIEW of the whole axis — local, clamped, honest. This
        // is the one room where binding pinch is not ScaleTravel's job.
        // (Move events carry a per-frame delta ratio; wheel arrives the
        // same way, so the desktop dialect zooms for free.)
        lastInteractionAt = performance.now();
        if (e.phase !== "move") return;
        zoomTarget = clamp(zoomTarget * e.scale, ZOOM_MIN, ZOOM_MAX);
      },
      twist: (e) => {
        if (e.fingers === 3) return; // three fingers turn the season, not the lens
        lastInteractionAt = performance.now();
        // two fingers rotate the lens: living tree ↔ the bare graph
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          setLens(lensTarget > 0.5 ? 1 : 0);
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        // a circling hand: the whole tree sways with the winding
        if (!reduce) swayVel += clamp(e.angularVelocity, -6, 6) * 0.12;
        const now = performance.now();
        if (now - lastChargeNoteAt > 600) {
          lastChargeNoteAt = now;
          note(43 + Math.round(Math.min(5, Math.abs(e.winding))), 140);
          try {
            haptics.ripple(0.25);
          } catch {
            /* noop */
          }
        }
      },
    });

    // ————— the vessel: tilt = parallax of trunk vs branches vs vignettes;
    // shake = the tree shivers and a few leaves of light fall —————
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) {
          parTX = 0;
          parTY = 0;
          return;
        }
        parTX = clamp(gamma / 28, -1, 1);
        parTY = clamp((beta - 35) / 28, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        shiver = Math.min(1, shiver + 0.5 + intensity * 0.5);
        dropLeaves(intensity);
        note(29, 300);
        try {
          haptics.chop();
        } catch {
          /* noop */
        }
      },
    });

    // ————— keyboard dialect: arrows walk the axis (branch detours ride
    // the same order), Enter chimes, held Enter travels, Esc lowers —————
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (lensSnapped === 1) setLens(0);
        selIdx = -1;
        kbCharge = 0;
        return;
      }
      if (ev.key === "ArrowUp" || ev.key === "ArrowRight") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        selIdx = (selIdx + 1 + NODES.length) % NODES.length;
        kbCharge = 0;
        chimeNode(selIdx, true);
        return;
      }
      if (ev.key === "ArrowDown" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        selIdx = (selIdx <= 0 ? NODES.length : selIdx) - 1;
        kbCharge = 0;
        chimeNode(selIdx, true);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (selIdx < 0) {
          selIdx = 0;
          chimeNode(0, true);
          return;
        }
        if (!ev.repeat) {
          chimeNode(selIdx);
          kbCharge = 0.05;
          return;
        }
        // held Enter is the keyboard's ceremony: the same slow road
        if (!NODES[selIdx].route) return;
        kbCharge = clamp01(kbCharge + 0.07);
        bloom[selIdx] = Math.max(bloom[selIdx], kbCharge);
        glowNeighbors(selIdx, kbCharge);
        if (kbCharge >= 1) {
          kbCharge = 0;
          travelTo(selIdx);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") kbCharge = 0;
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);

    // ————— the loop —————
    let lastFrame = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (reduce && now - lastFrame < 90) return;
      lastFrame = now;
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduce) localT += dt * timeScale;
      zoom += (zoomTarget - zoom) * Math.min(1, dt * 8);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      sway += swayVel * dt;
      swayVel = swayVel * Math.exp(-dt * 1.2) - sway * dt * 2.4;
      sway *= Math.exp(-dt * 0.5);
      shiver *= Math.exp(-dt * 2.4);
      parX += ((reduce ? 0 : -parTX * PAR_MAX) - parX) * Math.min(1, dt * 5);
      parY += ((reduce ? 0 : -parTY * PAR_MAX) - parY) * Math.min(1, dt * 5);
      for (let i = 0; i < NODES.length; i++) {
        swell[i] = Math.max(0, swell[i] - dt * 1.4);
        if (hold.idx !== i && !(selIdx === i && kbCharge > 0))
          bloom[i] = Math.max(0, bloom[i] - dt * 1.8);
      }
      for (const [k, v] of edgeGlow) {
        const nv = v - dt * 1.2;
        if (nv <= 0) edgeGlow.delete(k);
        else edgeGlow.set(k, nv);
      }
      if (hold.idx < 0 && !(selIdx >= 0 && kbCharge > 0)) holdCharge = 0;

      const audioT = audio().getAudioTime() ?? now / 1000;
      const breath = reduce ? 0 : Math.sin(audioT * Math.PI * 2 * 0.14) * 0.5 + 0.5;
      const vigT = reduce ? 0 : localT;

      // glimmer: after ~20s idle one branch pulses faintly — physical, never text
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 6000 && !reduce) {
        glimmerAt = now;
        const roots = NODES.filter((n) => !n.onTrunk);
        if (roots.length > 0) {
          const n = roots[glimmerIdx % roots.length];
          glimmerIdx += 1;
          swell[n.order] = Math.max(swell[n.order], 0.4);
          glowNeighbors(n.order, 0.35);
        }
      }

      // ————— background: ink with a faint high glow at the crown —————
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#060810");
      bg.addColorStop(0.55, "#05070d");
      bg.addColorStop(1, "#04060b");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      const halo = ctx.createRadialGradient(
        width * 0.5,
        height * 0.16,
        10,
        width * 0.5,
        height * 0.16,
        Math.max(width, height) * 0.7,
      );
      halo.addColorStop(0, `rgba(140, 160, 215, ${0.05 + breath * 0.02})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      // node screen positions once per frame (hit tests + edges + ruler)
      for (let i = 0; i < NODES.length; i++) {
        const p = nodePoint(NODES[i]);
        nodeScreen[i].x = p.x;
        nodeScreen[i].y = p.y;
        nodeScreen[i].r = nodeRadius(i);
      }
      const idxOf = new Map(NODES.map((n, i) => [n.id, i]));

      // ————— threads: the trunk luminous, branches finer, glow = graph —————
      const feltA = 1 - lens * 0.75;
      for (const e of TREE.edges) {
        const ai = idxOf.get(e.a);
        const bi = idxOf.get(e.b);
        if (ai === undefined || bi === undefined) continue;
        const A = nodeScreen[ai];
        const B = nodeScreen[bi];
        const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
        const glow = edgeGlow.get(key) ?? 0;
        const bareOnly = lens > 0.96;
        // control point: trunk stays taut; branch threads bow outward
        const midX = (A.x + B.x) / 2;
        const midY = (A.y + B.y) / 2;
        const bow = e.trunk ? 0 : (A.x === B.x ? 12 : (B.x - A.x) * 0.24) * (1 - lens);
        const passes = e.trunk && !bareOnly ? [0, 1] : [1];
        for (const pass of passes) {
          if (pass === 0) {
            ctx.strokeStyle = `rgba(231, 172, 82, ${(0.07 + glow * 0.1) * feltA})`;
            ctx.lineWidth = 3.6;
          } else {
            const a = e.trunk
              ? 0.3 * feltA + lens * 0.22 + glow * 0.4
              : 0.16 * feltA + lens * 0.2 + glow * 0.45;
            ctx.strokeStyle = e.trunk
              ? `rgba(240, 220, 180, ${a})`
              : `rgba(206, 222, 250, ${a})`;
            ctx.lineWidth = e.trunk ? 1 : 0.7;
          }
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          if (lens > 0.5 || e.trunk) ctx.lineTo(B.x, B.y);
          else ctx.quadraticCurveTo(midX + bow, midY, B.x, B.y);
          ctx.stroke();
        }
      }

      // ————— the ruler (lens up): log₁₀ spans, the notation surface —————
      if (lens > 0.6) {
        const la = (lens - 0.6) / 0.4;
        const trunkIdx = TREE.trunk
          .map((id) => idxOf.get(id))
          .filter((i): i is number => i !== undefined);
        if (trunkIdx.length > 1) {
          const rx = nodeScreen[trunkIdx[0]].x - clamp(width * 0.16, 46, 90);
          ctx.strokeStyle = `rgba(206, 222, 250, ${0.3 * la})`;
          ctx.lineWidth = 0.7;
          ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
          ctx.textAlign = "right";
          // one tick per band boundary along the whole axis, true to log₁₀
          const sLo = Math.min(...NODES.map((n) => n.s));
          const sHi = Math.max(...NODES.map((n) => n.s));
          const top = nodeScreen[trunkIdx[trunkIdx.length - 1]].y;
          const bot = nodeScreen[trunkIdx[0]].y;
          ctx.beginPath();
          ctx.moveTo(rx, bot);
          ctx.lineTo(rx, top);
          ctx.stroke();
          const marks = new Set<number>();
          for (const n of NODES) {
            marks.add(n.sMin);
            marks.add(n.sMax);
          }
          ctx.fillStyle = `rgba(206, 222, 250, ${0.5 * la})`;
          for (const s of marks) {
            const yy = mix(bot, top, (s - sLo) / (sHi - sLo));
            ctx.beginPath();
            ctx.moveTo(rx - 4, yy);
            ctx.lineTo(rx + 4, yy);
            ctx.stroke();
            ctx.fillText(rulerLabel(s), rx - 8, yy + 3);
          }
        }
      }

      // ————— the nodes: living miniatures (or the bare graph's marks) —————
      for (let i = 0; i < NODES.length; i++) {
        const n = NODES[i];
        const { x, y } = nodeScreen[i];
        const r = nodeScreen[i].r;
        if (x < -r * 2 || x > width + r * 2 || y < -r * 2 || y > height + r * 2) continue;
        const feltHere = 1 - lens;

        if (feltHere > 0.04) {
          ctx.save();
          ctx.globalAlpha = feltHere;
          const base = baseDiscs.get(n.id);
          if (base) ctx.drawImage(base, x - r, y - r, r * 2, r * 2);
          // the living material, clipped to its disc, one extra parallax
          // sheet nearer than the threads that hold it
          ctx.beginPath();
          ctx.arc(x, y, r * 0.94, 0, Math.PI * 2);
          ctx.clip();
          ctx.translate(x + parX * PAR_VIGNETTE, y + parY * PAR_VIGNETTE);
          drawVignette(ctx, n.id, r, vigT + n.order * 3.7, breath);
          ctx.restore();

          // a swelling answer to touch: warm rim rising with the chime
          const lit = swell[i] + bloom[i];
          if (lit > 0.02) {
            ctx.strokeStyle = `rgba(231, 172, 82, ${clamp01(0.12 + lit * 0.5) * feltHere})`;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.arc(x, y, r + 3, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        if (lens > 0.04) {
          // the bare graph: a small mark and its id in thin mono
          ctx.globalAlpha = lens;
          ctx.fillStyle = n.route ? "rgba(240, 220, 180, 0.85)" : "rgba(122, 84, 52, 0.6)";
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
          ctx.textAlign = n.onTrunk ? "left" : PLACE[n.id].x < 0 ? "right" : "left";
          const tx = n.onTrunk ? x + 10 : PLACE[n.id].x < 0 ? x - 10 : x + 10;
          ctx.fillStyle = "rgba(206, 222, 250, 0.7)";
          ctx.fillText(n.id, tx, y + 3);
          ctx.fillStyle = "rgba(206, 222, 250, 0.4)";
          ctx.fillText(
            `${rulerLabel(n.sMin)}…${rulerLabel(n.sMax)}`,
            tx,
            y + 15,
          );
          ctx.globalAlpha = 1;
        }

        // keyboard selection ring + the travel charge closing around it
        if (selIdx === i) {
          ctx.strokeStyle = "rgba(242, 238, 230, 0.7)";
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(x, y, r + 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        const charge = hold.idx === i ? holdCharge : selIdx === i ? kbCharge : 0;
        if (charge > 0.02 && n.route) {
          ctx.strokeStyle = `rgba(231, 172, 82, ${0.35 + charge * 0.55})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(x, y, r + 10, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
          ctx.stroke();
        }
      }

      // ————— leaves of light: what a shake lets go —————
      for (let i = leaves.length - 1; i >= 0; i--) {
        const lf = leaves[i];
        const age = (now - lf.born) / 4200;
        if (age >= 1 || lf.y > height + 20) {
          leaves.splice(i, 1);
          continue;
        }
        lf.vx += Math.sin(localT * 3 + lf.seed) * 18 * dt;
        lf.x += lf.vx * dt;
        lf.y += lf.vy * dt;
        const a = Math.sin(Math.min(1, age) * Math.PI);
        ctx.save();
        ctx.translate(lf.x, lf.y);
        ctx.rotate(Math.sin(localT * 2.2 + lf.seed) * 0.8);
        ctx.fillStyle = `rgba(243, 211, 122, ${0.5 * a})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.2, 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // glimmer ring, physical only
      if (glimmerAt && now - glimmerAt < 1600 && !reduce) {
        const u = (now - glimmerAt) / 1600;
        const roots = NODES.filter((n) => !n.onTrunk);
        if (roots.length > 0) {
          const n = roots[(glimmerIdx - 1 + roots.length) % roots.length];
          const p = nodeScreen[n.order];
          ctx.beginPath();
          ctx.strokeStyle = `rgba(238, 234, 219, ${0.22 * (1 - u)})`;
          ctx.lineWidth = 0.9;
          ctx.arc(p.x, p.y, p.r + 6 + u * 26, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      detach();
      detachVessel();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
    };
  }, [router]);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="the whole tree kept in one glance"
      style={{
        position: "fixed",
        inset: 0,
        background: "#04060b",
        outline: "none",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <ScaleTravelOverlay ui={travelUi} />
    </div>
  );
}
