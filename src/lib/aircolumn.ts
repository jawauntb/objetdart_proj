/**
 * aircolumn — the air above the peak, weighed and read.
 *
 * The invariant of /atmosphere is a VERTICAL PROFILE: pressure and density
 * against altitude under one lapse rate, plus a wind field sheared across
 * the column. Everything the room shows or sounds is a representation of
 * that profile and nothing else.
 *
 * The load-bearing map is OPTICAL DEPTH → COLOUR. The sky is not painted:
 * each channel's extinction is Rayleigh's λ⁻⁴ against the *actual*
 * barometric column, integrated in closed form, so the blue overhead and
 * the red at a low sun are consequences of the same numbers the barometer
 * reads. The map is recoverable — `altitudeForPressure` inverts the
 * profile exactly, and `pressureForMidi` inverts the sound — so from the
 * colour of the sky you could, in principle, read the column back.
 *
 * Three things earn their keep:
 *
 *  - **The column integrates by hand.** In the troposphere density is a
 *    power law of altitude, above it an exponential; both antiderivatives
 *    are one line, so the optical depth along any straight ray is closed
 *    form and the renderer never marches the air. The check that keeps
 *    this honest is physical: the whole column's weight IS the sea-level
 *    pressure (τ ∝ P₀/ρ₀g), pinned in scripts/test-aircolumn.mjs.
 *  - **Stirring conserves.** Hand disturbances live in sine modes that
 *    each integrate to zero over the column, so one finger slides layers
 *    against each other but can never push net momentum into the sky.
 *  - **A bounded scatter.** The one loop in this file runs exactly
 *    SCATTER_STEPS times and reports its count, so the budget is a
 *    returned number rather than a promise.
 *
 * Altitudes in km, pressure in kPa, temperature in K. Pure math, no
 * imports, no DOM — node-testable (scripts/test-aircolumn.mjs). See
 * INSPIRATION.md §2.
 */

// ——— determinism ————————————————————————————————————————————————

export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) | 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ——— the standard column ————————————————————————————————————————

/** Sea-level pressure, kPa. */
export const P0_KPA = 101.325;
/** Sea-level temperature, K. */
export const T0_K = 288.15;
/** The stratosphere's floor temperature, K — where the lapse stops. */
export const T_STRAT_K = 216.65;
/** The lapse rate at rest, K per km. */
export const LAPSE_STD = 6.5;
/** The dry adiabat — no world-law may steepen the air past it. */
export const LAPSE_MAX = 9.8;
/** ...and a near-isothermal floor, so the column never inverts. */
export const LAPSE_MIN = 3.2;
export const G_MS2 = 9.80665;
export const M_AIR = 0.0289644; // kg/mol
export const R_GAS = 8.31446;
/** Where the room stops counting air — the Kármán line. */
export const TOP_KM = 100;

/** Sea-level density from the ideal gas law, kg/m³ (≈1.225). */
export const RHO0 = (P0_KPA * 1000 * M_AIR) / (R_GAS * T0_K);

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function clampLapse(lapse: number): number {
  return clamp(lapse, LAPSE_MIN, LAPSE_MAX);
}

/** Where the troposphere ends under this lapse rate, km. */
export function tropopauseKm(lapse = LAPSE_STD): number {
  return (T0_K - T_STRAT_K) / clampLapse(lapse);
}

/** The barometric exponent gM/RL — dimensionless, ≈5.256 at rest. */
export function barometricExponent(lapse = LAPSE_STD): number {
  return (G_MS2 * M_AIR) / (R_GAS * (clampLapse(lapse) / 1000));
}

/** Scale height of the isothermal stratosphere, km (≈6.34). */
export const H_STRAT_KM = (R_GAS * T_STRAT_K) / (G_MS2 * M_AIR) / 1000;

export function temperatureK(zKm: number, lapse = LAPSE_STD): number {
  const L = clampLapse(lapse);
  return Math.max(T_STRAT_K, T0_K - L * Math.max(0, zKm));
}

/**
 * Pressure at altitude: the power law up to the tropopause, exponential
 * above it, continuous at the join. The exact standard-atmosphere numbers
 * (22.632 kPa at 11 km) fall out rather than being put in.
 */
