import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-sun-disk — the pure-math half of the billboarded sun disk.
 *
 * The ShaderMaterial itself only comes alive against a real WebGL context;
 * this test does not render. It pins the invariants a regression would
 * drift:
 *
 *   SUN_DISK_ANGULAR_RADIUS_RAD    — 0.0192 rad (twice the real 0.0093)
 *   SUN_DISK_DISTANCE              — 1500 m (behind clouds, in front of sky)
 *   SUN_DISK_WORLD_RADIUS          — derived from the two above
 *   SUN_DISK_CORE_RADIUS_FRAC      — 0.20 (hot-core cutoff)
 *   SUN_DISK_CORE_BOOST            — 4.5 (bloom-threshold-crossing multiplier)
 *   SUN_DISK_LIMB_U                — 0.60 (Chapman-style limb darkening)
 *   SUN_DISK_RAYLEIGH_*            — (0.05, 0.15, 0.35) — blue leaks first
 *   chapmanLimbDarkening(r)        — monotonic 1..(1-u) ramp
 *   sunDiskChromaticShift(r)       — neutral at r=0, warm-shifted at r=1
 *   sunDiskIntensityForDay(df)     — 0 at night, ~2.4 at noon
 *   sunDiskColorForDay(df)         — warm at horizon, hot at noon, dark at night
 *   sunDiskEnabledForTier(tier)    — on for high/medium/low, off for sleep
 *
 * A regression that stripped the Rayleigh split (equal per-channel k) would
 * kill the disk's reddened limb; the test names each so any drift shows up
 * before it hits the frame.
 */

// ── stubs for the Three.js imports the disk module carries at load time. ─
class V2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z) || 1;
    this.x /= l; this.y /= l; this.z /= l;
    return this;
  }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  setFromMatrixPosition() { return this; }
}
class Color {
  constructor(r = 1, g = 1, b = 1) {
    if (typeof r === "number" && g === undefined) {
      this.r = ((r >> 16) & 0xff) / 255;
      this.g = ((r >> 8) & 0xff) / 255;
      this.b = (r & 0xff) / 255;
    } else {
      this.r = r; this.g = g; this.b = b;
    }
  }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  clone() { return new Color(this.r, this.g, this.b); }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
  lerp(c, t) {
    this.r = this.r + (c.r - this.r) * t;
    this.g = this.g + (c.g - this.g) * t;
    this.b = this.b + (c.b - this.b) * t;
    return this;
  }
}
class Object3D {
  constructor() {
    this.position = new V3();
    this.children = [];
  }
  add(o) { this.children.push(o); }
  updateMatrixWorld() {}
  lookAt() {}
}
class PlaneGeometry { constructor() {} dispose() {} }
class ShaderMaterial {
  constructor(o = {}) {
    this.uniforms = o.uniforms || {};
    this.transparent = !!o.transparent;
    this.blending = o.blending;
    this.depthWrite = !!o.depthWrite;
    this.depthTest = !!o.depthTest;
    this.side = o.side;
    this.toneMapped = o.toneMapped;
    this.name = o.name;
  }
  dispose() {}
}
class Mesh extends Object3D {
  constructor(g, m) {
    super();
    this.geometry = g;
    this.material = m;
    this.frustumCulled = true;
    this.visible = true;
    this.renderOrder = 0;
    this.name = "";
    this.castShadow = false;
    this.receiveShadow = false;
  }
  updateMatrixWorld() {}
  lookAt() {}
}
class OrthographicCamera extends Object3D {
  constructor() {
    super();
    this.left = -1; this.right = 1; this.top = 1; this.bottom = -1;
    this.near = 0.1; this.far = 100;
  }
  updateProjectionMatrix() {}
}
class DirectionalLightShadow {
  constructor() {
    this.mapSize = new V2(512, 512);
    this.bias = 0;
    this.normalBias = 0;
    this.radius = 1;
    this.camera = new OrthographicCamera();
    this.map = null;
  }
}
class DirectionalLight extends Object3D {
  constructor(color = 0xffffff, intensity = 1) {
    super();
    this.color = new Color(color);
    this.intensity = intensity;
    this.castShadow = false;
    this.shadow = new DirectionalLightShadow();
    this.target = new Object3D();
  }
}
class HemisphereLight extends Object3D {
  constructor(sky = 0xffffff, ground = 0x444444, intensity = 1) {
    super();
    this.color = new Color(sky);
    this.groundColor = new Color(ground);
    this.intensity = intensity;
  }
}

