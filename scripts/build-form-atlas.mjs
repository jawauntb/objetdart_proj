// The form atlas — every visual form this repo wrote as a component, read from
// its syntax tree, so a lattice animal can wear any of them.
//
// A lattice animal (a polyomino from jawauntb/lattice-animal) keeps its body:
// its cells are its identity. What it can change is what each cell is drawn
// as. This script walks the TypeScript AST of every component file and reads
// the vocabulary the component actually paints with — the colours in its
// string literals and shader vec3s, the canvas and GL calls it makes, the JSX
// it renders, the words its identifiers are built from, the noun its room
// creates — and reduces that to a small form signature:
//
//   { id, component, rooms, tech, kind, palette[3], params }
//
// `kind` picks one of the SDF primitives in src/lib/lattice-forms-layer.ts
// (a star with diffraction spikes, a log-spiral of dust, a membrane cell with
// a nucleus, a ripple of excitation, …); `palette` and `params` make every
// component's form its own. Nothing here is hand-assigned per component: a
// room changes its source, the atlas follows.
//
//   node scripts/build-form-atlas.mjs           write the atlas
//   node scripts/build-form-atlas.mjs --check   fail if the written atlas is stale
//
// Outputs (both generated, both checked):
//   src/data/form-atlas.generated.ts   compact, imported by the client
//   public/lattice/forms.json          full, with the evidence each kind came from
//
// Deterministic: files are read in sorted order and every tie breaks by name.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { loadTsModule } from "./lib/load-ts.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_TS = "src/data/form-atlas.generated.ts";
const OUT_JSON = "public/lattice/forms.json";
const check = process.argv.includes("--check");

/** The primitives the shader can draw, in its own index order. */
export const KINDS = ["orb", "star", "spiral", "cell", "quantum", "orbit", "flame", "drop", "petal", "crystal", "glyph", "cloud"];

/**
 * Word families for each kind. A component votes for a kind by how often its
 * identifiers, strings and shaders use these stems; its name, its routes and
 * its room's `creates` noun vote ten times as loud as one identifier.
 */
const FAMILIES = {
  star: ["star", "stellar", "spike", "twinkle", "nova", "pulsar", "constellation", "sirius", "magnitude", "parallax", "sky", "comet"],
  spiral: ["galaxy", "galax", "spiral", "arm", "vortex", "swirl", "nebula", "cosmic", "whirl", "local", "cluster", "halo", "web", "filament"],
  cell: ["cell", "membrane", "nucleus", "organelle", "cyto", "plasm", "tissue", "vesicle", "mito", "virus", "capsid", "embryo", "seed", "polyp", "creature", "spore", "ribosome", "helix", "base"],
  quantum: ["quant", "quark", "gluon", "boson", "photon", "excitation", "ripple", "interference", "amplitude", "psi", "particle", "field", "hadron", "nucleon", "vacuum", "plank", "planck", "spin", "sine", "fourier", "phase", "signal", "eigen"],
  orbit: ["orbit", "planet", "moon", "kepler", "solar", "satellite", "ellipse", "body", "tourbillon", "watch", "clock", "coin", "gear", "escapement", "time", "relativity", "manifold", "orb"],
  flame: ["fire", "flame", "ember", "plasma", "spark", "lightning", "bolt", "storm", "burn", "candle", "thunder", "zeus", "lantern", "beam", "light", "glow", "ion"],
  drop: ["water", "ocean", "sea", "tide", "drop", "rain", "foam", "bubble", "spring", "geyser", "coast", "reef", "shore", "wave", "surf", "pool", "marsh", "seep", "eruption", "aphros"],
  petal: ["flower", "petal", "bloom", "garden", "blossom", "leaf", "root", "branch", "tree", "grass", "plant", "insect", "bird", "wing", "feather", "reed", "growth", "soil", "tip", "murmur", "flock", "hummock"],
  crystal: ["crystal", "atom", "molecule", "bond", "lattice", "rock", "pebble", "mineral", "gem", "jewel", "facet", "hex", "element", "stone", "cut", "chain", "mountain", "cairn", "earth", "land", "city", "plot", "structure", "loom", "group", "mark", "constraint"],
  glyph: ["text", "word", "letter", "glyph", "char", "font", "reading", "prose", "sigil", "greek", "chart", "tape", "label", "page", "guide", "colophon", "archive", "header", "footer", "help", "button", "toggle", "nav", "pretext", "morph", "voice", "card", "hero", "invitation", "dither", "pixel"],
  cloud: ["cloud", "mist", "fog", "smoke", "atmosphere", "aurora", "void", "dust", "haze", "breath", "air", "column", "sound", "audio", "music", "timbre", "instrument", "comb", "pulse", "concern", "compass", "observe", "beyond", "circularity", "tint"],
};