export function pressureKPa(zKm: number, lapse = LAPSE_STD): number {
  const L = clampLapse(lapse);
  const z = Math.max(0, zKm);
  const zt = tropopauseKm(L);
  const n = barometricExponent(L);
  if (z <= zt) return P0_KPA * Math.pow(1 - (L * z) / T0_K, n);
  const pTrop = P0_KPA * Math.pow(1 - (L * zt) / T0_K, n);
  return pTrop * Math.exp(-(z - zt) / H_STRAT_KM);
}

/** Density from pressure and temperature — never its own law. */
export function densityKgM3(zKm: number, lapse = LAPSE_STD): number {
  return (pressureKPa(zKm, lapse) * 1000 * M_AIR) / (R_GAS * temperatureK(zKm, lapse));
}

/** Density relative to sea level — the optical medium. */
export function relDensity(zKm: number, lapse = LAPSE_STD): number {
  return densityKgM3(zKm, lapse) / RHO0;
}

/**
 * The inverse of the profile: which altitude carries this pressure. This
 * existing (and round-tripping, in the tests) is what makes the colour a
 * reading and not a decoration — the column can be recovered.
 */
export function altitudeForPressure(pKPa: number, lapse = LAPSE_STD): number {
  const L = clampLapse(lapse);
  const p = clamp(pKPa, 1e-9, P0_KPA);
  const zt = tropopauseKm(L);
  const n = barometricExponent(L);
  const pTrop = P0_KPA * Math.pow(1 - (L * zt) / T0_K, n);
  if (p >= pTrop) return (T0_K / L) * (1 - Math.pow(p / P0_KPA, 1 / n));
  return zt + H_STRAT_KM * Math.log(pTrop / p);
}

// ——— the column, integrated by hand ——————————————————————————————
//
// In the troposphere ρ/ρ₀ = (1 − Lz/T₀)^(n−1): a power law, integrable in
// one line. Above, an exponential, likewise. So the equivalent column of
// sea-level air between any two altitudes is closed form, and along any
// straight ray the optical depth needs no sampling at all.

function tropoColumnAntideriv(z: number, L: number, n: number): number {
  // ∫(1 − Lz/T₀)^(n−1) dz = −(T₀/(Ln))(1 − Lz/T₀)^n
  return -((T0_K / (L * n)) * Math.pow(1 - (L * z) / T0_K, n));
}

/**
 * ∫ relDensity dz from z0 to z1 (z1 ≥ z0), in km of sea-level-equivalent
 * air. Piecewise across the tropopause, continuous at the join. The whole
 * column (0 → ∞) must weigh P₀/ρ₀g ≈ 8.43 km — the barometer's own number.
 */
export function columnKm(z0Km: number, z1Km: number, lapse = LAPSE_STD): number {
  const L = clampLapse(lapse);
  let a = Math.max(0, Math.min(z0Km, z1Km));
  let b = Math.max(0, Math.max(z0Km, z1Km));
  const zt = tropopauseKm(L);
  const n = barometricExponent(L);
  let sum = 0;
  if (a < zt) {
    const hi = Math.min(b, zt);
    sum += tropoColumnAntideriv(hi, L, n) - tropoColumnAntideriv(a, L, n);
    a = hi;
  }
  if (b > zt) {
    const lo = Math.max(a, zt);
    const rhoTrop = Math.pow(1 - (L * zt) / T0_K, n - 1);
    sum +=
      rhoTrop *
      H_STRAT_KM *
      (Math.exp(-(lo - zt) / H_STRAT_KM) - Math.exp(-(b - zt) / H_STRAT_KM));
  }
  return sum;
}

/**
 * Optical depths are clamped here — well past total darkness, and the
 * point is not physics: one Infinity loose in a colour pipeline paints a
 * region of the sky NaN-black.
 */
export const TAU_MAX = 60;

/** Below this |vertical component| a ray is treated as level. */
const DIRY_EPS = 1e-4;

/**
 * Sea-level-equivalent kilometres of air along a straight ray: start
 * altitude, vertical direction component, length. Closed form everywhere —
 * a slant path is the vertical column stretched by 1/|dirY|; a level path
 * is local density times distance.
 */
export function airPathKm(
  z0Km: number,
  dirY: number,
  distKm: number,
  lapse = LAPSE_STD,
): number {
  const d = Math.max(0, distKm);
  if (Math.abs(dirY) < DIRY_EPS) return relDensity(z0Km, lapse) * d;
  const z1 = z0Km + dirY * d;
  return columnKm(z0Km, z1, lapse) / Math.abs(dirY);
}

