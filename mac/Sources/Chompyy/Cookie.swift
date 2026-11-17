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

/// The cookie, eaten slice by slice, and every cut is bitten. `eaten` (0...1) is the share of the
/// 5-hour window used. What's left is a wedge from 12 o'clock, clockwise; both cut edges are a row of
/// bite marks rather than a knife line. The wedge is opened just enough that the piece left (after the
/// bites) is exactly the share left, so the picture matches the number.
struct CookieShape: Shape {
    var eaten: Double

    var animatableData: Double {
        get { eaten }
        set { eaten = newValue }
    }

    /// Bites along a cut, in cookie radii from the centre: distance, bite radius. Uneven like real bites.
    static let cutBites: [(Double, Double)] = [(0.24, 0.13), (0.50, 0.17), (0.78, 0.16), (1.0, 0.2)]

    /// The piece left, in unit coordinates, for a wedge of `turn` (0...1 of a full circle).
    static func piece(turn: Double) -> (inWedge: (Double, Double) -> Bool, bites: [(Double, Double, Double)]) {
        let start = -Double.pi / 2, end = start + turn * 2 * .pi
        var bites: [(Double, Double, Double)] = []
        // Leading edge: bites sit on the eaten side, overlapping into the piece. Trailing edge (12 o'clock)
        // gets fewer, so the first slice reads as bitten too.
        for (k, (d, br)) in cutBites.enumerated() {
            let a = end + 0.10 / max(d, 0.3)
            bites.append((cos(a) * d, sin(a) * d, br))
            if k % 2 == 1 {
                let b = start - 0.10 / max(d, 0.3)
                bites.append((cos(b) * d, sin(b) * d, br * 0.8))
            }
        }
        let inWedge: (Double, Double) -> Bool = { x, y in
            var a = atan2(y, x) - start
            while a < 0 { a += 2 * .pi }
            return a <= turn * 2 * .pi
        }
        return (inWedge, bites)
    }

    /// Share of the cookie left for a wedge of `turn` (grid estimate).
    static func leftShare(turn: Double) -> Double {
        let (inWedge, bites) = piece(turn: turn)
        let n = 40
        var kept = 0, total = 0
        for yi in 0..<n {
            for xi in 0..<n {
                let x = (Double(xi) + 0.5) / Double(n) * 2 - 1, y = (Double(yi) + 0.5) / Double(n) * 2 - 1
                guard x * x + y * y <= 1 else { continue }
                total += 1
                if inWedge(x, y) && !bites.contains(where: { (x - $0.0) * (x - $0.0) + (y - $0.1) * (y - $0.1) <= $0.2 * $0.2 }) { kept += 1 }
            }
        }
        return Double(kept) / Double(max(total, 1))
    }

    /// The wedge whose bitten piece is `left` of the cookie (bisection).
    static func turn(for left: Double) -> Double {
        var lo = left, hi = min(1, left + 0.35)
        for _ in 0..<12 {
            let mid = (lo + hi) / 2
            if leftShare(turn: mid) < left { lo = mid } else { hi = mid }
        }
        return (lo + hi) / 2
    }

    func path(in rect: CGRect) -> Path {
        let r = min(rect.width, rect.height) / 2
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let cookie = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        let left = 1 - max(0, min(1, eaten))
        if left > 0.995 { return cookie }
        if left < 0.01 { return Path() }
        let turn = Self.turn(for: left)
        let start = Angle.radians(-Double.pi / 2), end = Angle.radians(-Double.pi / 2 + turn * 2 * .pi)
        var wedge = Path()
        wedge.move(to: c)
        wedge.addArc(center: c, radius: r * 1.02, startAngle: start, endAngle: end, clockwise: false)
        wedge.closeSubpath()
        var bites = Path()
        for b in Self.piece(turn: turn).bites {
            let br = CGFloat(b.2) * r
            let bc = CGPoint(x: c.x + CGFloat(b.0) * r, y: c.y + CGFloat(b.1) * r)
            bites.addEllipse(in: CGRect(x: bc.x - br, y: bc.y - br, width: br * 2, height: br * 2))
        }
        return cookie.intersection(wedge).subtracting(bites)
    }

    /// Where a face fits on the piece left, as a point in unit coordinates and a scale (0...1).
    /// Below 15 % the piece is too thin for a face: it floats in the middle instead (`onPiece` false).
    static func faceSpot(left: Double) -> (x: Double, y: Double, scale: Double, onPiece: Bool) {
        if left > 0.97 { return (0, 0.05, 1, true) }
        if left < 0.15 { return (0, 0, 0.85, false) }
        let turn = Self.turn(for: left)
        let mid = -Double.pi / 2 + turn * .pi
        let d = min(0.55, (1 - left) * 1.4) // slides off-centre as the piece narrows
        return (cos(mid) * d, sin(mid) * d, max(0.5, min(1, left * 1.4 + 0.25)), true)
    }
}

/// How Chompyy feels: a frugal little cookie that hates waste. Happiest when the window is nearly
/// used up before it resets; worried when a lot is left and the reset is close.
enum CookieMood: String {
    case sleepy, worried, content, delighted, enlightened

