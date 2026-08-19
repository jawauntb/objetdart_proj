// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ObjetUniverseKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "ObjetUniverseCore", targets: ["ObjetUniverseCore"]),
    .library(name: "ObjetUniverseRender", targets: ["ObjetUniverseRender"]),
  ],
  targets: [
    .target(name: "ObjetUniverseCore"),
    .target(name: "ObjetUniverseRender", dependencies: ["ObjetUniverseCore"]),
    .testTarget(
      name: "ObjetUniverseCoreTests",
      dependencies: ["ObjetUniverseCore", "ObjetUniverseRender"]
    )
  ]
)
