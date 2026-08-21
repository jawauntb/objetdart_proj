import Foundation

/// Keeps React at the boundary: the active scientific kernel, clock, and stable
/// checkpoint live here and remain alive while JavaScript replaces overlays.
public final class UniverseHost {
  public typealias KernelFactory = (SceneID) -> SimulationKernel
  private static let observabilityCapacity = 64

  public private(set) var activeScene: SceneID
  public private(set) var committedScenes: [SceneID]
  public private(set) var telemetry = UniverseTelemetry()
  public private(set) var boundaries: [HostBoundary] = []
  public private(set) var lastStableCheckpoint: KernelCheckpoint

  private let factory: KernelFactory
  private var activeKernel: SimulationKernel
  private var clock = UniverseClock()
  private struct PendingCommand {
    let scene: SceneID
    let command: SemanticCommand
  }
  private var pendingCommands: [Int: PendingCommand] = [:]
  private var suspended = false
  private var retired = false

  public init(initial: SimulationKernel, factory: @escaping KernelFactory) {
    activeKernel = initial
    activeScene = initial.scene
    committedScenes = [initial.scene]
    self.factory = factory
    lastStableCheckpoint = .init(scene: initial.scene, tick: 0, digest: "initial")
    initial.prepare()
    initial.activate()
  }

  /// Whether the active medium says this verb in its own material. The input
  /// layer asks before it commits: a verb the medium cannot express is
  /// answered in the hand and the ear instead of being scheduled onto a tick
  /// that would change nothing.
  public func expresses(_ verb: SemanticVerb) -> Bool {
    guard !retired else { return false }
    return activeKernel.expresses(verb)
  }

  @discardableResult
  public func apply(_ command: SemanticCommand) -> CommandDisposition {
    guard !retired, let ordinal = clock.enqueue(actionAt: command.at) else { return .rejected }
    record(.previewed)
    record(.durablyAppended)
    pendingCommands[ordinal] = PendingCommand(scene: activeScene, command: command)
    return .scheduled
  }

  @discardableResult
  public func advance(to presentationTime: TimeInterval) -> ClockFrame {
    let frame = clock.advance(to: presentationTime)
    telemetry.logicalTick = clock.logicalTick
    if frame.droppedDebt { telemetry.droppedFrameDebt += 1 }
    guard !retired else { return frame }
    for step in frame.steps {
      for ordinal in step.actionOrdinals {
        guard let pending = pendingCommands.removeValue(forKey: ordinal) else {
          telemetry.quarantinedOutputs += 1
          record(.outputQuarantined)
          continue
        }
        guard pending.scene == activeScene else {
          telemetry.quarantinedOutputs += 1
          record(.outputQuarantined)
          continue
        }
        _ = promote(activeKernel.apply(pending.command))
      }
      _ = promote(activeKernel.advance(ticks: 1))
    }
    return frame
  }

  public func suspend() {
    guard !suspended, !retired else { return }
    suspended = true
    clock.suspend()
    activeKernel.freeze()
  }

  public func resume(at presentationTime: TimeInterval = ProcessInfo.processInfo.systemUptime) {
    guard suspended, !retired else { return }
    suspended = false
    clock.resume(at: presentationTime)
    activeKernel.activate()
  }

  /// A handoff has one commit point: identity changes only after the destination is
  /// prepared and the source has frozen. Repeated requests are no-ops.
  @discardableResult
  public func handoff(to destinationScene: SceneID) throws -> Bool {
    guard destinationScene != activeScene, !retired else { return false }
    let destination = factory(destinationScene)
    guard destination.scene == destinationScene else {
      throw UniverseHostError.factoryReturnedWrongScene(expected: destinationScene, actual: destination.scene)
    }

    destination.prepare()
    let source = activeKernel
    if !suspended { source.freeze() }
    activeKernel = destination
    activeScene = destinationScene
    appendCommittedScene(destinationScene)
    telemetry.handoffs += 1
    if !suspended { destination.activate() }
    source.retire()
    return true
  }

  /// Teardown is terminal: future overlay churn cannot leave the active kernel alive.
  public func shutdown() {
    guard !retired else { return }
    if !suspended { activeKernel.freeze() }
    activeKernel.retire()
    pendingCommands.removeAll(keepingCapacity: false)
    clock.suspend()
    retired = true
  }

  private func promote(_ output: KernelOutput) -> CommandDisposition {
    guard output.stable, output.checkpoint.scene == activeScene else {
      telemetry.quarantinedOutputs += 1
      record(.outputQuarantined)
      return .quarantined
    }
    record(.authoritativelyApplied)
    lastStableCheckpoint = output.checkpoint
    record(.checkpointPromoted)
    record(.uiAcknowledged)
    record(.sensoryConfirmed)
    return .committed
  }

  private func record(_ boundary: HostBoundary) {
    boundaries.append(boundary)
    if boundaries.count > Self.observabilityCapacity { boundaries.removeFirst() }
  }

  private func appendCommittedScene(_ scene: SceneID) {
    committedScenes.append(scene)
    if committedScenes.count > Self.observabilityCapacity { committedScenes.removeFirst() }
  }
}