// ——— Rayleigh, and the haze under it ————————————————————————————

/** The three wavelengths the room sees by, nm. */
export const LAMBDA_NM: readonly [number, number, number] = [680, 550, 440];
/** Sea-level Rayleigh extinction at 550 nm, per km. */
export const BETA_R_550 = 0.0135;

/** λ⁻⁴: the reason the sky is blue, as arithmetic. */
export function rayleighBeta(lambdaNm: number): number {
  const r = 550 / lambdaNm;
  return BETA_R_550 * r * r * r * r;
}

/** Per-channel Rayleigh extinction (r, g, b), per km at sea level. */
export const BETA_R: readonly [number, number, number] = [
  rayleighBeta(LAMBDA_NM[0]),
  rayleighBeta(LAMBDA_NM[1]),
  rayleighBeta(LAMBDA_NM[2]),
];

/** The aerosol haze hugs the ground on its own short scale height. */
export const HAZE_SCALE_KM = 1.2;
/** Haze extinction per km at sea level, per unit of the room's haze law. */
export const BETA_HAZE = 0.02;

/** Sea-level-equivalent km of HAZE along a ray — its own exponential. */
export function hazePathKm(z0Km: number, dirY: number, distKm: number): number {
  const d = Math.max(0, distKm);
  const H = HAZE_SCALE_KM;
  const e0 = Math.exp(-Math.max(0, z0Km) / H);
  if (Math.abs(dirY) < DIRY_EPS) return e0 * d;
  const e1 = Math.exp(-Math.max(0, z0Km + dirY * d) / H);
  return Math.abs((H / dirY) * (e0 - e1));
}

export type RGB = [number, number, number];

/**
 * τ per channel over a path, written into `out` — the allocation-free twin
 * of `opticalDepthRGB`, used by the scatter loop below so a single ray
 * sample doesn't cost a fresh array per channel-pass.
 */
function opticalDepthRGBInto(
  out: RGB,
  z0Km: number,
  dirY: number,
  distKm: number,
  lapse: number,
  haze: number,
): void {
  const air = airPathKm(z0Km, dirY, distKm, lapse);
  const hz = hazePathKm(z0Km, dirY, distKm) * Math.max(0, haze) * BETA_HAZE;
  out[0] = Math.min(TAU_MAX, BETA_R[0] * air + hz);
  out[1] = Math.min(TAU_MAX, BETA_R[1] * air + hz);
  out[2] = Math.min(TAU_MAX, BETA_R[2] * air + hz);
}

/** τ per channel over a path, Rayleigh + haze, capped against NaN. */
export function opticalDepthRGB(
  z0Km: number,
  dirY: number,
  distKm: number,
  lapse = LAPSE_STD,
  haze = 1,
): RGB {
  const out: RGB = [0, 0, 0];
  opticalDepthRGBInto(out, z0Km, dirY, distKm, lapse, haze);
  return out;
}

/** The allocation-free twin of `transmittanceRGB` — writes into `out`. */
function transmittanceRGBInto(
  out: RGB,
  z0Km: number,
  dirY: number,
  distKm: number,
  lapse: number,
  haze: number,
): void {
  opticalDepthRGBInto(out, z0Km, dirY, distKm, lapse, haze);
  out[0] = Math.exp(-out[0]);
  out[1] = Math.exp(-out[1]);
  out[2] = Math.exp(-out[2]);
}

/** What survives the path, per channel: 1 clear, 0 drowned. */
export function transmittanceRGB(
  z0Km: number,
  dirY: number,
  distKm: number,
  lapse = LAPSE_STD,
  haze = 1,
): RGB {
  const out: RGB = [0, 0, 0];
  transmittanceRGBInto(out, z0Km, dirY, distKm, lapse, haze);
  return out;
}

/**
 * The sun's own colour after the column: its transmittance from altitude z
 * toward elevation `sunElev` (radians). Near the horizon the path length
 * multiplies and λ⁻⁴ takes the blue first — sunset red is subtraction,
 * not paint. dirY is floored so a sun *below* the horizon reads as the
 * longest path there is, not a negative one.
 */
export function sunTransmitRGB(
  zKm: number,
  sunElev: number,
  lapse = LAPSE_STD,
  haze = 1,
): RGB {
  const out: RGB = [0, 0, 0];
  sunTransmitRGBInto(out, zKm, sunElev, lapse, haze);
  return out;
}

