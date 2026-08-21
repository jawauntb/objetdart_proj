import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender

final class RendererLifecycleTests: XCTestCase {
  func testSceneHandoffCommitsOnceForNormalInterruptedReversedAndBackgroundedRequests() throws {
    let source = ProbeKernel(scene: .wave)
    let cell = ProbeKernel(scene: .cell)
    let solar = ProbeKernel(scene: .solar)
    let host = UniverseHost(initial: source, factory: { scene in
      switch scene {
      case .wave: source
      case .cell: cell
      case .solar: solar
      case .molecules, .atoms: ProbeKernel(scene: scene)
      }
    })

    XCTAssertTrue(try host.handoff(to: .cell))
    XCTAssertFalse(try host.handoff(to: .cell))
    host.suspend()
    XCTAssertTrue(try host.handoff(to: .solar))
    host.resume()
    XCTAssertTrue(try host.handoff(to: .wave))

    XCTAssertEqual(host.committedScenes, [.wave, .cell, .solar, .wave])
    XCTAssertEqual(source.freezeCount, 1)
    XCTAssertEqual(cell.freezeCount, 1, "a background handoff cannot freeze its source twice")
    XCTAssertEqual(solar.freezeCount, 1, "a background-created destination stays prepared until resume")
    XCTAssertEqual(cell.activateCount, 1)
    XCTAssertEqual(solar.activateCount, 1)
  }

  func testInvalidKernelOutputCannotReplaceStableCheckpoint() {
    let kernel = ProbeKernel(scene: .wave)
    let host = UniverseHost(initial: kernel, factory: { _ in kernel })
    _ = host.advance(to: 0)
    XCTAssertEqual(host.apply(.init(id: "first", verb: .material, at: 0)), .scheduled)
    _ = host.advance(to: 1.0 / 120.0)
    let stable = host.lastStableCheckpoint
    kernel.nextOutputIsStable = false

    let result = host.apply(.init(id: "bad", verb: .material, at: 1.0 / 120.0))
    _ = host.advance(to: 2.0 / 120.0)

    XCTAssertEqual(result, .scheduled)
    XCTAssertEqual(host.lastStableCheckpoint, stable)
    XCTAssertGreaterThanOrEqual(host.telemetry.quarantinedOutputs, 1)
  }

  func testCommittedCommandReceiptCarriesOnlyKernelAuthoredHistoryAfterCheckpointPromotion() {
    let kernel = ProbeKernel(scene: .solar)
    kernel.historyKind = .birth
    let host = UniverseHost(initial: kernel, factory: { _ in kernel })
    _ = host.advance(to: 0)
    let command = SemanticCommand(id: "star-birth", verb: .ceremony, at: 0)

    XCTAssertEqual(host.apply(command), .scheduled)
    XCTAssertTrue(host.drainCommittedCommandReceipts().isEmpty, "scheduling is not a committed event")
    _ = host.advance(to: 1.0 / 120.0)

    let receipts = host.drainCommittedCommandReceipts()
    XCTAssertEqual(receipts.count, 1)
    XCTAssertEqual(receipts.first?.command.id, "star-birth")
    XCTAssertEqual(receipts.first?.historyKind, .birth)
    XCTAssertTrue(host.drainCommittedCommandReceipts().isEmpty)
  }

  func testQueuedCommandIsQuarantinedWhenItsSceneIsReplaced() throws {
    let source = TraceKernel(scene: .wave)
    let destination = TraceKernel(scene: .cell)
    let host = UniverseHost(initial: source, factory: { scene in
      scene == .cell ? destination : source
    })

    _ = host.advance(to: 0)
    XCTAssertEqual(host.apply(.init(id: "before-handoff", verb: .material, at: 0)), .scheduled)
    XCTAssertTrue(try host.handoff(to: .cell))
    _ = host.advance(to: 1.0 / 60.0)

    XCTAssertTrue(source.appliedAtTicks.isEmpty)
    XCTAssertTrue(destination.appliedAtTicks.isEmpty)
    XCTAssertEqual(host.telemetry.quarantinedOutputs, 1)
    XCTAssertTrue(host.boundaries.contains(.outputQuarantined))
  }

