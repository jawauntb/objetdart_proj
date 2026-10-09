"use client";

/**
 * lattice-visitors — the engine behind `src/components/LatticeVisitors.tsx`,
 * loaded with a dynamic import once the page is idle so the form atlas and the
 * shader never sit on a room's first load. See the component for what it does
 * and why; this owns the fetch, the schedule and the frame.
 */

import { ROOM_REGISTRY } from "@/lib/room-registry";
import { createGLStage } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { createFrameGovernor, onGalleryPause, onVisibility } from "@/lib/room-runtime";
import { getFieldAudio } from "@/lib/audio";
import {
  FORMS,
  FORM_STRIDE,
  bodyOf,
  cellSize,
  formById,
  formForRoom,
  hash32,
  isLatticeAnimal,
  liveVisit,
  pathPoint,
  residentPoint,
  visitAt,
  wildAnimal,
  writeAnimal,
  type AnimalBody,
  type Cell,
  type FormSpec,
} from "@/lib/lattice-forms";
import { createFormsLayer } from "@/lib/lattice-forms-layer";

type Inhabitant = { id: string; room: string; form: string | null; cells: Cell[] };

const MAX_INSTANCES = 6000;
const MAX_RESIDENTS = 3;
const COMMONS_TTL_MS = 90_000;

let sessionSeed = 0;
function session(): number {
  if (!sessionSeed) {
    const b = new Uint32Array(1);
    try {
      crypto.getRandomValues(b);
    } catch {
      b[0] = 0x51ed;
    }
    sessionSeed = b[0] || 1;
  }
  return sessionSeed;
}

function roomForPath(path: string | null): string | null {
  if (!path) return null;
  const exact = ROOM_REGISTRY.find((e) => e.href === path);
  if (exact) return exact.key;
  if (path.startsWith("/atlas")) return "atlas";
  return null;
}

async function inhabitantsOf(room: string | null): Promise<Inhabitant[]> {
  try {
    const res = await fetch("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "universe_inhabitants", arguments: room ? { room, shapes: true } : { shapes: true } } }),
    });
    if (!res.ok) return [];
    const j = await res.json();
    const text = j?.result?.content?.[0]?.text;
    if (j?.result?.isError || typeof text !== "string") return [];
    const list = JSON.parse(text)?.inhabitants;
    if (!Array.isArray(list)) return [];
    return list
      .filter((h: Inhabitant) => h && typeof h.id === "string" && Array.isArray(h.cells) && h.cells.length && h.cells.length <= 400 && isLatticeAnimal(h.cells))
      .map((h: Inhabitant) => ({ id: h.id, room: String(h.room), form: typeof h.form === "string" ? h.form : null, cells: h.cells }));
  } catch {
    return [];
  }
}

let commonsCache: { at: number; list: Inhabitant[] } | null = null;
async function commons(): Promise<Inhabitant[]> {
  const now = Date.now();
  if (commonsCache && now - commonsCache.at < COMMONS_TTL_MS) return commonsCache.list;
  const list = await inhabitantsOf(null);
  commonsCache = { at: now, list };
  return list;
}

type Wanderer = { index: number; body: AnimalBody; from: FormSpec; to: FormSpec; seed: number; sounded: boolean };

