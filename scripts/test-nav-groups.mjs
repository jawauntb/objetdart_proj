// The dropdown's grouping is presentation computed over the derived order —
// never a second, hand-sorted list. Each assertion names the bug it catches:
// a room landing in no section (a stranger cannot find it), a room landing in
// two (the menu lies about what it is), a grouping that silently re-sorts the
// spine, a discipline chip that filters to nothing, and a grouping helper
// shipped with no consumer (the fork-regions failure mode).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule, rootUrl } from "./lib/load-ts.mjs";

const routes = loadTsModule("src/lib/routes.ts");
const navGroups = loadTsModule("src/lib/nav-groups.ts");
const registry = loadTsModule("src/lib/room-registry.ts");

const { NAVIGATION_ROUTES } = routes;
const { buildNavSections, disciplinesOf } = navGroups;
const { ROOM_REGISTRY, ROOM_BY_KEY, NAV_DISCIPLINES, bandOf } = registry;

const refs = NAVIGATION_ROUTES.map((r) => ({ key: r.key, href: r.href }));
const sections = buildNavSections(refs);
const navKeys = NAVIGATION_ROUTES.map((r) => r.key);

// ———————————————————————————————————————————————————————————————————————
// §1 — every registered key lands in exactly one section. A new room that
// falls through the sectioning (or is double-bucketed by a future edit)
// fails here by name, before a visitor ever finds the menu missing it.
// ———————————————————————————————————————————————————————————————————————
const flattened = [
  ...sections.fold,
  ...sections.spine.flatMap((g) => [g.primary, ...g.peers]),
  ...sections.laws,
  ...sections.instruments,
  ...sections.reading,
];
assert.equal(
  new Set(flattened).size,
  flattened.length,
  "a key sits in two sections — the menu would list it twice",
);
{
  const missing = navKeys.filter((k) => !flattened.includes(k));
  const extra = flattened.filter((k) => !navKeys.includes(k));
  assert.deepEqual(missing, [], `registered keys landed in no section: ${missing.join(", ")}`);
  assert.deepEqual(extra, [], `sections invented keys the nav does not carry: ${extra.join(", ")}`);
}

// ———————————————————————————————————————————————————————————————————————
// §2 — the grouping is a chunking of the derived order, never a re-sort.
// Each section, read back flat, must equal the derived sequence filtered to
// that section's own predicate — so a grouping bug that hoists, drops or
// shuffles a room cannot pass, and neither can a hand-sorted "preferred"
// spine sneaking in above nav-order.
// ———————————————————————————————————————————————————————————————————————
const isBandRoom = (k) => ROOM_BY_KEY[k].kind === "room" && bandOf(ROOM_BY_KEY[k]) !== null;
assert.deepEqual(
  [...sections.fold, ...sections.spine.flatMap((g) => [g.primary, ...g.peers])],
  navKeys.filter(isBandRoom),
  "fold + spine, flattened, must reproduce the derived order's band-addressed subsequence exactly",
);
assert.deepEqual(
  sections.laws,
  navKeys.filter((k) => ROOM_BY_KEY[k].kind === "room" && bandOf(ROOM_BY_KEY[k]) === null),
  "laws must be the exempt-addressed rooms in derived order",
);
assert.deepEqual(
  sections.instruments,
  navKeys.filter((k) => ROOM_BY_KEY[k].kind === "instrument"),
  "lenses & instruments must be kind \"instrument\" in derived order",
);
assert.deepEqual(
  sections.reading,
  navKeys.filter((k) => ROOM_BY_KEY[k].kind === "reading"),
  "reading must be kind \"reading\" in derived order",
);

