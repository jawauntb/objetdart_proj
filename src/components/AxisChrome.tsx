"use client";

/**
 * AxisChrome — ScaleTravel + MetaNavigator membership card.
 *
 * Mount on every room that takes a scale address. `travel={false}` when the
 * room still owns pinch (OrbitControls, binary suns) — MetaNavigator still
 * opens the lateral peer ring; pinch-travel waits until the room yields the
 * frame verb. `peers={false}` for solo band primaries with no peer circle.
 */

import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";

type Props = {
  route: string;
  /** Pinch-owned scale travel. Default true. */
  travel?: boolean;
  /** Lateral peer ring. Default true; no-ops when the route has no circle. */
  peers?: boolean;
};

export default function AxisChrome({ route, travel = true, peers = true }: Props) {
  return (
    <>
      {travel ? <ScaleTravel route={route} /> : null}
      {peers ? <MetaNavigator route={route} /> : null}
    </>
  );
}