  func testObservabilityRetainsTheExactRecentWindow() {
    let kernel = ProbeKernel(scene: .wave)
    let host = UniverseHost(initial: kernel, factory: { _ in kernel })
    _ = host.advance(to: 0)

    for index in 0 ..< 13 {
      XCTAssertEqual(host.apply(.init(id: "action-\(index)", verb: .material, at: 0)), .scheduled)
    }
    _ = host.advance(to: 1.0 / 120.0)

    XCTAssertEqual(host.boundaries.count, 64)
    XCTAssertEqual(Array(host.boundaries.prefix(2)), [.previewed, .durablyAppended])
    XCTAssertEqual(host.boundaries.last, .sensoryConfirmed)
  }

  func testCommittedSceneHistoryRetainsTheExactRecentWindow() throws {
    let initial = ProbeKernel(scene: .wave)
    let host = UniverseHost(initial: initial, factory: { ProbeKernel(scene: $0) })
    let destinations = (0 ..< 65).map { $0.isMultiple(of: 2) ? SceneID.cell : .solar }

    for destination in destinations { XCTAssertTrue(try host.handoff(to: destination)) }

    let fullHistory = [SceneID.wave] + destinations
    XCTAssertEqual(host.committedScenes, Array(fullHistory.suffix(64)))
  }

  func testRenderHostOwnsOneClockAcrossAllProbesAndRetiresThem() {
    let renderHost = RenderHost()
    let metal = RendererProbe(kind: .metal)
    let reality = RendererProbe(kind: .realityKit)
    let skia = RendererProbe(kind: .skiaOverlay)
    renderHost.install(metal)
    renderHost.install(reality)
    renderHost.install(skia)

    renderHost.resume()
    renderHost.render(interpolation: -0.5)
    let replacementMetal = RendererProbe(kind: .metal)
    renderHost.install(replacementMetal)
    renderHost.render(interpolation: 1.5)
    renderHost.suspend()
    renderHost.retireAll()

    XCTAssertEqual(renderHost.clockStarts, 1)
    XCTAssertEqual(renderHost.activeRendererCount, 0)
    XCTAssertEqual(renderHost.renderedFrameCount, 2)
    XCTAssertEqual(metal.prepareCount, 1)
    XCTAssertEqual(metal.resumeCount, 1)
    XCTAssertEqual(metal.lastInterpolation, 0)
    XCTAssertEqual(metal.retireCount, 1)
    XCTAssertEqual(replacementMetal.prepareCount, 1)
    XCTAssertEqual(replacementMetal.resumeCount, 1)
    XCTAssertEqual(replacementMetal.lastInterpolation, 1)
    XCTAssertEqual(replacementMetal.suspendCount, 1)
    XCTAssertEqual(replacementMetal.retireCount, 1)
    XCTAssertEqual(reality.retireCount, 1)
    XCTAssertEqual(skia.retireCount, 1)
  }

  func testHostSuspensionIsClosedFormAtTheKernelBoundary() {
    let kernel = ProbeKernel(scene: .wave)
    let host = UniverseHost(initial: kernel, factory: { _ in kernel })
    _ = host.advance(to: 0)
    _ = host.advance(to: 1.0 / 60.0)
    XCTAssertEqual(host.lastStableCheckpoint.tick, 2)

    host.suspend()
    _ = host.advance(to: 121)
    XCTAssertEqual(host.lastStableCheckpoint.tick, 2)
    XCTAssertEqual(kernel.freezeCount, 1)

    host.resume(at: 121)
    let resumed = host.advance(to: 121 + 1.0 / 60.0)
    XCTAssertEqual(resumed.steps.count, 2)
    XCTAssertFalse(resumed.droppedDebt)
    XCTAssertEqual(host.lastStableCheckpoint.tick, 4)
    XCTAssertEqual(kernel.activateCount, 2)
  }

  func testHostShutdownRetiresTheActiveKernelExactlyOnce() {
    let kernel = ProbeKernel(scene: .wave)
    let host = UniverseHost(initial: kernel, factory: { _ in kernel })

    host.shutdown()
    host.shutdown()

    XCTAssertEqual(kernel.freezeCount, 1)
    XCTAssertEqual(kernel.retireCount, 1)
    XCTAssertEqual(host.apply(.init(id: "late", verb: .material, at: 0)), .rejected)
  }