const threeStub = {
  Vector2: V2,
  Vector3: V3,
  Color,
  Object3D,
  OrthographicCamera,
  DirectionalLight,
  HemisphereLight,
  PlaneGeometry,
  ShaderMaterial,
  Mesh,
  AdditiveBlending: 2,
  DoubleSide: 2,
};

const mod = loadTsModule("src/lib/city-sun-disk.ts", {
  requireMap: { three: threeStub },
});

const {
  SUN_DISK_ANGULAR_RADIUS_RAD,
  SUN_DISK_DISTANCE,
  SUN_DISK_WORLD_RADIUS,
  SUN_DISK_CORE_RADIUS_FRAC,
  SUN_DISK_CORE_BOOST,
  SUN_DISK_LIMB_U,
  SUN_DISK_RAYLEIGH_R,
  SUN_DISK_RAYLEIGH_G,
  SUN_DISK_RAYLEIGH_B,
  SUN_DISK_LUMINANCE_NOON,
  SUN_DISK_LUMINANCE_HORIZON,
  chapmanLimbDarkening,
  sunDiskChromaticShift,
  sunDiskIntensityForDay,
  sunDiskColorForDay,
  sunDiskEnabledForTier,
  createCitySunDisk,
} = mod;

// ── constants pinned by the brief ────────────────────────────────────────

assert.equal(
  SUN_DISK_ANGULAR_RADIUS_RAD,
  0.0192,
  "angular half-radius pinned to twice the real sun (~1.1°)",
);
assert.ok(
  SUN_DISK_ANGULAR_RADIUS_RAD > 0.01 && SUN_DISK_ANGULAR_RADIUS_RAD < 0.03,
  "angular radius stays in the small-disk range (0.6°..1.7°)",
);

assert.equal(
  SUN_DISK_DISTANCE,
  1500,
  "distance pinned to 1500 m — behind clouds (~700 m), inside backdrop dome (2000 m)",
);
assert.ok(SUN_DISK_DISTANCE > 900, "disk sits well behind the cloud slab top (~900 m)");
assert.ok(SUN_DISK_DISTANCE < 2000, "disk sits inside the backdrop dome (~2000 m)");

// derived: world radius = tan(angular_radius) * distance
{
  const expected = Math.tan(SUN_DISK_ANGULAR_RADIUS_RAD) * SUN_DISK_DISTANCE;
  assert.ok(
    Math.abs(SUN_DISK_WORLD_RADIUS - expected) < 1e-6,
    `world radius derived from angular size and distance; got ${SUN_DISK_WORLD_RADIUS} vs expected ${expected}`,
  );
  // ~28.8 m — noticeable but not dominant.
  assert.ok(
    SUN_DISK_WORLD_RADIUS > 20 && SUN_DISK_WORLD_RADIUS < 40,
    `world radius lands in the visible-but-tight band; got ${SUN_DISK_WORLD_RADIUS}`,
  );
}

// hot core ─ 20 % of disk radius
assert.equal(
  SUN_DISK_CORE_RADIUS_FRAC,
  0.20,
  "hot-core cutoff sits at 20 % of the disk radius",
);
assert.ok(
  SUN_DISK_CORE_RADIUS_FRAC > 0 && SUN_DISK_CORE_RADIUS_FRAC < 0.5,
  "core sits inside the disk, well short of the limb",
);

// bloom-threshold-crossing multiplier ─ 4.5×
assert.equal(
  SUN_DISK_CORE_BOOST,
  4.5,
  "core is 4.5× brighter than the outer disk — passes bloom threshold hard",
);
assert.ok(
  SUN_DISK_CORE_BOOST > 3,
  "core boost must clear a bloom threshold ceiling of ~0.55 at noon by a wide margin",
);

