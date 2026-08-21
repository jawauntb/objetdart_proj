import Foundation

/// Small, allocation-free stamps shared by bounded scalar projections.
///
/// The painter deliberately owns no simulation state. Kernels choose the
/// radius and value from their own ledgers; this utility only turns those
/// choices into the normalized field the renderer consumes.
public enum ScalarFieldPainter {
  public static func gaussian(
    x: Double,
    y: Double,
    radius: Double,
    value: Double,
    width: Int,
    height: Int,
    into output: inout UnsafeMutableBufferPointer<Float>
  ) {
    let px = (x * 0.5 + 0.5) * Double(width - 1)
    let py = (y * 0.5 + 0.5) * Double(height - 1)
    let r = max(1, radius)
    let minX = max(0, Int(px - r * 2))
    let maxX = min(width - 1, Int(px + r * 2))
    let minY = max(0, Int(py - r * 2))
    let maxY = min(height - 1, Int(py + r * 2))
    guard minX <= maxX, minY <= maxY else { return }
    for yIndex in minY ... maxY {
      for xIndex in minX ... maxX {
        let dx = Double(xIndex) - px
        let dy = Double(yIndex) - py
        let contribution = exp(-(dx * dx + dy * dy) / max(1, r * r)) * value
        output[yIndex * width + xIndex] = min(1, output[yIndex * width + xIndex] + Float(contribution))
      }
    }
  }
}
