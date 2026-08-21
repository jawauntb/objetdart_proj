import ExpoModulesCore

public final class ObjetUniverseModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ObjetUniverse")

    // The universe stays first: it is this module's default view, the one
    // `requireNativeViewManager("ObjetUniverse")` resolves to, and it mounts
    // once below every route.
    View(ObjetUniverseView.self) {
      Prop("scene") { (view: ObjetUniverseView, scene: String) in
        view.setScene(scene)
      }
    }

    // The touchable half, mounted inside a route. See
    // `ObjetUniverseSurfaceView` for why contact cannot reach the universe
    // view directly.
    View(ObjetUniverseSurfaceView.self) {
      ViewName("ObjetUniverseSurface")
      Events("onSemanticCommand")

      Prop("enabled") { (view: ObjetUniverseSurfaceView, enabled: Bool) in
        view.setEnabled(enabled)
      }

      Prop("representation") { (view: ObjetUniverseSurfaceView, representation: Int) in
        view.setRepresentation(representation)
      }

      Prop("maxRepresentation") { (view: ObjetUniverseSurfaceView, representation: Int) in
        view.setMaxRepresentation(representation)
      }

      Prop("assistiveVerb") { (view: ObjetUniverseSurfaceView, verb: String?) in
        view.setAssistiveVerb(verb)
      }
      Prop("assistiveIntensity") { (view: ObjetUniverseSurfaceView, intensity: Double) in
        view.setAssistiveIntensity(intensity)
      }
      Prop("assistiveOriginX") { (view: ObjetUniverseSurfaceView, x: Double) in
        view.setAssistiveOriginX(x)
      }
      Prop("assistiveOriginY") { (view: ObjetUniverseSurfaceView, y: Double) in
        view.setAssistiveOriginY(y)
      }
      Prop("assistiveCommandId") { (view: ObjetUniverseSurfaceView, id: String?) in
        view.setAssistiveCommandId(id)
      }
    }
  }
}
