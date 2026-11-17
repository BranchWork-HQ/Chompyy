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

/// The cookie, eaten from the middle outward. `eaten` (0...1) is the share of the 5-hour window used.
/// The hole is a cluster of uneven bites that grows from near the centre; it is scaled so the bitten
/// area is that share of the cookie's area, so the picture matches the number (the old version took
/// 8 fixed bites around the edge, 12.5 % each, and showed 45 % left as half eaten).
struct CookieShape: Shape {
    var eaten: Double

    var animatableData: Double {
        get { eaten }
        set { eaten = newValue }
    }

    /// Bites at full size, in cookie radii: centre x, centre y, radius. Uneven on purpose.
    static let bites: [(Double, Double, Double)] = [
        (0.06, -0.04, 0.50), (0.44, 0.18, 0.36), (-0.36, 0.30, 0.38),
        (-0.30, -0.40, 0.33), (0.30, -0.46, 0.31), (0.04, 0.54, 0.31), (-0.58, -0.04, 0.26),
    ]

    /// Share of the cookie's area inside the bites at scale `k` (grid estimate; the bites overlap).
    static func bittenShare(_ k: Double) -> Double {
        let n = 36
        var inside = 0, total = 0
        for yi in 0..<n {
            for xi in 0..<n {
                let x = (Double(xi) + 0.5) / Double(n) * 2 - 1, y = (Double(yi) + 0.5) / Double(n) * 2 - 1
                guard x * x + y * y <= 1 else { continue }
                total += 1
                if bites.contains(where: { b in
                    let dx = x - b.0 * k, dy = y - b.1 * k, rr = b.2 * k
                    return dx * dx + dy * dy <= rr * rr
                }) { inside += 1 }
            }
        }
        return Double(inside) / Double(max(total, 1))
    }

    /// The scale whose bitten share is `e` (bisection; the share grows with the scale).
    static func scale(for e: Double) -> Double {
        var lo = 0.0, hi = 2.4
        for _ in 0..<14 {
            let mid = (lo + hi) / 2
            if bittenShare(mid) < e { lo = mid } else { hi = mid }
        }
        return (lo + hi) / 2
    }

    func path(in rect: CGRect) -> Path {
        let r = min(rect.width, rect.height) / 2
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let cookie = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        let e = max(0, min(1, eaten))
        if e < 0.005 { return cookie }
        if e > 0.995 { return Path() }
        let k = CGFloat(Self.scale(for: e))
        var hole = Path()
        for b in Self.bites {
            let rr = CGFloat(b.2) * k * r
            let bc = CGPoint(x: c.x + CGFloat(b.0) * k * r, y: c.y + CGFloat(b.1) * k * r)
            hole.addEllipse(in: CGRect(x: bc.x - rr, y: bc.y - rr, width: rr * 2, height: rr * 2))
        }
        return cookie.subtracting(hole)
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
