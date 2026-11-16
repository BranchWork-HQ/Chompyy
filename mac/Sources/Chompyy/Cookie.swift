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

/// The cookie shape with `bites` (0...8) taken around the edge, clockwise from the top right.
/// Each bite is a scalloped set of tooth marks, not a clean wedge (kept distinct from Pac-Man).
struct CookieShape: Shape {
    var bites: Int
    static let slots = 8

    func path(in rect: CGRect) -> Path {
        let r = min(rect.width, rect.height) / 2
        let c = CGPoint(x: rect.midX, y: rect.midY)
        var cookie = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        guard bites > 0 else { return cookie }
        var mouth = Path()
        for i in 0..<min(bites, Self.slots) {
            // Start at 1 o'clock and go clockwise.
            let angle = -Double.pi / 2 + Double.pi / 5 + Double(i) * 2 * Double.pi / Double(Self.slots)
            // Three overlapping tooth circles per bite make the scalloped edge.
            for k in -1...1 {
                let a = angle + Double(k) * 0.24
                let toothR = r * (k == 0 ? 0.40 : 0.32)
                let dist = r * (k == 0 ? 1.06 : 1.0)
                let tc = CGPoint(x: c.x + CGFloat(cos(a)) * dist, y: c.y + CGFloat(sin(a)) * dist)
                mouth.addEllipse(in: CGRect(x: tc.x - toothR, y: tc.y - toothR, width: toothR * 2, height: toothR * 2))
            }
        }
        cookie = cookie.subtracting(mouth)
        return cookie
    }
}

/// A chocolate-chip cookie that gets eaten as the 5-hour window is used.
/// `left` is the fraction left (1 = whole cookie); nil = unknown (drawn faded).
struct CookieView: View {
    var left: Double?
    var size: CGFloat = 64

    var bites: Int {
        guard let left else { return 0 }
        return Int(((1 - left) * Double(CookieShape.slots)).rounded())
    }

    // Chip positions as fractions of the radius (x, y, size).
    private let chips: [(CGFloat, CGFloat, CGFloat)] = [
        (-0.40, -0.30, 0.30), (0.20, -0.48, 0.26), (0.42, 0.10, 0.30), (-0.05, 0.08, 0.28),
        (-0.50, 0.32, 0.24), (0.12, 0.52, 0.30), (-0.18, -0.70, 0.20), (0.68, -0.22, 0.20),
    ]

    var body: some View {
        let shape = CookieShape(bites: bites)
        ZStack {
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
        .animation(.spring(duration: 0.5), value: bites)
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
