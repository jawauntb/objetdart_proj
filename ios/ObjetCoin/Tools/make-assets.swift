import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct AppIconImage {
    let filename: String
    let points: Int
    let scale: Int
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assets = root.appendingPathComponent("ObjetCoin/Resources/Assets.xcassets")
let appIconDir = assets.appendingPathComponent("AppIcon.appiconset")
let launchDir = assets.appendingPathComponent("LaunchCoin.imageset")

let appIconImages = [
    AppIconImage(filename: "AppIcon-20@2x.png", points: 20, scale: 2),
    AppIconImage(filename: "AppIcon-20@3x.png", points: 20, scale: 3),
    AppIconImage(filename: "AppIcon-29@2x.png", points: 29, scale: 2),
    AppIconImage(filename: "AppIcon-29@3x.png", points: 29, scale: 3),
    AppIconImage(filename: "AppIcon-40@2x.png", points: 40, scale: 2),
    AppIconImage(filename: "AppIcon-40@3x.png", points: 40, scale: 3),
    AppIconImage(filename: "AppIcon-60@2x.png", points: 60, scale: 2),
    AppIconImage(filename: "AppIcon-60@3x.png", points: 60, scale: 3),
    AppIconImage(filename: "AppIcon-1024.png", points: 1024, scale: 1),
]

try FileManager.default.createDirectory(at: appIconDir, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: launchDir, withIntermediateDirectories: true)

func pngContext(size: Int, alpha: Bool) -> CGContext {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = alpha
        ? CGImageAlphaInfo.premultipliedLast.rawValue
        : CGImageAlphaInfo.noneSkipLast.rawValue
    guard let context = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ) else {
        fatalError("Could not create bitmap context")
    }

    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)
    context.interpolationQuality = .high
    return context
}

func writePNG(_ context: CGContext, to url: URL) throws {
    guard let image = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            UTType.png.identifier as CFString,
            1,
            nil
          ) else {
        fatalError("Could not encode PNG")
    }

    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        fatalError("Could not write PNG")
    }
}

func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
    CGColor(
        srgbRed: CGFloat((hex >> 16) & 0xff) / 255,
        green: CGFloat((hex >> 8) & 0xff) / 255,
        blue: CGFloat(hex & 0xff) / 255,
        alpha: alpha
    )
}