    static func from(left: Double?, msLeft: Double?, fresh: Bool) -> CookieMood? {
        if fresh { return .sleepy }
        guard let left else { return nil }
        if left < 0.12 { return .enlightened }
        if left > 0.5, let ms = msLeft, ms < 90 * 60_000 { return .worried }
        if left < 0.4 { return .delighted }
        return .content
    }

    var label: String {
        switch self {
        case .sleepy: "sleepy, no window yet"
        case .worried: "worried, a lot would go to waste"
        case .content: "content"
        case .delighted: "delighted"
        case .enlightened: "enlightened, almost nothing wasted"
        }
    }
}

/// A chocolate-chip cookie that gets eaten as the 5-hour window is used, with a face when there's room.
/// `left` is the fraction left (1 = whole cookie); nil = unknown (drawn faded).
struct CookieView: View {
    var left: Double?
    var size: CGFloat = 64
    var mood: CookieMood? = nil

    var eaten: Double { left.map { 1 - max(0, min(1, $0)) } ?? 0 }
    private var showsFace: Bool { mood != nil && size >= 40 }

    // Chip positions as fractions of the radius (x, y, size).
    private let chips: [(CGFloat, CGFloat, CGFloat)] = [
        (-0.40, -0.30, 0.30), (0.20, -0.48, 0.26), (0.42, 0.10, 0.30), (-0.05, 0.08, 0.28),
        (-0.50, 0.32, 0.24), (0.12, 0.52, 0.30), (-0.18, -0.70, 0.20), (0.68, -0.22, 0.20),
    ]

    var body: some View {
        let shape = CookieShape(eaten: eaten)
        ZStack {
            if mood == .enlightened && showsFace {
                Circle()
                    .fill(RadialGradient(colors: [Color(red: 1, green: 0.85, blue: 0.45).opacity(0.55), .clear], center: .center, startRadius: size * 0.2, endRadius: size * 0.75))
                    .frame(width: size * 1.15, height: size * 1.15)
            }
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
                        .opacity(showsFace ? 0.55 : 1) // quieter, so the face reads
                }
            }
            .frame(width: size, height: size)
            .clipShape(shape)
            shape.stroke(Brand.chocolate.opacity(0.35), lineWidth: max(0.5, size / 40))
            if showsFace, let mood {
                CookieFace(mood: mood, left: left ?? 1, size: size)
            }
        }
        .frame(width: size, height: size)
        .opacity(left == nil && mood != .sleepy ? 0.45 : 1)
        .animation(.spring(duration: 0.6), value: eaten)
        .animation(.easeInOut(duration: 0.4), value: mood)
        .accessibilityLabel(left.map { "Cookie, \(Int($0 * 100)) percent of the 5-hour window left\(mood.map { ", \($0.label)" } ?? "")" } ?? "Cookie, quota unknown")
    }
}

