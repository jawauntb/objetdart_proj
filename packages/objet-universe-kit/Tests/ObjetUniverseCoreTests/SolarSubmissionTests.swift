import Foundation
import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender
#if canImport(Metal) && canImport(QuartzCore)
import Metal
import QuartzCore
#endif

final class SolarSubmissionTests: XCTestCase {
  func testAtomSnapshotIsForwardedOnlyWhileHostIsRunning() {
    let kernel = AtomKernel(seed: 0xA70A)
    let host = RenderHost()
    let renderer = RendererProbe(kind: .metal)
    host.install(renderer)

    kernel.withAtomRenderSnapshot { host.submitAtoms($0) }
    XCTAssertEqual(renderer.submittedAtomCount, 0)

    host.resume()
    kernel.withAtomRenderSnapshot { host.submitAtoms($0) }
    XCTAssertEqual(renderer.submittedAtomCount, 1)
    XCTAssertEqual(renderer.lastAtomBodyCount, kernel.atoms.count)
    XCTAssertEqual(renderer.lastAtomTick, 0)

    host.suspend()
    kernel.withAtomRenderSnapshot { host.submitAtoms($0) }
    XCTAssertEqual(renderer.submittedAtomCount, 1)
  }

  func testMoleculeSnapshotIsForwardedOnlyWhileHostIsRunning() {
    let kernel = MoleculeKernel(seed: 0xC8E0)
    let host = RenderHost()
    let renderer = RendererProbe(kind: .metal)
    host.install(renderer)

    kernel.withMoleculeRenderSnapshot { host.submitMolecules($0) }
    XCTAssertEqual(renderer.submittedMoleculeCount, 0)

    host.resume()
    kernel.withMoleculeRenderSnapshot { host.submitMolecules($0) }
    XCTAssertEqual(renderer.submittedMoleculeCount, 1)
    XCTAssertEqual(renderer.lastMoleculeBodyCount, kernel.molecules.count)
    XCTAssertEqual(renderer.lastMoleculeTick, 0)

    host.suspend()
    kernel.withMoleculeRenderSnapshot { host.submitMolecules($0) }
    XCTAssertEqual(renderer.submittedMoleculeCount, 1)
  }

  func testSolarSnapshotIsForwardedOnlyWhileHostIsRunning() {
    let kernel = SolarKernel(seed: 0x501A)
    let host = RenderHost()
    let renderer = RendererProbe(kind: .metal)
    host.install(renderer)

    kernel.withSolarRenderSnapshot { host.submitSolar($0) }
    XCTAssertEqual(renderer.submittedSolarCount, 0)

    host.resume()
    kernel.withSolarRenderSnapshot { host.submitSolar($0) }
    XCTAssertEqual(renderer.submittedSolarCount, 1)
    XCTAssertEqual(renderer.lastSolarBodyCount, kernel.bodies.count)
    XCTAssertEqual(renderer.lastSolarTick, 0)

    host.suspend()
    kernel.withSolarRenderSnapshot { host.submitSolar($0) }
    XCTAssertEqual(renderer.submittedSolarCount, 1)
  }

  func testSolarSnapshotCarriesEachWorldsStableMaterialSeed() {
    let kernel = SolarKernel(seed: 0x501A)
    kernel.withSolarRenderSnapshot { snapshot in
      XCTAssertEqual(
        snapshot.bodies.map(\.materialSeed),
        kernel.bodies.map(\.seed),
        "the renderer's surface identity must come from the authoritative world seed"
      )
    }
  }

  func testPublicSceneSelectionKeepsScalarLanesSourceCompatible() {
    XCTAssertEqual(SceneRendererSelection(scene: .wave), .field)
    XCTAssertEqual(SceneRendererSelection(scene: .cell), .field)
    XCTAssertEqual(SceneRendererSelection(scene: .molecules), .field)
    XCTAssertEqual(SceneRendererSelection(scene: .atoms), .field)
    XCTAssertEqual(SceneRendererSelection(scene: .solar), .solar)
  }

