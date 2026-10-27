import AppKit

// Finder window background for the installer image: `swift background.swift <output dir> <brand icon>`.
// Finder draws the real EasyHub.app and Applications icons on top of this at the positions below
// (top-left origin, window content 640x410), so the platters and arrow line up with them.
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let brand = NSImage(contentsOfFile: CommandLine.arguments[2])
let size = NSSize(width: 640, height: 410)
let appCenter = NSPoint(x: 170, y: 232)
let folderCenter = NSPoint(x: 470, y: 232)

func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> NSColor {
    NSColor(calibratedRed: r / 255, green: g / 255, blue: b / 255, alpha: a)
}

func render(scale: Int, name: String) throws {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(size.width) * scale, pixelsHigh: Int(size.height) * scale,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { fatalError("Could not create the image.") }
    bitmap.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    context.cgContext.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    // Convert to a top-left origin so the coordinates match Finder's icon positions.
    context.cgContext.translateBy(x: 0, y: size.height)
    context.cgContext.scaleBy(x: 1, y: -1)
    let flipped = NSGraphicsContext(cgContext: context.cgContext, flipped: true)
    NSGraphicsContext.current = flipped

    // Soft vertical wash with a faint brand-blue glow behind the centre.
    NSGradient(colors: [color(250, 251, 254), color(233, 238, 248)])!
        .draw(in: NSRect(origin: .zero, size: size), angle: 90)
    NSGradient(colors: [color(61, 111, 220, 0.10), color(61, 111, 220, 0)])!
        .draw(fromCenter: NSPoint(x: 320, y: 232), radius: 0, toCenter: NSPoint(x: 320, y: 232), radius: 250, options: [])

    // Header: brand mark and name.
    if let brand {
        brand.draw(in: NSRect(x: 292, y: 26, width: 56, height: 56), from: .zero, operation: .sourceOver, fraction: 1,
                   respectFlipped: true, hints: nil)
    }
    func text(_ value: String, y: CGFloat, size: CGFloat, weight: NSFont.Weight, tone: NSColor) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        (value as NSString).draw(
            in: NSRect(x: 32, y: y, width: 576, height: size * 1.5),
            withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: weight),
                             .foregroundColor: tone, .paragraphStyle: paragraph])
    }
    text("把 EasyHub 拖到“应用程序”", y: 92, size: 20, weight: .semibold, tone: color(28, 43, 77))
    text("Drag EasyHub to Applications to install", y: 122, size: 12.5, weight: .regular, tone: color(110, 120, 140))

    // Platters under the two real icons.
    for center in [appCenter, folderCenter] {
        let rect = NSRect(x: center.x - 76, y: center.y - 70, width: 152, height: 156)
        let shadow = NSShadow()
        shadow.shadowColor = color(28, 43, 77, 0.10)
        shadow.shadowBlurRadius = 18
        shadow.shadowOffset = NSSize(width: 0, height: -5)
        NSGraphicsContext.saveGraphicsState()
        shadow.set()
        color(255, 255, 255, 0.92).setFill()
        NSBezierPath(roundedRect: rect, xRadius: 26, yRadius: 26).fill()
        NSGraphicsContext.restoreGraphicsState()
        color(28, 43, 77, 0.06).setStroke()
        let edge = NSBezierPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: 26, yRadius: 26)
        edge.lineWidth = 1
        edge.stroke()
    }

    // Dashed arc with an arrow head between the platters.
    let blue = color(61, 111, 220)
    let arc = NSBezierPath()
    arc.move(to: NSPoint(x: 266, y: 210))
    arc.curve(to: NSPoint(x: 366, y: 210), controlPoint1: NSPoint(x: 296, y: 170), controlPoint2: NSPoint(x: 336, y: 170))
    arc.lineWidth = 3
    arc.lineCapStyle = .round
    arc.setLineDash([1, 8], count: 2, phase: 0)
    blue.setStroke()
    arc.stroke()
    let head = NSBezierPath()
    head.move(to: NSPoint(x: 355, y: 198))
    head.line(to: NSPoint(x: 369, y: 211))
    head.line(to: NSPoint(x: 353, y: 221))
    head.lineWidth = 3.5
    head.lineCapStyle = .round
    head.lineJoinStyle = .round
    blue.setStroke()
    head.stroke()

    NSGraphicsContext.restoreGraphicsState()
    guard let data = bitmap.representation(using: .png, properties: [:]) else { fatalError("Could not encode the image.") }
    try data.write(to: output.appendingPathComponent(name))
}

try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
try render(scale: 1, name: "background.png")
try render(scale: 2, name: "background@2x.png")
