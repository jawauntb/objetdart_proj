import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

// Pin the dusk-and-lit-windows moment. This is the settlement's emotional
// peak — the brief calls the warm tungsten glow one-by-one against the
// cool blue evening the whole point — and every future refactor of
// city-windows.ts must survive this ladder. If a change lowers the dusk
// peak, or lets a lit window bleed into noon, or drops the midnight
// afterglow to zero, this file fires before it lands.
//
// The ladder the brief pins:
//   dawn     (0)    → ~0
//   noon     (0.25) → ~0
//   dusk     (0.5)  → ~0.7   (emotional peak)
//   midnight (0.75) → ~0.4   (a scattering of restless lamps)
//   pre-dawn (~1)   → ~0     (closes the loop)

const mod = loadTsModule("src/lib/city-windows.ts");
const {
  baselineLitFractionForDay,
  litFractionForDay,
  windowIsLit,
} = mod;

// ── the pinned four hours ────────────────────────────────────────────────
//
// The tolerance is intentional. The curve doesn't need to land on the exact
// numbers — it needs to walk the ladder. A ±0.15 window at each cardinal
// point is loose enough that a small palette tuning does not fire the test,
// tight enough that a wrong-shape curve (a sinusoid, a linear ramp) does.

const dawn = baselineLitFractionForDay(0);
const noon = baselineLitFractionForDay(0.25);
const dusk = baselineLitFractionForDay(0.5);
const midnight = baselineLitFractionForDay(0.75);

assert.ok(
  dawn < 0.05,
  `dawn (${dawn.toFixed(3)}) must be effectively unlit — the sky is enough at first light`,
);
assert.ok(
  noon < 0.05,
  `noon (${noon.toFixed(3)}) must be effectively unlit — a lit window vanishes against a bright sky`,
);
assert.ok(
  dusk > 0.55 && dusk < 0.85,
  `dusk (${dusk.toFixed(3)}) must land near 0.7 — this is the emotional peak, the whole block warm`,
);
assert.ok(
  midnight > 0.25 && midnight < 0.55,
  `midnight (${midnight.toFixed(3)}) must land near 0.4 — a scattering stays lit, the block is asleep but alive`,
);

// The loop closes: pre-dawn approaches dawn as f → 1.
const preDawn = baselineLitFractionForDay(0.99);
assert.ok(
  preDawn < 0.1,
  `pre-dawn (${preDawn.toFixed(3)}) must return to the dark end — the day's loop is a loop, not a spiral`,
);

// ── shape: dusk is the maximum ───────────────────────────────────────────
//
// The peak of the curve must sit in the evening window, not at noon or
// midnight. Scan the whole day at fine resolution and check that the
// argmax sits between 0.45 and 0.65 (the "dusk" band as the brief means
// it, wide enough for artistic taste).

let peakHour = 0;
let peakValue = -1;
for (let i = 0; i < 200; i += 1) {
  const f = i / 200;
  const v = baselineLitFractionForDay(f);
  if (v > peakValue) {
    peakValue = v;
    peakHour = f;
  }
}
assert.ok(
  peakHour > 0.45 && peakHour < 0.65,
  `the curve's peak must sit at dusk, not noon or midnight — peak was ${peakHour.toFixed(3)} (${peakValue.toFixed(3)})`,
);

// The rise into dusk is monotone — no dips through the evening lift.
for (let i = 30; i < Math.round(peakHour * 200); i += 1) {
  const a = baselineLitFractionForDay(i / 200);
  const b = baselineLitFractionForDay((i + 1) / 200);
  assert.ok(
    b + 1e-6 >= a,
    `the evening lift is monotone — window ${(i / 200).toFixed(3)} → ${((i + 1) / 200).toFixed(3)} dropped`,
  );
}

// ── seed variance: 48 plots, 48 individual schedules ─────────────────────
//
// The whole reason the seed exists is so a row of homes reads as forty-
// eight separate homes, not one atlas stamped forty-eight times. The test
// samples a big set of seeds at dusk and checks:
//   - they don't collapse to one value (there IS variance)
//   - they don't blow past the [0, 1] envelope (the amplitude dial is safe)
//   - the mean sits near the baseline (the ensemble is honest to the hour)

