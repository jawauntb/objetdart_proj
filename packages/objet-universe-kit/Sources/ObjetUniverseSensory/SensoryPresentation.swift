import Foundation

/// The presentation-only reduced-motion projection for a sensory event.
///
/// Kernels still author the event and its scientific meaning. This seam only
/// lowers physical output before the shared audio and haptic buses schedule
/// it, so accessibility never changes an event's identity, timing, pitch, or
/// enabled senses.
public enum SensoryPresentation {
  public static let reducedMotionAmplitude: Double = 0.55
  public static let minimumAudibleEnergy: Double = 0.12

  public static func event(_ event: SensoryEvent, reducedMotion: Bool) -> SensoryEvent {
    guard reducedMotion, event.derivation.energy > 0 else { return event }
    let scaledEnergy = event.derivation.energy * reducedMotionAmplitude
    // The floor preserves an already-audible act after attenuation; it never
    // invents extra force for an outcome the authority deliberately made soft.
    let reducedEnergy = min(
      event.derivation.energy,
      max(minimumAudibleEnergy, scaledEnergy)
    )
    return SensoryEvent(
      id: event.id,
      signature: event.signature,
      clock: event.clock,
      energy: reducedEnergy,
      frequencyHz: event.frequencyHz,
      senses: event.senses
    )
  }
}
