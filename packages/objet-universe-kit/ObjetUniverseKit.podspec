Pod::Spec.new do |s|
  s.name = "ObjetUniverseKit"
  s.version = "0.1.0"
  s.summary = "Authoritative Swift host, clock, renderer, and sensory buses for objet d'art."
  s.homepage = "https://github.com/jawauntb/objetdart_proj"
  s.authors = { "objet d'art" => "hello@objet.art" }
  s.license = { :type => "UNLICENSED" }
  s.source = { :git => "https://github.com/jawauntb/objetdart_proj.git", :tag => s.version.to_s }
  s.platforms = { :ios => "17.0" }
  s.swift_version = "6.0"
  s.static_framework = true
  s.module_name = "ObjetUniverseKit"
  # Persistence stays an SPM-only target: it needs GRDB and is not required
  # to compile the Expo universe view or sensory preference bridge.
  s.source_files = [
    "Sources/ObjetUniverseCore/**/*.swift",
    "Sources/ObjetUniverseRender/**/*.swift",
    "Sources/ObjetUniverseSensory/**/*.swift",
  ]
  s.frameworks = "Foundation", "UIKit", "AVFoundation", "CoreHaptics"
  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
  }
end