const duskSamples = [];
for (let s = 1; s <= 200; s += 1) {
  const v = litFractionForDay(0.5, s);
  assert.ok(v >= 0 && v <= 1, `lit fraction must stay in [0,1] — got ${v} at seed ${s}`);
  duskSamples.push(v);
}
const min = Math.min(...duskSamples);
const max = Math.max(...duskSamples);
assert.ok(
  max - min > 0.15,
  `seeds at dusk must vary — a row of homes reads as many, not one (spread ${(max - min).toFixed(3)})`,
);
const mean = duskSamples.reduce((a, b) => a + b, 0) / duskSamples.length;
assert.ok(
  Math.abs(mean - dusk) < 0.12,
  `the ensemble mean at dusk (${mean.toFixed(3)}) must be honest to the block's dusk baseline (${dusk.toFixed(3)})`,
);

// A single seed is stable — same input, same output, no wall-clock creep.
assert.equal(
  litFractionForDay(0.5, 42), litFractionForDay(0.5, 42),
  "the curve is a pure function — one seed at one hour always reads the same",
);

// Two different seeds are (with high probability) different plots.
assert.notEqual(
  litFractionForDay(0.5, 7), litFractionForDay(0.5, 8),
  "different seeds produce different schedules — the settlement is not one atlas",
);

// ── windowIsLit: the per-cell gate ───────────────────────────────────────
//
// The mechanism that makes windows read as "one by one" instead of "all
// at once" is a stable per-cell hash compared against the plot's lit
// fraction. As the fraction rises, more cells flip on; as it falls, more
// flip off. The test pins:
//   - a bright fraction (1) lights every window
//   - a dark fraction (0) lights none
//   - the same (plot, row, col) at the same fraction is stable
//   - the count grows monotonically with the fraction (no flicker)

for (let r = 0; r < 4; r += 1) {
  for (let c = 0; c < 6; c += 1) {
    assert.equal(
      windowIsLit(1, 12345, r, c), true,
      `at full lit fraction every window must be on — the block is fully awake`,
    );
    assert.equal(
      windowIsLit(0, 12345, r, c), false,
      `at zero lit fraction no window is on — the block is asleep`,
    );
  }
}

// Stability: the same input reads the same twice.
assert.equal(
  windowIsLit(0.5, 999, 2, 3), windowIsLit(0.5, 999, 2, 3),
  "the per-cell gate is a pure function — a window does not flicker frame-to-frame",
);

// Monotonicity: for one plot, the count of lit windows in a 6×8 grid is
// non-decreasing as the lit fraction rises from 0 to 1.
function countLit(seed, f) {
  let n = 0;
  for (let r = 0; r < 6; r += 1) for (let c = 0; c < 8; c += 1) {
    if (windowIsLit(f, seed, r, c)) n += 1;
  }
  return n;
}
let prev = -1;
for (let i = 0; i <= 20; i += 1) {
  const f = i / 20;
  const n = countLit(0xC17A, f);
  assert.ok(n >= prev, `window count must not flicker down as the hour brightens — f=${f} n=${n} prev=${prev}`);
  prev = n;
}

// And the ends: 0 lights nothing, 1 lights everything (48 cells).
assert.equal(countLit(0xC17A, 0), 0, "no lit windows at zero fraction");
assert.equal(countLit(0xC17A, 1), 48, "every window lit at full fraction");

// ── real geometric window openings — the frame-lattice ladder ───────────
//
// R6-A: home + store facades finally carry a real InstancedMesh window-
// frame lattice. Each frame is a small extruded rectangle-with-hole that
// protrudes ~8cm from the wall face, so grazing sunset light rakes across
// a real edge and the bloom pass catches genuine self-shadow. The pure
// math that drives the lattice — how many frames per plot, and where on
// the plot each one sits — is testable without three; the tests below
// pin the ladder so a grid refactor can't silently drop a wall's worth
// of windows or misalign the frame ring with the pane.

const frames = loadTsModule("src/lib/city-window-frames-pure.ts");
const {
  WINDOW_FACES,
  faceYawFor,
  windowsPerPlot,
  WINDOW_FRAME_DEPTH_M,
  WINDOW_FRAME_OUTER,
  WINDOW_FRAME_INNER,
  windowFramePlacement,
  WINDOW_GRIDS_PURE,
} = frames;

// The four faces are the four cardinal walls, distinct and no duplicates.
assert.equal(WINDOW_FACES.length, 4, "four wall faces, one lattice — no more, no less");
const faceSet = new Set(WINDOW_FACES);
assert.equal(faceSet.size, 4, "wall faces must be distinct — the lattice is not double-stamped");

