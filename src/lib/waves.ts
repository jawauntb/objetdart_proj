/**
 * Renderer-independent wave and spectral laws shared by the web rooms and
 * native reference fixtures. Every operation is deterministic: callers own
 * their buffers, clocks, and presentation cadence.
 */

export const TAU = Math.PI * 2;

export type WaveMode = "ripple" | "string" | "refraction";
export type FourierPreset = "square" | "saw" | "triangle" | "pulse";

export type Harmonic = {
  n: number;
  r: number;
  sign: number;
  hue: string;
};

export type EpicyclePoint = Harmonic & {
  x: number;
  y: number;
};

export type Complex = {
  re: number;
  im: number;
};

const HARMONIC_PALETTE = ["#f1d77c", "#66d4c9", "#ff7f8f", "#92a7ff", "#f0a45e", "#8fe1aa"] as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** The stationary slow band used by the refraction tank. */
export function refractionSpeedAt(row: number, height: number): number {
  const fy = row / Math.max(1, height);
  return 0.42 + 0.58 * (1 - clamp((fy - 0.3) / 0.6, 0, 1));
}

export function fillRefractionSpeedField(field: Float32Array, width: number, height: number): void {
  if (field.length !== width * height) {
    throw new Error("refraction field dimensions do not match its buffer");
  }
  for (let y = 0; y < height; y += 1) {
    const speed = refractionSpeedAt(y, height);
    field.fill(speed, y * width, (y + 1) * width);
  }
}

/**
 * One centered finite-difference update of u_tt = c²∇²u with fixed edges.
 * `current` and `previous` remain inputs; `next` receives the authoritative
 * result, allowing renderers to swap preallocated buffers without churn.
 */
export function advanceWave2DInto({
  current,
  previous,
  next,
  width,
  height,
  cSquared,
  damping,
  speedField,
}: {
  current: Float32Array;
  previous: Float32Array;
  next: Float32Array;
  width: number;
  height: number;
  cSquared: number;
  damping: number;
  speedField?: Float32Array;
}): void {
  const length = width * height;
  if (current.length !== length || previous.length !== length || next.length !== length ||
    (speedField && speedField.length !== length)) {
    throw new Error("wave field dimensions do not match their buffers");
  }
  // Fixed boundaries must stay zero even if a caller reuses `previous` as
  // `next` (the web integrator does, to keep two buffers total).
  next.fill(0, 0, width);
  next.fill(0, (height - 1) * width, length);
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    next[row] = 0;
    next[row + width - 1] = 0;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const laplacian = current[i - 1] + current[i + 1] + current[i - width] + current[i + width] - 4 * current[i];
      const localSpeed = speedField ? speedField[i] : 1;
      next[i] = (2 * current[i] - previous[i] + cSquared * localSpeed * laplacian) * damping;
    }
  }
}

/** One centered finite-difference update of a string fixed at both ends. */
export function advanceString1DInto({
  current,
  previous,
  next,
  cSquared,
  damping,
}: {
  current: Float32Array;
  previous: Float32Array;
  next: Float32Array;
  cSquared: number;
  damping: number;
}): void {
  if (current.length !== previous.length || current.length !== next.length) {
    throw new Error("string buffers must have equal length");
  }
  next[0] = 0;
  next[next.length - 1] = 0;
  for (let i = 1; i < current.length - 1; i += 1) {
    const laplacian = current[i - 1] + current[i + 1] - 2 * current[i];
    next[i] = (2 * current[i] - previous[i] + cSquared * laplacian) * damping;
  }
}

/** The exact Fourier component law drawn by the circularity instrument. */
export function harmonicFor(preset: FourierPreset, index: number, breath: number): Harmonic {
  const hue = HARMONIC_PALETTE[index % HARMONIC_PALETTE.length];
  if (preset === "saw") {
    const n = index + 1;
    return { n, r: 88 / n, sign: index % 2 ? -1 : 1, hue };
  }
  if (preset === "triangle") {
    const n = index * 2 + 1;
    return { n, r: 112 / (n * n), sign: index % 2 ? -1 : 1, hue };
  }
  if (preset === "pulse") {
    const n = index + 1;
    const duty = 0.34 + Math.sin(breath * TAU) * 0.08;
    const signed = 108 * (Math.sin(Math.PI * n * duty) / (Math.PI * n));
    return { n, r: Math.abs(signed), sign: signed < 0 ? -1 : 1, hue };
  }
  const n = index * 2 + 1;
  return { n, r: 80 / n, sign: 1, hue };
}

export function epicycleChain(preset: FourierPreset, terms: number, theta: number, breath: number): EpicyclePoint[] {
  let x = 0;
  let y = 0;
  const chain: EpicyclePoint[] = [{ x, y, n: 0, r: 0, sign: 1, hue: "#f1d77c" }];
  for (let index = 0; index < terms; index += 1) {
    const harmonic = harmonicFor(preset, index, breath);
    const drift = Math.sin(breath * TAU + index * 0.7) * 0.035;
    const angle = theta * harmonic.n * harmonic.sign + drift;
    x += Math.cos(angle) * harmonic.r;
    y += Math.sin(angle) * harmonic.r;
    chain.push({ ...harmonic, x, y });
  }
  return chain;
}

/** Allocation-free y projection of the final epicycle point. */
export function epicycleTipY(preset: FourierPreset, terms: number, theta: number, breath: number): number {
  let y = 0;
  const duty = preset === "pulse" ? 0.34 + Math.sin(breath * TAU) * 0.08 : 0;
  for (let index = 0; index < terms; index += 1) {
    let n: number;
    let radius: number;
    let sign: number;
    if (preset === "saw") {
      n = index + 1;
      radius = 88 / n;
      sign = index % 2 ? -1 : 1;
    } else if (preset === "triangle") {
      n = index * 2 + 1;
      radius = 112 / (n * n);
      sign = index % 2 ? -1 : 1;
    } else if (preset === "pulse") {
      n = index + 1;
      const signed = 108 * (Math.sin(Math.PI * n * duty) / (Math.PI * n));
      radius = Math.abs(signed);
      sign = signed < 0 ? -1 : 1;
    } else {
      n = index * 2 + 1;
      radius = 80 / n;
      sign = 1;
    }
    const drift = Math.sin(breath * TAU + index * 0.7) * 0.035;
    y += Math.sin(theta * n * sign + drift) * radius;
  }
  return y;
}

/** Direct DFT is deliberately small and fixture-oriented, not a render-loop FFT. */
export function discreteFourierTransform(samples: readonly number[]): Complex[] {
  const count = samples.length;
  if (count === 0) return [];
  return Array.from({ length: count }, (_, bin) => {
    let re = 0;
    let im = 0;
    for (let index = 0; index < count; index += 1) {
      const angle = -TAU * bin * index / count;
      re += samples[index] * Math.cos(angle);
      im += samples[index] * Math.sin(angle);
    }
    return { re, im };
  });
}

export function inverseDiscreteFourierTransform(spectrum: readonly Complex[]): number[] {
  const count = spectrum.length;
  if (count === 0) return [];
  return Array.from({ length: count }, (_, index) => {
    let re = 0;
    for (let bin = 0; bin < count; bin += 1) {
      const angle = TAU * bin * index / count;
      re += spectrum[bin].re * Math.cos(angle) - spectrum[bin].im * Math.sin(angle);
    }
    return re / count;
  });
}

export function complexPower(value: Complex): number {
  return value.re * value.re + value.im * value.im;
}

export function signalEnergy(samples: readonly number[]): number {
  return samples.reduce((total, sample) => total + sample * sample, 0);
}