// ———————————————————————————————————————————————————————————————————————
// §3 — the cosmology reads back: the fold holds the manifold, the rings
// collapse under the rooms that lead them, and the law-rooms sit in laws.
// These fail when a room is mis-kinded or a ring loses its head.
// ———————————————————————————————————————————————————————————————————————
assert.deepEqual(sections.fold, ["manifold"], "the fold holds the manifold");
{
  const byPrimary = new Map(sections.spine.map((g) => [g.primary, g]));
  const cabinet = byPrimary.get("drop");
  assert.ok(cabinet, "the drop leads a spine group");
  for (const k of ["coin", "watch", "tourbillon", "viruses"]) {
    assert.ok(cabinet.peers.includes(k), `the cabinet ring collapses ${k} under the drop`);
  }
  const sky = byPrimary.get("stars");
  assert.ok(sky, "the stars lead a spine group");
  for (const k of ["comb", "beam", "localgroup"]) {
    assert.ok(sky.peers.includes(k), `the sky ring collapses ${k} under the stars`);
  }
  const shore = byPrimary.get("coast");
  assert.ok(shore && shore.peers.includes("sine"), "the shore ring collapses sine under the coast");
  // Every group's band is its primary's own address — the label a stranger
  // reads must be where the leading room actually lives.
  for (const g of sections.spine) {
    assert.equal(bandOf(ROOM_BY_KEY[g.primary]), g.band, `${g.primary} leads a group labeled with a foreign band`);
    assert.ok(g.label.length > 0, `${g.id} has no label`);
  }
}
for (const k of ["relativity", "eigen", "group", "time", "loom", "overlook"]) {
  assert.ok(sections.laws.includes(k), `${k} is a law-room and belongs in laws`);
}
assert.ok(sections.instruments.includes("timbre"), "timbre is a lens/instrument");
assert.ok(sections.reading.includes("guide"), "guide is a reading surface");

// ———————————————————————————————————————————————————————————————————————
// §4 — disciplines: every room states 1–3, from the fixed vocabulary, and
// every chip catches at least one room. A tagless new room would render a
// row no filter can reach; an unused tag is a dead control.
// ———————————————————————————————————————————————————————————————————————
const used = new Set();
for (const entry of ROOM_REGISTRY) {
  const tags = entry.disciplines ?? [];
  assert.ok(tags.length >= 1 && tags.length <= 3, `${entry.key}: needs 1–3 disciplines, has ${tags.length}`);
  assert.equal(new Set(tags).size, tags.length, `${entry.key}: duplicate discipline tags`);
  for (const t of tags) {
    assert.ok(NAV_DISCIPLINES.includes(t), `${entry.key}: "${t}" is not in NAV_DISCIPLINES`);
    used.add(t);
  }
  if (entry.kind === "reading") {
    assert.ok(tags.includes("reading"), `${entry.key}: a reading surface carries the reading tag`);
  }
  assert.deepEqual([...disciplinesOf(entry.key)], [...tags], `${entry.key}: disciplinesOf must read the registry`);
}
for (const d of NAV_DISCIPLINES) {
  assert.ok(used.has(d), `discipline "${d}" tags no room — a chip that filters to nothing`);
}

// ———————————————————————————————————————————————————————————————————————
// §5 — the helper has its consumer, in the same tree: the site header must
// build its sections through buildNavSections and offer the discipline
// chips. fork-regions.ts shipped tested with zero consumers; not again.
// ———————————————————————————————————————————————————————————————————————
{
  const header = readFileSync(new URL("src/components/SiteHeader.tsx", rootUrl), "utf8");
  assert.match(header, /buildNavSections\(/, "SiteHeader must render the grouped sections");
  assert.match(header, /NAV_DISCIPLINES/, "SiteHeader must offer the discipline filter chips");
}

console.log(
  `nav groups ok: fold ${sections.fold.length}, spine ${sections.spine.length} groups / ` +
    `${sections.spine.reduce((n, g) => n + 1 + g.peers.length, 0)} rooms, laws ${sections.laws.length}, ` +
    `instruments ${sections.instruments.length}, reading ${sections.reading.length}`,
);
