/**
 * Gesture core — the pure math of the grammar (docs/gesture-grammar.md).
 *
 * No imports, no DOM: every classifier here is a plain function over samples,
 * so the grammar's physics is node-testable (scripts/test-gesture.mjs) and
 * identical everywhere. The DOM binding lives in ./index.ts; rooms bind
 * meanings, never thresholds — all thresholds live here and only here.
 */

export const THRESHOLDS = {
  /** ms to wait for all fingers of a chord to land. */
  chordSettleMs: 40,
  /** A chord whose fingers land slower than this is an arpeggio. */
  arpeggioMs: 40,
  /** Contact shorter than this (and unmoved) is a tap. */
  tapMaxMs: 250,
  /** Hold tiers: touch → dwell → ceremony. */
  dwellMs: 900,
  ceremonyMs: 2500,
  /** Window for tap trains (double/triple). */
  tapTrainMs: 280,
  /** Movement past this many px commits a drag (kills tap/hold). */
  moveTolPx: 12,
  /** Release speed above this is a flick, px/ms. */
  flickVel: 0.6,
  /** Total winding (fraction of a full turn) that commits a scrub. */
  scrubWinding: 0.75,
  /** Two-finger channel deadzones: scale ratio, radians, px. */
  pinchDeadzone: 0.03,
  twistDeadzoneRad: 0.1,
  pan2DeadzonePx: 8,
  /** Device-motion. */
  shakeThresh: 16,
  shakeWindowMs: 700,
  knockThresh: 22,
  /** Screen-edge inset inside which gestures may begin (the surf line). */
  edgeInsetPx: 24,
  /**
   * Instrument surfaces (polyphonic rooms binding `voice`): fingers landing
   * further apart than this are independent voices, never a frame gesture.
   */
  voiceStaggerMs: 80,
  /**
   * How long a together-landed pair may stay ambiguous before it is locked
   * as voices. Notes are already sounding — this only closes the door on a
   * late pinch claim.
   */
  voiceDecideMs: 180,
  /** Drum: landings within this rolling window can form one patter. */
  drumWindowMs: 1200,
  /** Landings needed inside the window before a patter commits. */
  drumMinHits: 3,
  /** Consecutive landings closer than this are one chord strike, never a patter. */
  drumGapMs: 60,
  /** Landings within this radius of a zone anchor belong to that hand's spot. */
  drumZonePx: 72,
  /** drumAlternation at or above this reads as drumming, not stray taps. */
  drumAlternationMin: 0.7,
  /** An entrance later than this after the previous is a new phrase, not the same arpeggio. */
  arpeggioGapMaxMs: 600,
} as const;

export type HoldTier = 0 | 1 | 2 | 3;

/** 0 = not yet a hold, 1 = touch, 2 = dwell, 3 = ceremony. */
export function holdTier(elapsedMs: number): HoldTier {
  if (elapsedMs >= THRESHOLDS.ceremonyMs) return 3;
  if (elapsedMs >= THRESHOLDS.dwellMs) return 2;
  if (elapsedMs >= THRESHOLDS.tapMaxMs) return 1;
  return 0;
}

export type IntensitySource = {
  /** PointerEvent.pressure — trustworthy only when not the 0.5 default. */
  pressure?: number;
  /** Contact ellipse, px. */
  width?: number;
  height?: number;
  /** Approach/velocity fallback, px/ms. */
  velocity?: number;
};

/**
 * One 0..1 "how hard you meant it" from the best available channel:
 * real force > contact area (finger pad vs tip) > velocity. A bare tap with
 * no signals reads as a middle 0.5, never zero.
 */
export function intensityFrom(src: IntensitySource): number {
  if (src.pressure !== undefined && src.pressure > 0 && Math.abs(src.pressure - 0.5) > 1e-3) {
    return clamp01(src.pressure);
  }
  const area = (src.width ?? 0) * (src.height ?? 0);
  if (area > 0) {
    // ~12px circle = light fingertip, ~40px = flat pad.
    return clamp01((Math.sqrt(area) - 8) / 32);
  }
  if (src.velocity !== undefined) return clamp01(src.velocity / 1.6);
  return 0.5;
}

export type Pt = { x: number; y: number };

export type TwoPointerDelta = {
  /** Common translation of the pair, px. */
  dx: number;
  dy: number;
  /** Radial: ratio of distances (>1 = spreading = zoom in). */
  scale: number;
  /** Angular: signed radians. */
  rotate: number;
};

/**
 * Decompose two-finger motion into its orthogonal channels: translation
 * (pan2), radial (pinch), angular (twist). The three independent things a
 * two-finger grip can say at once.
 */