  func testSceneConstructionRetriesAreCadencedBoundedAndRearmedOnlyAtABoundary() {
    let retries = SceneConstructionRetryPolicy()
    retries.reset(at: 10)

    XCTAssertTrue(retries.beginAttempt(at: 10))
    XCTAssertFalse(retries.beginAttempt(at: 10.5), "layout churn must not bypass the retry cadence")
    XCTAssertTrue(retries.beginAttempt(at: 11))
    XCTAssertTrue(retries.beginAttempt(at: 12))
    XCTAssertFalse(retries.beginAttempt(at: 13), "a persistent allocation failure must reach a terminal retry state")
    XCTAssertEqual(retries.attempts, SceneConstructionRetryPolicy.maximumAttempts)

    retries.reset(at: 20)
    XCTAssertTrue(retries.beginAttempt(at: 20), "a foreground return or new route request gets one fresh bounded window")
  }

  func testReplacingSolarRendererRetiresOldOwnerBeforeNextSubmission() {
    let kernel = SolarKernel(seed: 0xCAFE)
    let host = RenderHost()
    let first = RendererProbe(kind: .metal)
    let replacement = RendererProbe(kind: .metal)
    host.install(first)
    host.resume()
    kernel.withSolarRenderSnapshot { host.submitSolar($0) }

    host.install(replacement)
    kernel.withSolarRenderSnapshot { host.submitSolar($0) }
    host.suspend()

    XCTAssertEqual(first.submittedSolarCount, 1)
    XCTAssertEqual(first.retireCount, 1)
    XCTAssertEqual(replacement.prepareCount, 1)
    XCTAssertEqual(replacement.resumeCount, 1)
    XCTAssertEqual(replacement.submittedSolarCount, 1)
    XCTAssertEqual(replacement.suspendCount, 1)
  }

  func testReplacingMoleculeRendererRetiresOldOwnerBeforeNextSubmission() {
    let kernel = MoleculeKernel(seed: 0xC8E0)
    let host = RenderHost()
    let first = RendererProbe(kind: .metal)
    let replacement = RendererProbe(kind: .metal)
    host.install(first)
    host.resume()
    kernel.withMoleculeRenderSnapshot { host.submitMolecules($0) }

    host.install(replacement)
    kernel.withMoleculeRenderSnapshot { host.submitMolecules($0) }
    host.suspend()

    XCTAssertEqual(first.submittedMoleculeCount, 1)
    XCTAssertEqual(first.retireCount, 1)
    XCTAssertEqual(replacement.prepareCount, 1)
    XCTAssertEqual(replacement.resumeCount, 1)
    XCTAssertEqual(replacement.submittedMoleculeCount, 1)
    XCTAssertEqual(replacement.suspendCount, 1)
  }

  func testOpenSkyCameraIntentIsBoundedReversibleAndPresentationOnly() {
    var camera = SolarCameraState()
    camera.apply(translation: .zero, velocity: .zero, phase: .enter)
    camera.apply(
      translation: SemanticVector(x: 40, y: -40),
      velocity: SemanticVector(x: 90, y: -90),
      phase: .tick
    )
    XCTAssertGreaterThanOrEqual(camera.yaw, -Double.pi)
    XCTAssertLessThanOrEqual(camera.yaw, Double.pi)
    XCTAssertEqual(camera.pitch, -0.42, accuracy: 0.0001)

    camera.apply(translation: .zero, velocity: .zero, phase: .cancel)
    XCTAssertEqual(camera.yaw, 0, accuracy: 0.0001)
    XCTAssertEqual(camera.pitch, 0.12, accuracy: 0.0001)

    camera.apply(translation: .zero, velocity: .zero, phase: .enter)
    camera.apply(
      translation: SemanticVector(x: 0.2, y: 0.1),
      velocity: SemanticVector(x: 4, y: 2),
      phase: .release
    )
    let released = camera
    camera.advancePresentationFrame(deltaSeconds: 1.0 / 60.0)
    XCTAssertNotEqual(camera, released, "release velocity must create bounded presentation inertia")
  }

  func testCameraInertiaIsEquivalentAtThirtyAndSixtyHertz() {
    func trace(hz: Int) -> SolarCameraState {
      var camera = SolarCameraState()
      camera.apply(translation: .zero, velocity: .zero, phase: .enter)
      camera.apply(
        translation: SemanticVector(x: 0.18, y: 0.08),
        velocity: SemanticVector(x: 2.4, y: 1.1),
        phase: .release
      )
      for _ in 0 ..< hz {
        camera.advancePresentationFrame(deltaSeconds: 1.0 / Double(hz))
      }
      return camera
    }

    let thirty = trace(hz: 30)
    let sixty = trace(hz: 60)
    XCTAssertEqual(thirty.yaw, sixty.yaw, accuracy: 1e-12)
    XCTAssertEqual(thirty.pitch, sixty.pitch, accuracy: 1e-12)
  }

