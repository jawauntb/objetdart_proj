// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /geyser — the geyser — build, erupt, cool.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from there.
 */
const geyser = {
  key: "geyser",
  href: "/geyser",
  sigil: "growth",
  desc: "the aquifer, timed and superheated",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "cabinet",
    band: "drop",
    label: "the geyser",
    ringAfter: "spring"
  },
  icon: {
    title: "the geyser — build, erupt, cool",
    description: "the aquifer, timed and superheated",
    path: "/geyser",
    shortName: "geyser",
    kind: "growth",
    bg: "#050a08",
    bg2: "#132420",
    glow: "#f0c690",
    accent: "#5aa89c",
    accent2: "#e88c4a",
    ink: "#f0efe6",
  },
  guide: {
    title: "the geyser — build, erupt, cool",
    scale: "the drop band — cabinet peer behind the spring, ahead of the coin: a hand's width of superheated ground in section, where a narrow throat fills against a hysteretic trigger and fires a ballistic column when head and temperature time each other into the red.",
    essence:
      "a two-state thermal ledger — an aquifer head H(t) under a narrow throat and a temperature T(t) in the same column — with an eruption trigger E = H·T that fires when it crosses upward and reseats only after E has fallen well below it. the room is not a fountain — it is the wait for one; a slow build hisses under the ground, the plume rides the release, the pool cools and starts again. the whole rhythm is read off the two numbers and the phase the column is in; nothing on the shelf is created except what the sky gave back or the mantle quietly poured in.",
    moves: [
      "tap → rings the throat at the local head; the pitch rises through the build and drops after the fire, so the same room sounds like two different rooms across a cycle",
      "dwell → warms the local ground with the palm's own heat, accelerating the build; keep pressing and T climbs faster toward the trigger",
      "ceremony (hold to the tier) → releases the throat manually — a fired eruption whether the trigger was ready or not, kept as a mark of intent",
      "drag → the surface film slides while the pool cools; a shear across the plume, no change to the ledger",
      "flick → throws a bubble at that point; a small plume-of-a-plume, its pitch the head that shaped it",
      "twist → raises the cycle lens: H(t), T(t), the trigger line, time-until-next-eruption, plume height",
      "twist3 → walks the year through the thermal register; winter mutes the mantle, summer stokes it, the interval between eruptions changes with the season",
      "tap3 → tutti; every phase rings at once — the room's own beat across the whole cycle",
      "drag3 → the world-law: down is rain (recharge; H rises faster), across is warmth (mantle; T rises faster)",
      "hold3 → time dilation while held; the ledger's clock runs slow so a wait can be inspected",
      "scrub → stirs the pool from above; the pool cools faster as its surface exchanges heat with the air",
      "drum (two hands alternating) → the wave field between them times the build, and a landing hit near the trigger can push it over",
      "arrows → walk the surface cursor; enter held warms the ground at the cursor; escape lowers the lens",
      "tilt / shake / knock / flip (once invited) → the pool leans, the surface scatters, a struck ground rings the column, face-down is night — the ground glows red where the mantle is loudest",
    ],
    finds: [
      "the pitch is the head times the temperature — an eruption is the geometry meaning the room made",
      "a geyser left to itself falls into a rhythm; the interval is the mantle warmth minus the wind's chill, and the cycle keeps in the ledger's own closed form",
      "a manual ceremony is not free — it dumps head and heat that would have fed a bigger natural fire five minutes later",
      "the plume height IS Q_erupt, and Q_erupt IS the head and temperature that got dumped — three lenses on the same instant",
      "a fortnight's absence is read off a closed-form cycle counter, not replayed — the room does not owe the visitor the fires they missed",
    ],
    keeps: "the current head, the temperature, the phase the column is in, the count of eruptions ever fired, the season the year had reached, and the hour it was last looked at.",
  },
} as const satisfies RoomManifest;

export default geyser;
