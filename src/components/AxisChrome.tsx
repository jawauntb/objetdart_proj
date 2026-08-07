"use client";

/**
 * AxisChrome — ScaleTravel + MetaNavigator membership card.
 *
 * The `travel` prop's default is *derived from the room registry*: a room
 * whose `RoomEntry.frame === "own"` (OrbitControls, binary suns, its own
 * pinch verb) does not want ScaleTravel bound on top of it — mounting both
 * is the double-pinch bug, where two owners fight for one gesture. The
 * registry is the single source of truth for frame ownership; AxisChrome
 * reads it so a new own-frame room cannot forget to pass `travel={false}`.
 *
 * `peers={false}` for solo band primaries with no peer circle. An explicit
 * `travel` prop always wins over the derivation — the derivation is a
 * default, not a lock.
 */

import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import { guideKeyForPath } from "@/lib/guide-route";
import { ROOM_BY_KEY } from "@/lib/room-registry";

type Props = {
  route: string;
  /**
   * Pinch-owned scale travel. Default derived from the registry: false when
   * the room's `frame` is `"own"`, true otherwise. Pass explicitly to
   * override — for a lateral surface with no registry row that still wants
   * ScaleTravel, or to defer travel in a room whose registry entry is not
   * yet updated.
   */
  travel?: boolean;
  /** Lateral peer ring. Default true; no-ops when the route has no circle. */
  peers?: boolean;
};

/**
 * Read the registry for `route`. Own-frame → travel:false. Everything
 * else, including a route with no registry row, → travel:true (the safe
 * fallback: mount ScaleTravel; assume the room yields).
 */
function deriveTravel(route: string): boolean {
  const key = guideKeyForPath(route);
  const entry = key ? ROOM_BY_KEY[key] : null;
  return entry ? entry.frame !== "own" : true;
}

export default function AxisChrome({ route, travel, peers = true }: Props) {
  const resolvedTravel = travel ?? deriveTravel(route);
  return (
    <>
      {resolvedTravel ? <ScaleTravel route={route} /> : null}
      {peers ? <MetaNavigator route={route} /> : null}
    </>
  );
}
