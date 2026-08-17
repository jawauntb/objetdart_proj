/**
 * Arrival invitation — the one volunteered explanation, then silence.
 *
 * `/manifold` is the door. Once, after a breath so the fold is seen, a card
 * names why this is an album of rooms and how the hand works. Dismissal is
 * remembered here and the card never returns. The chrome `?` stays sought;
 * this module does not open it.
 *
 * Pure codec: no DOM. Persistence is a JSON record at ARRIVAL_STORAGE_KEY.
 * The door stays open unless `dismissed` is the boolean `true`.
 */

export const ARRIVAL_STORAGE_KEY = "objetdart:arrival:v1";

export type ArrivalRecord = { dismissed: true };

/** the on-disk shape — a visitor who has already entered */
export function encodeArrivalDismissal(): string {
  const record: ArrivalRecord = { dismissed: true };
  return JSON.stringify(record);
}

/**
 * True only when the stored payload is a record whose `dismissed` field is
 * the boolean `true`. Missing keys, garbage, `"true"`, `{dismissed:false}`
 * and `{dismissed:"true"}` all read as not-yet-dismissed, so a corrupt write
 * cannot hide the door.
 */
export function isArrivalDismissed(raw: string | null | undefined): boolean {
  if (raw == null || raw === "") return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    return (parsed as { dismissed?: unknown }).dismissed === true;
  } catch {
    return false;
  }
}

export function readArrivalDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return isArrivalDismissed(window.localStorage.getItem(ARRIVAL_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function writeArrivalDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ARRIVAL_STORAGE_KEY, encodeArrivalDismissal());
  } catch {
    /* private mode, quota — the session still closes; the next visit may ask again */
  }
}
