import type { ConcernKey } from "@/lib/types";
import type { TapeEvent } from "@/store/field";

/**
 * Field state — the phenomenological readout.
 *
 * Translates the concern vector + recent tape events into a small set of
 * living state-words. The panel reads them aloud the way an instrument
 * reads its dials: short, declarative, slightly archaic. The values shift
 * as the user moves through the site, so the panel reads as a living
 * organ rather than a static label.
 */
export type FieldState = {
  flow: string;       // aligned | drifting | held | undertow
  pressure: string;   // low | rising | high | venting
  bloom: string;      // dormant | budding | rising | full
  ambient: string;    // quiet | soft | warm | held
  veto: string;       // inactive | watching | active
  value: string;      // lowercased label of the top concern (e.g. "memory")
  ridge: string;      // broken | forming | held | aligned
  undertow: string;   // none | faint | strong | pull
};

/**
 * Pure, deterministic. No clock side-effects beyond Date.now() for the
 * "recent window" calculations on the tape — derivation is otherwise a
 * function of its inputs.
 */
export function deriveFieldState(
  concerns: Record<ConcernKey, number>,
  tape: TapeEvent[],
): FieldState {
  const now = Date.now();
  const last30s = tape.filter((e) => now - e.t <= 30_000);
  const last60s = tape.filter((e) => now - e.t <= 60_000);

  // sorted concerns: [key, value][] descending
  const sorted = (Object.entries(concerns) as [ConcernKey, number][]).sort(
    (a, b) => b[1] - a[1],
  );

  const topThree = sorted.slice(0, 3).map(([, v]) => v);
  const topThreeAvg = topThree.length
    ? topThree.reduce((a, b) => a + b, 0) / topThree.length
    : 0;
  const topThreeSpan = topThree.length
    ? Math.max(...topThree) - Math.min(...topThree)
    : 0;

  const memory = concerns.memory ?? 0;
  const body = concerns.body ?? 0;
  const risk = concerns.risk ?? 0;
  const work = concerns.work ?? 0;
  const P = risk + work;

  // "others low" — for the undertow flow case
  const othersAvg =
    (Object.entries(concerns) as [ConcernKey, number][])
      .filter(([k]) => k !== "memory" && k !== "body")
      .reduce((a, [, v]) => a + v, 0) / 6;

  // ── flow ──────────────────────────────────────────────────────────────
  let flow: FieldState["flow"];
  if (tape.length === 0) {
    flow = "held";
  } else if ((memory > 70 || body > 70) && othersAvg < 45) {
    flow = "undertow";
  } else if (last30s.length >= 3 && topThreeSpan <= 20) {
    flow = "aligned";
  } else if (topThreeSpan > 40) {
    flow = "drifting";
  } else {
    flow = "aligned";
  }

  // ── pressure ──────────────────────────────────────────────────────────
  const recentRiskDrop = last30s.some(
    (e) => e.kind === "concern" && e.meta === "risk" && e.intensity > 0.6,
  );
  let pressure: FieldState["pressure"];
  if (recentRiskDrop) pressure = "venting";
  else if (P > 160) pressure = "high";
  else if (P > 130) pressure = "rising";
  else pressure = "low";

  // ── bloom ─────────────────────────────────────────────────────────────
  const n60 = last60s.length;
  let bloom: FieldState["bloom"];
  if (n60 === 0) bloom = "dormant";
  else if (n60 <= 2) bloom = "budding";
  else if (n60 <= 5) bloom = "rising";
  else bloom = "full";

  // ── ambient ───────────────────────────────────────────────────────────
  let ambient: FieldState["ambient"];
  if (P > 160) ambient = "held";
  else if (P > 130) ambient = "warm";
  else if (P > 90) ambient = "soft";
  else ambient = "quiet";

  // ── veto ──────────────────────────────────────────────────────────────
  let veto: FieldState["veto"];
  if (risk > 75) veto = "active";
  else if (risk > 50) veto = "watching";
  else veto = "inactive";

  // ── value ─────────────────────────────────────────────────────────────
  const value = sorted[0] ? String(sorted[0][0]).toLowerCase() : "—";

  // ── ridge ─────────────────────────────────────────────────────────────
  let ridge: FieldState["ridge"];
  if (topThreeAvg >= 70) ridge = "aligned";
  else if (topThreeAvg >= 50) ridge = "held";
  else if (topThreeAvg >= 30) ridge = "forming";
  else ridge = "broken";

  // ── undertow ──────────────────────────────────────────────────────────
  let undertow: FieldState["undertow"];
  if (memory > 75) undertow = "pull";
  else if (memory > 60) undertow = "strong";
  else if (memory > 45) undertow = "faint";
  else undertow = "none";

  return { flow, pressure, bloom, ambient, veto, value, ridge, undertow };
}
