import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-backdrop-dome — the pure-math half of the horizon backdrop.
 *
 * The factory in `city-backdrop-dome.ts` builds a single ShaderMaterial +
 * CylinderGeometry, drawn from inside the world. The FALSIFIABLE
 * behaviour we test here is the pure surface: silhouette determinism,
 * horizon tint ladder (day → dusk → night), day/night curves, and the
 * geometric constants that pin the ring's placement outside the infill
 * annulus.
 *
 * A regression that inverted the silhouette floor/peak, dropped the
 * horizon warmth at dusk, or left the dome inside the skyline ring
 * would land here without a WebGL context.
 */

// ── stubs ────────────────────────────────────────────────────────────────

const threeStub = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === "Color") {
        return class {
          constructor(r = 0, g = 0, b = 0) {
            this.r = r;
            this.g = g;
            this.b = b;
          }
          setRGB(r, g, b) {
            this.r = r;
            this.g = g;
            this.b = b;
            return this;
          }
        };
      }
      if (key === "Vector3") {
        return class {
          constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
          }
          set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
          }
          clone() {
            return new this.constructor(this.x, this.y, this.z);
          }
          multiplyScalar() {
            return this;
          }
          normalize() {
            return this;
          }
        };
      }
      if (key === "BackSide") return 1;
      // Any other three symbol: a permissive stub class.
      return function stub() {
        return new Proxy(
          {},
          {
            get() {
              return () => undefined;
            },
            set() {
              return true;
            },
          },
        );
      };
    },
  },
);

// city-backdrop-dome imports SkyState as a type from city-sky. Load a
// minimal stub of city-sky so the CommonJS transpile of the .ts file has
// something to bind — we never actually call anything on it from the
// pure surface under test.
const skyStub = {
  dayFractionToSkyState() {
    return null;
  },
  sampleSkyColor() {
    return { x: 0, y: 0, z: 0 };
  },
  fogColorFromSky() {
    return null;
  },
};

const mod = loadTsModule("src/lib/city-backdrop-dome.ts", {
  requireMap: {
    three: threeStub,
    "@/lib/city-sky": skyStub,
  },
});

const {
  BACKDROP_RADIUS,
  BACKDROP_HEIGHT,
  BACKDROP_BASE_Y,
  BACKDROP_RADIAL_SEGMENTS,
  BACKDROP_HEIGHT_SEGMENTS,
  BACKDROP_SILHOUETTE_PEAK,
  BACKDROP_SILHOUETTE_FLOOR,
  BACKDROP_NOISE_OCTAVES,
  backdropUnitHash,
  silhouetteHeightAtAzimuth,
  backdropDuskAmount,
  backdropNightAmount,
  backdropTintFromSky,
} = mod;

// ── constants the brief pins ─────────────────────────────────────────────

assert.ok(
  BACKDROP_RADIUS >= 1500 && BACKDROP_RADIUS <= 3000,
  `dome radius sits at photographic distance (got ${BACKDROP_RADIUS})`,
);
assert.equal(BACKDROP_RADIUS, 2000, "brief pins the dome at r=2000 m");

// The dome must live OUTSIDE the infill / skyline-ring annulus, which
// runs to 500 m. Even after any margin, r=2000 is safely beyond.
const INFILL_OUTER_R = 500;
assert.ok(
  BACKDROP_RADIUS > INFILL_OUTER_R * 3,
  `dome beyond the last infill ring by ×3 or more (got ${BACKDROP_RADIUS} vs ${INFILL_OUTER_R})`,
);

// The dome must live INSIDE the Preetham sky mesh at 4.5e5 m.
assert.ok(
  BACKDROP_RADIUS < 450000,
  `dome closer than Preetham sky mesh (got ${BACKDROP_RADIUS})`,
);

assert.ok(BACKDROP_HEIGHT > 100, "dome tall enough to subtend real horizon");
assert.ok(BACKDROP_HEIGHT < 800, "dome not so tall it swallows the frame");
assert.ok(
  BACKDROP_BASE_Y <= 0,
  `dome base sits at or below ground (got ${BACKDROP_BASE_Y})`,
);

assert.ok(BACKDROP_RADIAL_SEGMENTS >= 64, "azimuth resolution reads continuous");
assert.ok(BACKDROP_HEIGHT_SEGMENTS >= 16, "vertical resolution supports haze taper");

