import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender
#if canImport(Metal) && canImport(QuartzCore)
import Metal
import QuartzCore
#endif

final class SolarSubmissionTests: XCTestCase {
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

  func testSceneSelectionKeepsSolarOffTheScalarFieldRenderer() {
    XCTAssertEqual(SceneRendererSelection(scene: .wave), .field)
    XCTAssertEqual(SceneRendererSelection(scene: .cell), .field)
    XCTAssertEqual(SceneRendererSelection(scene: .molecules), .field)
    XCTAssertEqual(SceneRendererSelection(scene: .atoms), .field)
    XCTAssertEqual(SceneRendererSelection(scene: .solar), .solar)
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
  func testSolarFrameLeaseDropsInsteadOfBlockingWhenGPUIsBehind() {
    let pool = SolarFrameLeasePool(capacity: 3)
    XCTAssertTrue(pool.tryAcquire())
    XCTAssertTrue(pool.tryAcquire())
    XCTAssertTrue(pool.tryAcquire())
    XCTAssertFalse(pool.tryAcquire(), "the display link must drop rather than wait for the GPU")
    pool.release()
    XCTAssertTrue(pool.tryAcquire())
    pool.release()
    pool.release()
    pool.release()
  }

  func testSolarPipelinesPublishAsOneAtomicReadyBundle() {
    let publication = SolarPipelinePublication<(Int, Int, Int, Int)>()
    XCTAssertTrue(publication.beginPreparation())
    XCTAssertFalse(publication.beginPreparation(), "only one background compiler may own preparation")
    XCTAssertNil(publication.snapshot(), "rendering must not observe a partial pipeline set")

    publication.publish((1, 2, 3, 4))
    let ready = publication.snapshot()
    XCTAssertEqual(ready?.0, 1)
    XCTAssertEqual(ready?.3, 4)
    XCTAssertFalse(publication.beginPreparation(), "a ready bundle must be reused")
  }

  func testRetiredSolarRendererRejectsLatePipelinePublication() {
    let publication = SolarPipelinePublication<Int>()
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
    XCTAssertTrue(SceneRendererFactory.make(for: .solar, layer: layer, waveBreathSeconds: 7) is SolarRenderer)
  }
  #endif
}
