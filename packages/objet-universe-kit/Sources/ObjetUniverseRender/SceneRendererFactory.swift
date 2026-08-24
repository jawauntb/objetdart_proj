#if canImport(Metal) && canImport(QuartzCore)
import Metal
#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif
import QuartzCore

/// The single native renderer factory. Re-entering a scene constructs a fresh
/// visual instrument while `RenderHost.install` retires the previous Metal
/// owner before the replacement resumes.
public enum SceneRendererFactory {
  public static func make(
    for scene: SceneID,
    layer: CAMetalLayer,
    waveBreathSeconds: Double
  ) -> (any UniverseRenderer)? {
    switch scene {
    case .wave, .atoms, .molecules:
      WaveMaterialRenderer(layer: layer, breathSeconds: waveBreathSeconds)
    case .cell:
      CellMaterialRenderer(layer: layer)
    case .solar:
      SolarRenderer(layer: layer)
    }
  }
}
#endif