  func testCameraInverseProjectionMatchesPortraitAndLandscapeCover() {
    var camera = SolarCameraState()
    camera.apply(translation: .zero, velocity: .zero, phase: .enter)
    camera.apply(
      translation: SemanticVector(x: 1.0 / (2 * 0.72), y: -0.12 / 0.82),
      velocity: .zero,
      phase: .tick
    )

    let portrait = MaterialProjection.materialPoint(
      viewX: 0.75,
      viewY: 0.25,
      viewportWidth: 390,
      viewportHeight: 844
    )
    let portraitWorld = camera.projectMaterialPoint(portrait)
    XCTAssertEqual(portraitWorld.x, portrait.y, accuracy: 1e-12)
    XCTAssertEqual(portraitWorld.y, 1 - portrait.x, accuracy: 1e-12)

    let landscape = MaterialProjection.materialPoint(
      viewX: 0.75,
      viewY: 0.25,
      viewportWidth: 844,
      viewportHeight: 390
    )
    let landscapeWorld = camera.projectMaterialPoint(landscape)
    XCTAssertEqual(landscapeWorld.x, landscape.y, accuracy: 1e-12)
    XCTAssertEqual(landscapeWorld.y, 1 - landscape.x, accuracy: 1e-12)

    let vector = camera.projectMaterialVector(SemanticVector(x: 0.2, y: -0.1))
    XCTAssertEqual(vector.x, -0.1, accuracy: 1e-12)
    XCTAssertEqual(vector.y, -0.2, accuracy: 1e-12)
  }

  #if canImport(Metal) && canImport(QuartzCore)
  func testMetalFrameSlotsDropInsteadOfBlockingAndReturnTheirOwnResources() throws {
    let pool = MetalFrameSlotPool(capacity: 3)
    let first = try XCTUnwrap(pool.tryAcquire())
    let second = try XCTUnwrap(pool.tryAcquire())
    let third = try XCTUnwrap(pool.tryAcquire())
    XCTAssertNil(pool.tryAcquire(), "the display link must drop rather than wait for the GPU")

    pool.release(second)
    let returned = try XCTUnwrap(pool.tryAcquire())
    XCTAssertEqual(
      returned,
      second,
      "a completed frame must return its own resources, not an arbitrary in-flight slot"
    )
    pool.release(returned)
    pool.release(first)
    pool.release(third)
  }

  func testMetalPipelinesPublishAsOneAtomicReadyBundle() {
    let publication = MetalPipelinePublication<(Int, Int, Int, Int)>()
    XCTAssertTrue(publication.beginPreparation())
    XCTAssertFalse(publication.beginPreparation(), "only one background compiler may own preparation")
    XCTAssertNil(publication.snapshot(), "rendering must not observe a partial pipeline set")

    publication.publish((1, 2, 3, 4))
    let ready = publication.snapshot()
    XCTAssertEqual(ready?.0, 1)
    XCTAssertEqual(ready?.3, 4)
    XCTAssertFalse(publication.beginPreparation(), "a ready bundle must be reused")
  }

  func testMetalPipelinePreparationCanRetryAfterFailure() {
    let publication = MetalPipelinePublication<Int>()
    XCTAssertTrue(publication.beginPreparation())
    XCTAssertTrue(publication.isPreparing())
    publication.failPreparation()

    XCTAssertNil(publication.snapshot(), "a failed compiler must publish no partial pipeline")
    XCTAssertFalse(publication.isPreparing())
    XCTAssertTrue(publication.beginPreparation(), "a failed compiler must release preparation for a later retry")
    publication.publish(42)
    XCTAssertEqual(publication.snapshot(), 42)
  }