/** Canvas / GL / SVG calls worth counting as the component's hand. */
const CALLS = ["arc", "ellipse", "fillRect", "strokeRect", "lineTo", "bezierCurveTo", "quadraticCurveTo", "fillText", "drawImage", "createRadialGradient", "createLinearGradient", "drawArrays", "drawArraysInstanced", "drawElements", "putImageData", "rotate", "translate"];
const JSX_TAGS = ["canvas", "svg", "circle", "ellipse", "path", "rect", "line", "polygon", "polyline", "text", "g", "div", "span", "p", "button"];

const NON_VISUAL_TAGS = new Set(["script", "style", "meta", "link", "noscript", "title", "head"]);

const COLOR_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}[^)]*\)|hsla?\(\s*-?[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%[^)]*\)/g;
const VEC3_RE = /vec3\(\s*([01]?\.\d+|[01](?:\.0*)?)\s*,\s*([01]?\.\d+|[01](?:\.0*)?)\s*,\s*([01]?\.\d+|[01](?:\.0*)?)\s*\)/g;

// ——— files ———

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const rel = (abs) => abs.slice(ROOT.length);
const componentFiles = () => {
  const comps = walk(`${ROOT}src/components`).filter((f) => f.endsWith(".tsx"));
  // Components that live beside their page rather than in src/components.
  const app = walk(`${ROOT}src/app`).filter((f) => f.endsWith(".tsx") && !/\/(page|layout|route|template|_render|opengraph-image|twitter-image|icon|apple-icon|not-found|error)\.tsx$/.test(f));
  return [...comps, ...app].map(rel).sort();
};

// ——— colour ———