/** Start the visitors on `canvas` for the room at `pathname`; returns the stop. */
export function runVisitors(canvas: HTMLCanvasElement, pathname: string | null): () => void {
  const room = roomForPath(pathname);
  if (!room) return () => {};
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const governor = createFrameGovernor();
  const stage = createGLStage(canvas, { wrap: canvas, label: "lattice-visitors", reducedMotion: reduced, maxDpr: 1.5, quality: governor.tier() });
  if (!stage) return () => {};
  const layer = createFormsLayer(stage);
  if (!layer) {
    stage.dispose();
    return () => {};
  }
  const gl = stage.gl;
  const data = new Float32Array(MAX_INSTANCES * FORM_STRIDE);
  const seed = hash32(`${session()}|${pathname}`);
  const roomForm = formForRoom(room);
  const t0 = performance.now();
  let residents: { body: AnimalBody; form: FormSpec; seed: number; since: number }[] = [];
  let pool: Inhabitant[] = [];
  let wanderer: Wanderer | null = null;
  let hint = 0;
  let raf = 0;
  let wake = 0;
  let hidden = document.visibilityState === "hidden";
  let paused = false;
  let disposed = false;

  const clock = () => (performance.now() - t0) / 1000;

  const wandererFor = (index: number): Wanderer => {
    const v = visitAt(seed, index);
    const s = hash32(`${seed}|w|${index}`);
    const h = pool.length ? pool[Math.floor(v.pick * pool.length) % pool.length] : null;
    // With nobody in the commons to send, a wild lattice animal comes, in any
    // of the forms this repo wrote — so over enough visits every form passes through.
    const cells = h ? h.cells : wildAnimal(s, 4 + Math.floor(v.pick * 9));
    const from = (h && formById(h.form)) || FORMS[s % FORMS.length];
    return { index, body: bodyOf(cells), from, to: roomForm ?? from, seed: s, sounded: false };
  };

  const chime = (w: Wanderer) => {
    if (w.sounded) return;
    w.sounded = true;
    try {
      const audio = getFieldAudio();
      if (!audio.getAudioContext() || audio.isMuted()) return;
      // pentatonic, lower for a larger animal: the second sense, same frame as the first sight
      const steps = [0, 3, 5, 7, 10][w.seed % 5] - Math.min(12, Math.floor(w.body.count / 6));
      audio.playTone(392 * Math.pow(2, steps / 12), 1.4);
    } catch {}
  };

  const frame = () => {
    raf = 0;
    if (disposed || hidden || paused) return;
    const tier = governor.beginFrame(performance.now());
    const t = clock();
    const size = stage.beginFrame(clocksFrom({ time: t, reducedMotion: reduced }));
    const W = size.width, H = size.height;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let n = 0;
    const roomLeft = () => MAX_INSTANCES - n;

    for (const r of residents) {
      const at = residentPoint(r.seed, t, reduced);
      const fade = Math.min(1, (t - r.since) / 3);
      n += writeAnimal(data, n, roomLeft(), r.body, r.form, {
        x: at.x * W, y: at.y * H, cell: cellSize(r.body.radius, W, H), heading: at.heading,
        alpha: 0.82 * fade, time: t, seed: r.seed, reduced,
      });
    }

    const live = liveVisit(seed, t, hint);
    if (live) {
      hint = live.index;
      if (!wanderer || wanderer.index !== live.index) wanderer = wandererFor(live.index);
      chime(wanderer);
      const v = live.visit;
      const u = Math.min(1, Math.max(0, (t - v.start) / v.duration));
      const p = reduced ? { x: (v.from[0] + v.to[0] + 1) / 3, y: (v.from[1] + v.to[1] + 1) / 3, heading: 0 } : pathPoint(v, u);
      const fade = Math.min(1, u / 0.08, (1 - u) / 0.08) * 0.9;
      const cell = cellSize(wanderer.body.radius, W, H);
      // It arrives in the form of where it came from and becomes the form of here.
      const morph = wanderer.from === wanderer.to ? 1 : Math.min(1, Math.max(0, (u - 0.28) / 0.3));
      const place = { x: p.x * W, y: p.y * H, cell, heading: p.heading, time: t, seed: wanderer.seed, reduced };
      if (morph < 1) n += writeAnimal(data, n, roomLeft(), wanderer.body, wanderer.from, { ...place, alpha: fade * (1 - morph) });
      if (morph > 0) n += writeAnimal(data, n, roomLeft(), wanderer.body, wanderer.to, { ...place, alpha: fade * morph });
    }

    if (n > 0) layer.draw(data, n, reduced ? 0 : t);
    // A slow device still sees them; it sees them at a lower DPR next mount.
    void tier;
    schedule(!!live || residents.length > 0);
  };

  // No frame loop while nobody is here: sleep until the next visit is due.
  const schedule = (busy: boolean) => {
    if (disposed || hidden || paused || raf) return;
    if (busy) {
      if (wake) window.clearTimeout(wake);
      wake = 0;
      raf = requestAnimationFrame(frame);
      return;
    }
    if (wake) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const t = clock();
    let i = hint;
    let v = visitAt(seed, i);
    while (t > v.start + v.duration) v = visitAt(seed, ++i);
    hint = i;
    const ms = Math.max(50, (v.start - t) * 1000);
    wake = window.setTimeout(() => {
      wake = 0;
      raf = requestAnimationFrame(frame);
    }, ms);
  };

  const offVis = onVisibility((h) => {
    hidden = h;
    if (!h) schedule(true);
  });
  const offGallery = onGalleryPause((p) => {
    paused = p;
    if (!p) schedule(true);
  });

  // Who lives here, and who might wander through.
  void inhabitantsOf(room).then((list) => {
    if (disposed) return;
    const t = clock();
    residents = list.slice(0, MAX_RESIDENTS).map((h) => ({
      body: bodyOf(h.cells),
      form: formById(h.form) ?? roomForm ?? FORMS[hash32(h.id) % FORMS.length],
      seed: hash32(`${seed}|${h.id}`),
      since: t,
    }));
    schedule(residents.length > 0);
  });
  void commons().then((list) => {
    if (disposed) return;
    pool = list.filter((h) => h.room !== room);
  });
  schedule(false);

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    if (wake) window.clearTimeout(wake);
    offVis();
    offGallery();
    layer.dispose();
    stage.dispose();
  };
}