  func testFactoryAndCheckpointMismatchesAreQuarantinedWithoutChangingTheActiveScene() {
    let source = ProbeKernel(scene: .wave)
    let wrong = ProbeKernel(scene: .solar)
    let host = UniverseHost(initial: source, factory: { _ in wrong })

    XCTAssertThrowsError(try host.handoff(to: .cell))
    XCTAssertEqual(host.activeScene, .wave)
    XCTAssertEqual(host.committedScenes, [.wave])
    XCTAssertEqual(source.freezeCount, 0)

    _ = host.advance(to: 0)
    source.outputScene = .cell
    _ = host.advance(to: 1.0 / 120.0)
    XCTAssertEqual(host.lastStableCheckpoint, .init(scene: .wave, tick: 0, digest: "initial"))
    XCTAssertEqual(host.telemetry.quarantinedOutputs, 1)
    XCTAssertEqual(host.boundaries.last, .outputQuarantined)
  }

  func testHostSchedulesCommandsOnTheSameTicksAtEveryPresentationRate() {
    let thirty = hostTrace(presentationRate: 30)
    let sixty = hostTrace(presentationRate: 60)
    let oneTwenty = hostTrace(presentationRate: 120)

    XCTAssertEqual(thirty.ticks, [1, 43, 133, 211])
    XCTAssertEqual(thirty.ticks, sixty.ticks)
    XCTAssertEqual(sixty.ticks, oneTwenty.ticks)
    XCTAssertEqual(thirty.checkpoint, sixty.checkpoint)
    XCTAssertEqual(sixty.checkpoint, oneTwenty.checkpoint)
  }

  private func hostTrace(presentationRate: Int) -> (ticks: [Int], checkpoint: KernelCheckpoint) {
    let kernel = TraceKernel(scene: .wave)
    let host = UniverseHost(initial: kernel, factory: { _ in kernel })
    _ = host.advance(to: 0)
    for (index, at) in [0.0, 0.35, 1.1, 1.75].enumerated() {
      XCTAssertEqual(host.apply(.init(id: "action-\(index)", verb: .material, at: at)), .scheduled)
    }
    for frame in 1 ... presentationRate * 2 {
      _ = host.advance(to: Double(frame) / Double(presentationRate))
    }
    return (kernel.appliedAtTicks, host.lastStableCheckpoint)
  }
}

private final class ProbeKernel: SimulationKernel {
  let scene: SceneID
  var nextOutputIsStable = true
  var outputScene: SceneID?
  var historyKind: NaturalHistoryKind?
  private(set) var prepareCount = 0
  private(set) var activateCount = 0
  private(set) var freezeCount = 0
  private(set) var retireCount = 0
  private var tick = 0

  init(scene: SceneID) { self.scene = scene }
  func prepare() { prepareCount += 1 }
  func activate() { activateCount += 1 }
  func freeze() { freezeCount += 1 }
  func retire() { retireCount += 1 }
  func apply(_ command: SemanticCommand) -> KernelOutput { output() }
  func advance(ticks: Int) -> KernelOutput {
    tick += ticks
    return output()
  }

  private func output() -> KernelOutput {
    .init(
      stable: nextOutputIsStable,
      checkpoint: .init(scene: outputScene ?? scene, tick: tick, digest: "\(scene.rawValue)-\(tick)"),
      historyKind: historyKind
    )
  }
}

private final class TraceKernel: SimulationKernel {
  let scene: SceneID
  private var tick = 0
  private(set) var appliedAtTicks: [Int] = []

  init(scene: SceneID) { self.scene = scene }
  func prepare() {}
  func activate() {}
  func freeze() {}
  func retire() {}
  func apply(_ command: SemanticCommand) -> KernelOutput {
    appliedAtTicks.append(tick + 1)
    return output()
  }
  func advance(ticks: Int) -> KernelOutput {
    tick += ticks
    return output()
  }

  private func output() -> KernelOutput {
    .init(stable: true, checkpoint: .init(scene: scene, tick: tick, digest: "trace-\(appliedAtTicks)"))
  }
}
