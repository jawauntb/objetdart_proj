require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name = "ObjetUniverse"
  s.version = package["version"]
  s.summary = "Persistent native universe host for objet d'art."
  s.homepage = "https://github.com/jawauntb/objetdart_proj"
  s.authors = { "objet d'art" => "hello@objet.art" }
  s.license = { :type => "UNLICENSED" }
  s.source = { :git => "https://github.com/jawauntb/objetdart_proj.git", :tag => s.version.to_s }
  s.platforms = { :ios => "17.0" }
  s.swift_version = "6.0"
  s.static_framework = true
  # Evaluated from ios/. Include this folder's Swift, not a nested ios/ios glob.
  s.source_files = "**/*.{h,m,mm,swift}"
  s.dependency "ExpoModulesCore"
  # Compiles packages/objet-universe-kit/Sources via the sibling kit pod.
  s.dependency "ObjetUniverseKit"
  s.frameworks = "UIKit", "QuartzCore", "CoreMotion"
  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
  }
end