/** The allocation-free twin of `sunTransmitRGB` — writes into `out`. */
function sunTransmitRGBInto(
  out: RGB,
  zKm: number,
  sunElev: number,
  lapse: number,
  haze: number,
): void {
  const dirY = Math.max(0.015, Math.sin(sunElev));
  const dist = (TOP_KM - Math.min(zKm, TOP_KM - 1)) / dirY;
  transmittanceRGBInto(out, zKm, dirY, dist, lapse, haze);
}

// ——— the sky, scattered once ————————————————————————————————————

/** The one loop's budget, stated before the loop was written. */
export const SCATTER_STEPS = 14;
/** How far a level ray looks before the room stops caring, km. */
export const VIEW_RANGE_KM = 220;
/** Sun strength feeding the scatter — a tuning, not a law. */
export const SUN_INTENSITY = 20;
/** Henyey–Greenstein anisotropy for the haze. */
export const HAZE_G = 0.6;

export function rayleighPhase(cosTheta: number): number {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}

export function hazePhase(cosTheta: number): number {
  const g = HAZE_G;
  const denom = 1 + g * g - 2 * g * cosTheta;
  return (1 - g * g) / (4 * Math.PI * Math.pow(Math.max(1e-4, denom), 1.5));
}

export type SkySample = {
  rgb: RGB;
  /** Samples spent — the budget, reported rather than promised. */
  steps: number;
};

/**
 * Single-scattered radiance at altitude z looking along a ray with
 * vertical component dirY, where cosTheta is the angle the ray makes with
 * the sun. Exactly SCATTER_STEPS midpoint samples; every transmittance
 * inside is closed form, so the cost is the budget and nothing else.
 */
export function skyColor(
  zKm: number,
  dirY: number,
  cosTheta: number,
  sunElev: number,
  lapse = LAPSE_STD,
  haze = 1,
): SkySample {
  // How far this ray runs before it leaves the air (or the frame).
  let dist = VIEW_RANGE_KM;
  if (dirY > DIRY_EPS) dist = Math.min(dist, (TOP_KM - Math.min(zKm, TOP_KM)) / dirY || 0);
  else if (dirY < -DIRY_EPS) dist = Math.min(dist, Math.max(0.5, zKm / -dirY));
  const dt = dist / SCATTER_STEPS;
  const pR = rayleighPhase(cosTheta);
  const pM = hazePhase(cosTheta);
  const out: RGB = [0, 0, 0];
  // Reused across every scatter step below instead of asking
  // transmittanceRGB/sunTransmitRGB for a fresh triple each time — same
  // values, SCATTER_STEPS× fewer short-lived arrays per call.
  const toEye: RGB = [0, 0, 0];
  const fromSun: RGB = [0, 0, 0];
  let steps = 0;
  for (let i = 0; i < SCATTER_STEPS; i++) {
    steps++;
    const t = (i + 0.5) * dt;
    const zi = Math.max(0, zKm + dirY * t);
    const rho = relDensity(zi, lapse);
    const hzD = Math.max(0, haze) * Math.exp(-zi / HAZE_SCALE_KM);
    transmittanceRGBInto(toEye, zKm, dirY, t, lapse, haze);
    sunTransmitRGBInto(fromSun, zi, sunElev, lapse, haze);
    // Night falls in the scatter itself: below the horizon the direct term
    // is already extinguished by the long path; this floor only keeps the
    // arithmetic finite.
    for (let c = 0; c < 3; c++) {
      const sigma = BETA_R[c] * rho * pR + BETA_HAZE * hzD * pM;
      out[c] += toEye[c] * sigma * fromSun[c] * SUN_INTENSITY * dt;
    }
  }
  return { rgb: out, steps };
}

/** Radiance → displayable 0..1, softly — the film curve of the room. */
export function tonemap(x: number, exposure = 1): number {
  return 1 - Math.exp(-Math.max(0, x) * exposure);
}

// ——— the wind, sheared and conserving ————————————————————————————
//
// The base wind is the world's: calm at the ground, a jet where the
// tropopause is (so the lapse-rate law literally moves the wind), thinning
// above. Hand disturbances live in sine modes over the column, each of
// which integrates to zero — stirring slides layers against each other but
// can never give the whole sky net momentum.