// Face yaws land at 0, +π/2, π, -π/2 (in some order). Every frame's
// outward normal must be one of the four cardinals.
const yaws = WINDOW_FACES.map(f => faceYawFor(f)).sort((a, b) => a - b);
const cardinals = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
for (let i = 0; i < 4; i += 1) {
  assert.ok(
    Math.abs(yaws[i] - cardinals[i]) < 1e-9,
    `face yaw ${yaws[i].toFixed(4)} must land on a cardinal (${cardinals[i].toFixed(4)})`,
  );
}

// The counts. Home = 3 × 3 × 4 = 36; store = 5 × 4 × 4 = 80; tree /
// event / empty carry no lattice.
assert.equal(windowsPerPlot("home"), 36, "home plot contributes 36 frames — 3×3 grid × 4 walls");
assert.equal(windowsPerPlot("store"), 80, "store plot contributes 80 frames — 5×4 grid × 4 walls");
assert.equal(windowsPerPlot("tree"), 0, "tree plots do not carry window frames — a park has no walls");
assert.equal(windowsPerPlot("event"), 0, "event towers own their curtain-wall geometry — no lattice");
assert.equal(windowsPerPlot("empty"), 0, "empty plots draw nothing");

// The grids match the emissive canvas: same rows × cols so a lit cell on
// the canvas and its frame ring on the wall are in perfect register.
assert.deepEqual(WINDOW_GRIDS_PURE.home,  { rows: 3, cols: 3 }, "home grid pinned at 3×3");
assert.deepEqual(WINDOW_GRIDS_PURE.store, { rows: 5, cols: 4 }, "store grid pinned at 5×4");

// The protrusion is exactly the value the brief calls out (6–8cm) —
// enough for a rake shadow at grazing angles, small enough that the
// silhouette at bird's-eye still reads as one flat wall.
assert.ok(
  WINDOW_FRAME_DEPTH_M >= 0.06 && WINDOW_FRAME_DEPTH_M <= 0.08 + 1e-9,
  `frame depth ${WINDOW_FRAME_DEPTH_M} must be in the 6–8cm band the brief calls for`,
);

// Frame outer must exceed inner so the ring is not a solid box.
assert.ok(
  WINDOW_FRAME_INNER < WINDOW_FRAME_OUTER,
  "the frame's inner opening must be smaller than its outer — otherwise there's no hole for the pane",
);

// ── placement geometry — the wall face is real ───────────────────────────
//
// On a plot centered at origin, a 4×4×4 home with yaw=0, the +Z face's
// center window (row 1, col 1 in a 3×3 grid) must sit AT the wall's
// front face (z ≈ sz/2 + frameDepth/2), at half-height (y ≈ yScale/2),
// on the plot's centerline (x ≈ 0). Any drift means the lattice is not
// aligned with the wall.

{
  const home = WINDOW_GRIDS_PURE.home;
  const p = windowFramePlacement(
    0, 0, 0,        // cx, cz, yaw
    4, 4, 4,        // sx, sz, yScale
    home.rows, home.cols,
    0,              // face: +Z
    1, 1,           // row 1 of 3 (center), col 1 of 3 (center)
  );
  assert.ok(Math.abs(p.x) < 1e-6, `center window on +Z face must sit on the centerline — got x=${p.x}`);
  const expectedZ = 4 / 2 + WINDOW_FRAME_DEPTH_M / 2;
  assert.ok(
    Math.abs(p.z - expectedZ) < 1e-6,
    `center +Z window must protrude ${WINDOW_FRAME_DEPTH_M / 2} past the wall face — got z=${p.z}, expected ${expectedZ}`,
  );
  // Row 1 in a 3-row grid is the MIDDLE row — cell center at (1+0.5) *
  // (4/3) = 2.0 — exactly half the wall height.
  assert.ok(
    Math.abs(p.y - 2.0) < 1e-6,
    `center row must sit at half-height — got y=${p.y}, expected 2.0`,
  );
  // The window is 78% of its cell in both axes.
  const cellW = 4 / 3;
  const cellH = 4 / 3;
  assert.ok(
    Math.abs(p.winW - cellW * WINDOW_FRAME_OUTER) < 1e-6,
    `window width ${p.winW} must be cell × frame_outer (${cellW * WINDOW_FRAME_OUTER})`,
  );
  assert.ok(
    Math.abs(p.winH - cellH * WINDOW_FRAME_OUTER) < 1e-6,
    `window height ${p.winH} must be cell × frame_outer (${cellH * WINDOW_FRAME_OUTER})`,
  );
}

