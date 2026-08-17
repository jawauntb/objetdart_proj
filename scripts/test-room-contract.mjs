// The room contract. AGENTS.md said all of this in prose and an audit still
// found /earth on raw PointerEvents with a private 540ms hold timer, /stars
// (4517 lines) with no vessel layer, thirty of thirty-five rooms never calling
// into room-runtime, src/lib/fork-regions.ts merged with zero consumers, and
// AtomsField hand-rolling the clear button <LetGo> exists to fix.
//
// So the laws are executable now. Every assertion below names the bug it
// catches. When this test goes red, the law is working: fix the room, or
// write the reasoned exemption into src/lib/room-registry.ts. Never delete
// the entry you should be updating.
//
// Static checks over source text — plain node, no browser, fast. Where a rule
// cannot be read reliably from source, it is a registry field a human fills
// in and this test asserts is filled: an honest declaration beats a flaky
// regex.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { loadTsModule, rootUrl } from "./lib/load-ts.mjs";

const read = (p) => readFileSync(new URL(p, rootUrl), "utf8");
const there = (p) => existsSync(new URL(p, rootUrl));

const registryModule = loadTsModule("src/lib/room-registry.ts");
const routesModule = loadTsModule("src/lib/routes.ts");

/**
 * The 2D calls DESIGN.md bans per frame, and the ledger that records who
 * still owes them. Same three patterns scripts/test-room-paint.mjs ratchets,
 * read from the same file, so the two laws can never disagree about a count.
 */
