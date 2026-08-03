/**
 * The candle's little laws — pure and node-testable.
 *
 * The persistent candle (CandleMark) is the site's one invitation surface:
 * a dwell on the flame invites the vessel (device motion), holding on to
 * ceremony invites breath (the microphone), and blowing / shaking /
 * triple-tapping puts the candle out — the whole site dims into night until
 * the wick is pressed again. This module holds the state machine behind
 * that: legal lit↔snuffed transitions, the hold-tier ladder, the
 * never-ask-twice invitation ledger, and the persistence codec. No DOM —
 * the DOM half lives in CandleMark.tsx; sensors live in lib/vessel.ts and
 * lib/gesture.
 */

export type CandleState = "lit" | "snuffed";
export type CandleEvent = "snuff" | "relight";
export type CandleTransition = { state: CandleState; changed: boolean };

/**
 * The only legal transitions: a lit candle can be snuffed, a snuffed candle
 * can be relit. Everything else is a no-op (`changed: false`) so effects —
 * the thud of night falling, the bloom of relight — fire exactly once.
 */
export function candleNext(state: CandleState, event: CandleEvent): CandleTransition {
  if (event === "snuff" && state === "lit") return { state: "snuffed", changed: true };
  if (event === "relight" && state === "snuffed") return { state: "lit", changed: true };
  return { state, changed: false };
}

export type HoldAction = "invite-vessel" | "invite-breath" | "relight" | null;

/**
 * The hold ladder, as tier *crossings* (tiers from gesture/core: 2 = dwell,
 * 3 = ceremony). Crossing dwell on a lit candle is the invitation to the
 * vessel; holding on through ceremony is the invitation to breath; crossing
 * dwell on the unlit wick relights it. Staying at a tier fires nothing —
 * a hand that keeps holding is not asking again.
 */
export function holdAction(state: CandleState, tier: number, prevTier: number): HoldAction {
  const crossedDwell = prevTier < 2 && tier >= 2;
  const crossedCeremony = prevTier < 3 && tier >= 3;
  if (state === "snuffed") return crossedDwell ? "relight" : null;
  if (crossedCeremony) return "invite-breath";
  if (crossedDwell) return "invite-vessel";
  return null;
}

// ——— The invitation ledger: never ask twice in the same session ———

export type InviteKind = "vessel" | "breath";
export type InviteLedger = { readonly vessel: boolean; readonly breath: boolean };

export const FRESH_LEDGER: InviteLedger = { vessel: false, breath: false };

/**
 * Pure never-ask-twice reducer: `ask` is true only the first time a kind is
 * requested; the ledger is monotone — an asked flag never clears.
 */
export function inviteNext(
  ledger: InviteLedger,
  kind: InviteKind,
): { ledger: InviteLedger; ask: boolean } {
  if (ledger[kind]) return { ledger, ask: false };
  return { ledger: { ...ledger, [kind]: true }, ask: true };
}

// Session-scoped ledger (module singleton, like haptics' enabled flag).
let sessionLedger: InviteLedger = FRESH_LEDGER;

/** Gate an invitation for this session. True at most once per kind. */
export function shouldInvite(kind: InviteKind): boolean {
  const next = inviteNext(sessionLedger, kind);
  sessionLedger = next.ledger;
  return next.ask;
}

// ——— Persistence: the candle remembers its night ———

export const CANDLE_KEY = "objetdart:candle:v1";

/** Anything that isn't explicitly a remembered night reads as lit. */
export function parseCandle(raw: string | null | undefined): CandleState {
  return raw === "snuffed" ? "snuffed" : "lit";
}

export function loadCandleState(): CandleState {
  if (typeof window === "undefined") return "lit";
  try {
    return parseCandle(window.localStorage.getItem(CANDLE_KEY));
  } catch {
    return "lit";
  }
}

export function saveCandleState(state: CandleState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CANDLE_KEY, state);
  } catch {
    /* noop */
  }
}
