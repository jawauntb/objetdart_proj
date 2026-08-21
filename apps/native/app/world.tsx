import { ProofSceneRoute } from "../src/scenes/ProofSceneRoute";

/**
 * The world route sits above the persistent `<ObjetUniverseView>` and stays
 * transparent so the native material renders through. It mounts the surface
 * the hand meets, the shared safe-area chrome, and the two sought reading
 * surfaces (fold and trail). No tab bar, no first-launch overlay, no HUD. See
 * `docs/native/art-direction.md` §9.
 *
 * The surface is a native view rather than a React touch handler on purpose.
 * UIKit hit-tests the topmost view at a point, so a recogniser on the
 * universe below would never see a finger through the navigator's screens —
 * and recognition belongs in Swift regardless, where the one grammar lives.
 * React learns only which phenomena the visitor has caused, because the guide
 * may not describe a phenomenon that has not landed.
 *
 * While the guide sheet is open the surface is closed: the state contract
 * pauses authoritative intervention for the reading surfaces.
 */
export default function WorldRoute() {
  return <ProofSceneRoute scene="wave" />;
}