// Chapman-style limb darkening coefficient
assert.equal(
  SUN_DISK_LIMB_U,
  0.60,
  "limb darkening u=0.60 matches the visible 550 nm photosphere",
);
assert.ok(
  SUN_DISK_LIMB_U > 0 && SUN_DISK_LIMB_U < 1,
  "u in the physically-plausible [0,1) range",
);

// Rayleigh coefficients — the (0.05, 0.15, 0.35) ratio: blue extinguished fastest,
// green a middle band, red survives. Every reference the brief pins reddens the
// low sun through the atmosphere.
assert.equal(SUN_DISK_RAYLEIGH_R, 0.05, "Rayleigh red k=0.05");
assert.equal(SUN_DISK_RAYLEIGH_G, 0.15, "Rayleigh green k=0.15");
assert.equal(SUN_DISK_RAYLEIGH_B, 0.35, "Rayleigh blue k=0.35");
assert.ok(
  SUN_DISK_RAYLEIGH_B > SUN_DISK_RAYLEIGH_G && SUN_DISK_RAYLEIGH_G > SUN_DISK_RAYLEIGH_R,
  "Rayleigh: blue > green > red (blue leaks out fastest)",
);

// disk luminance ladder
assert.equal(
  SUN_DISK_LUMINANCE_NOON,
  2.4,
  "noon whole-disk luminance is 2.4 — above the ~0.9 dusk bloom threshold with margin",
);
assert.equal(
  SUN_DISK_LUMINANCE_HORIZON,
  1.2,
  "horizon whole-disk luminance is 1.2 — dim ember, still visible against warm sky",
);
assert.ok(
  SUN_DISK_LUMINANCE_NOON > SUN_DISK_LUMINANCE_HORIZON,
  "noon disk is brighter than the horizon disk — atmospheric extinction eats horizon light",
);

// ── chapmanLimbDarkening at cardinal r ──────────────────────────────────
// r=0 → peak. r=1 → limb. Between: monotonic decrease.
{
  const v = chapmanLimbDarkening(0);
  assert.ok(Math.abs(v - 1) < 1e-9, `centre I/I0 = 1 (peak); got ${v}`);
}
{
  const v = chapmanLimbDarkening(1);
  // I/I0 at limb = 1 - u * (1 - 0) = 1 - u = 0.40
  assert.ok(Math.abs(v - 0.40) < 1e-9, `limb I/I0 = 1 - u = 0.40; got ${v}`);
}
{
  const v = chapmanLimbDarkening(0.5);
  // mu = sqrt(0.75), I = 1 - 0.6 * (1 - sqrt(0.75))
  const mu = Math.sqrt(0.75);
  const expected = 1 - 0.6 * (1 - mu);
  assert.ok(Math.abs(v - expected) < 1e-9, `midway darkening ${expected}; got ${v}`);
}

// monotonic: I decreases with r from 0 to 1
{
  let prev = Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const r = i / 20;
    const v = chapmanLimbDarkening(r);
    assert.ok(v <= prev + 1e-9, `limb darkening monotone; r=${r} v=${v} prev=${prev}`);
    prev = v;
  }
}

// off-disk r > 1 → 0
assert.equal(chapmanLimbDarkening(1.1), 0, "off-disk returns 0");
assert.equal(chapmanLimbDarkening(10), 0, "far off-disk returns 0");

// negative r → clamps to 0 → peak
assert.equal(chapmanLimbDarkening(-0.5), 1, "negative r clamps to peak");