  func testMetalPipelineRetryPolicyKeepsTheTransitionBriefThenShowsItsOwnGround() {
    let policy = MetalPipelineRetryPolicy()
    XCTAssertEqual(policy.nextAction(isPreparing: true), .retainCurrentDrawable)

    for attempt in 1 ... MetalPipelineRetryPolicy.maximumPreparationAttempts {
      policy.recordPreparationAttempt()
      if attempt == MetalPipelineRetryPolicy.maximumPreparationAttempts {
        XCTAssertEqual(policy.nextAction(isPreparing: false), .presentFallback)
        XCTAssertEqual(policy.nextAction(isPreparing: false), .retainCurrentDrawable)
        continue
      }
      XCTAssertEqual(policy.nextAction(isPreparing: false), .retainCurrentDrawable)
      XCTAssertEqual(policy.nextAction(isPreparing: false), .retainCurrentDrawable)
      XCTAssertEqual(policy.nextAction(isPreparing: false), .retryPreparation)
    }
    for _ in 0 ..< (MetalPipelineRetryPolicy.fallbackRearmFrames - 1) {
      XCTAssertEqual(policy.nextAction(isPreparing: false), .retainCurrentDrawable)
    }
    XCTAssertEqual(policy.nextAction(isPreparing: false), .retryPreparation)

    for _ in 0 ..< MetalPipelineRetryPolicy.maximumPreparationAttempts {
      policy.recordPreparationAttempt()
    }
    XCTAssertEqual(policy.nextAction(isPreparing: false), .presentFallback)
    XCTAssertEqual(policy.nextAction(isPreparing: false), .retainCurrentDrawable)

    policy.resetAfterSuspend()
    XCTAssertEqual(policy.nextAction(isPreparing: false), .retryPreparation)
    policy.recordPreparationAttempt()
    policy.recordPipelineReady()
    XCTAssertEqual(policy.preparationAttempts, 0)
  }

  func testRetiredMetalRendererRejectsLatePipelinePublication() {
    let publication = MetalPipelinePublication<Int>()
    XCTAssertTrue(publication.beginPreparation())
    publication.retire()
    publication.publish(42)

    XCTAssertNil(publication.snapshot())
    XCTAssertFalse(publication.beginPreparation())
  }
  #endif

  func testRenderHostForwardsCameraIntentOnlyToAnActiveRenderer() {
    let host = RenderHost()
    let renderer = RendererProbe(kind: .metal)
    host.install(renderer)
    host.orientSolarCamera(by: .zero, velocity: .zero, phase: .enter)
    XCTAssertEqual(renderer.solarCameraIntentCount, 0)
    host.resume()
    host.orientSolarCamera(by: .zero, velocity: .zero, phase: .enter)
    XCTAssertEqual(renderer.solarCameraIntentCount, 1)
    host.suspend()
    host.orientSolarCamera(by: .zero, velocity: .zero, phase: .release)
    XCTAssertEqual(renderer.solarCameraIntentCount, 1)
  }

  func testRenderHostCarriesReducedMotionToExistingAndReplacementMaterials() {
    let host = RenderHost()
    host.setReducedMotion(true)

    let first = RendererProbe(kind: .metal)
    host.install(first)
    XCTAssertEqual(first.reducedMotion, true)

    host.setReducedMotion(false)
    XCTAssertEqual(first.reducedMotion, false)

    let replacement = RendererProbe(kind: .metal)
    host.install(replacement)
    XCTAssertEqual(replacement.reducedMotion, false)
  }

  #if canImport(Metal) && canImport(QuartzCore)
  func testFactoryBuildsTheMaterialSpecificRendererWhenMetalExists() throws {
    guard MTLCreateSystemDefaultDevice() != nil else {
      if ProcessInfo.processInfo.environment["CI"] == "true" {
        XCTFail("Native CI must expose Metal for renderer factory coverage")
        return
      }
      throw XCTSkip("local host exposes no Metal device")
    }
    let layer = CAMetalLayer()
    XCTAssertTrue(SceneRendererFactory.make(for: .wave, layer: layer, waveBreathSeconds: 7) is WaveMaterialRenderer)
    XCTAssertTrue(SceneRendererFactory.make(for: .atoms, layer: layer, waveBreathSeconds: 7) is AtomRenderer)
    XCTAssertTrue(SceneRendererFactory.make(for: .molecules, layer: layer, waveBreathSeconds: 7) is MoleculeRenderer)
    XCTAssertTrue(SceneRendererFactory.make(for: .cell, layer: layer, waveBreathSeconds: 7) is CellMaterialRenderer)
    XCTAssertTrue(SceneRendererFactory.make(for: .solar, layer: layer, waveBreathSeconds: 7) is SolarRenderer)
  }