/** Surface drift, arbitrary drift units. */
export const WIND_SURF = 0.12;
/** The jet's strength over the surface drift. */
export const WIND_JET = 1.0;
/** How wide the jet stands about the tropopause, km. */
export const JET_WIDTH_KM = 5.5;
/** How many sine modes a hand can ring. */
export const WIND_MODES = 6;
/** How hard one stir may ring the column, per mode. */
export const STIR_MAX = 0.9;

/** The undisturbed wind at altitude z. Peaks at the tropopause. */
export function baseWind(zKm: number, lapse = LAPSE_STD): number {
  const zt = tropopauseKm(lapse);
  const u = (Math.max(0, zKm) - zt) / JET_WIDTH_KM;
  const fade = 1 - Math.min(1, Math.max(0, zKm - zt) / (TOP_KM - zt)) * 0.55;
  return (WIND_SURF + WIND_JET * Math.exp(-u * u)) * fade;
}

/** d(baseWind)/dz, exactly — the shear the streaks stretch by. */
export function baseShear(zKm: number, lapse = LAPSE_STD): number {
  const zt = tropopauseKm(lapse);
  const z = Math.max(0, zKm);
  const u = (z - zt) / JET_WIDTH_KM;
  const g = Math.exp(-u * u);
  const above = Math.max(0, z - zt);
  const fade = 1 - Math.min(1, above / (TOP_KM - zt)) * 0.55;
  const dFade = z > zt && above < TOP_KM - zt ? -0.55 / (TOP_KM - zt) : 0;
  const core = WIND_SURF + WIND_JET * g;
  const dCore = WIND_JET * g * (-2 * u) / JET_WIDTH_KM;
  return dCore * fade + core * dFade;
}

/** Mode shapes: whole periods over the column, so each integrates to 0. */
export function modeShape(n: number, zKm: number): number {
  return Math.sin((2 * Math.PI * (n + 1) * zKm) / TOP_KM);
}

/** The hand's part of the wind: Σ aₙ·shapeₙ(z). */
export function perturbationAt(zKm: number, amps: readonly number[]): number {
  let v = 0;
  for (let n = 0; n < Math.min(WIND_MODES, amps.length); n++) {
    v += amps[n] * modeShape(n, zKm);
  }
  return v;
}

/** d(perturbation)/dz, exactly. */
export function perturbationShear(zKm: number, amps: readonly number[]): number {
  let v = 0;
  for (let n = 0; n < Math.min(WIND_MODES, amps.length); n++) {
    const k = (2 * Math.PI * (n + 1)) / TOP_KM;
    v += amps[n] * k * Math.cos(k * zKm);
  }
  return v;
}

/**
 * One stir at altitude z0: each mode receives the impulse in proportion to
 * its own value there (a point disturbance projected onto the basis), so
 * the wind at z0 moves the way the finger moved, and the column's integral
 * stays exactly zero because every shape's already is.
 */
export function stirImpulse(z0Km: number, strength: number): number[] {
  const s = clamp(strength, -1, 1);
  const out: number[] = [];
  for (let n = 0; n < WIND_MODES; n++) {
    out.push(clamp(s * modeShape(n, z0Km) * (1 / (1 + n * 0.6)), -STIR_MAX, STIR_MAX));
  }
  return out;
}

export function windAt(zKm: number, amps: readonly number[], lapse = LAPSE_STD): number {
  return baseWind(zKm, lapse) + perturbationAt(zKm, amps);
}

export function shearAt(zKm: number, amps: readonly number[], lapse = LAPSE_STD): number {
  return baseShear(zKm, lapse) + perturbationShear(zKm, amps);
}

// ——— pressure as register ————————————————————————————————————————
//
// The second map: the column heard. Pitch follows the logarithm of
// pressure — the ground answers deep, the thin air high — and the map is
// invertible, so a note names an altitude as surely as a colour does.

export const MIDI_GROUND = 36;
export const MIDI_TOP = 88;
/** Decades of pressure between the ground and the silence at the top. */
export const PRESSURE_DECADES = 6.5;

export function midiForPressure(pKPa: number): number {
  const p = clamp(pKPa, P0_KPA * Math.pow(10, -PRESSURE_DECADES), P0_KPA);
  const u = (Math.log10(P0_KPA) - Math.log10(p)) / PRESSURE_DECADES;
  return MIDI_GROUND + u * (MIDI_TOP - MIDI_GROUND);
}