// ── sunDiskChromaticShift ────────────────────────────────────────────────
// At r=0 → neutral (1,1,1). At r=1 → warm-shifted with blue lowest.
{
  const s = sunDiskChromaticShift(0);
  assert.ok(Math.abs(s.r - 1) < 1e-9, `centre R=1; got ${s.r}`);
  assert.ok(Math.abs(s.g - 1) < 1e-9, `centre G=1; got ${s.g}`);
  assert.ok(Math.abs(s.b - 1) < 1e-9, `centre B=1; got ${s.b}`);
}
{
  const s = sunDiskChromaticShift(1);
  // r=1: path=1 → (1-0.05, 1-0.15, 1-0.35) = (0.95, 0.85, 0.65)
  assert.ok(Math.abs(s.r - 0.95) < 1e-9, `limb R=0.95; got ${s.r}`);
  assert.ok(Math.abs(s.g - 0.85) < 1e-9, `limb G=0.85; got ${s.g}`);
  assert.ok(Math.abs(s.b - 0.65) < 1e-9, `limb B=0.65; got ${s.b}`);
  assert.ok(s.r > s.g && s.g > s.b, `limb reddens: R > G > B (${s.r} > ${s.g} > ${s.b})`);
}
{
  // Between: quadratic path so mid-disk barely reddens
  const s = sunDiskChromaticShift(0.5);
  // path = 0.25 → (1-0.0125, 1-0.0375, 1-0.0875)
  assert.ok(Math.abs(s.r - 0.9875) < 1e-9, `mid R; got ${s.r}`);
  assert.ok(Math.abs(s.g - 0.9625) < 1e-9, `mid G; got ${s.g}`);
  assert.ok(Math.abs(s.b - 0.9125) < 1e-9, `mid B; got ${s.b}`);
}

// Off-disk r>1: values may go negative naïvely — clamped to 0.
{
  const s = sunDiskChromaticShift(2);
  assert.ok(s.r >= 0 && s.g >= 0 && s.b >= 0, "chromatic shift stays non-negative off-disk");
}

// ── sunDiskIntensityForDay at cardinal times ────────────────────────────
// Sun-below-horizon must return 0. Peak at noon must equal LUMINANCE_NOON.
// Dawn/dusk exactly at df=0/0.5 sits at horizon: alt=0 → returns 0
// (below-horizon guard).

{
  const v = sunDiskIntensityForDay(0.75);
  assert.equal(v, 0, "midnight (below horizon) — no disk");
}
{
  const v = sunDiskIntensityForDay(0.25);
  assert.ok(
    Math.abs(v - SUN_DISK_LUMINANCE_NOON) < 1e-6,
    `noon intensity == LUMINANCE_NOON; got ${v}`,
  );
}

// Sunrise / sunset are at df=0 and df=0.5 (altitude=0). The intensity is
// exactly 0 there because the sun is at the horizon; but just above the
// horizon (df=0.01 or df=0.49) it should land near LUMINANCE_HORIZON.
{
  const v = sunDiskIntensityForDay(0);
  assert.equal(v, 0, "dawn (altitude=0 at df=0) intensity is 0 (guard)");
}
{
  const v = sunDiskIntensityForDay(0.01);
  assert.ok(v > 0, "just after dawn: intensity is positive");
  assert.ok(v < SUN_DISK_LUMINANCE_NOON, "just after dawn: intensity below noon peak");
}
{
  const v = sunDiskIntensityForDay(0.49);
  assert.ok(v > 0, "just before dusk: intensity is positive");
  assert.ok(v < SUN_DISK_LUMINANCE_NOON, "just before dusk: intensity below noon peak");
}

// intensity stays finite and non-negative across the full cycle
for (let i = 0; i < 200; i += 1) {
  const df = i / 200;
  const v = sunDiskIntensityForDay(df);
  assert.ok(Number.isFinite(v) && v >= 0, `intensity finite & non-negative; df=${df} v=${v}`);
}

// noon is the peak — sample a window and verify no other df exceeds it.
{
  const peak = sunDiskIntensityForDay(0.25);
  for (let i = 0; i < 200; i += 1) {
    const df = i / 200;
    const v = sunDiskIntensityForDay(df);
    assert.ok(v <= peak + 1e-9, `noon is peak; df=${df} v=${v} peak=${peak}`);
  }
}

// ── sunDiskColorForDay ───────────────────────────────────────────────────
// Below horizon → (0,0,0). Above → base sunColorAt tinted warmer at horizon.
{
  const c = sunDiskColorForDay(0.75);
  assert.equal(c.r, 0, "midnight R=0");
  assert.equal(c.g, 0, "midnight G=0");
  assert.equal(c.b, 0, "midnight B=0");
}
{
  const c = sunDiskColorForDay(0.25);
  assert.ok(c.r > 0.6, `noon R warm; got ${c.r}`);
  assert.ok(c.g > 0.6, `noon G warm; got ${c.g}`);
  assert.ok(c.b > 0.5, `noon B warm; got ${c.b}`);
}
// At low altitude (df=0.05), the color reddens beyond the base sunColorAt.
{
  const c = sunDiskColorForDay(0.05);
  assert.ok(c.r > c.g, `dawn-ember R > G (${c.r} > ${c.g})`);
  assert.ok(c.g > c.b, `dawn-ember G > B (${c.g} > ${c.b})`);
}