assert.ok(
  BACKDROP_SILHOUETTE_FLOOR < BACKDROP_SILHOUETTE_PEAK,
  "silhouette envelope not inverted",
);
assert.ok(
  BACKDROP_SILHOUETTE_FLOOR > 0,
  "silhouette has a floor — the shortest distant building still reads",
);
assert.ok(
  BACKDROP_SILHOUETTE_PEAK < 0.5,
  "silhouette crest sits in the lower half of the dome so haze reads above",
);

assert.ok(BACKDROP_NOISE_OCTAVES >= 2, "silhouette carries multi-scale detail");
assert.ok(BACKDROP_NOISE_OCTAVES <= 6, "octave count stays cheap");

// ── backdropUnitHash ────────────────────────────────────────────────────

for (let i = 0; i < 32; i += 1) {
  const u = backdropUnitHash(i, 0x123);
  assert.ok(Number.isFinite(u), `finite hash at ${i}`);
  assert.ok(u >= 0 && u <= 1, `hash in [0, 1] at ${i}, got ${u}`);
  assert.equal(backdropUnitHash(i, 0x123), u, "hash is pure");
}
// Different seeds give different outputs across a wide sample.
{
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    seen.add(backdropUnitHash(i, 0x9e3).toFixed(6));
  }
  assert.ok(seen.size > 150, `hash spreads (got ${seen.size} unique)`);
}
// Different salts give different outputs.
{
  const a = backdropUnitHash(42, 0);
  const b = backdropUnitHash(42, 1);
  assert.notEqual(a, b, "hash responds to salt");
}

// ── silhouetteHeightAtAzimuth ───────────────────────────────────────────

// Determinism.
for (let i = 0; i < 20; i += 1) {
  const az = i / 20;
  assert.equal(
    silhouetteHeightAtAzimuth(az, 0x51de),
    silhouetteHeightAtAzimuth(az, 0x51de),
    `pure at az ${az}`,
  );
}