  func testCellRendererAcceptsTheAuthoritativeCellLatticeAndRejectsDrift() {
    let kernel = CellKernel(seed: 0xC311_C011)
    XCTAssertTrue(CellMaterialRenderer.acceptsFieldDimensions(width: kernel.width, height: kernel.height))
    XCTAssertFalse(CellMaterialRenderer.acceptsFieldDimensions(width: kernel.width - 1, height: kernel.height))
    XCTAssertFalse(CellMaterialRenderer.acceptsFieldDimensions(width: kernel.width, height: kernel.height + 1))
  }

  func testWaveRendererAdmitsOnlyItsAuthoritativeWaterSubmission() {
    let field = WaveField(seed: 0x57A7_E)
    XCTAssertTrue(WaveMaterialRenderer.acceptsSubmission(
      materialKind: 0,
      width: field.width,
      height: field.height
    ))
    for materialKind in [1, 3] {
      XCTAssertFalse(WaveMaterialRenderer.acceptsSubmission(
        materialKind: materialKind,
        width: field.width,
        height: field.height
      ))
    }
    XCTAssertFalse(WaveMaterialRenderer.acceptsSubmission(
      materialKind: 0,
      width: field.width - 1,
      height: field.height
    ))
    XCTAssertFalse(WaveMaterialRenderer.acceptsSubmission(
      materialKind: 0,
      width: field.width,
      height: field.height + 1
    ))
  }

  func testMoleculeRendererAdmitsOnlyTheBoundedAuthoritativeSnapshot() {
    let molecule = MoleculeKernel(seed: 0xC0DE)
    molecule.withMoleculeRenderSnapshot { snapshot in
      XCTAssertTrue(MoleculeRenderer.acceptsSnapshot(bodyCount: snapshot.bodies.count))
    }
    XCTAssertFalse(MoleculeRenderer.acceptsSnapshot(bodyCount: MoleculeKernel.maximumMolecules + 1))
    XCTAssertFalse(MoleculeRenderer.acceptsSnapshot(bodyCount: -1))
  }

  func testMoleculeRendererPacksCompoundGeometryWithoutInventingIdentity() throws {
    let records = [
      MoleculeRenderBody(
        position: SIMD2<Float>(-0.2, 0.3), velocity: SIMD2<Float>(0.1, -0.2), compoundIndex: 0,
        shape: .bent, atomCount: 3, vibration: 1.4
      ),
      MoleculeRenderBody(
        position: SIMD2<Float>(0.4, -0.1), velocity: SIMD2<Float>(-0.3, 0.2), compoundIndex: 99,
        shape: .ionic, atomCount: 9, vibration: -0.4
      ),
    ]
    var packed = [MoleculeGPUBody](repeating: MoleculeGPUBody(), count: MoleculeKernel.maximumMolecules)
    try records.withUnsafeBufferPointer { bodies in
      let snapshot = MoleculeRenderSnapshot(
        tick: 7,
        elapsedSeconds: 1.5,
        secondsPerTick: UniverseClock.defaultStepSeconds,
        representation: 2,
        reactionEnergy: 572,
        bodies: bodies
      )
      let bodyCount = try XCTUnwrap(packed.withUnsafeMutableBufferPointer {
        MoleculeRenderer.pack(snapshot, bodies: $0)
      })
      XCTAssertEqual(bodyCount, 2)
    }
    XCTAssertEqual(packed[0].positionVibration, SIMD4<Float>(-0.2, 0.3, 1, 0))
    XCTAssertEqual(packed[0].geometryVelocity, SIMD4<Float>(0, 3, 0.1, -0.2))
    XCTAssertEqual(packed[1].positionVibration, SIMD4<Float>(0.4, -0.1, 0, 7))
    XCTAssertEqual(packed[1].geometryVelocity, SIMD4<Float>(5, 5, -0.3, 0.2))
  }

