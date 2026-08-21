/** Physical place and representational lens are deliberately distinct. */

export const SCALE_CONTRACT_VERSION = 1 as const;

export type NativeScaleId = "wave-medium" | "cellular-colony" | "molecular-bond" | "atomic-shell" | "solar-formation";
export type ScaleLens = "material" | "surface" | "signal" | "phase" | "spectrum" | "lineage" | "orbital";

export type PhysicalScale = Readonly<{
  id: NativeScaleId;
  /** log10 metres; a physical address, never a camera value. */
  log10Metres: number;
  label: string;
}>;

export type ScaleAddress = Readonly<{
  version: typeof SCALE_CONTRACT_VERSION;
  physical: PhysicalScale;
  /** A lens changes representation at the same physical address. */
  lens: ScaleLens;
}>;

export type PassageAnchor = Readonly<{
  version: typeof SCALE_CONTRACT_VERSION;
  id: string;
  from: ScaleAddress;
  to: ScaleAddress;
  handoff: "resistance" | "detent" | "passage";
}>;

export const NATIVE_SCALE_ADDRESSES: Readonly<Record<NativeScaleId, ScaleAddress>> = {
  "wave-medium": { version: SCALE_CONTRACT_VERSION, physical: { id: "wave-medium", log10Metres: -1, label: "the wave medium" }, lens: "surface" },
  "cellular-colony": { version: SCALE_CONTRACT_VERSION, physical: { id: "cellular-colony", log10Metres: -5, label: "the cellular colony" }, lens: "material" },
  "molecular-bond": { version: SCALE_CONTRACT_VERSION, physical: { id: "molecular-bond", log10Metres: -9, label: "the molecular bond" }, lens: "material" },
  "atomic-shell": { version: SCALE_CONTRACT_VERSION, physical: { id: "atomic-shell", log10Metres: -10, label: "the atomic shell" }, lens: "material" },
  "solar-formation": { version: SCALE_CONTRACT_VERSION, physical: { id: "solar-formation", log10Metres: 12, label: "the forming solar system" }, lens: "orbital" },
};

const SCALE_IDS: readonly NativeScaleId[] = ["wave-medium", "cellular-colony", "molecular-bond", "atomic-shell", "solar-formation"];
const LENSES: readonly ScaleLens[] = ["material", "surface", "signal", "phase", "spectrum", "lineage", "orbital"];

export function isScaleAddress(value: unknown): value is ScaleAddress {
  if (typeof value !== "object" || value === null) return false;
  const address = value as Record<string, unknown>;
  if (address.version !== SCALE_CONTRACT_VERSION || !LENSES.includes(address.lens as ScaleLens) || typeof address.physical !== "object" || address.physical === null) return false;
  const physical = address.physical as Record<string, unknown>;
  if (!SCALE_IDS.includes(physical.id as NativeScaleId) || typeof physical.log10Metres !== "number" || !Number.isFinite(physical.log10Metres) || typeof physical.label !== "string" || physical.label.length === 0) return false;
  const canonical = NATIVE_SCALE_ADDRESSES[physical.id as NativeScaleId].physical;
  return physical.log10Metres === canonical.log10Metres && physical.label === canonical.label;
}

export function samePhysicalScale(a: ScaleAddress, b: ScaleAddress): boolean {
  return a.physical.id === b.physical.id && a.physical.log10Metres === b.physical.log10Metres;
}

export function isPassageAnchor(value: unknown): value is PassageAnchor {
  if (typeof value !== "object" || value === null) return false;
  const anchor = value as Record<string, unknown>;
  return anchor.version === SCALE_CONTRACT_VERSION && typeof anchor.id === "string" && anchor.id.length > 0 && isScaleAddress(anchor.from) && isScaleAddress(anchor.to) && (anchor.handoff === "resistance" || anchor.handoff === "detent" || anchor.handoff === "passage") && !samePhysicalScale(anchor.from, anchor.to);
}