// Envelope. Every sampled height must sit within [FLOOR, PEAK].
{
  const N = 512;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let seed = 0; seed < 8; seed += 1) {
    for (let i = 0; i < N; i += 1) {
      const az = i / N;
      const h = silhouetteHeightAtAzimuth(az, seed);
      assert.ok(Number.isFinite(h), `finite at seed ${seed}, az ${az}`);
      assert.ok(
        h >= BACKDROP_SILHOUETTE_FLOOR - 1e-9,
        `≥ floor at seed ${seed}, az ${az}, got ${h}`,
      );
      assert.ok(
        h <= BACKDROP_SILHOUETTE_PEAK + 1e-9,
        `≤ peak at seed ${seed}, az ${az}, got ${h}`,
      );
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  // Across many samples the profile must actually vary — a regression to
  // a flat rectangle would land here.
  assert.ok(
    maxH - minH > (BACKDROP_SILHOUETTE_PEAK - BACKDROP_SILHOUETTE_FLOOR) * 0.4,
    `silhouette varies (spread ${(maxH - minH).toFixed(3)})`,
  );
}

// Different seeds paint plausibly different skylines.
{
  const N = 128;
  let differences = 0;
  for (let i = 0; i < N; i += 1) {
    const az = i / N;
    const a = silhouetteHeightAtAzimuth(az, 111);
    const b = silhouetteHeightAtAzimuth(az, 222);
    if (Math.abs(a - b) > 0.005) differences += 1;
  }
  assert.ok(differences > N * 0.5, `distinct skylines per seed (${differences}/${N})`);
}

// Wrap continuity: az 0 and az 1 sample the same lattice, so their
// values should be identical (the shader wraps with fract).
assert.equal(
  silhouetteHeightAtAzimuth(0, 42),
  silhouetteHeightAtAzimuth(1, 42),
  "azimuth wraps at seam",
);

// ── backdropDuskAmount ──────────────────────────────────────────────────

// Cardinal states: dawn = 0, noon = 0.25, dusk = 0.5, midnight = 0.75.
{
  const dawn = backdropDuskAmount(0);
  const noon = backdropDuskAmount(0.25);
  const dusk = backdropDuskAmount(0.5);
  const midnight = backdropDuskAmount(0.75);
  assert.ok(dusk > 0.8, `dusk carries dusk-amount (got ${dusk})`);
  assert.ok(dawn > 0.8, `dawn carries dusk-amount too (got ${dawn})`);
  assert.ok(noon < 0.2, `noon has no dusk (got ${noon})`);
  assert.ok(midnight < 0.2, `midnight has no dusk (got ${midnight})`);
}

// Range.
for (let i = 0; i < 100; i += 1) {
  const v = backdropDuskAmount(i / 100);
  assert.ok(Number.isFinite(v), `finite at ${i}`);
  assert.ok(v >= 0 && v <= 1, `in [0, 1] at ${i}, got ${v}`);
}

// Wrap.
assert.ok(
  Math.abs(backdropDuskAmount(0) - backdropDuskAmount(1)) < 1e-6,
  "dusk amount wraps at 1",
);
assert.ok(
  Math.abs(backdropDuskAmount(-0.25) - backdropDuskAmount(0.75)) < 1e-6,
  "dusk amount wraps at negatives",
);

// ── backdropNightAmount ─────────────────────────────────────────────────

{
  const dawn = backdropNightAmount(0);
  const noon = backdropNightAmount(0.25);
  const dusk = backdropNightAmount(0.5);
  const midnight = backdropNightAmount(0.75);
  assert.ok(midnight > 0.9, `midnight is deeply night (got ${midnight})`);
  assert.ok(noon < 0.1, `noon is not night (got ${noon})`);
  assert.ok(
    dusk > 0.3 && dusk < 0.7,
    `dusk sits between night and day (got ${dusk})`,
  );
  assert.ok(
    dawn > 0.3 && dawn < 0.7,
    `dawn sits between night and day (got ${dawn})`,
  );
}

for (let i = 0; i < 100; i += 1) {
  const v = backdropNightAmount(i / 100);
  assert.ok(v >= 0 && v <= 1, `night in [0, 1] at ${i}, got ${v}`);
}

// ── backdropTintFromSky ─────────────────────────────────────────────────

// Fake SkyState — the tint function only reads sunAltitude, so we pass
// enough of the shape to compute.
function fakeState(altitude) {
  return {
    sunAltitude: altitude,
    // The rest of the fields are unused by backdropTintFromSky; still
    // present for shape-safety in TS builds.
    sunDir: { x: 0, y: Math.sin(altitude), z: 0 },
    turbidity: 3,
    rayleigh: 2,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    sunPosition: { x: 0, y: 1, z: 0 },
  };
}

// Noon: sun overhead — cool horizon.
{
  const t = backdropTintFromSky(fakeState(Math.PI * 0.5));
  assert.equal(t.horizon.length, 3);
  assert.equal(t.under.length, 3);
  assert.equal(t.haze.length, 3);
  // Blue channel dominates day horizon.
  assert.ok(
    t.horizon[2] > t.horizon[0],
    `noon horizon is blue-biased (${t.horizon.join(", ")})`,
  );
}

// Dusk: sun at horizon — warm ember dominates.
{
  const t = backdropTintFromSky(fakeState(0));
  // Red channel dominates dusk horizon.
  assert.ok(
    t.horizon[0] > t.horizon[2],
    `dusk horizon is warm/red-biased (${t.horizon.join(", ")})`,
  );
  // The under band is warmer/brighter still — the ember lick.
  assert.ok(
    t.under[0] > t.horizon[0] * 0.95,
    `dusk under is at least as warm as horizon (${t.under.join(", ")})`,
  );
}

// Midnight: sun below — cool deep indigo.
{
  const t = backdropTintFromSky(fakeState(-Math.PI * 0.5));
  // All channels sit low.
  const maxCh = Math.max(...t.horizon);
  assert.ok(
    maxCh < 0.4,
    `midnight horizon reads dim (max channel ${maxCh})`,
  );
  // Blue > red — the moonlit-indigo bias.
  assert.ok(
    t.horizon[2] >= t.horizon[0],
    `midnight horizon is cool (${t.horizon.join(", ")})`,
  );
}

// Every tint component sits in [0, 1].
for (const alt of [-Math.PI / 2, -0.2, 0, 0.3, Math.PI / 2]) {
  const t = backdropTintFromSky(fakeState(alt));
  for (const triple of [t.horizon, t.under, t.haze]) {
    for (const ch of triple) {
      assert.ok(Number.isFinite(ch), `finite tint channel at alt ${alt}`);
      assert.ok(ch >= 0 && ch <= 1, `tint in [0, 1] at alt ${alt}, got ${ch}`);
    }
  }
}

// Determinism.
{
  const a = backdropTintFromSky(fakeState(0.1));
  const b = backdropTintFromSky(fakeState(0.1));
  for (const key of ["horizon", "under", "haze"]) {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(a[key][i], b[key][i], `pure tint at ${key}[${i}]`);
    }
  }
}

console.log("test-city-backdrop-dome: OK");
