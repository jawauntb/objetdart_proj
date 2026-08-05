import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-camera — the pure-math half of the perspective camera.
 *
 * The tests below pin the coupled zoom+pitch curve at both extremes and
 * demand it stay monotone in between. A pinch that made the camera pitch
 * up in the middle of the travel would be a bug the eye reads instantly
 * ("the world tilted the wrong way for a beat"); a test that only walked
 * two zoom values would miss it. So we sample the whole [0..1] axis.
 *
 * We do NOT construct a Three.js PerspectiveCamera here — the tests need
 * to run in plain node without a GL context. The pure functions are the
 * causal law; the factory glues them to Three.
 */

// The pure functions do not call into Three, but the module imports it
// for its factory. A minimal stub lets the test run in plain node — the
// test never touches PerspectiveCamera or Vector3 directly.
const threeStub = {
  PerspectiveCamera: class { constructor() { this.position = { set() {} }; }
    updateProjectionMatrix() {} lookAt() {} },
  Vector3: class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
    copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
    project(){return this;} },
};
const mod = loadTsModule("src/lib/city-camera.ts", { requireMap: { three: threeStub } });
const {
  pitchForZoom,
  distanceForZoom,
  lookYForZoom,
  normToWorld,
  CITY_HALF,
  CAM_FOV,
  CAM_NEAR,
  CAM_FAR,
} = mod;

// ——— cardinal points on the zoom axis ————————————————————————————————————
// A bug that inverted the zoom → pitch mapping would still pass a "smooth"
// test; these two lines catch it because they name the ends.

const pitchBird = pitchForZoom(0);
const pitchEye = pitchForZoom(1);
// bird's-eye pitch is helicopter-tilt (>60°) but not floorplan-nadir; the
// old 78° near-nadir read as a floorplan, not a photograph.
assert.ok(pitchBird > 1.0 && pitchBird < 1.35, "bird's-eye pitch is helicopter (60-78°); got " + (pitchBird * 180 / Math.PI));
assert.ok(pitchEye < 0.25, "eye-level pitch is near-horizon (<15°); got " + (pitchEye * 180 / Math.PI));
assert.ok(pitchBird > pitchEye, "pitch decreases as zoom climbs from bird's-eye to eye-level");

const distBird = distanceForZoom(0);
const distEye = distanceForZoom(1);
// Bird's-eye altitude tightened from 165 to keep the 80-unit city
// filling the frame rather than shrinking into a satellite thumbnail;
// still comfortably above the tallest tower.
assert.ok(distBird > 90, "bird's-eye distance is helicopter-altitude (>90 units); got " + distBird);
assert.ok(distEye < 40, "eye-level distance is near a tower (<40 units); got " + distEye);
assert.ok(distBird > distEye, "distance shrinks as zoom climbs");

// ——— monotone across the full axis ————————————————————————————————————————
// A cubic curve on distanceForZoom must be strictly decreasing over [0,1].
// The smoothstep in the module never overshoots, so any two samples with
// z1 > z0 must give d1 < d0. A regression here (a bump in the curve) is
// the "camera hesitates mid-pinch" bug this test names.

let prevPitch = Infinity;
let prevDist = Infinity;
for (let i = 0; i <= 40; i += 1) {
  const z = i / 40;
  const p = pitchForZoom(z);
  const d = distanceForZoom(z);
  assert.ok(p <= prevPitch + 1e-9,
    `pitchForZoom must be monotone non-increasing; z=${z} p=${p} prev=${prevPitch}`);
  assert.ok(d <= prevDist + 1e-9,
    `distanceForZoom must be monotone non-increasing; z=${z} d=${d} prev=${prevDist}`);
  prevPitch = p;
  prevDist = d;
}

// ——— clamp semantics ——————————————————————————————————————————————————————
// A visitor pinching past the natural travel must land at the endpoints,
// never past them — the camera has one axis and it clamps.

assert.equal(pitchForZoom(-1), pitchForZoom(0), "under-clamped zoom returns the bird's-eye pitch");
assert.equal(pitchForZoom(2), pitchForZoom(1), "over-clamped zoom returns the eye-level pitch");
assert.equal(distanceForZoom(-1), distanceForZoom(0), "under-clamped zoom returns the bird's-eye distance");
assert.equal(distanceForZoom(2), distanceForZoom(1), "over-clamped zoom returns the eye-level distance");

// ——— look-at Y rises with zoom-in ————————————————————————————————————————
// The camera's aim lifts off the ground as it zooms in so the horizon
// centers in the frame. A regression here (aim staying at y=0 at
// eye-level) would put the entire skyline in the upper half of the
// screen — the exact ugly-crop the coupling is designed to prevent.

// Bird's-eye aim was y=0.3 — the shadows on the pavement. Photographs of
// cities aim at the mass, not the floor. New default aims at short-building
// mid-height (2-3 units) at the bird's-eye end, still lifting toward
// mid-skyline (~7 units) at eye-level so the horizon centers the frame.
assert.ok(lookYForZoom(0) >= 1 && lookYForZoom(0) <= 4, "at bird's-eye we aim on the mass, not the ground");
assert.ok(lookYForZoom(1) > 4, "at eye-level we aim well above ground");
assert.ok(lookYForZoom(1) > lookYForZoom(0), "look-at Y rises with zoom-in");

// ——— normToWorld inverse geometry ————————————————————————————————————————
// The 48 plots live at normalized (0..1)²; they map to (-CITY_HALF..+CITY_HALF)²
// world coordinates centered at (0,0). A regression here would put the
// settlement off-center and the camera's default (0,0,0) target would
// miss it — a test that only spot-checked one point would miss the drift.

assert.equal(CITY_HALF, 40, "the settlement is a 80-unit square (CITY_HALF=40)");
{
  const c = normToWorld(0.5, 0.5);
  assert.equal(c.x, 0, "center of normalized space maps to world origin (x)");
  assert.equal(c.z, 0, "center of normalized space maps to world origin (z)");
}
{
  const ne = normToWorld(1, 0);
  assert.equal(ne.x, CITY_HALF, "east edge x = +CITY_HALF");
  assert.equal(ne.z, -CITY_HALF, "north edge z = -CITY_HALF");
}
{
  const sw = normToWorld(0, 1);
  assert.equal(sw.x, -CITY_HALF, "west edge x = -CITY_HALF");
  assert.equal(sw.z, CITY_HALF, "south edge z = +CITY_HALF");
}

// ——— camera constants (documented invariants) ————————————————————————————
// A change to FOV or clip planes is a change to how the room reads; the
// test names them so a future refactor states the intent, not the accident.

assert.equal(CAM_FOV, 42, "the FOV is the phone-lens FOV");
assert.ok(CAM_NEAR > 0 && CAM_NEAR < 5, "near plane is tight enough for street-level");
assert.ok(CAM_FAR > 500, "far plane reaches past the settlement + horizon");

console.log(
  "city-camera ok: pitch cliff 78°→8°, distance 165→22, monotone across the axis, " +
  "clamp holds at both ends, look-at Y rises with zoom-in, norm↔world maps center at origin.",
);
