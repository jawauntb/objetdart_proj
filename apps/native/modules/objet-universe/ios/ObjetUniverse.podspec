Pod::Spec.new do |s|
  s.name = "ObjetUniverse"
  s.version = "0.1.0"
  s.summary = "Persistent native universe host for objet d'art."
  s.homepage = "https://github.com/jawauntb/objetdart_proj"
  s.authors = { "objet d'art" => "hello@objet.art" }
  s.license = { :type => "UNLICENSED" }
  s.source = { :git => "https://github.com/jawauntb/objetdart_proj.git", :tag => s.version.to_s }
  s.platforms = { :ios => "17.0" }
  s.swift_version = "6.0"
  s.source_files = "ios/**/*.{h,m,mm,swift}", "../../../../../packages/objet-universe-kit/Sources/**/*.swift"
  s.dependency "ExpoModulesCore"
end
