// Room liveness, executable.
//
// `test:room-contract` made the *grammar* a law: every room speaks through
// `attachGestures`, every global binding is implemented or reasoned away.
// It now reports "68 interactive rooms, 13 global bindings each, no drift" —
// and the album was still, in the visitor's own words, "just a spinning
// earth". A room can pass every line of that contract and be a slideshow.
//
// So this is the next level up: the contract asks whether a verb is BOUND;
// this asks whether the room is ALIVE. Three properties, measured before it
// was written, so nobody argues about scope:
//
//   · **46 of ~68 interactive rooms bound no multi-tap at all.** A double tap
//     did exactly what a single tap did nearly everywhere. `gesture/core.ts`
//     has published the rungs — 1 / 3 / 5 / n — since the engine landed, and
//     almost nothing climbed them.
//   · **36 of 62 travel edges had no film.** The gap was systematic: the whole
//     small-scale spine (quanta→quarks→nucleons→atoms→molecules→organics→dna→
//     organelles→cells→tissue) fell back to the shared 2400ms breath, while
//     every registered film sat on the astronomical trunk. That is *why* the
//     transitions a visitor actually notices look like a spinning globe — the
//     globe IS the default film.
//   · **Nothing checked that a room's objects act on each other.** That is the
//     whole difference between /stars — where black holes eat stars, two holes
//     inspiral and ring, planets take orbits — and a field of decals.
//
// Each assertion below names the bug it catches. Where a property cannot be
// read reliably from source, it is a registry field a human fills in honestly
// and this test asserts is filled — the same choice test-room-contract made,
// for the same reason: a stated reason beats a clever regex, and a flaky regex
// is how a law gets deleted.
//
// Static reads over source text plus the real scale graph — plain node, no
// browser, fast. When this goes red, the law is working. Fix the room, or
// write the reasoned exemption into src/lib/room-registry.ts. Never delete the
// entry you should be updating.

import { existsSync, readFileSync } from "node:fs";
import { loadTsModule, rootUrl } from "./lib/load-ts.mjs";

const read = (p) => readFileSync(new URL(p, rootUrl), "utf8");
const there = (p) => existsSync(new URL(p, rootUrl));

const { ROOM_REGISTRY } = loadTsModule("src/lib/room-registry.ts");
const { SCALE_BANDS, travelOptions } = loadTsModule("src/lib/scale.ts");
const { PASSAGES, resolvePassageSpec } = loadTsModule("src/lib/travel-passage.ts");

// ———————————————————————————————————————————————————————————————————————
// Reading a room's source honestly
// ———————————————————————————————————————————————————————————————————————
//
// Same idiom as test-room-contract.mjs and test-room-quality.mjs, kept
// deliberately: a gesture named in a docstring proves nothing, so comments go
// first. Strings are optional here — the tap ladder's top rung is the literal
// `"n"` (`tapTrainTier` returns 1 | 3 | 5 | "n"), so the rung scan needs a
// source with comments blanked and strings intact, while the handler-body
// scan needs both blanked.