function parseColor(s) {
  s = s.trim();
  let m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(s))) return m[1].split("").map((c) => parseInt(c + c, 16));
  if ((m = /^#([0-9a-f]{6})$/i.exec(s))) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s))) return [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)));
  if ((m = /^hsla?\(\s*(-?[\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i.exec(s))) {
    const h = (((Number(m[1]) % 360) + 360) % 360) / 360, sat = Number(m[2]) / 100, l = Number(m[3]) / 100;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((x) => Math.round(x * 255));
  }
  return null;
}
const hex = (c) => "#" + c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
const luma = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const chroma = (c) => (Math.max(...c) - Math.min(...c)) / 255;

/** Kind defaults: what a component with no colours of its own wears. */
const KIND_PALETTE = {
  orb: ["#2c4a5c", "#c8732a", "#f3d77a"],
  star: ["#2a3a6a", "#9fc4ff", "#fff4dc"],
  spiral: ["#3a2350", "#c98bd8", "#ffe6b0"],
  cell: ["#2d5a4a", "#8fd3a8", "#f0ffe8"],
  quantum: ["#1c2f6b", "#5fd0ff", "#e8fbff"],
  orbit: ["#3b3424", "#d9b45a", "#fff2c8"],
  flame: ["#5a1a0c", "#ff7a2a", "#ffe9a8"],
  drop: ["#0e3a4e", "#4fb3c8", "#e6fbff"],
  petal: ["#4a2238", "#e07aa0", "#fff0f4"],
  crystal: ["#2a2f3a", "#9fb6cc", "#f4fbff"],
  glyph: ["#2a2622", "#a89a84", "#f4ecdc"],
  cloud: ["#3a3f4a", "#b8c2cf", "#f6f8fb"],
};

/**
 * Three anchors from the colours the component painted with: most-used first,
 * near-duplicates merged, near-black and near-white set aside unless that is
 * all there is, then ordered dark → light so the shader can read rim → core.
 */
/** Rotate a colour's hue by `deg`, keeping its lightness: a borrowed palette made one's own. */
function hueShift(c, deg) {
  const [r, g, b] = c.map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return c;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h * 60 + deg) % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((x) => Math.round(x * 255));
}

function paletteOf(colors, kind, file) {
  const freq = new Map();
  for (const c of colors) { const k = hex(c); freq.set(k, (freq.get(k) || 0) + 1); }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([h]) => parseColor(h));
  const merged = [];
  for (const c of ranked) if (!merged.some((m) => dist(m, c) < 38)) merged.push(c);
  const lively = merged.filter((c) => luma(c) > 0.06 && luma(c) < 0.97);
  const pool = (lively.length >= 2 ? lively : merged).slice(0, 6);
  // Prefer colour that carries hue, so a form reads as itself and not as grey.
  pool.sort((a, b) => chroma(b) - chroma(a) || luma(a) - luma(b));
  const chosen = pool.slice(0, 3);
  // A component that painted with fewer than three colours borrows its kind's
  // palette, turned by a hue its own path picks, so no two borrowers match.
  const turn = (fnv(file) % 72) * 5 - 180;
  const fallback = KIND_PALETTE[kind].map((h) => hueShift(parseColor(h), turn));
  while (chosen.length < 3) chosen.push(fallback[chosen.length]);
  chosen.sort((a, b) => luma(a) - luma(b));
  return chosen.map(hex);
}

// ——— the walk ———

const words = (s) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[^A-Za-z]+/g, " ").toLowerCase().split(" ").filter((w) => w.length > 2);
const isShader = (s) => /gl_FragColor|gl_Position|void\s+main\s*\(|precision\s+(?:high|medium|low)p/.test(s);

function readComponent(file) {
  const source = readFileSync(`${ROOT}${file}`, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
  const tokens = new Map();
  const calls = Object.fromEntries(CALLS.map((c) => [c, 0]));
  const tags = Object.fromEntries(JSX_TAGS.map((t) => [t, 0]));
  const colors = [];
  let shaders = 0, shaderChars = 0, jsx = 0, intrinsic = 0, defaultName = null, firstComponent = null;
  const imports = [];
  const bump = (w, n = 1) => tokens.set(w, (tokens.get(w) || 0) + n);
  const takeString = (s) => {
    for (const m of s.match(COLOR_RE) || []) { const c = parseColor(m); if (c) colors.push(c); }
    if (isShader(s)) {
      shaders++; shaderChars += s.length;
      let m; VEC3_RE.lastIndex = 0;
      while ((m = VEC3_RE.exec(s))) {
        const c = [m[1], m[2], m[3]].map((x) => Number(x) * 255);
        if (c.every((x) => x >= 0 && x <= 255) && !(c[0] === c[1] && c[1] === c[2])) colors.push(c);
      }
    }
    for (const w of words(s)) bump(w);
  };

  const visit = (node) => {
    if (ts.isIdentifier(node)) for (const w of words(node.text)) bump(w);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) takeString(node.text);
    else if (ts.isTemplateExpression(node)) { takeString(node.head.text); for (const sp of node.templateSpans) takeString(sp.literal.text); }
    else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const n = node.expression.name.text;
      if (n in calls) calls[n]++;
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      jsx++;
      const t = node.tagName.getText(sf);
      if (t in tags) tags[t]++;
      // A lowercase tag is a real element on the page; <Script> or <Head> alone paints nothing.
      if (/^[a-z]/.test(t) && !NON_VISUAL_TAGS.has(t)) intrinsic++;
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) jsx++;
    else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) {
      const mods = ts.getModifiers(node) || [];
      if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) defaultName = node.name.text;
      if (!firstComponent && mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) firstComponent = node.name.text;
    }
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) defaultName = node.expression.text;
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const name = defaultName || firstComponent || file.split("/").pop().replace(/\.tsx$/, "");
  const tech = shaders > 0 || /createGLStage|getContext\(\s*["']webgl/.test(source) ? (/from "three"/.test(source) ? "three" : "webgl")
    : calls.arc + calls.fillRect + calls.lineTo + calls.ellipse + calls.fillText + calls.drawImage > 0 ? "canvas"
    : tags.svg > 0 ? "svg" : "dom";
  return { file, name, tech, source, tokens, calls, tags, colors, shaders, shaderChars, jsx, visual: intrinsic > 0, lines: source.split("\n").length, imports };
}

// ——— classification ———

function scoreKinds(c, loud) {
  const scores = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const evidence = Object.fromEntries(KINDS.map((k) => [k, []]));
  const loudWords = loud.flatMap(words);
  for (const [kind, stems] of Object.entries(FAMILIES)) {
    for (const stem of stems) {
      let n = 0;
      for (const [w, count] of c.tokens) if (w.startsWith(stem)) n += count;
      let l = 0;
      for (const w of loudWords) if (w.startsWith(stem)) l++;
      if (n + l > 0) {
        scores[kind] += Math.log1p(n) + 10 * l;
        evidence[kind].push([stem, n + 10 * l]);
      }
    }
  }
  return { scores, evidence };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const tokenSum = (c, stems) => { let n = 0; for (const [w, k] of c.tokens) if (stems.some((s) => w.startsWith(s))) n += k; return n; };
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };

function paramsOf(c, kind) {
  const total = Math.max(1, [...c.tokens.values()].reduce((a, b) => a + b, 0));
  const rate = (stems, k) => clamp01(Math.log1p((tokenSum(c, stems) / total) * 1000) / k);
  const r2 = (x) => Math.round(x * 100) / 100;
  const sign = fnv(c.name) & 1 ? 1 : -1;
  return {
    glow: r2(0.25 + 0.75 * rate(["glow", "lighter", "additive", "bloom", "halo", "corona", "shine", "bright"], 4.5)),
    spin: r2(sign * rate(["rotat", "spin", "orbit", "angle", "swirl", "twist", "turn", "theta"], 5)),
    pulse: r2(rate(["breath", "pulse", "beat", "heart", "throb", "swell", "lfo"], 4)),
    jitter: r2(rate(["noise", "turbul", "jitter", "flicker", "random", "seeded", "fbm", "chaos"], 5)),
    drift: r2(rate(["flow", "current", "wind", "drift", "velocity", "stream", "advect"], 5)),
    bonds: r2(rate(["bond", "link", "edge", "connect", "neighbor", "chain", "string", "thread"], 5)),
    // How much of the component is shader — a GL room's form glows from inside.
    depth: r2(clamp01(c.shaderChars / Math.max(1, c.source.length) * 3)),
    detail: r2(clamp01(Math.log10(Math.max(10, c.lines)) / 4)),
    // A per-form variation knob: petal count, spike count, spiral arm count.
    facets: 3 + (fnv(c.file) % 5),
  };
}

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase().replace(/^-|-$/g, "");

function build() {
  const R = loadTsModule("src/lib/room-registry.ts");
  const roomsBySource = new Map();
  for (const e of R.ROOM_REGISTRY) if (e.source) {
    const list = roomsBySource.get(e.source) || [];
    list.push(e);
    roomsBySource.set(e.source, list);
  }
  const forms = [];
  const skipped = [];
  for (const file of componentFiles()) {
    const c = readComponent(file);
    if (!c.visual) { skipped.push({ file, reason: "renders no element of its own (no intrinsic JSX)" }); continue; }
    const rooms = (roomsBySource.get(file) || []).sort((a, b) => (a.key < b.key ? -1 : 1));
    const loud = [c.name, ...rooms.flatMap((r) => [r.key, r.href, r.creates || ""])];
    const { scores, evidence } = scoreKinds(c, loud);
    let kind = "orb", best = 0.5;
    for (const k of KINDS) if (scores[k] > best + 1e-9) { kind = k; best = scores[k]; }
    forms.push({
      id: kebab(c.name),
      component: c.name,
      file,
      rooms: rooms.map((r) => r.key),
      routes: rooms.map((r) => r.href),
      noun: rooms.find((r) => r.creates)?.creates ?? null,
      tech: c.tech,
      kind,
      palette: paletteOf(c.colors, kind, file),
      params: paramsOf(c, kind),
      evidence: {
        lines: c.lines,
        colors: c.colors.length,
        shaders: c.shaders,
        jsx: c.jsx,
        calls: Object.fromEntries(Object.entries(c.calls).filter(([, n]) => n > 0)),
        tags: Object.fromEntries(Object.entries(c.tags).filter(([, n]) => n > 0)),
        why: evidence[kind].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 6).map(([s, n]) => `${s}:${n}`),
        runnerUp: KINDS.filter((k) => k !== kind).sort((a, b) => scores[b] - scores[a] || (a < b ? -1 : 1))[0],
      },
    });
  }
  // Ids are unique: two files that default-export the same name keep their path.
  const seen = new Map();
  for (const f of forms) seen.set(f.id, (seen.get(f.id) || 0) + 1);
  for (const f of forms) if (seen.get(f.id) > 1) f.id = kebab(f.file.replace(/^src\/(components|app)\//, "").replace(/\.tsx$/, ""));
  forms.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { forms, skipped };
}

function render({ forms, skipped }) {
  const compact = forms.map(({ id, component, rooms, noun, tech, kind, palette, params }) => ({ id, component, rooms, noun, tech, kind, palette, params }));
  const ts = `// GENERATED by scripts/build-form-atlas.mjs from the syntax tree of every
// component in this repo. Do not edit by hand: change the component, then run
// \`node scripts/build-form-atlas.mjs\`. \`npm run test:lattice-forms\` fails when
// this file is stale.
import type { FormSpec } from "@/lib/lattice-forms";

export const FORM_KINDS = ${JSON.stringify(KINDS)} as const;

export const FORM_ATLAS: readonly FormSpec[] = ${JSON.stringify(compact, null, 1)};
`;
  const json = JSON.stringify({
    v: 1,
    about: "Every visual form objet d'art wrote as a component, read from its syntax tree (scripts/build-form-atlas.mjs). A lattice animal keeps its cells and wears a form: each cell is drawn as the form's kind, in its palette.",
    kinds: KINDS,
    count: forms.length,
    forms,
    skipped,
  }, null, 1) + "\n";
  return { ts, json };
}

const out = render(build());
if (check) {
  const stale = [];
  if (!existsSync(`${ROOT}${OUT_TS}`) || readFileSync(`${ROOT}${OUT_TS}`, "utf8") !== out.ts) stale.push(OUT_TS);
  if (!existsSync(`${ROOT}${OUT_JSON}`) || readFileSync(`${ROOT}${OUT_JSON}`, "utf8") !== out.json) stale.push(OUT_JSON);
  if (stale.length) {
    console.error(`form atlas is stale: ${stale.join(", ")}. Run: node scripts/build-form-atlas.mjs`);
    process.exit(1);
  }
  console.log("form atlas: current");
} else {
  mkdirSync(`${ROOT}public/lattice`, { recursive: true });
  writeFileSync(`${ROOT}${OUT_TS}`, out.ts);
  writeFileSync(`${ROOT}${OUT_JSON}`, out.json);
  const j = JSON.parse(out.json);
  console.log(`form atlas: ${j.count} forms written to ${OUT_TS} and ${OUT_JSON} (${j.skipped.length} non-visual files skipped)`);
}
