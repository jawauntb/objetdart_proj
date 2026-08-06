// Scale → spectral register, the pure half (plan W3). lib/scale says what a
// manifold position sounds like in the abstract (SpectralRegister); this maps
// that onto the concrete parameters the audio engine glides: the register
// lowpass over the ambient bed, the brightness shelf, the breath LFO, and the
// rate scale applied to the beds' swell LFOs. No imports with runtime weight,
// no DOM — node-testable (scripts/test-audio-register.mjs).

import type { SpectralRegister } from "@/lib/scale";

export type RegisterGlideTargets = {
  /** Register lowpass center over the ambient master, Hz. */
  cutoffHz: number;
  /** Highshelf cut, dB (always ≤ 0) — brightness discipline. */
  shelfDb: number;
  /** Rate of the breath LFO riding the register cutoff, Hz. */
  breathHz: number;
  /** Depth of that breath on the cutoff, Hz (scales with the cutoff). */
  breathDepthHz: number;
  /** Multiplier on the ambient layers' swell-LFO rates. */
  rateScale: number;
};

// The coast is the neutral point of the instrument: at human scale the
// register filter sits open enough to be transparent and the swells run at
// their authored rates. Mirrors spectralRegisterFor at the human shore
// (s = 2.5) on the −35…27 axis — ~0.0776 Hz, a long slow half of the ocean
// bed's 0.14 Hz swell. Retuned whenever the axis floor moves (the plank
// band opened thirteen decades under the quanta and dropped the floor to
// −35); test-audio-register.mjs holds the two in sync.
export const NEUTRAL_LFO_HZ = 0.0776;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Register → glide targets. Cosmic registers (low baseHz, minute-long lfoHz)
 * come out dark and slow; atomic registers open the filter fully and breathe
 * fast. Clamps keep every target inside what the beds can wear without
 * turning harsh (cutoff ceiling) or dying entirely (cutoff/breath floors).
 */
export function registerGlideTargets(reg: SpectralRegister): RegisterGlideTargets {
  const cutoffHz = clamp(reg.baseHz * 6, 150, 12000);
  const shelfDb = -16 * (1 - clamp(reg.brightness, 0, 1));
  const breathHz = clamp(reg.lfoHz, 0.005, 1.6);
  const breathDepthHz = cutoffHz * 0.18;
  const rateScale = clamp(reg.lfoHz / NEUTRAL_LFO_HZ, 0.25, 4);
  return { cutoffHz, shelfDb, breathHz, breathDepthHz, rateScale };
}