func drawBackground(in context: CGContext, size: CGFloat) {
    let rect = CGRect(x: 0, y: 0, width: size, height: size)
    context.setFillColor(color(0x06080d))
    context.fill(rect)

    let space = CGColorSpaceCreateDeviceRGB()
    let colors = [color(0x06080d), color(0x1b1305, alpha: 0.82), color(0x1f2741, alpha: 0.95)]
    let gradient = CGGradient(
        colorsSpace: space,
        colors: colors as CFArray,
        locations: [0, 0.48, 1]
    )!
    context.drawRadialGradient(
        gradient,
        startCenter: CGPoint(x: size * 0.62, y: size * 0.35),
        startRadius: 0,
        endCenter: CGPoint(x: size * 0.5, y: size * 0.5),
        endRadius: size * 0.72,
        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
    )

    var seed: UInt64 = 0xC01A
    for index in 0..<95 {
        seed = seed &* 6364136223846793005 &+ 1442695040888963407
        let x = CGFloat(seed % 10_000) / 10_000 * size
        seed = seed &* 6364136223846793005 &+ 1442695040888963407
        let y = CGFloat(seed % 10_000) / 10_000 * size
        let radius = size * CGFloat(0.0025 + Double(index % 5) * 0.0009)
        let fleckColor = index % 7 == 0 ? color(0x80a4ff, alpha: 0.5) : color(0xf8d879, alpha: 0.62)
        context.setFillColor(fleckColor)
        context.fillEllipse(in: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
    }
}

func drawCoin(in context: CGContext, size: CGFloat, includeBackground: Bool) {
    if includeBackground {
        drawBackground(in: context, size: size)
    } else {
        context.clear(CGRect(x: 0, y: 0, width: size, height: size))
    }

    let center = CGPoint(x: size * 0.5, y: size * 0.5)
    let outerRadius = size * 0.34
    let faceRadius = size * 0.30
    let outerRect = CGRect(
        x: center.x - outerRadius,
        y: center.y - outerRadius,
        width: outerRadius * 2,
        height: outerRadius * 2
    )
    let faceRect = CGRect(
        x: center.x - faceRadius,
        y: center.y - faceRadius,
        width: faceRadius * 2,
        height: faceRadius * 2
    )

    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: size * 0.035), blur: size * 0.07, color: color(0x000000, alpha: 0.48))
    context.setFillColor(color(0xb57918))
    context.fillEllipse(in: outerRect)
    context.restoreGState()

    context.setStrokeColor(color(0x6c4210, alpha: 0.7))
    context.setLineWidth(size * 0.006)
    for i in 0..<96 {
        let a = CGFloat(i) / 96 * CGFloat.pi * 2
        let inner = CGPoint(x: center.x + cos(a) * outerRadius * 0.88, y: center.y + sin(a) * outerRadius * 0.88)
        let outer = CGPoint(x: center.x + cos(a) * outerRadius * 1.01, y: center.y + sin(a) * outerRadius * 1.01)
        context.move(to: inner)
        context.addLine(to: outer)
        context.strokePath()
    }

    context.saveGState()
    context.addEllipse(in: faceRect)
    context.clip()
    let space = CGColorSpaceCreateDeviceRGB()
    let gold = CGGradient(
        colorsSpace: space,
        colors: [color(0xfff1a8), color(0xe8bd55), color(0xa86c18), color(0x5a350d)] as CFArray,
        locations: [0, 0.35, 0.72, 1]
    )!
    context.drawLinearGradient(
        gold,
        start: CGPoint(x: size * 0.33, y: size * 0.22),
        end: CGPoint(x: size * 0.72, y: size * 0.82),
        options: []
    )
    context.restoreGState()

    context.setStrokeColor(color(0xffe49a, alpha: 0.8))
    context.setLineWidth(size * 0.009)
    context.strokeEllipse(in: faceRect.insetBy(dx: size * 0.018, dy: size * 0.018))

    context.setStrokeColor(color(0x5a350d, alpha: 0.68))
    context.setLineWidth(size * 0.014)
    context.setLineCap(.round)
    context.move(to: CGPoint(x: center.x, y: center.y - faceRadius * 0.64))
    context.addLine(to: CGPoint(x: center.x, y: center.y + faceRadius * 0.64))
    context.move(to: CGPoint(x: center.x - faceRadius * 0.64, y: center.y))
    context.addLine(to: CGPoint(x: center.x + faceRadius * 0.64, y: center.y))
    context.strokePath()

    context.setStrokeColor(color(0xfff0ad, alpha: 0.72))
    context.setLineWidth(size * 0.008)
    context.move(to: CGPoint(x: center.x, y: center.y - faceRadius * 0.64))
    context.addLine(to: CGPoint(x: center.x, y: center.y + faceRadius * 0.64))
    context.move(to: CGPoint(x: center.x - faceRadius * 0.64, y: center.y))
    context.addLine(to: CGPoint(x: center.x + faceRadius * 0.64, y: center.y))
    context.strokePath()

    context.setFillColor(color(0x4b2c08, alpha: 0.55))
    context.fillEllipse(in: CGRect(x: center.x - size * 0.052, y: center.y - size * 0.052, width: size * 0.104, height: size * 0.104))
    context.setFillColor(color(0xfff1a8, alpha: 0.58))
    context.fillEllipse(in: CGRect(x: center.x - size * 0.026, y: center.y - size * 0.026, width: size * 0.052, height: size * 0.052))

    context.setFillColor(color(0xffe8a3, alpha: 0.7))
    for i in 0..<28 {
        let a = CGFloat(i) / 28 * CGFloat.pi * 2
        let p = CGPoint(x: center.x + cos(a) * faceRadius * 0.78, y: center.y + sin(a) * faceRadius * 0.78)
        let r = size * 0.006
        context.fillEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
    }
}

for image in appIconImages {
    let pixels = image.points * image.scale
    let context = pngContext(size: pixels, alpha: false)
    drawCoin(in: context, size: CGFloat(pixels), includeBackground: true)
    try writePNG(context, to: appIconDir.appendingPathComponent(image.filename))
}

let launchContext = pngContext(size: 512, alpha: true)
drawCoin(in: launchContext, size: 512, includeBackground: false)
try writePNG(launchContext, to: launchDir.appendingPathComponent("LaunchCoin.png"))

print("Generated \(appIconImages.count) app icons and LaunchCoin.png")