// The -Z face mirrors the +Z face: same center window, opposite side of
// the plot. This is the check that the plot is symmetric front-to-back.
{
  const home = WINDOW_GRIDS_PURE.home;
  const pFront = windowFramePlacement(0, 0, 0, 4, 4, 4, home.rows, home.cols, 0, 1, 1);
  const pBack  = windowFramePlacement(0, 0, 0, 4, 4, 4, home.rows, home.cols, 1, 1, 1);
  assert.ok(
    Math.abs(pFront.z + pBack.z) < 1e-6,
    `+Z and -Z center windows must sit at opposite z — got ${pFront.z} and ${pBack.z}`,
  );
  assert.ok(
    Math.abs(pFront.y - pBack.y) < 1e-6,
    "front and back center windows sit at the same height",
  );
}

// A store facade: 5 rows × 4 cols. Every window on the +Z face must lie
// on the plane z = sz/2 + frameDepth/2 (± noise from x-tangent = 0 test).
// Sample the whole face and check.
{
  const store = WINDOW_GRIDS_PURE.store;
  const sx = 5, sz = 4, yScale = 10;
  const wallHalfWithLip = sz / 2 + WINDOW_FRAME_DEPTH_M / 2;
  for (let r = 0; r < store.rows; r += 1) {
    for (let c = 0; c < store.cols; c += 1) {
      const p = windowFramePlacement(0, 0, 0, sx, sz, yScale, store.rows, store.cols, 0, r, c);
      assert.ok(
        Math.abs(p.z - wallHalfWithLip) < 1e-6,
        `every +Z-face store frame must sit on the wall plane — got z=${p.z} at (r=${r},c=${c})`,
      );
      // Row 0 sits at the ground floor (base of wall); row R-1 sits near
      // the roof. The window sequence must climb monotonically in y.
      const expectedY = (r + 0.5) * (yScale / store.rows);
      assert.ok(
        Math.abs(p.y - expectedY) < 1e-6,
        `store row ${r} must sit at y=${expectedY} — got y=${p.y}`,
      );
      // Every window fits within the wall in the tangent direction —
      // no frame pokes past the corners.
      assert.ok(
        p.x + p.winW / 2 <= sx / 2 + 1e-6 && p.x - p.winW / 2 >= -sx / 2 - 1e-6,
        `store window at (r=${r},c=${c}) tangent x=${p.x} must stay inside sx=${sx}`,
      );
    }
  }
}

// Yaw obeys plot rotation. A home rotated by π/2 (a right turn) has its
// +Z face point along world +X — the center +Z window must sit at world
// x = sx/2 + frameDepth/2, z ≈ 0.
{
  const home = WINDOW_GRIDS_PURE.home;
  const yaw = Math.PI / 2;
  const p = windowFramePlacement(0, 0, yaw, 4, 4, 4, home.rows, home.cols, 0, 1, 1);
  const expectedX = 4 / 2 + WINDOW_FRAME_DEPTH_M / 2;
  assert.ok(
    Math.abs(p.x - expectedX) < 1e-6,
    `plot yawed +90° puts +Z face's center window at world +x — got x=${p.x}, expected ${expectedX}`,
  );
  assert.ok(
    Math.abs(p.z) < 1e-6,
    `plot yawed +90° puts +Z face's center window at world z=0 — got z=${p.z}`,
  );
}

// Determinism: same inputs → same outputs. No wall clock, no drift.
{
  const a = windowFramePlacement(1.2, -0.7, 0.4, 5, 3, 7, 5, 4, 0, 2, 1);
  const b = windowFramePlacement(1.2, -0.7, 0.4, 5, 3, 7, 5, 4, 0, 2, 1);
  assert.deepEqual(a, b, "windowFramePlacement is a pure function — same inputs give same outputs");
}

console.log(
  `city-windows ok: dawn ${dawn.toFixed(3)} → noon ${noon.toFixed(3)} → dusk ${dusk.toFixed(3)} → midnight ${midnight.toFixed(3)}, ` +
  `peak at hour ${peakHour.toFixed(3)}, ` +
  `seeds spread ${(max - min).toFixed(3)} at dusk with mean ${mean.toFixed(3)}, ` +
  `per-cell gate is monotone through the evening lift — the dusk moment is pinned. ` +
  `Frame lattice: home=36, store=80, tree/event=0; ${WINDOW_FRAME_DEPTH_M * 100}cm protrusion; +Z / -Z / +X / -X faces land on the wall.`,
);
