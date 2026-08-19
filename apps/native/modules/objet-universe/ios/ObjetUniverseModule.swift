import ExpoModulesCore

public final class ObjetUniverseModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ObjetUniverse")

    View(ObjetUniverseView.self) {
      Prop("scene") { (view: ObjetUniverseView, scene: String) in
        view.setScene(scene)
      }
    }
  }
}