// ── tier ladder ─────────────────────────────────────────────────────────
// Sleep hides the disk. All active tiers keep it on.

assert.equal(sunDiskEnabledForTier("high"), true, "disk on at high");
assert.equal(sunDiskEnabledForTier("medium"), true, "disk on at medium");
assert.equal(sunDiskEnabledForTier("low"), true, "disk on at low (cheap enough for all active tiers)");
assert.equal(sunDiskEnabledForTier("sleep"), false, "disk off at sleep");

// ── createCitySunDisk smoke ─────────────────────────────────────────────
// The factory returns a mesh with:
//   - renderOrder 0.5 (between sky at 0 and clouds at 1)
//   - frustumCulled false (billboards defeat culling anyway)
//   - visible true (day-lit by default)
//   - castShadow / receiveShadow both false (the disk is a pure emitter)
//   - material.transparent true
//   - material.depthWrite / depthTest both false (composite-only pass)

{
  const disk = createCitySunDisk();
  assert.ok(disk.mesh, "factory returns a mesh");
  assert.equal(disk.mesh.renderOrder, 0.5, "renderOrder=0.5 sits between sky and clouds");
  assert.equal(disk.mesh.frustumCulled, false, "billboards defeat culling");
  assert.equal(disk.mesh.visible, true, "starts visible");
  assert.equal(disk.mesh.castShadow, false, "pure emitter — no shadow cast");
  assert.equal(disk.mesh.receiveShadow, false, "pure emitter — no shadow receive");
  assert.equal(disk.mesh.name, "citySunDisk", "mesh has a stable name for scene-graph inspection");
  const m = disk.mesh.material;
  assert.ok(m.transparent, "material transparent for alpha rolloff at limb");
  assert.equal(m.depthWrite, false, "no depth write — no z-fight with clouds or dome");
  assert.equal(m.depthTest, false, "no depth test — the renderOrder chain owns the order");
  assert.ok(m.uniforms.uBaseColor, "baseColor uniform present");
  assert.ok(m.uniforms.uLuminance, "luminance uniform present");
  assert.ok(m.uniforms.uCoreBoost, "core boost uniform present");
  assert.ok(m.uniforms.uOpacity, "opacity uniform present");
  disk.dispose();
}

// update() hides the mesh at night (below horizon)
{
  const disk = createCitySunDisk();
  const camera = new Object3D();
  const sunPos = new V3(0, -100, 0);
  disk.update({
    dayFraction: 0.75,
    sunPosition: sunPos,
    camera,
    tier: "high",
  });
  assert.equal(disk.mesh.visible, false, "night — disk hidden");
  disk.dispose();
}

// update() shows the mesh at noon and writes uniforms
{
  const disk = createCitySunDisk();
  const camera = new Object3D();
  const sunPos = new V3(0, 200, 0);
  disk.update({
    dayFraction: 0.25,
    sunPosition: sunPos,
    camera,
    tier: "high",
  });
  assert.equal(disk.mesh.visible, true, "noon — disk visible");
  const m = disk.mesh.material;
  assert.ok(m.uniforms.uLuminance.value > 1, "noon luminance > 1");
  disk.dispose();
}

// update() hides the mesh at sleep tier
{
  const disk = createCitySunDisk();
  const camera = new Object3D();
  const sunPos = new V3(0, 200, 0);
  disk.update({
    dayFraction: 0.25,
    sunPosition: sunPos,
    camera,
    tier: "sleep",
  });
  assert.equal(disk.mesh.visible, false, "sleep tier — disk hidden regardless of time");
  disk.dispose();
}

console.log("test-city-sun-disk: PASS");