export function decomposeTwoPointer(a0: Pt, b0: Pt, a1: Pt, b1: Pt): TwoPointerDelta {
  const c0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const c1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1e-6;
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1e-6;
  const ang0 = Math.atan2(b0.y - a0.y, b0.x - a0.x);
  const ang1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
  let rotate = ang1 - ang0;
  if (rotate > Math.PI) rotate -= 2 * Math.PI;
  if (rotate < -Math.PI) rotate += 2 * Math.PI;
  return { dx: c1.x - c0.x, dy: c1.y - c0.y, scale: d1 / d0, rotate };
}

/**
 * Signed winding of a path around its centroid, in full turns.
 * |winding| ≥ THRESHOLDS.scrubWinding means the hand is circling (a scrub);
 * sign gives direction (positive = counterclockwise in screen coords).
 */
export function pathWinding(points: Pt[]): number {
  if (points.length < 8) return 0;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  // Circling means a consistent radius around the centroid. A straight stroke
  // passes *through* its centroid (radius collapsing to ~0 mid-path flips the
  // angle by π and fakes half a turn) — reject paths whose radius varies wildly.
  let rSum = 0;
  const radii = points.map((p) => {
    const r = Math.hypot(p.x - cx, p.y - cy);
    rSum += r;
    return r;
  });
  const rMean = rSum / points.length;
  if (rMean < 8) return 0;
  const rVar = radii.reduce((a, r) => a + (r - rMean) * (r - rMean), 0) / points.length;
  if (Math.sqrt(rVar) / rMean > 0.55) return 0;
  let total = 0;
  let prev = Math.atan2(points[0].y - cy, points[0].x - cx);
  for (let i = 1; i < points.length; i++) {
    const a = Math.atan2(points[i].y - cy, points[i].x - cx);
    let d = a - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    total += d;
    prev = a;
  }
  return -total / (2 * Math.PI); // flip: screen y is down; + = counterclockwise
}

export type PairMotion = {
  /** ms between the two fingers landing. */
  landDeltaMs: number;
  /** Displacement of each finger since the pair formed, px. */
  da: Pt;
  db: Pt;
  /** Accumulated distance ratio between the fingers (1 = unchanged). */
  scale: number;
  /** Accumulated rotation of the connecting line, radians. */
  rotate: number;
  /** ms since the pair formed. */
  elapsedMs: number;
};

export type PairVerdict = "voices" | "frame" | "undecided";

/**
 * Instrument-surface discriminator: are two concurrent fingers one frame
 * gesture (pinch/twist) or two independent voices (a dyad)?
 *
 * The physics of hands: chord fingers land staggered, or land together and
 * then hold still or travel the same way (a double-stop glide). Frame
 * fingers land together and move *against* each other — spreading, closing,
 * or turning about their midpoint. So:
 *
 * - staggered landing → voices, forever (a chord must never read as pinch)
 * - opposed motion past the radial or angular deadzone → frame
 * - parallel or one-sided motion → voices (an anchored-thumb pinch is
 *   sacrificed on instrument surfaces; both-fingers pinches and the desktop
 *   wheel still zoom)
 * - stillness past the decide window → voices (a held dyad)
 */
export function classifyInstrumentPair(m: PairMotion): PairVerdict {
  if (m.landDeltaMs > THRESHOLDS.voiceStaggerMs) return "voices";

  const aMag = Math.hypot(m.da.x, m.da.y);
  const bMag = Math.hypot(m.db.x, m.db.y);
  const bothMoving = aMag > THRESHOLDS.moveTolPx && bMag > THRESHOLDS.moveTolPx;
  const opposed = m.da.x * m.db.x + m.da.y * m.db.y < 0;
  const radial = Math.abs(m.scale - 1) > THRESHOLDS.pinchDeadzone * 2;
  const angular = Math.abs(m.rotate) > THRESHOLDS.twistDeadzoneRad * 1.5;

  if (bothMoving && opposed && (radial || angular)) return "frame";
  if (m.elapsedMs > THRESHOLDS.voiceDecideMs) return "voices";
  if ((aMag > THRESHOLDS.moveTolPx || bMag > THRESHOLDS.moveTolPx) && !opposed) return "voices";
  return "undecided";
}

export type ReleaseKind = "tap" | "flick" | "drag-end" | "hold-release";

export function classifyRelease(durationMs: number, movedPx: number, releaseVel: number): ReleaseKind {
  if (movedPx <= THRESHOLDS.moveTolPx) {
    return durationMs <= THRESHOLDS.tapMaxMs ? "tap" : "hold-release";
  }
  return releaseVel >= THRESHOLDS.flickVel ? "flick" : "drag-end";
}

/** Running tap-train count: 1, 2, 3… while taps stay inside the window. */
export function tapTrain(prevCount: number, prevTimeMs: number, nowMs: number): number {
  return nowMs - prevTimeMs <= THRESHOLDS.tapTrainMs ? Math.min(3, prevCount + 1) : 1;
}

