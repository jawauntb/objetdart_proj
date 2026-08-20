import ExpoModulesCore
import ObjetUniverseKit

/// Bridges only user preferences and coarse bus state to React Native.
/// Per-event authority lives entirely on the native side (`AudioBus` and
/// `HapticBus` in `ObjetUniverseSensory`); TypeScript's role — enforced
/// in `apps/native/src/sensory/preferences.ts` — is limited to muting
/// and reading current bus health. Scenes cannot construct independent
/// audio graphs or generic success vibrations from JavaScript.
public final class SensoryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ObjetSensory")

    AsyncFunction("setAudioMuted") { (muted: Bool) in
      AudioBus.shared.setMuted(muted)
    }

    AsyncFunction("setHapticsMuted") { (muted: Bool) in
      HapticBus.shared.setMuted(muted)
    }

    Function("busState") { () -> [String: Any] in
      [
        "audioMuted": AudioBus.shared.isMuted,
        "hapticsMuted": HapticBus.shared.isMuted,
        "hapticEngineAvailable": HapticBus.shared.isCoreHapticsSupported,
      ]
    }
  }
}
