# objet d'art native

This is the iPhone and iPad development-build shell for the persistent universe.
It is not an Expo Go surface and it is not a WebView wrapper.

## Run

Use Node 22.13.x, then install from the repository root:

```sh
npm ci
npm run native:check
npm run native:prebuild
npm run native:ios
```

For a physical development build, use the `development` EAS profile. Verify the first
build on an iPhone and iPad before relying on native sensor, haptic, or renderer behavior.

## TestFlight

Production iOS is EAS from `apps/native`, the same shape Mapvest uses: remote
`buildNumber`, no `EAS_NO_VCS=1`, and `expo prebuild --clean` on the worker so
the generated `ios/` tree picks up the local Expo module and `ObjetUniverseKit`
extra-pod.

```sh
npm ci
npm run native:prebuild
cd apps/native
npx eas-cli@22.0.0 build --platform ios --profile production --auto-submit
```

Green `Native CI` on `main` also runs `.github/workflows/ios-eas-production.yml`
when the repo secret `EXPO_TOKEN` is set. Manual: Actions → `ios-eas-production`.

## What the first screen shows

The route tree is an overlay. Underneath every route sits one persistent
`ObjetUniverseView`, whose layer is a `CAMetalLayer`, and the whole visible
material is drawn into it by `WaveMaterialRenderer` from the field the active
`WaveKernel` owns. Three rules follow, and each has a guard in
`scripts/native/test-workspace.mjs`:

- **A route may not paint its own ground.** The stack's `contentStyle` and the
  navigation theme's `colors.background` are both transparent in
  `app/_layout.tsx`; either one left opaque covers the material completely and
  the app opens on a flat rectangle.
- **The view installs a real renderer, never a `RendererProbe`.** The probe is
  the lifecycle test double — it counts calls and draws nothing.
- **The medium is alive at rest.** `WaveField` carries a seeded ambient drive,
  so a visitor who touches nothing still finds a moving sea; with the drive at
  zero the tank is the pure conservative integrator the committed fixture in
  `scripts/native/fixtures/wave-reference.json` pins, and it decays to black
  within minutes.

## What touch does

The universe view is mounted below every route and cannot be touched there:
UIKit hit-tests the topmost view at a point, so every navigator screen above
it answers first even when it is fully transparent. The touchable half is
therefore `<ObjetUniverseSurface>` — a transparent native view the route
mounts inside itself, holding the recognisers and drawing nothing. The chrome
sits above it and keeps its own taps; everything else falls through to the
water.

One contact travels one path, and `scripts/native/test-workspace.mjs` guards
each hop:

1. `SurfaceInput` normalises a UIKit recogniser into a `NativeGestureShape`.
   It holds no threshold of its own — every number comes from
   `NativeGestureThresholds`, which is the verbatim mirror of
   `src/lib/gesture/core.ts`.
2. `GestureRouter` decides what the shape *means*. Finger count addresses the
   stack: one finger is the material, two the representation, three the
   world-law. A tap climbs the train's rungs, and a press keeps arriving at
   the wire contract's sample rate so duration stays an axis — the ceremony
   is committed when the hand lets go, never on the way past 2500 ms.
3. `UniverseRuntime` is the one seam to the kernel. It projects contact onto
   the material through `MaterialProjection` — the same aspect-fill law the
   shader reads, so the ring lands under the finger rather than a quarter of
   a tank away — asks the medium whether it says the verb, and commits when
   it does.
4. Either way the hand and the ear answer, through `HapticBus` and
   `AudioBus`. A verb the wave cannot say — season, weather, lens — is
   acknowledged softly instead of being given invented physics, exactly as
   `src/lib/gesture/defaults.ts` does on the web. Continuous streams answer
   in the material only: twenty haptics a second is a rattle, not a
   confirmation.

The wave tank says six of the seventeen durable meanings —
`material`, `grow`, `ceremony`, `tutti`, `agitate`, `wake` — and
`WaveKernel.expresses` is where that vocabulary is declared.
`WaveInterventionTests` pins it against what `apply` actually does, so the
declaration cannot drift from the physics. React learns only which
phenomena the visitor has caused, because the guide may not name a
phenomenon that has not landed; the material never round-trips through
JavaScript.

The vessel — tilt, shake, knock, flip — reaches the same router from
`VesselSensors`, and is invited by the first touch rather than demanded at
launch: iOS presents its dialog only from inside a real gesture, and a
universe that asked before it was touched would be asking for nothing.

Three-finger twist (season) and `pan2` stay unbound: UIKit's rotation
recogniser is a two-finger instrument, and the shape vocabulary has no pan2
case. They are answered, not implemented — the guide entry stays hidden
until the phenomenon can actually land.

The wave shader is Metal source embedded in `WaveShaders.swift` and compiled
once at `prepare()`. The kit ships both as a Swift package and as a CocoaPod,
and a `.metal` file would produce a `default.metallib` only one of those two
paths could find.

## Generated iOS ownership

`apps/native/ios/` is generated by `expo prebuild` and is intentionally ignored. It
contains no source of truth. The Expo module, Swift package, privacy manifest, and UI
tests live outside it. `plugins/withObjetUniverse.ts` records those roots;
`expo-build-properties` extraPods plus `ObjetUniverseKit.podspec` attach the Swift
authority sources after each clean prebuild.

Do not put native source directly in `apps/native/ios/`.