export function pressureForMidi(midi: number): number {
  const u = clamp((midi - MIDI_GROUND) / (MIDI_TOP - MIDI_GROUND), 0, 1);
  return P0_KPA * Math.pow(10, -u * PRESSURE_DECADES);
}

// ——— the haze banks, seeded like the aerosols lie ————————————————

export const HAZE_BANKS = 7;
/** No bank sits above this: aerosols are a ground phenomenon. */
export const BANK_CEIL_KM = 26;

/**
 * Deterministic bank altitudes, distributed by the haze's own exponential
 * (inverse-CDF), so where the banks gather IS where the aerosol is. Sorted
 * ascending; same seed, same sky.
 */
export function hazeBankAltitudes(seed: number, count = HAZE_BANKS): number[] {
  const rng = mulberry32(hashSeed(seed, 0x0a72));
  const H = HAZE_SCALE_KM * 2.6;
  const span = 1 - Math.exp(-BANK_CEIL_KM / H);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = (i + 0.18 + rng() * 0.64) / count;
    out.push(-H * Math.log(1 - u * span));
  }
  return out.sort((a, b) => a - b);
}

// ——— the lens: isobars ————————————————————————————————————————

/** The pressures the raised lens draws, kPa — crowding near the ground. */
export const ISOBARS_KPA: readonly number[] = [90, 70, 50, 30, 20, 10, 5, 2, 1, 0.4, 0.1, 0.02];

// ——— moist thermodynamics: why a parcel becomes a cloud ——————————
//
// The room's objects are not sprites: a press lifts a PARCEL of the air
// standing there, carrying the column's humidity with it. Lifted, it cools
// on the dry adiabat (9.8 K/km) — always faster than the environment, so it
// is heavy and would sink back — until its own vapour saturates. That
// altitude is the LIFTING CONDENSATION LEVEL, and it is where the parcel
// becomes visible: cloud base. Above it the released latent heat slows the
// cooling to the moist adiabat, so the parcel can find itself WARMER than
// the air around it and rise on its own. It stops at the EQUILIBRIUM LEVEL,
// where the two temperatures cross again, and spreads there.
//
// Every part of that is a consequence of the same column the colour reads,
// which is the point: the three-finger law steepens the lapse rate, and the
// clouds a hand makes get taller because the column genuinely became less
// stable. Cloud base and cloud top are computed, never chosen.

/** Latent heat of vaporisation, J/kg. */
export const L_VAP = 2.501e6;
/** Gas constant for dry air, J/(kg·K). */
export const R_DRY = 287.058;
/** Gas constant for water vapour, J/(kg·K). */
export const R_VAP = 461.5;
/** Specific heat of dry air at constant pressure, J/(kg·K). */
export const CP_DRY = 1004.7;
/** Mᵥ/M_d — the molecular weight ratio, ≈0.622. */
export const EPSILON_W = R_DRY / R_VAP;
/** The dry adiabat, K/km: g/cₚ. A parcel lifted dry cools at exactly this. */
export const LAPSE_DRY = (G_MS2 / CP_DRY) * 1000;

/**
 * Saturation vapour pressure over water, kPa (Tetens). Superexponential in
 * temperature — this single curve is why warm air can hold cloud and cold
 * air cannot, and why cloud base drops as the ground moistens.
 */
export function saturationVaporKPa(TK: number): number {
  const tc = TK - 273.15;
  return 0.61078 * Math.exp((17.27 * tc) / (tc + 237.3));
}

/** Saturation mixing ratio at a pressure and temperature, kg/kg. */
export function satMixingRatio(pKPa: number, TK: number): number {
  const es = Math.min(saturationVaporKPa(TK), pKPa * 0.98);
  return (EPSILON_W * es) / Math.max(1e-6, pKPa - es);
}

/** The dew point of air at this pressure carrying this mixing ratio, K. */
export function dewPointK(pKPa: number, w: number): number {
  const e = clamp((pKPa * Math.max(1e-12, w)) / (EPSILON_W + Math.max(1e-12, w)), 1e-9, pKPa);
  const ln = Math.log(e / 0.61078);
  return 273.15 + (237.3 * ln) / (17.27 - ln);
}

/**
 * The saturated adiabatic lapse rate, K/km — the moist adiabat. Strictly
 * gentler than the dry one wherever there is any vapour at all, and it
 * relaxes back toward the dry adiabat in cold, thin air where there is
 * nothing left to condense.
 */