export type Rhythm = { bpm: number; stability: number };

/**
 * Tempo of a tap train (≥4 taps): median interval → bpm, and a 0..1 stability
 * (1 = metronomic). Lets a room entrain its clocks to the hand's pulse.
 */
export function rhythmFrom(tapTimesMs: number[]): Rhythm | null {
  if (tapTimesMs.length < 4) return null;
  const iv: number[] = [];
  for (let i = 1; i < tapTimesMs.length; i++) iv.push(tapTimesMs[i] - tapTimesMs[i - 1]);
  const sorted = [...iv].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0 || median > 2000) return null;
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) * (b - mean), 0) / iv.length);
  return { bpm: 60000 / median, stability: clamp01(1 - sd / mean) };
}

export type MotionSample = { x: number; y: number; z: number; t: number };

/**
 * Shake intensity 0..1 from recent accelerometer samples (without gravity):
 * mean magnitude above the threshold within the window, normalized.
 */
export function shakeIntensity(samples: MotionSample[], nowMs: number): number {
  const recent = samples.filter((s) => nowMs - s.t <= THRESHOLDS.shakeWindowMs);
  if (recent.length < 4) return 0;
  let over = 0;
  let sum = 0;
  for (const s of recent) {
    const m = Math.hypot(s.x, s.y, s.z);
    if (m > THRESHOLDS.shakeThresh * 0.6) {
      over++;
      sum += m;
    }
  }
  if (over < 3) return 0;
  const meanOver = sum / over;
  return clamp01((meanOver - THRESHOLDS.shakeThresh * 0.6) / THRESHOLDS.shakeThresh);
}

/** Alternation 0..1 of a drum pattern: 1 = strict left-right patter. */
export function drumAlternation(hits: Array<{ zone: number }>): number {
  if (hits.length < 3) return 0;
  let alt = 0;
  for (let i = 1; i < hits.length; i++) if (hits[i].zone !== hits[i - 1].zone) alt++;
  return alt / (hits.length - 1);
}

export type DrumHit = { x: number; y: number; t: number };

export type DrumVerdict = {
  hits: number;
  alternation: number;
  /** The landing that committed this patter. */
  x: number;
  y: number;
  /** The two zones the hands alternate between. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

/**
 * Drumming (grammar §1): landings alternating between two distinct zones
 * inside the rolling window. A same-spot roll is one zone — no drum; a
 * chord's simultaneous landings are one strike — no drum. Hits must be in
 * time order. Returns the patter (with both zone anchors, so a room can
 * play the space *between* the hands) or null.
 */
export function classifyDrum(hits: DrumHit[], nowMs: number): DrumVerdict | null {
  const recent = hits.filter((h) => nowMs - h.t <= THRESHOLDS.drumWindowMs);
  if (recent.length < THRESHOLDS.drumMinHits) return null;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].t - recent[i - 1].t < THRESHOLDS.drumGapMs) return null;
  }
  // Zone anchors: the first hit, and the first hit that lands clear of it.
  const a = recent[0];
  let b: DrumHit | null = null;
  const zones: Array<{ zone: number }> = [];
  for (const h of recent) {
    const da = Math.hypot(h.x - a.x, h.y - a.y);
    if (b === null && da > THRESHOLDS.drumZonePx) b = h;
    if (b === null) {
      zones.push({ zone: 0 });
      continue;
    }
    const db = Math.hypot(h.x - b.x, h.y - b.y);
    zones.push({ zone: da <= db ? 0 : 1 });
  }
  if (b === null) return null; // one zone: a roll on the spot, not a drum
  const alternation = drumAlternation(zones);
  if (alternation < THRESHOLDS.drumAlternationMin) return null;
  const last = recent[recent.length - 1];
  return {
    hits: recent.length,
    alternation,
    x: last.x,
    y: last.y,
    ax: a.x,
    ay: a.y,
    bx: b.x,
    by: b.y,
  };
}

export type ArpeggioVerdict = { fingers: number; spreadMs: number };

/**
 * Staggered chord landing (grammar §1 "stagger"): concurrent fingers whose
 * landings spread past the chord-settle stagger — an arpeggio rather than a
 * chord. Landings tighter than arpeggioMs are one chord; an entrance more
 * than arpeggioGapMaxMs after the previous is a new phrase, not this roll.
 */
export function classifyArpeggio(landingsMs: number[]): ArpeggioVerdict | null {
  if (landingsMs.length < 2) return null;
  const sorted = [...landingsMs].sort((x, y) => x - y);
  const spreadMs = sorted[sorted.length - 1] - sorted[0];
  if (spreadMs <= THRESHOLDS.arpeggioMs) return null;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > THRESHOLDS.arpeggioGapMaxMs) return null;
  }
  return { fingers: landingsMs.length, spreadMs };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
