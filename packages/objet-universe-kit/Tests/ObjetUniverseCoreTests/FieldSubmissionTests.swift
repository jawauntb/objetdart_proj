import XCTest
@testable import ObjetUniverseRender

/// The wire between the active kernel and the material. A field that never
/// reaches the renderer is the same blank screen as a renderer that never
/// draws, so the forwarding rule is pinned rather than assumed.
final class FieldSubmissionTests: XCTestCase {
  private func submit(to host: RenderHost, width: Int, height: Int, exposure: Double) {
    var values = [Float](repeating: 0.5, count: width * height)
    values.withUnsafeBufferPointer { buffer in
      guard let base = buffer.baseAddress else { return XCTFail("empty field buffer") }
      host.submitField(
        FieldSubmission(
          values: base,
          width: width,
          height: height,
          elapsedSeconds: 2,
          secondsPerStep: 1.0 / 120.0,
          exposure: exposure
        )
      )
    }
  }

  func testASuspendedHostNeverUploadsIntoReleasedResources() {
    let host = RenderHost()
    let material = RendererProbe(kind: .metal)
    host.install(material)

    submit(to: host, width: 4, height: 4, exposure: 1)
    XCTAssertEqual(material.submittedFieldCount, 0, "an unstarted host has no GPU resources to fill")

    host.resume()
    submit(to: host, width: 4, height: 4, exposure: 2)
    XCTAssertEqual(material.submittedFieldCount, 1)
    XCTAssertEqual(material.lastFieldWidth, 4)
    XCTAssertEqual(material.lastFieldHeight, 4)
    XCTAssertEqual(material.lastExposure, 2)

    host.suspend()
    submit(to: host, width: 8, height: 8, exposure: 3)
    XCTAssertEqual(material.submittedFieldCount, 1, "a suspended renderer has retired its texture")
    XCTAssertEqual(material.lastFieldWidth, 4)
  }

  func testEveryFieldRendererSeesTheSameFrame() {
    let host = RenderHost()
    let material = RendererProbe(kind: .metal)
    let overlay = RendererProbe(kind: .skiaOverlay)
    host.install(material)
    host.install(overlay)
    host.resume()

    submit(to: host, width: 6, height: 3, exposure: 1.5)

    XCTAssertEqual(host.submittedFieldCount, 1)
    XCTAssertEqual(material.lastFieldWidth, 6)
    XCTAssertEqual(overlay.lastFieldWidth, 6)
    XCTAssertEqual(material.lastFieldHeight, 3)
    XCTAssertEqual(overlay.lastFieldHeight, 3)
  }
}