export function moistLapseKKm(TK: number, pKPa: number): number {
  const ws = satMixingRatio(pKPa, TK);
  const num = 1 + (L_VAP * ws) / (R_DRY * TK);
  const den = 1 + (L_VAP * L_VAP * ws * EPSILON_W) / (CP_DRY * R_DRY * TK * TK);
  return LAPSE_DRY * (num / den);
}

/** The bisection budget for the condensation level — stated, then spent. */
export const LCL_STEPS = 34;

export type LiftResult = {
  /** Cloud base, km. Equals the release altitude when the air is saturated. */
  lclKm: number;
  /** The parcel's conserved mixing ratio, kg/kg. */
  w: number;
  /** Iterations spent — the budget reported rather than promised. */
  steps: number;
};

/**
 * Lift the air standing at z0 and find where it saturates. Relative
 * humidity is the room's own moisture law (the season, turned by three
 * fingers); the temperature and pressure are the column's. `dTK` is the
 * warmth the hand put into the parcel — the sun-heated ground under a long
 * press — which it carries up without gaining any vapour, so a warmer
 * parcel makes its cloud *higher*, never sooner.
 */
export function liftToCondensation(
  z0Km: number,
  rh: number,
  lapse = LAPSE_STD,
  dTK = 0,
): LiftResult {
  const z0 = clamp(z0Km, 0, TOP_KM);
  const h = clamp(rh, 0.01, 1);
  const Te0 = temperatureK(z0, lapse);
  const T0 = Te0 + Math.max(0, dTK);
  const p0 = pressureKPa(z0, lapse);
  const w = h * satMixingRatio(p0, Te0);
  // saturated already, and unwarmed: the cloud starts in the hand
  if (h >= 0.999 && dTK <= 0) return { lclKm: z0, w, steps: 0 };
  const excess = (z: number) => {
    const Tp = T0 - LAPSE_DRY * (z - z0);
    return satMixingRatio(pressureKPa(z, lapse), Tp) - w;
  };
  let lo = z0;
  let hi = Math.min(TOP_KM, z0 + 22);
  let steps = 0;
  if (excess(hi) > 0) return { lclKm: hi, w, steps: 1 }; // never saturates in range
  for (let i = 0; i < LCL_STEPS; i++) {
    steps++;
    const mid = (lo + hi) / 2;
    if (excess(mid) > 0) lo = mid;
    else hi = mid;
  }
  return { lclKm: (lo + hi) / 2, w, steps };
}

/** The parcel's ascent budget above cloud base — bounded, in steps. */
export const ASCENT_STEPS = 64;
/** How far the ascent integrator will follow a parcel, km. */
export const ASCENT_SPAN_KM = 32;

export type AscentResult = {
  lclKm: number;
  /**
   * The level of free convection: where the lifted parcel first becomes
   * warmer than the air around it. Below this it is heavy and must be
   * pushed — which is what the hand's press is doing. null when the column
   * never lets it go free.
   */
  lfcKm: number | null;
  /** Where the parcel's temperature meets the column's again, km. */
  elKm: number;
  /** Temperature at cloud base, K. */
  baseTK: number;
  /** Peak positive buoyancy along the ascent, m/s² — the room's vigour. */
  peakBuoyancy: number;
  steps: number;
};

/**
 * Follow a parcel released at z0 to where it stops. Below the condensation
 * level it cools on the dry adiabat and is always heavy. Above, on the
 * moist adiabat, it is *still* heavy for a while — the column started
 * warmer — and only past the level of free convection does it rise on its
 * own, to the equilibrium level where the two temperatures meet again.
 *
 * That gap is the whole mechanic of the room's objects: a short press lifts
 * a parcel a little way and it sinks back as a puff; a press long enough to
 * push it past the LFC lets go of a tower that builds itself.
 */
