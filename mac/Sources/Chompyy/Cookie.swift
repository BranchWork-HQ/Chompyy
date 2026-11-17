import SwiftUI

/// Brand colours: a chocolate-chip cookie.
enum Brand {
    static let dough = Color(red: 0.85, green: 0.63, blue: 0.38)
    static let doughEdge = Color(red: 0.70, green: 0.47, blue: 0.25)
    static let chip = Color(red: 0.30, green: 0.18, blue: 0.11)
    static let chocolate = Color(red: 0.36, green: 0.23, blue: 0.16)
    static let cream = Color(red: 1.0, green: 0.97, blue: 0.91)
    static let ok = Color(red: 0.30, green: 0.62, blue: 0.38)
    static let warn = Color(red: 0.85, green: 0.45, blue: 0.20)

    /// Surfaces that work in light and dark mode: warm cream by day, warm brown-black by night.
    static let boardBackground = adaptive(light: (0.98, 0.95, 0.90), dark: (0.11, 0.10, 0.09))
    static let columnBackground = adaptive(light: (0.95, 0.91, 0.85), dark: (0.16, 0.14, 0.13))
    static let cardBackground = adaptive(light: (1.0, 1.0, 1.0), dark: (0.22, 0.20, 0.18))

    static func adaptive(light: (CGFloat, CGFloat, CGFloat), dark: (CGFloat, CGFloat, CGFloat)) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let c = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(red: c.0, green: c.1, blue: c.2, alpha: 1)
        })
    }
}

/// The cookie, eaten slice by slice like a cake. `eaten` (0...1) is the share of the 5-hour window used.
/// What's left is a wedge from 12 o'clock, clockwise, whose angle (and so its area) is the share left,
/// so the picture matches the number (the old version took 8 fixed edge bites of 12.5 % each). The cut
/// edge has a few small crumb notches so it reads as a broken cookie rather than a pie chart.
struct CookieShape: Shape {
    var eaten: Double

    var animatableData: Double {
        get { eaten }
        set { eaten = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let r = min(rect.width, rect.height) / 2
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let cookie = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        let left = 1 - max(0, min(1, eaten))
        if left > 0.995 { return cookie }
        if left < 0.005 { return Path() }
        let start = Angle.degrees(-90)
        let end = Angle.degrees(-90 + 360 * left)
        var wedge = Path()
        wedge.move(to: c)
        wedge.addArc(center: c, radius: r * 1.02, startAngle: start, endAngle: end, clockwise: false)
        wedge.closeSubpath()
        var piece = cookie.intersection(wedge)
        // Crumb notches along both cut edges, just inside the piece (tiny, so the area stays true).
        var crumbs = Path()
        for (edge, side) in [(end.radians, -1.0), (start.radians, 1.0)] {
            for (d, size) in (side < 0 ? [(0.52, 0.055), (0.84, 0.075)] : [(0.7, 0.05)]) {
                let a = edge + side * 0.035
                let p = CGPoint(x: c.x + CGFloat(cos(a) * d) * r, y: c.y + CGFloat(sin(a) * d) * r)
                let cr = CGFloat(size) * r
                crumbs.addEllipse(in: CGRect(x: p.x - cr, y: p.y - cr, width: cr * 2, height: cr * 2))
            }
        }
        if left < 0.97 { piece = piece.subtracting(crumbs) }
        return piece
    }
}

/// A chocolate-chip cookie that gets eaten as the 5-hour window is used.
/// `left` is the fraction left (1 = whole cookie); nil = unknown (drawn faded).
struct CookieView: View {
    var left: Double?
    var size: CGFloat = 64

    var eaten: Double { left.map { 1 - max(0, min(1, $0)) } ?? 0 }

    // Chip positions as fractions of the radius (x, y, size).
    private let chips: [(CGFloat, CGFloat, CGFloat)] = [
        (-0.40, -0.30, 0.30), (0.20, -0.48, 0.26), (0.42, 0.10, 0.30), (-0.05, 0.08, 0.28),
        (-0.50, 0.32, 0.24), (0.12, 0.52, 0.30), (-0.18, -0.70, 0.20), (0.68, -0.22, 0.20),
    ]

    var body: some View {
        let shape = CookieShape(eaten: eaten)
        ZStack {
            // Where the eaten slices were: a faint outline, so how much is gone reads at a glance.
            Circle()
                .strokeBorder(Brand.doughEdge.opacity(0.35), style: StrokeStyle(lineWidth: max(0.75, size / 48), dash: [max(1.5, size / 22), max(1.5, size / 26)]))
                .opacity(eaten > 0.005 ? 1 : 0)
            shape.fill(
                RadialGradient(colors: [Brand.dough, Brand.doughEdge], center: .center, startRadius: 0, endRadius: size * 0.6)
            )
            ZStack {
                ForEach(0..<chips.count, id: \.self) { i in
                    let (x, y, s) = chips[i]
                    Ellipse()
                        .fill(Brand.chip)
                        .frame(width: size * s * 0.42, height: size * s * 0.34)
                        .rotationEffect(.degrees(Double(i) * 37))
                        .offset(x: x * size / 2, y: y * size / 2)
                }
            }
            .frame(width: size, height: size)
            .clipShape(shape)
            shape.stroke(Brand.chocolate.opacity(0.35), lineWidth: max(0.5, size / 40))
        }
        .frame(width: size, height: size)
        .opacity(left == nil ? 0.45 : 1)
        .animation(.spring(duration: 0.6), value: eaten)
        .accessibilityLabel(left.map { "Cookie, \(Int($0 * 100)) percent of the 5-hour window left" } ?? "Cookie, quota unknown")
    }
}

/// The menu bar icon: the same cookie, rendered small.
@MainActor
func cookieMenuImage(left: Double?) -> NSImage {
    let renderer = ImageRenderer(content: CookieView(left: left, size: 18).padding(1))
    renderer.scale = NSScreen.main?.backingScaleFactor ?? 2
    let image = renderer.nsImage ?? NSImage(systemSymbolName: "circle.fill", accessibilityDescription: nil)!
    image.isTemplate = false
    return image
}