function blank(source, { strings = true } = {}) {
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
    if (strings && (c === '"' || c === "'" || c === "`")) {
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

/** Index of the balanced closer that opens at `from`. */
function matchAt(text, from, open, close) {
  let depth = 0;
  for (let k = from; k < text.length; k++) {
    if (text[k] === open) depth++;
    else if (text[k] === close) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/**
 * Every body of `name: (…) => …` in the file, concatenated, or null. Handler
 * bodies, not the whole file — a room that merely mentions `count` in its draw
 * loop has not bound the tap train. *Every* body, not the first: a room may
 * mount more than one gesture surface, and a room built on `<RoomShell>` writes
 * its `tap:` inside the `voice={{…}}` object, which is the same shape.
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
    let depth = 0;
    for (let k = j; k < clean.length; k++) {
      const ch = clean[k];
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        if (depth === 0) {
          found.push(clean.slice(j, k));
          break;
        }
        depth--;
      } else if (ch === "," && depth === 0) {
        found.push(clean.slice(j, k));
        break;
      }
    }
  }
  return found.length ? found.join("\n;\n") : null;
}

// ———————————————————————————————————————————————————————————————————————
// Declared exemptions that are not room-shaped
// ———————————————————————————————————————————————————————————————————————

/**
 * Travel edges that genuinely want the plain breath, each with the reason.
 * Keyed `from->to` at the band grain, exactly as `resolvePassageSpec` keys.
 *
 * Empty on purpose. Every edge on this axis crosses a real change of kind —
 * that is what a band boundary IS — so "this hop has nothing to depict" is a
 * claim that has to be argued, in writing, one edge at a time. An edge listed
 * here without twelve characters of reason fails the same as an unfilmed one.
 */
const PLAIN_BREATH_EDGES = {};

/** Findings, grouped by law so the report stays readable and therefore alive. */
const owed = {
  tapTrain: [],
  topRung: [],
  interacts: [],
  film: [],
  filmDispatch: [],
  seed: [],
};

// ———————————————————————————————————————————————————————————————————————
// 1 & 2 & 3 & 5. Per-room
// ———————————————————————————————————————————————————————————————————————

const interactive = [];
for (const entry of ROOM_REGISTRY) {
  if (entry.kind === "reading") continue;
  if (!entry.source || !there(entry.source)) continue; // test-room-contract owns that failure
  const raw = read(entry.source);
  interactive.push({
    entry,
    // both blanked: the handler-body scan must not read a gesture named in a
    // docstring or a string as a binding
    clean: blank(raw),
    // comments blanked, strings kept: the ladder's top rung is the literal
    // "n" that tapTrainTier returns
    code: blank(raw, { strings: false }),
  });
}

for (const { entry, clean, code } of interactive) {
  const key = entry.key;

  // — 1. the tap train is bound ————————————————————————————————————
  //
  // The bug: a room binds `tap` and throws `e.count` away, so the second,
  // third and tenth tap of a train do exactly what the first did. AGENTS.md
  // already calls that out — "a tap that does nothing is raised friction, and
  // raised friction is a bug" — and 46 rooms did it anyway. The handler must
  // at minimum *read* `count`: branch on it here, or hand it to the api that
  // does (`apiRef.current?.tap(x, y, e.intensity, e.count, e.fingers)`).
  const tapB = handlerBody(clean, "tap");
  if (!entry.taps) {
    if (tapB == null) {
      owed.tapTrain.push([
        key,
        "binds no `tap` handler at all — through attachGestures or through the " +
          "<RoomShell> voice, one finger on the material is the first thing a hand tries",
      ]);
    } else if (!/\bcount\b/.test(tapB)) {
      owed.tapTrain.push([
        key,
        "binds `tap` but never reads `e.count` — the tap train is thrown away, so a " +
          "double tap is indistinguishable from a single one. Branch on tapTrainTier(e.count), " +
          "or pass the count through to the api that does",
      ]);
    }
  }

  // — 2. a largest rung exists ——————————————————————————————————————
  //
  // Reading `count` is not the same as climbing it. /marsh multiplies its ring
  // by `(count - 1) * 0.08` and calls it a ladder: that is a loudness knob, and
  // a hand that taps five times fast gets 32% more of the same ring. The rungs
  // are published in gesture/core.ts — 1 / 3 / 5 / n — and the room's largest,
  // rarest event lives at the top one. Spend real fidelity there; that is the
  // wow. A room that wants no ladder says so in the registry's `taps` field.
  if (!entry.taps) {
    const usesLadder = /\btapTrainTier\s*\(/.test(code);
    const topRung =
      /\b\w*[Tt]ier\s*(?:===|==|>=)\s*(?:5\b|["']n["'])/.test(code) ||
      /\b\w*[Cc]ount\s*(?:===|>=)\s*(?:5|7)\b/.test(code);
    if (!usesLadder || !topRung) {
      owed.topRung.push([
        key,
        !usesLadder
          ? "never calls tapTrainTier() — whatever it does with e.count is a private " +
            "dialect of the tap train, not the site-wide 1 / 3 / 5 / n ladder, and there is " +
            "no rung for the room's largest event to sit on"
          : "calls tapTrainTier() but branches on no rung above 3 — the ladder stops before " +
            "the room's rarest, biggest event. Five rapid taps must buy something a single " +
            "tap cannot",
      ]);
    }
  }
  if (entry.taps && entry.taps.trim().length < 12) {
    owed.tapTrain.push([key, "the `taps` note is not a reason — say why this material has no rung ladder"]);
  }

  // — 3. the objects act on each other ———————————————————————————————
  //
  // The one that matters most and the one no regex can see honestly. A field
  // of objects that never touch is a slideshow with a particle count; /stars
  // is alive because a black hole *eats* the star that drifts near it and two
  // holes inspiral into a third thing that is neither parent. So the registry
  // carries the claim in a sentence a human wrote and a reviewer can falsify
  // by playing the room: which force acts between the objects, and what a
  // merge or reaction PRODUCES. Required of any room whose material is
  // countable — `creates` non-null is the room saying it holds a population.
  if (entry.creates && !(entry.interacts ?? "").trim()) {
    owed.interacts.push([
      `${key} (${entry.creates})`,
      "creates a countable material and declares no `interacts` — nothing on record says the " +
        "population is a population rather than a pile of decals. Name the force between " +
        "the objects and what a merge or reaction produces (gravity at astronomical scale, " +
        "charge and bonding at molecular, adhesion at cellular, drag in fluids)",
    ]);
  } else if (entry.interacts != null && entry.interacts.trim().length < 24) {
    owed.interacts.push([
      key,
      "the `interacts` note is too short to be a claim — it must name the force AND what a " +
        "merge, reaction or consumption produces, or it is decoration on a decoration",
    ]);
  }

  // — 5. determinism ————————————————————————————————————————————————
  //
  // "Everything generated is a deterministic function of a small state vector
  // (a seed)" is the first of AGENTS.md's laws that no test could reach. It is
  // reachable: `Math.random()` in a room is a state the seed cannot reproduce,
  // so the same room never comes back the same way, `<LetGo>` and the kept
  // field cannot round-trip, and a film built the same way cannot be replayed
  // backward on the return leg. `hashSeed` / `seededRandom` are the shared
  // answer. A room that truly needs entropy (an audio noise buffer, a DOM id)
  // states which call and why in the registry's `nondeterminism` field.
  const rolls = (code.match(/\bMath\.random\s*\(/g) ?? []).length;
  if (rolls > 0 && !entry.nondeterminism) {
    owed.seed.push([
      `${key} ×${rolls}`,
      "calls Math.random() — the seed law says everything rendered is a function " +
        "of a small state vector, so this room cannot come back the way it left and its film " +
        "cannot replay backward. Seed it (hashSeed / seededRandom), or say which call needs " +
        "real entropy in the registry's `nondeterminism` field",
    ]);
  }
  if (entry.nondeterminism) {
    if (entry.nondeterminism.trim().length < 12) {
      owed.seed.push([key, "the `nondeterminism` note is not a reason — say what needs real entropy"]);
    } else if (rolls === 0) {
      owed.seed.push([
        key,
        "carries a `nondeterminism` exemption with no Math.random() left to exempt — " +
          "the debt was paid; delete the line rather than leaving a licence lying around",
      ]);
    }
  }
}

// ———————————————————————————————————————————————————————————————————————
// 4. Every travel edge resolves to a film
// ———————————————————————————————————————————————————————————————————————
//
// The bug, exactly as a visitor reported it: "many are just a spinning earth."
// They were. `DEFAULT_PASSAGE` carries no `film`, and `makeFilmFor` answers a
// filmless spec with `makeFilm(PASSAGE_SEED)` — the chart that curls onto a
// turning globe. So an unregistered edge does not fail loudly, it plays the
// planet, and the planet plays between quarks and nucleons.
//
// scripts/test-travel-passage.mjs already pins that every edge resolves *a
// spec*. This asks the harder question: does the edge resolve a film that
// depicts THAT crossing. Enumerated exactly as travelOptions does, over the
// real scale graph, in both directions — the same walk ScaleTravel makes.

const edges = new Map();
for (const band of SCALE_BANDS) {
  for (const dir of [1, -1]) {
    for (const dest of travelOptions(band.id, dir, {})) {
      edges.set(`${band.id}->${dest.id}`, { from: band.id, dest });
    }
  }
}

let filmed = 0;
for (const [edgeKey, { from, dest }] of edges) {
  const spec = resolvePassageSpec(from, dest);
  if (spec.film) {
    filmed++;
    continue;
  }
  const excuse = PLAIN_BREATH_EDGES[edgeKey];
  if (excuse && excuse.trim().length >= 12) continue;
  owed.film.push([
    edgeKey,
    excuse
      ? "is listed in PLAIN_BREATH_EDGES with no reason — say what this crossing has to show " +
        "that the shared breath already shows better"
      : `${
          PASSAGES[edgeKey]
            ? "has a registered spec with no `film` key, so it plays the default planet"
            : "is unregistered, so it falls back to DEFAULT_PASSAGE"
        } — the turning globe stands in for a crossing it has nothing to do with. ` +
        "Write the film that depicts what actually happens between these two scales, or " +
        "declare the edge in PLAIN_BREATH_EDGES with a reason",
  ]);
}

// A registered film nobody draws is worse than no film: it reads as covered in
// the registry and plays the planet on the screen. `makeFilmFor` is the one
// dispatch, so every name PASSAGES uses must appear in it.
{
  const host = "src/components/TravelPassage.tsx";
  if (there(host)) {
    const hostSrc = read(host);
    const dispatch = hostSrc.slice(hostSrc.indexOf("function makeFilmFor"));
    for (const name of new Set(Object.values(PASSAGES).map((s) => s.film).filter(Boolean))) {
      if (!new RegExp(`film\\s*===\\s*["']${name}["']`).test(dispatch)) {
        owed.filmDispatch.push([
          name,
          `is named by PASSAGES but makeFilmFor() in ${host} never dispatches it — the edge ` +
            "reads as covered in the registry and plays the default planet on the screen",
        ]);
      }
    }
  }
}

// ———————————————————————————————————————————————————————————————————————
// The report
// ———————————————————————————————————————————————————————————————————————

const countable = interactive.filter((r) => r.entry.creates).length;
const total =
  owed.tapTrain.length +
  owed.topRung.length +
  owed.interacts.length +
  owed.film.length +
  owed.filmDispatch.length +
  owed.seed.length;

if (total === 0) {
  console.log(
    `room liveness ok: ${interactive.length} interactive rooms climb the tap ladder, ` +
      `${countable} countable materials declare their physics, ` +
      `${edges.size}/${edges.size} travel edges carry a film, nothing rolls unseeded`,
  );
  process.exit(0);
}

const lines = [];
lines.push("");
lines.push("— room liveness is red. that is the law working, not an obstacle. —");
lines.push("");

/**
 * One block per law, and findings that share a sentence share a line. Forty
 * copies of the same paragraph is how a reader learns to scroll past a report,
 * and a report nobody reads is a law nobody keeps — the contract test says the
 * same thing about its own grouping, for the same reason.
 */
function section(title, why, findings, label = "room") {
  if (!findings.length) return;
  lines.push(`${title} — ${findings.length} ${label}${findings.length === 1 ? "" : "s"}`);
  lines.push(`  ${why}`);
  const byMessage = new Map();
  for (const [who, what] of findings) {
    const list = byMessage.get(what) ?? [];
    list.push(who);
    byMessage.set(what, list);
  }
  for (const [what, who] of byMessage) {
    if (who.length === 1) lines.push(`   · ${who[0]}: ${what}`);
    else {
      lines.push(`   · ${who.length} ${label}s: ${what}`);
      lines.push(`     ${who.join(" ")}`);
    }
  }
  lines.push("");
}

section(
  "1. the tap train is not bound",
  "gesture/core.ts publishes the rungs 1 / 3 / 5 / n; a handler that drops e.count " +
    "makes every tap after the first a repeat of the first.",
  owed.tapTrain,
);
section(
  "2. the ladder has no top rung",
  "the room's largest, rarest event has nowhere to live — five rapid taps buy nothing " +
    "a single tap does not already buy.",
  owed.topRung,
);
section(
  "3. the objects do not act on each other, or nobody has said they do",
  "a population that never merges, reacts or consumes is a particle count. state the " +
    "force and what a merge produces in the registry's `interacts` field.",
  owed.interacts,
);
section(
  "4. travel edges with no film",
  `${filmed} of ${edges.size} edges carry one. an edge without a film plays the default ` +
    "planet — the spinning earth a visitor sees between quarks and nucleons.",
  owed.film,
  "edge",
);
section(
  "4b. films named but never drawn",
  "PASSAGES points at a film makeFilmFor() does not answer.",
  owed.filmDispatch,
  "film",
);
section(
  "5. unseeded randomness",
  "Math.random() in a room breaks the seed law: the room cannot come back the way it left, " +
    "and a film built this way cannot replay backward on the return leg.",
  owed.seed,
);

lines.push("fix the room, write the film, or write the reasoned exemption in");
lines.push("src/lib/room-registry.ts (`taps`, `interacts`, `nondeterminism`) or in");
lines.push("PLAIN_BREATH_EDGES at the top of this file.");
lines.push("never delete the entry you should be updating.");
lines.push("");
console.error(lines.join("\n"));
process.exit(1);