  func testMoleculeRendererRejectsMalformedOrOversizedUploads() {
    let valid = MoleculeRenderBody(
      position: SIMD2<Float>(0, 0), velocity: SIMD2<Float>(0, 0), compoundIndex: 0,
      shape: .bent, atomCount: 3, vibration: 0.5
    )

    func pack(_ records: [MoleculeRenderBody], destinationCount: Int) -> Int? {
      var destination = [MoleculeGPUBody](repeating: MoleculeGPUBody(), count: destinationCount)
      return records.withUnsafeBufferPointer { bodies in
        let snapshot = MoleculeRenderSnapshot(
          tick: 0,
          elapsedSeconds: 0,
          secondsPerTick: UniverseClock.defaultStepSeconds,
          representation: 0,
          reactionEnergy: 0,
          bodies: bodies
        )
        return destination.withUnsafeMutableBufferPointer {
          MoleculeRenderer.pack(snapshot, bodies: $0)
        }
      }
    }

    XCTAssertNil(pack([valid], destinationCount: MoleculeKernel.maximumMolecules - 1))
    XCTAssertNil(pack(
      Array(repeating: valid, count: MoleculeKernel.maximumMolecules + 1),
      destinationCount: MoleculeKernel.maximumMolecules
    ))
    XCTAssertNil(pack([
      MoleculeRenderBody(
        position: SIMD2<Float>(.nan, 0), velocity: .zero, compoundIndex: 0,
        shape: .bent, atomCount: 3, vibration: 0.5
      ),
    ], destinationCount: MoleculeKernel.maximumMolecules))
    XCTAssertNil(pack([
      MoleculeRenderBody(
        position: .zero, velocity: SIMD2<Float>(.infinity, 0), compoundIndex: 0,
        shape: .bent, atomCount: 3, vibration: 0.5
      ),
    ], destinationCount: MoleculeKernel.maximumMolecules))
    XCTAssertNil(pack([
      MoleculeRenderBody(
        position: .zero, velocity: .zero, compoundIndex: 0,
        shape: .bent, atomCount: 3, vibration: .nan
      ),
    ], destinationCount: MoleculeKernel.maximumMolecules))
  }

  func testAtomRendererAdmitsTheBoundedAuthoritativeSnapshotOnly() {
    let atom = AtomKernel(seed: 0xA70A)
    atom.withAtomRenderSnapshot { snapshot in
      XCTAssertTrue(AtomRenderer.acceptsSnapshot(bodyCount: snapshot.bodies.count, bondCount: snapshot.bonds.count))
    }
    XCTAssertFalse(AtomRenderer.acceptsSnapshot(bodyCount: AtomKernel.maximumAtoms + 1, bondCount: 0))
    XCTAssertFalse(AtomRenderer.acceptsSnapshot(
      bodyCount: 0,
      bondCount: AtomKernel.maximumAtoms * (AtomKernel.maximumAtoms - 1) / 2 + 1
    ))
    XCTAssertFalse(AtomRenderer.acceptsSnapshot(bodyCount: -1, bondCount: 0))
  }

  func testAtomRendererPacksKernelBodiesAndFiltersMalformedInRangeBonds() throws {
    let records = [
      AtomRenderBody(
        position: SIMD2<Float>(-0.2, 0.3), velocity: SIMD2<Float>(0.1, -0.2), atomicNumber: 6,
        shellCount: 2, valence: 4, excitation: 1.4
      ),
      AtomRenderBody(
        position: SIMD2<Float>(0.4, -0.1), velocity: SIMD2<Float>(-0.3, 0.2), atomicNumber: 8,
        shellCount: 2, valence: 2, excitation: -0.4
      ),
    ]
    let relations = [
      AtomRenderBond(firstIndex: 0, secondIndex: 1, order: 2),
      AtomRenderBond(firstIndex: 1, secondIndex: 1, order: 1),
      AtomRenderBond(firstIndex: 0, secondIndex: 2, order: 1),
    ]
    var packedBodies = [AtomGPUBody](repeating: AtomGPUBody(), count: AtomKernel.maximumAtoms)
    var packedBonds = [AtomGPUBond](
      repeating: AtomGPUBond(),
      count: AtomKernel.maximumAtoms * (AtomKernel.maximumAtoms - 1) / 2
    )

    try records.withUnsafeBufferPointer { bodies in
      try relations.withUnsafeBufferPointer { bonds in
        let snapshot = AtomRenderSnapshot(
          tick: 7,
          elapsedSeconds: 1.5,
          secondsPerTick: UniverseClock.defaultStepSeconds,
          representation: 2,
          fusionEnergy: 0.75,
          bodies: bodies,
          bonds: bonds
        )
        let upload = try XCTUnwrap(packedBodies.withUnsafeMutableBufferPointer { packedBodies in
          packedBonds.withUnsafeMutableBufferPointer { packedBonds in
            AtomRenderer.pack(snapshot, bodies: packedBodies, bonds: packedBonds)
          }
        })
        XCTAssertEqual(upload.bodyCount, 2)
        XCTAssertEqual(upload.bondCount, 1)
      }
    }

    XCTAssertEqual(packedBodies[0].positionExcitation, SIMD4<Float>(-0.2, 0.3, 1, 6))
    XCTAssertEqual(packedBodies[1].positionExcitation, SIMD4<Float>(0.4, -0.1, 0, 8))
    XCTAssertEqual(packedBonds[0].endpoints, SIMD4<Float>(-0.2, 0.3, 0.4, -0.1))
    XCTAssertEqual(packedBonds[0].relation, SIMD4<Float>(2, 6, 8, 0.5))
  }