const BANNED_PAINT = {
  createRadialGradient: /createRadialGradient\s*\(/g,
  shadowBlur: /\bshadowBlur\s*=/g,
  "ctx.filter blur": /\bctx\.filter\s*=|\.filter\s*=\s*[`"']blur\(/g,
};
const paintLedger = JSON.parse(readFileSync(new URL("scripts/room-paint-ledger.json", rootUrl), "utf8"));

const {
  ROOM_REGISTRY,
  ROOM_BY_KEY,
  BINDING_PROBES,
  GLOBAL_BINDINGS,
  requiredBindings,
  registryDrift,
  guideKeys,
  bandOf,
  registerOf,
} = registryModule;
const { SITE_ROUTES, NAVIGATION_ROUTES, GALLERY_ROUTES } = routesModule;

// ———————————————————————————————————————————————————————————————————————
// Reading a room's source honestly: comments and strings are blanked before
// any brace scanning, so a gesture named in a comment never counts as bound.
// ———————————————————————————————————————————————————————————————————————

function blankLiterals(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          out += " ";
          i++;
          break;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Index just past the balanced closer that opens at `from`. */
function matchAt(clean, from, open, close) {
  let depth = 0;
  for (let k = from; k < clean.length; k++) {
    if (clean[k] === open) depth++;
    else if (clean[k] === close) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/**
 * Every body of `name: (…) => …` in the file, concatenated, or null when the
 * room writes no such handler. Handler bodies, not the whole file: a room that
 * merely mentions `fingers === 3` in its draw loop has not bound tutti.
 *
 * *Every* body, not the first: a room may mount more than one gesture surface
 * (Tourbillon binds the SVG dial and the WebGL stage; Signal binds its stage
 * and a single transport button), and which one happens to appear first in the
 * file is an accident of editing order, not a statement about the grammar. The
 * first-body-only reading called /signal's two-finger tap unbound while the
 * source plainly bound it forty lines further down — a false red, and a false
 * red is how a law gets deleted.
 */
function handlerBody(clean, name) {
  const re = new RegExp(`(?:^|[\\s,{(])${name}\\s*:\\s*(?:async\\s*)?\\(`, "g");
  const found = [];
  let m;
  while ((m = re.exec(clean))) {
    const paren = clean.indexOf("(", m.index + m[0].length - 1);
    const closed = matchAt(clean, paren, "(", ")");
    if (closed < 0) continue;
    const rest = clean.slice(closed + 1);
    const arrow = rest.match(/^\s*(?::\s*[^=>]*)?=>/);
    if (!arrow) continue;
    let j = closed + 1 + arrow[0].length;
    while (j < clean.length && /\s/.test(clean[j])) j++;
    if (clean[j] === "{") {
      const end = matchAt(clean, j, "{", "}");
      if (end > 0) found.push(clean.slice(j, end + 1));
      continue;
    }
    // expression body — up to the next top-level comma
    let depth = 0;
    for (let k = j; k < clean.length; k++) {
      const ch = clean[k];
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        if (depth === 0) { found.push(clean.slice(j, k)); break; }
        depth--;
      } else if (ch === "," && depth === 0) { found.push(clean.slice(j, k)); break; }
    }
  }
  return found.length ? found.join("\n;\n") : null;
}

/** The object literal handed to onVessel(…), or null. */
function vesselBody(clean) {
  const at = clean.indexOf("onVessel(");
  if (at < 0) return null;
  const open = clean.indexOf("{", at);
  if (open < 0) return null;
  const end = matchAt(clean, open, "{", "}");
  return end > 0 ? clean.slice(open, end + 1) : null;
}

/** Every setTimeout delay that is a bare numeric literal. */
function timeoutDelays(clean) {
  const out = [];
  let at = 0;
  for (;;) {
    at = clean.indexOf("setTimeout(", at);
    if (at < 0) break;
    const open = clean.indexOf("(", at);
    const close = matchAt(clean, open, "(", ")");
    at = open + 1;
    if (close < 0) continue;
    const args = clean.slice(open + 1, close);
    // last top-level argument
    let depth = 0;
    let lastComma = -1;
    for (let k = 0; k < args.length; k++) {
      const ch = args[k];
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
      else if (ch === "," && depth === 0) lastComma = k;
    }
    if (lastComma < 0) continue;
    const tail = args.slice(lastComma + 1).trim();
    if (/^\d+$/.test(tail)) out.push(Number(tail));
  }
  return out;
}

/** Identifier split into its words, for threshold-name matching. */
function identWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const THRESHOLD_WORDS = new Set([
  "hold",
  "press",
  "longpress",
  "dwell",
  "ceremony",
  "tap",
  "tier",
  "chord",
  "settle",
  "gesture",
]);

// ———————————————————————————————————————————————————————————————————————
// Failure collection: grouped by room so the report stays readable and
// therefore stays alive. A wall of two hundred lines gets deleted.
// ———————————————————————————————————————————————————————————————————————

const structural = []; // [where: what]
const owedBindings = new Map(); // key -> [binding name]
const owedNotes = new Map(); // key -> [sentence]

function fail(where, what) {
  structural.push(`${where}: ${what}`);
}
function oweBinding(key, binding) {
  const list = owedBindings.get(key) ?? [];
  list.push(binding);
  owedBindings.set(key, list);
}
function oweNote(key, what) {
  const list = owedNotes.get(key) ?? [];
  list.push(what);
  owedNotes.set(key, list);
}

/**
 * A room built on the scene shell (src/lib/scene/room.ts) delegates the
 * engine, the vessel, the frame governor, the visibility pause and the DPR
 * ceiling to `createRoomShell`, and states which verbs its material answers in
 * its object spec's `verbs` array. The contract reads that array instead of
 * hunting for handlers the room no longer writes.
 */
const VERB_FOR_BINDING = {
  tutti: "tutti",
  lens: "lens",
  season: "season",
  weather: "wind",
  dilation: "dilate",
  dwell: "dwell",
  ceremony: "ceremony",
  tilt: "gravity",
  shake: "agitate",
  knock: "knock",
  flip: "night",
  pan: "pan2",
  stepBack: null, // the shell yields it to ScaleTravel, like every room
};

/** The verb names in every `verbs: [...]` array — read off the raw source. */
/** The `RoomVoice` key each global binding arrives on (src/lib/gesture/defaults.ts). */
const VOICE_FOR_BINDING = {
  stepBack: "stepBack",
  tutti: "tutti",
  lens: "lens",
  season: "season",
  weather: "wind",
  dilation: "timeScale",
  dwell: "plant",
  ceremony: "ceremony",
  tilt: "gravity",
  shake: "scatter",
  knock: "knock",
  flip: "night",
  pan: null,
};

/** The verb names in every `verbs: [...]` array — read off the raw source. */
function declaredVerbs(raw) {
  const out = new Set();
  const re = /verbs\s*:\s*\[/g;
  let m;
  while ((m = re.exec(raw))) {
    const open = raw.indexOf("[", m.index + m[0].length - 1);
    const end = matchAt(raw, open, "[", "]");
    if (end < 0) continue;
    for (const q of raw.slice(open, end + 1).matchAll(/["']([a-z]+)["']/g)) out.add(q[1]);
  }
  return out;
}

// ———————————————————————————————————————————————————————————————————————
// 0. The registry is the authority: routes derive from it, nothing drifts
// ———————————————————————————————————————————————————————————————————————

{
  const registryKeys = ROOM_REGISTRY.map((r) => r.key);
  const routeKeys = SITE_ROUTES.map((r) => r.key);
  if (registryKeys.join(" ") !== routeKeys.join(" ")) {
    fail(
      "src/lib/routes.ts",
      "SITE_ROUTES is no longer the registry in order — it must be derived from " +
        "ROOM_REGISTRY, never hand-listed alongside it (that second list is how a room " +
        "ends up in the nav with no scale address)",
    );
  }
  if (NAVIGATION_ROUTES.length !== ROOM_REGISTRY.length) {
    fail("src/lib/routes.ts", "every registered room must appear in the navigation exactly once");
  }
  const galleryKeys = new Set(GALLERY_ROUTES.map((r) => r.key));
  for (const entry of ROOM_REGISTRY) {
    const shouldShow = entry.kind !== "reading";
    if (shouldShow !== galleryKeys.has(entry.key)) {
      fail(
        entry.key,
        `gallery membership disagrees with kind "${entry.kind}" — the swipe gallery is ` +
          "derived from READING_SURFACE_KEYS, so a room that hides from it must say it is a reading surface",
      );
    }
  }
  for (const line of registryDrift()) fail("registry ↔ manifold", line);

  // The guide's coverage set is the registry's, plus the threshold.
  const expected = guideKeys();
  if (new Set(expected).size !== expected.length) {
    fail("src/lib/room-registry.ts", "guideKeys() produced a duplicate — a key is registered twice");
  }
}

// ———————————————————————————————————————————————————————————————————————
// 1..6. Per-room conformance
// ———————————————————————————————————————————————————————————————————————

const sources = new Map();
function roomSource(entry) {
  if (!entry.source) return null;
  if (!there(entry.source)) return null;
  if (!sources.has(entry.source)) {
    const raw = read(entry.source);
    sources.set(entry.source, { raw, clean: blankLiterals(raw) });
  }
  return sources.get(entry.source);
}

for (const entry of ROOM_REGISTRY) {
  const key = entry.key;

  if (entry.source && !there(entry.source)) {
    fail(key, `registry points at ${entry.source}, which does not exist`);
    continue;
  }
  if (!there(entry.page)) {
    fail(key, `registry points at ${entry.page}, which does not exist`);
  }
  if (entry.kind === "reading") continue;
  const src = roomSource(entry);
  if (!src) {
    fail(key, "an interactive room must name the component that owns its material");
    continue;
  }
  const { raw, clean } = src;

  // Rooms built on <RoomShell> delegate the gesture table, the vessel, the
  // glimmer clock, the keyboard dialect, the axis chrome and <LetGo> to it;
  // rooms built on the scene model state their verbs in the object spec.
  const viaRoomShell = /@\/components\/RoomShell/.test(raw);
  const viaScene = /@\/lib\/scene\/(?:voice|object)/.test(raw);
  const viaShell = viaRoomShell || viaScene;
  // Law-rooms (`chrome: "none"`) still build on <RoomShell chrome={false}> so
  // they get the grammar, vessel, glimmer and LetGo without AxisChrome. The
  // prop is the exemption made visible; treating any RoomShell import as a
  // chrome mount would forbid the first law-room on the shell.
  const verbs = viaScene ? declaredVerbs(raw) : null;

  // — 1. the gesture engine, and no raw pointer wiring ———————————————
  const usesEngine = /attachGestures\s*\(/.test(clean) || viaShell;
  if (!usesEngine) {
    oweNote(
      key,
      "never adopted the gesture engine — no attachGestures. This is the /earth and /stars " +
        "violation exactly: raw pointer wiring cannot speak the grammar, so every global " +
        "binding below is unreachable and the thresholds drift room by room",
    );
  }
  const rawPointer =
    /addEventListener\(\s*["'](?:pointerdown|touchstart)["']/.test(raw) ||
    /\bonPointerDown\s*[=:]/.test(raw);
  if (rawPointer && usesEngine && !entry.rawPointer) {
    fail(
      key,
      "wires a raw pointerdown/touchstart alongside attachGestures with no reason on record — " +
        "either delete it (the engine already speaks it) or state why in the registry's " +
        "`rawPointer` field (an audio unlock, a stopPropagation on a panel)",
    );
  }

  // — 2. no private timing thresholds ——————————————————————————————
  const declRe = /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*number)?\s*=\s*(\d+)\b/g;
  let decl;
  while ((decl = declRe.exec(clean))) {
    const value = Number(decl[2]);
    if (value < 40) continue; // an accumulator starting at 0 is not a threshold
    if (!identWords(decl[1]).some((w) => THRESHOLD_WORDS.has(w))) continue;
    // A room may declare that a constant whose NAME reads like a tier is not
    // one (a camera's quiet-debounce, an animation duration). The sentence
    // must name the constant, so one reason can never cover a second, real
    // threshold smuggled in beside it.
    if ((entry.thresholds ?? "").includes(decl[1])) continue;
    fail(
      key,
      `declares its own timing threshold \`${decl[1]} = ${value}\` — hold tiers, tap windows ` +
        "and chord settling live in src/lib/gesture/core.ts alone. A private copy is how a " +
        "long-press comes to mean something different in one room than in every other" +
        (entry.thresholds
          ? ". The room's `thresholds` note does not name this one"
          : ". If the name only *reads* like a tier, say what it really is in the registry's " +
            "`thresholds` field and name the constant there"),
    );
  }
  if (entry.thresholds && entry.thresholds.trim().length < 12) {
    fail(key, "the `thresholds` note is not a reason — say what the constant really measures");
  }
  if (!usesEngine) {
    for (const delay of timeoutDelays(clean)) {
      if (delay >= 200 && delay <= 3000 && rawPointer) {
        fail(
          key,
          `re-implements the hold tiers with setTimeout(…, ${delay}) on a raw pointer — ` +
            "this is /earth's private 540ms tier, the exact bug the engine exists to end",
        );
        break;
      }
    }
  }

  // — 3. every global binding implemented or reasoned away ————————————
  const tapB = handlerBody(clean, "tap");
  const holdB = handlerBody(clean, "hold");
  const dragB = handlerBody(clean, "drag");
  const twistB = handlerBody(clean, "twist");
  const pan2B = handlerBody(clean, "pan2");
  const pinchB = handlerBody(clean, "pinch");
  const vessel = vesselBody(clean);
  const bodies = { tap: tapB, hold: holdB, drag: dragB, twist: twistB, pan2: pan2B, pinch: pinchB };

  const bound = (probe) => {
    if (probe.vessel) {
      if (!vessel) return false;
      return new RegExp(`(?:^|[\\s,{])${probe.handler}\\s*:`).test(vessel);
    }
    const body = bodies[probe.handler];
    if (body == null) return false;
    return probe.inBody ? probe.inBody.test(body) : true;
  };

  const probeFor = Object.fromEntries(BINDING_PROBES.map((p) => [p.binding, p]));
  for (const binding of requiredBindings(entry)) {
    const probe = probeFor[binding];
    if (!probe) {
      fail(key, `no probe for global binding "${binding}" — BINDING_PROBES must cover the grammar`);
      continue;
    }
    const shellVerb = VERB_FOR_BINDING[binding];
    const answered = viaShell
      ? shellVerb === null ||
        (verbs?.has(shellVerb) ?? false) ||
        (viaRoomShell && VOICE_FOR_BINDING[binding] != null &&
          new RegExp(`(?:^|[\\s,{])${VOICE_FOR_BINDING[binding]}\\s*:`, "m").test(clean)) ||
        bound(probe)
      : bound(probe);
    if (!answered) oweBinding(key, binding);
  }
  for (const binding of Object.keys(entry.exempt)) {
    if (!GLOBAL_BINDINGS.includes(binding)) {
      fail(key, `exempts "${binding}", which is not a global binding`);
    } else if ((entry.exempt[binding] ?? "").trim().length < 12) {
      fail(key, `the exemption for "${binding}" is not a reason — say what the material cannot express`);
    }
  }

  // — the frame verb: exactly one owner ————————————————————————————
  if (entry.frame === "yield" && pinchB) {
    fail(
      key,
      "yields the frame yet binds pinch itself — two owners of one verb means the room " +
        "fights ScaleTravel for scale travel. Declare `frame: \"own\"` or drop the handler",
    );
  }
  if (entry.frame === "own" && !pinchB) {
    fail(
      key,
      "declares it owns the frame but binds no pinch through attachGestures — a room that " +
        "keeps the frame verb owes the hand a real one (this is /stars, zooming on raw wheel events)",
    );
  }

  // — 4. the performance contract ————————————————————————————————
  const animates = /requestAnimationFrame\s*\(/.test(clean) || viaShell;
  if (animates) {
    if (!viaShell && !/onVisibility\s*\(/.test(clean)) {
      oweNote(
        key,
        "animates but never calls onVisibility — the room keeps drawing in a hidden tab, " +
          "burning a phone battery for nobody (src/lib/room-runtime.ts, or build on scene/room)",
      );
    }
    if (!viaShell && !/createFrameGovernor\s*\(/.test(clean) && !entry.governor) {
      oweNote(
        key,
        "animates with no createFrameGovernor and no stated exemption — no quality tier, so no " +
          "detailForTier and no resolveDpr ceiling. That is the whole 'not performing enough' " +
          "complaint (src/lib/room-runtime.ts, or build on scene/room)",
      );
    }
  }
  if (entry.governor && !animates) {
    fail(key, "carries a `governor` exemption but has no animation loop to exempt");
  }

  // — 5. the quiet clear is the shared control ————————————————————
  const usesLetGo = /@\/components\/LetGo/.test(raw) || (viaRoomShell && /letGo\s*=\s*\{/.test(raw));
  if (entry.creates && !usesLetGo) {
    oweNote(
      key,
      `creates ${entry.creates} but offers no <LetGo> — a whole-field clear hand-rolled in the ` +
        "room's own tree gets trapped under the tape's z-index in Chrome and silently swallows " +
        "clicks. That is why LetGo portals to document.body (AtomsField's 'still the field')",
    );
  }
  if (entry.creates == null && entry.keeps && usesLetGo) {
    fail(
      key,
      "mounts <LetGo> but declares no countable material — say what it creates in the registry, " +
        "or the control clears something the manifest does not admit exists",
    );
  }
  const homeRolled = [...raw.matchAll(/<button[\s\S]{0,400}?<\/button>/g)].filter((m) =>
    /(still the|clear the|let .{0,12}go|forget|empty the|start over)/i.test(m[0]),
  );
  if (homeRolled.length && !usesLetGo) {
    fail(
      key,
      "hand-rolls its clear control instead of the shared <LetGo> — same stacking-context bug, " +
        "same swallowed clicks, one more dialect of the same word",
    );
  }

  // — 5b. no paint server rebuilt per object per frame ————————————
  // The render side of the same defect the scene model fixes: a gradient or a
  // shadowBlur inside the loop that walks the population.
  //
  // The count itself belongs to the ratchet in scripts/test-room-paint.mjs —
  // `room-paint-ledger.json` records what every component in src/components/
  // uses today, existing debt is visible and may only shrink, and new debt
  // fails that test. Restating the same numbers here as a note with no way to
  // answer it taught the reader to skip the report, which is how a law dies.
  // So this clause asks the one question the ledger cannot: is the room ABOVE
  // what it declared — and, crucially, it reaches the rooms the ledger never
  // sees, because test:paint only walks src/components/ while a room may own
  // its material from src/app/<key>/ (DitherLab.tsx did, with a per-frame
  // shadowBlur nobody's ledger had ever counted).
  if (!viaShell) {
    const declared = paintLedger[entry.source] ?? {};
    for (const [name, pattern] of Object.entries(BANNED_PAINT)) {
      pattern.lastIndex = 0;
      const used = (raw.match(pattern) ?? []).length;
      const allowed = declared[name] ?? 0;
      if (used <= allowed) continue;
      oweNote(
        key,
        `calls ${name} ${used}× — ${
          allowed === 0
            ? "and scripts/room-paint-ledger.json sanctions none of them"
            : `past the ${allowed} scripts/room-paint-ledger.json sanctions`
        }. A paint server rebuilt inside the loop over the room's material is the most ` +
          "expensive habit in this codebase: hoist it to a cached sprite (bakeRadialSprite in " +
          "src/lib/scene/radial-sprite.ts), or describe the objects as instances (src/lib/scene/)",
      );
    }
  }

  // — 6. rooms with a scale address mount the chrome ——————————————
  const band = bandOf(entry);
  const pageSrc = there(entry.page) ? read(entry.page) : "";
  const shellOmitsChrome = /chrome\s*=\s*\{\s*false\s*\}/.test(raw);
  const mountsAxis = /<AxisChrome/.test(pageSrc) || (viaRoomShell && !shellOmitsChrome);
  const mountsTravel = /<ScaleTravel/.test(pageSrc);
  const mountsPeers = /<MetaNavigator/.test(pageSrc);
  const declared =
    entry.chrome === "axis"
      ? mountsAxis
      : entry.chrome === "travel+peers"
        ? mountsTravel && mountsPeers
        : entry.chrome === "travel"
          ? mountsTravel && !mountsPeers
          : entry.chrome === "peers"
            ? mountsPeers && !mountsTravel
            : !mountsAxis && !mountsTravel && !mountsPeers;
  if (!declared) {
    fail(
      key,
      `registry declares chrome "${entry.chrome}" but ${entry.page} mounts ` +
        `${[mountsAxis && "AxisChrome", mountsTravel && "ScaleTravel", mountsPeers && "MetaNavigator"]
          .filter(Boolean)
          .join(" + ") || "nothing"}`,
    );
  }
  if (band && entry.chrome === "none") {
    fail(
      key,
      `has the scale address "${band}" and mounts no axis chrome — pinch-travel and the peer ` +
        "ring are both unreachable, so the room is moored to the manifold on paper only. " +
        "Mount <AxisChrome route={…} />",
    );
  }
  if (!band && entry.chrome !== "none" && entry.kind !== "reading") {
    fail(key, "mounts axis chrome without a scale address — chrome it cannot travel with");
  }
  if (band && registerOf(entry) == null) {
    fail(key, `band "${band}" yields no spectral register — entryScaleFor(${entry.href}) returned null`);
  }

  // — 6b. own-frame rooms must not force `travel={true}` on AxisChrome ——
  //
  // The registry's `frame: "own"` says ScaleTravel would be a second owner
  // of pinch — the double-pinch bug where two owners fight for one gesture.
  // AxisChrome's default `travel` is now derived from the registry, so an
  // own-frame room gets `travel={false}` for free. An explicit `travel={true}`
  // on the mount overrides the derivation and reintroduces the exact bug the
  // derivation was written to prevent. Structural check: grep every AxisChrome
  // mount in the room's page (and its component, when it mounts one there) for
  // the literal override.
  if (entry.frame === "own") {
    const scanned = [];
    if (pageSrc) scanned.push({ where: entry.page, text: pageSrc });
    if (entry.source && entry.source !== entry.page && raw) {
      scanned.push({ where: entry.source, text: raw });
    }
    for (const { where, text } of scanned) {
      // Every `<AxisChrome ... />` tag, then look for `travel={true}` inside.
      for (const m of text.matchAll(/<AxisChrome\b[\s\S]*?\/>/g)) {
        if (/travel\s*=\s*\{\s*true\s*\}/.test(m[0])) {
          fail(
            key,
            `has \`frame: "own"\` but mounts <AxisChrome travel={true}> in ${where} — the registry ` +
              "makes ScaleTravel stand down for own-frame rooms; forcing `travel={true}` on top of it " +
              "reintroduces the double-pinch bug (two owners of one gesture). Drop the override, or " +
              "change the registry to `frame: \"yield\"` and let the derivation carry it",
          );
        }
      }
    }
  }
}

// ———————————————————————————————————————————————————————————————————————
// 7. No room-facing resolver merged with nobody to resolve for
// ———————————————————————————————————————————————————————————————————————
//
// Narrow on purpose: a lib module that someone thought worth its own node
// test is a module someone meant a room to use. src/lib/fork-regions.ts was
// built, tested, merged — and imported by nothing. A law nobody calls is not
// a law, it is a file.

{
  const libFiles = readdirSync(new URL("src/lib/", rootUrl), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => e.name.replace(/\.ts$/, ""));
  const consumers = new Map(libFiles.map((n) => [n, 0]));
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, rootUrl), { withFileTypes: true })) {
      const child = `${dir}${e.name}`;
      if (e.isDirectory()) walk(`${child}/`);
      else if (/\.tsx?$/.test(e.name)) {
        const text = read(child);
        for (const name of libFiles) {
          if (child === `src/lib/${name}.ts`) continue;
          if (new RegExp(`["']@/lib/${name}["']`).test(text)) {
            consumers.set(name, (consumers.get(name) ?? 0) + 1);
          }
        }
      }
    }
  };
  walk("src/");
  for (const name of libFiles) {
    if (!there(`scripts/test-${name}.mjs`)) continue;
    if ((consumers.get(name) ?? 0) > 0) continue;
    fail(
      `src/lib/${name}.ts`,
      "is tested but imported by nothing in src/ — dead on arrival, like fork-regions.ts. " +
        "Wire it into the room it was extracted for, or delete it and its test together",
    );
  }
}

// ———————————————————————————————————————————————————————————————————————
// The report
// ———————————————————————————————————————————————————————————————————————

const interactive = ROOM_REGISTRY.filter((r) => r.kind !== "reading");
const rooms = new Set([...owedBindings.keys(), ...owedNotes.keys()]);
const bindingCount = [...owedBindings.values()].reduce((n, l) => n + l.length, 0);
const noteCount = [...owedNotes.values()].reduce((n, l) => n + l.length, 0);

if (structural.length === 0 && bindingCount === 0 && noteCount === 0) {
  console.log(
    `room contract ok: ${interactive.length} interactive rooms, ` +
      `${GLOBAL_BINDINGS.length} global bindings each, no drift`,
  );
  process.exit(0);
}

const lines = [];
lines.push("");
lines.push("— the room contract is red. that is the law working, not an obstacle. —");
lines.push("");
if (structural.length) {
  lines.push(`structural violations (${structural.length}):`);
  for (const line of structural) lines.push(`  · ${line}`);
  lines.push("");
}
if (rooms.size) {
  lines.push(
    `the grammar owed: ${bindingCount} unbound bindings and ${noteCount} notes ` +
      `across ${rooms.size} of ${interactive.length} rooms`,
  );
  for (const entry of ROOM_REGISTRY) {
    const bindings = owedBindings.get(entry.key);
    const notes = owedNotes.get(entry.key);
    if (!bindings && !notes) continue;
    lines.push(`  /${entry.key}${bindings ? `  unbound: ${bindings.join(" ")}` : ""}`);
    for (const note of notes ?? []) lines.push(`      · ${note}`);
  }
  lines.push("");
  lines.push("what each unbound binding costs the hand:");
  const named = new Set([...owedBindings.values()].flat());
  for (const probe of BINDING_PROBES) {
    if (!named.has(probe.binding)) continue;
    lines.push(
      `  ${probe.binding.padEnd(9)} ${probe.loses} — ` +
        (probe.vessel
          ? "an onVessel handler"
          : `the attachGestures \`${probe.handler}\` handler`) +
        `, or the verb "${VERB_FOR_BINDING[probe.binding] ?? "—"}" on a scene object`,
    );
  }
  lines.push("");
}
lines.push("fix the room, or write the reasoned exemption in src/lib/room-registry.ts.");
lines.push("never delete the entry you should be updating.");
lines.push("");
console.error(lines.join("\n"));
process.exit(1);