export function liftParcel(
  z0Km: number,
  rh: number,
  lapse = LAPSE_STD,
  dTK = 0,
): AscentResult {
  const L = clampLapse(lapse);
  const { lclKm } = liftToCondensation(z0Km, rh, L, dTK);
  const z0 = clamp(z0Km, 0, TOP_KM);
  const baseTK = temperatureK(z0, L) + Math.max(0, dTK) - LAPSE_DRY * (lclKm - z0);
  const dz = ASCENT_SPAN_KM / ASCENT_STEPS;
  let z = lclKm;
  let Tp = baseTK;
  let peak = 0;
  let lfc: number | null = null;
  let el = lclKm;
  let steps = 0;
  for (let i = 0; i < ASCENT_STEPS; i++) {
    steps++;
    const zNext = Math.min(TOP_KM, z + dz);
    const Tnext = Tp - moistLapseKKm(Tp, pressureKPa(z, L)) * (zNext - z);
    const Te = temperatureK(zNext, L);
    const b = (G_MS2 * (Tnext - Te)) / Te;
    z = zNext;
    Tp = Tnext;
    if (b > 0) {
      if (lfc === null) lfc = z;
      if (b > peak) peak = b;
      el = z;
    } else if (lfc !== null) {
      break; // free ascent is over: the column has caught up
    }
    if (z >= TOP_KM) break;
  }
  return { lclKm, lfcKm: lfc, elKm: el, baseTK, peakBuoyancy: peak, steps };
}

// ——— parcels: how the made things live, merge, and die ——————————

/**
 * How wide the frame's column stands, km — the horizontal address, and the
 * room's own place on the axis: 10^5 m across, the middle of the atmosphere
 * band, so the hundred kilometres of air are as wide as they are deep.
 */
export const FRAME_KM = 110;
/** No more parcels than this may live at once. */
export const MAX_PARCELS = 10;
/** A parcel below this mass has dissipated and is removed. */
export const PARCEL_MIN_MASS = 0.06;

export type Parcel = {
  id: number;
  /** Horizontal position across the frame, km. */
  xKm: number;
  /** Altitude of the parcel's centre, km. */
  zKm: number;
  /** Cloud base and ceiling, from the column — not chosen. */
  lclKm: number;
  elKm: number;
  /** Condensed mass, arbitrary units; radius follows from it. */
  mass: number;
  /** Rotation the hand wound into it, rad/s. */
  spin: number;
  /** Vertical velocity, km/s. */
  w: number;
  seed: number;
  born: number;
};

/**
 * A parcel's radius from its mass — volume adds, so radius goes as the cube
 * root. The scale is a cumulus one: a fresh parcel is a couple of kilometres
 * across and a fed one reaches the ten a real tower has.
 */
export const PARCEL_RADIUS_SCALE = 4.0;
export function parcelRadiusKm(mass: number): number {
  return PARCEL_RADIUS_SCALE * Math.cbrt(Math.max(0, mass));
}

/** Two parcels touch when their radii overlap. */
export function parcelsTouch(a: Parcel, b: Parcel): boolean {
  const dx = a.xKm - b.xKm;
  const dz = a.zKm - b.zKm;
  const r = parcelRadiusKm(a.mass) + parcelRadiusKm(b.mass);
  return dx * dx + dz * dz < r * r;
}

/**
 * Two clouds that meet become one: mass adds, and every other quantity is
 * the mass-weighted mean, so the merged parcel sits at the centre of mass
 * and carries the summed momentum. Nothing is created by the meeting and
 * nothing is lost — which is the only reason a hand can trust the sky.
 */
export function mergeParcels(a: Parcel, b: Parcel): Parcel {
  const m = a.mass + b.mass;
  const wa = a.mass / m;
  const wb = b.mass / m;
  return {
    id: a.born <= b.born ? a.id : b.id,
    xKm: a.xKm * wa + b.xKm * wb,
    zKm: a.zKm * wa + b.zKm * wb,
    lclKm: a.lclKm * wa + b.lclKm * wb,
    elKm: Math.max(a.elKm, b.elKm),
    mass: m,
    spin: a.spin * wa + b.spin * wb,
    w: a.w * wa + b.w * wb,
    seed: a.born <= b.born ? a.seed : b.seed,
    born: Math.min(a.born, b.born),
  };
}

/**
 * What a parcel loses each second: entrainment of dry air at its edges
 * (surface-to-volume, so small clouds die fastest), plus the shear it is
 * standing in tearing it apart. A cloud in still, moist air is nearly
 * immortal; a cloud in the jet does not last a minute.
 */
export function dissipationRate(mass: number, shear: number, rh: number): number {
  const r = Math.max(0.2, parcelRadiusKm(mass));
  const dryness = 1 - clamp(rh, 0, 1);
  return (0.04 + 0.16 * dryness) / r + Math.abs(shear) * 0.9;
}
