// swift-tools-version: 6.0
import PackageDescription

// GRDB provides the SQLite writer used by the local persistence store. It is
// pinned to the stable 6.x line — the release we target is not yet on GRDB 7 —
// and guarded to Darwin platforms so `swift test` on Linux CI (which is what
// runs the ObjetUniverseCore tests today) does not try to resolve SQLite.
let package = Package(
  name: "ObjetUniverseKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "ObjetUniverseCore", targets: ["ObjetUniverseCore"]),
    .library(name: "ObjetUniverseRender", targets: ["ObjetUniverseRender"]),
    .library(name: "ObjetUniversePersistence", targets: ["ObjetUniversePersistence"]),
    .library(name: "ObjetUniverseSensory", targets: ["ObjetUniverseSensory"]),
  ],
  dependencies: [
    .package(url: "https://github.com/groue/GRDB.swift", from: "6.29.0"),
  ],
  targets: [
    .target(name: "ObjetUniverseCore"),
    .target(name: "ObjetUniverseRender", dependencies: ["ObjetUniverseCore"]),
    .target(
      name: "ObjetUniversePersistence",
      dependencies: [
        "ObjetUniverseCore",
        .product(name: "GRDB", package: "GRDB.swift"),
      ]
    ),
    .target(name: "ObjetUniverseSensory"),
    .testTarget(
      name: "ObjetUniverseCoreTests",
      dependencies: ["ObjetUniverseCore", "ObjetUniverseRender"]
    ),
    .testTarget(
      name: "ObjetUniversePersistenceTests",
      dependencies: ["ObjetUniversePersistence"]
    ),
    .testTarget(
      name: "ObjetUniverseSensoryTests",
      dependencies: ["ObjetUniverseSensory"]
    ),
  ]
)