/// The face, drawn on the piece that's left. Blinks now and then; sparkles twinkle when enlightened.
struct CookieFace: View {
    let mood: CookieMood
    let left: Double
    let size: CGFloat

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            Canvas { ctx, canvas in
                let spot = CookieShape.faceSpot(left: left)
                let u = size * 0.5 * CGFloat(spot.scale) // face unit
                let c = CGPoint(x: canvas.width / 2 + CGFloat(spot.x) * size / 2, y: canvas.height / 2 + CGFloat(spot.y) * size / 2)
                // On the cookie the face is chocolate; floating over the crumbs it's warm gold.
                let ink = GraphicsContext.Shading.color(spot.onPiece ? Brand.chip : Color(red: 1, green: 0.84, blue: 0.5))
                let line = StrokeStyle(lineWidth: max(1.2, u * 0.07), lineCap: .round, lineJoin: .round)
                let eyeDX = u * 0.28, eyeY = c.y - u * 0.12
                let blink = (mood == .content || mood == .worried || mood == .delighted) && t.truncatingRemainder(dividingBy: 4.3) < 0.14

                func eyeDots() {
                    for sx in [-1.0, 1.0] {
                        let ec = CGPoint(x: c.x + CGFloat(sx) * eyeDX, y: eyeY)
                        if blink {
                            var p = Path(); p.move(to: CGPoint(x: ec.x - u * 0.07, y: ec.y)); p.addLine(to: CGPoint(x: ec.x + u * 0.07, y: ec.y))
                            ctx.stroke(p, with: ink, style: line)
                        } else {
                            let er = u * 0.075
                            ctx.fill(Path(ellipseIn: CGRect(x: ec.x - er, y: ec.y - er * 1.2, width: er * 2, height: er * 2.4)), with: ink)
                            ctx.fill(Path(ellipseIn: CGRect(x: ec.x - er * 0.2, y: ec.y - er * 0.9, width: er * 0.7, height: er * 0.7)), with: .color(.white.opacity(0.8)))
                        }
                    }
                }
                func arcEyes(up: Bool) {
                    for sx in [-1.0, 1.0] {
                        let ec = CGPoint(x: c.x + CGFloat(sx) * eyeDX, y: eyeY)
                        var p = Path()
                        p.addArc(center: CGPoint(x: ec.x, y: ec.y + (up ? u * 0.05 : -u * 0.05)), radius: u * 0.09,
                                 startAngle: .degrees(up ? 200 : 20), endAngle: .degrees(up ? 340 : 160), clockwise: false)
                        ctx.stroke(p, with: ink, style: line)
                    }
                }
                func mouth(_ build: (inout Path) -> Void, fill: Bool = false) {
                    var p = Path(); build(&p)
                    if fill { ctx.fill(p, with: ink) } else { ctx.stroke(p, with: ink, style: line) }
                }
                func cheeks() {
                    for sx in [-1.0, 1.0] {
                        let cc = CGPoint(x: c.x + CGFloat(sx) * u * 0.42, y: c.y + u * 0.06)
                        ctx.fill(Path(ellipseIn: CGRect(x: cc.x - u * 0.1, y: cc.y - u * 0.05, width: u * 0.2, height: u * 0.1)), with: .color(Color(red: 0.92, green: 0.45, blue: 0.40).opacity(0.45)))
                    }
                }

                switch mood {
                case .content:
                    eyeDots()
                    mouth { $0.addArc(center: CGPoint(x: c.x, y: c.y + u * 0.04), radius: u * 0.16, startAngle: .degrees(25), endAngle: .degrees(155), clockwise: false) }
                case .delighted:
                    arcEyes(up: true)
                    cheeks()
                    mouth({ p in
                        p.move(to: CGPoint(x: c.x - u * 0.2, y: c.y + u * 0.1))
                        p.addQuadCurve(to: CGPoint(x: c.x + u * 0.2, y: c.y + u * 0.1), control: CGPoint(x: c.x, y: c.y + u * 0.42))
                        p.closeSubpath()
                    }, fill: true)
                case .enlightened:
                    arcEyes(up: false) // serene, closed
                    cheeks()
                    mouth { $0.addArc(center: CGPoint(x: c.x, y: c.y + u * 0.08), radius: u * 0.1, startAngle: .degrees(30), endAngle: .degrees(150), clockwise: false) }
                    // Twinkling sparkles around the piece.
                    for k in 0..<4 {
                        let phase = t * 2.2 + Double(k) * 1.7
                        let a = Double(k) * 1.6 + 0.4
                        let sp = CGPoint(x: canvas.width / 2 + CGFloat(cos(a)) * size * 0.55, y: canvas.height / 2 + CGFloat(sin(a)) * size * 0.55)
                        let sz = size * 0.07 * CGFloat(0.5 + 0.5 * sin(phase))
                        var star = Path()
                        star.move(to: CGPoint(x: sp.x, y: sp.y - sz)); star.addLine(to: CGPoint(x: sp.x, y: sp.y + sz))
                        star.move(to: CGPoint(x: sp.x - sz, y: sp.y)); star.addLine(to: CGPoint(x: sp.x + sz, y: sp.y))
                        ctx.stroke(star, with: .color(Color(red: 1, green: 0.82, blue: 0.4)), style: StrokeStyle(lineWidth: max(1, size / 50), lineCap: .round))
                    }
                case .worried:
                    eyeDots()
                    for sx in [-1.0, 1.0] { // brows tilted up in the middle
                        var p = Path()
                        p.move(to: CGPoint(x: c.x + CGFloat(sx) * u * 0.40, y: eyeY - u * 0.16))
                        p.addLine(to: CGPoint(x: c.x + CGFloat(sx) * u * 0.18, y: eyeY - u * 0.24))
                        ctx.stroke(p, with: ink, style: line)
                    }
                    mouth { p in
                        p.move(to: CGPoint(x: c.x - u * 0.16, y: c.y + u * 0.16))
                        p.addCurve(to: CGPoint(x: c.x + u * 0.16, y: c.y + u * 0.16),
                                   control1: CGPoint(x: c.x - u * 0.05, y: c.y + u * 0.06), control2: CGPoint(x: c.x + u * 0.05, y: c.y + u * 0.26))
                    }
                case .sleepy:
                    for sx in [-1.0, 1.0] {
                        var p = Path()
                        p.move(to: CGPoint(x: c.x + CGFloat(sx) * eyeDX - u * 0.08, y: eyeY))
                        p.addLine(to: CGPoint(x: c.x + CGFloat(sx) * eyeDX + u * 0.08, y: eyeY))
                        ctx.stroke(p, with: ink, style: line)
                    }
                    let mr = u * 0.05
                    ctx.stroke(Path(ellipseIn: CGRect(x: c.x - mr, y: c.y + u * 0.12, width: mr * 2, height: mr * 2.2)), with: ink, style: line)
                    let bob = CGFloat(sin(t * 1.5)) * u * 0.05
                    ctx.draw(Text("z").font(.system(size: max(7, u * 0.32), weight: .bold, design: .rounded)).foregroundColor(Brand.chocolate.opacity(0.8)),
                             at: CGPoint(x: c.x + u * 0.55, y: c.y - u * 0.5 + bob))
                }
            }
        }
        .frame(width: size, height: size)
        .allowsHitTesting(false)
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