  func testMetalPipelineCacheLetsAnIndependentBuildProceedDuringAnotherKey() throws {
    guard let device = MTLCreateSystemDefaultDevice() else {
      throw XCTSkip("this local host exposes no Metal device")
    }
    let resources = try MetalCacheTestResources(device: device, source: Self.cacheShaderSource)
    let cache = MetalPipelineCache.shared
    let slowNamespace = "cache-slow-\(UUID().uuidString)"
    let fastNamespace = "cache-fast-\(UUID().uuidString)"
    let slowStarted = DispatchSemaphore(value: 0)
    let releaseSlow = DispatchSemaphore(value: 0)
    let fastStarted = DispatchSemaphore(value: 0)
    let slowFinished = expectation(description: "slow pipeline build finishes")
    let fastFinished = expectation(description: "independent pipeline build finishes")

    DispatchQueue.global(qos: .userInitiated).async {
      do {
        _ = try cache.pipeline(
          namespace: slowNamespace,
          device: resources.device,
          pixelFormat: .bgra8Unorm
        ) {
          slowStarted.signal()
          releaseSlow.wait()
          return try resources.makePipeline()
        }
      } catch {
        XCTFail("slow cache build failed: \(error)")
      }
      slowFinished.fulfill()
    }

    XCTAssertEqual(slowStarted.wait(timeout: .now() + 1), .success)
    defer {
      releaseSlow.signal()
      wait(for: [slowFinished, fastFinished], timeout: 5)
    }

    DispatchQueue.global(qos: .userInitiated).async {
      do {
        _ = try cache.pipeline(
          namespace: fastNamespace,
          device: resources.device,
          pixelFormat: .bgra8Unorm
        ) {
          fastStarted.signal()
          return try resources.makePipeline()
        }
      } catch {
        XCTFail("independent cache build failed: \(error)")
      }
      fastFinished.fulfill()
    }

    XCTAssertEqual(
      fastStarted.wait(timeout: .now() + 1),
      .success,
      "a slow Cell-like build must not hold the cache lock across an unrelated pipeline build"
    )
  }

  private static let cacheShaderSource = """
  #include <metal_stdlib>
  using namespace metal;

  vertex float4 objet_cache_vertex(uint vertexID [[vertex_id]]) {
    float2 corners[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
    return float4(corners[vertexID], 0.0, 1.0);
  }

  fragment half4 objet_cache_fragment() {
    return half4(0.0);
  }
  """

  private final class MetalCacheTestResources: @unchecked Sendable {
    let device: MTLDevice
    private let library: MTLLibrary

    init(device: MTLDevice, source: String) throws {
      self.device = device
      library = try device.makeLibrary(source: source, options: nil)
    }

    func makePipeline() throws -> MTLRenderPipelineState {
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = library.makeFunction(name: "objet_cache_vertex")
      descriptor.fragmentFunction = library.makeFunction(name: "objet_cache_fragment")
      descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
      return try device.makeRenderPipelineState(descriptor: descriptor)
    }
  }
  #endif
}
