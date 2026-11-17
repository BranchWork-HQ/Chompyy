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
/// used up before it resets; eager when a lot is left and the reset is close (eat it before it's gone).
enum CookieMood: String {
    case sleepy, eager, content, delighted, enlightened

    static func from(left: Double?, msLeft: Double?, fresh: Bool) -> CookieMood? {
        if fresh { return .sleepy }
        guard let left else { return nil }
        if left < 0.12 { return .enlightened }
        if left > 0.5, let ms = msLeft, ms < 90 * 60_000 { return .eager }
        if left < 0.4 { return .delighted }
        return .content
    }

    var label: String {
        switch self {
        case .sleepy: "sleepy, no window yet"
        case .eager: "eager, lots left and the reset is close"
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
        .modifier(Bounce(on: showsFace, trigger: "\(mood?.rawValue ?? "-")·\(Int(eaten * 20))", size: size))
        .opacity(left == nil && mood != .sleepy ? 0.45 : 1)
        .animation(.spring(duration: 0.6), value: eaten)
        .animation(.easeInOut(duration: 0.4), value: mood)
        .accessibilityLabel(left.map { "Cookie, \(Int($0 * 100)) percent of the 5-hour window left\(mood.map { ", \($0.label)" } ?? "")" } ?? "Cookie, quota unknown")
    }
}

/// A springy hop and squash when the mood changes or a slice goes, plus a slow breath (sakuga-style
/// springs). Off for the menu bar icon and when Reduce Motion is on.
struct Bounce: ViewModifier {
    let on: Bool
    let trigger: String
    let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    struct Hop { var lift: CGFloat = 0; var squash: CGFloat = 0 }

    func body(content: Content) -> some View {
        if !on || reduceMotion {
            content
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
                let breath = CGFloat(sin(tl.date.timeIntervalSinceReferenceDate * 2)) * 0.012
                content
                    .scaleEffect(x: 1 + breath, y: 1 - breath, anchor: .bottom)
                    .keyframeAnimator(initialValue: Hop(), trigger: trigger) { view, v in
                        view.scaleEffect(x: 1 + v.squash, y: 1 - v.squash, anchor: .bottom).offset(y: v.lift)
                    } keyframes: { _ in
                        KeyframeTrack(\.squash) {
                            CubicKeyframe(0.14, duration: 0.08)     // crouch
                            SpringKeyframe(-0.08, duration: 0.18)   // stretch on the way up
                            SpringKeyframe(0, duration: 0.5, spring: .bouncy)
                        }
                        KeyframeTrack(\.lift) {
                            CubicKeyframe(0, duration: 0.08)
                            SpringKeyframe(-size * 0.14, duration: 0.2)
                            SpringKeyframe(0, duration: 0.5, spring: .bouncy)
                        }
                    }
            }
        }
    }
}

/// The face: hand-drawn doodle lines that "boil" (wobble at 8 frames a second, like a hand-drawn cartoon),
/// on the piece that's left. Blinks now and then; sparkles when enlightened.
struct CookieFace: View {
    let mood: CookieMood
    let left: Double
    let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: reduceMotion)) { tl in
            let t = reduceMotion ? 0 : tl.date.timeIntervalSinceReferenceDate
            let boil = Int(t * 8) % 7 + 1
            Canvas { ctx, canvas in
                let spot = CookieShape.faceSpot(left: left)
                let u = size * 0.5 * 0.85 * CGFloat(spot.scale)
                let c = CGPoint(x: canvas.width / 2 + CGFloat(spot.x) * size / 2, y: canvas.height / 2 + CGFloat(spot.y) * size / 2)
                let inkColor = spot.onPiece ? Brand.chip : Color(red: 1, green: 0.84, blue: 0.5)
                let ink = GraphicsContext.Shading.color(inkColor)
                let line = StrokeStyle(lineWidth: max(1.4, u * 0.075), lineCap: .round, lineJoin: .round)
                let amp = u * 0.035
                // Deterministic jitter per boil frame, so the lines wobble in steps like redrawn frames.
                func jit(_ n: Int) -> CGFloat {
                    let x = sin(Double(boil) * 999 + Double(n) * 77.7) * 10000
                    return CGFloat(x - floor(x) - 0.5)
                }
                func wob(_ pts: [CGPoint], _ n0: Int, closed: Bool = false, fill: Bool = false) {
                    var p = Path()
                    for (i, q) in pts.enumerated() {
                        let pt = CGPoint(x: c.x + q.x + jit(n0 + i) * amp, y: c.y + q.y + jit(n0 + i + 50) * amp)
                        if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
                    }
                    if closed { p.closeSubpath() }
                    if fill { ctx.fill(p, with: ink) } else { ctx.stroke(p, with: ink, style: line) }
                }
                func arc(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, _ a0: Double, _ a1: Double, _ n: Int = 7) -> [CGPoint] {
                    (0...n).map { i in
                        let a = a0 + (a1 - a0) * Double(i) / Double(n)
                        return CGPoint(x: cx + CGFloat(cos(a)) * r, y: cy + CGFloat(sin(a)) * r)
                    }
                }
                func dot(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ n: Int, color: Color? = nil) {
                    let p = CGPoint(x: c.x + x + jit(n) * amp, y: c.y + y + jit(n + 3) * amp)
                    ctx.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)), with: .color(color ?? inkColor))
                }
                func blush() {
                    for sx in [-1.0, 1.0] {
                        let p = CGPoint(x: c.x + CGFloat(sx) * u * 0.55 + jit(Int(sx) + 60) * amp, y: c.y + u * 0.12)
                        ctx.fill(Path(ellipseIn: CGRect(x: p.x - u * 0.12, y: p.y - u * 0.06, width: u * 0.24, height: u * 0.12)),
                                 with: .color(Color(red: 0.92, green: 0.45, blue: 0.40).opacity(0.5)))
                    }
                }
                let ex = u * 0.36, ey = -u * 0.1
                let blinking = (mood == .content || mood == .eager) && t.truncatingRemainder(dividingBy: 4.1) < 0.12

                switch mood {
                case .sleepy:
                    wob([CGPoint(x: -ex - u * 0.1, y: ey), CGPoint(x: -ex + u * 0.1, y: ey)], 1)
                    wob([CGPoint(x: ex - u * 0.1, y: ey), CGPoint(x: ex + u * 0.1, y: ey)], 5)
                    wob(arc(0, u * 0.18, u * 0.05, 0, 2 * .pi, 8), 9)
                    for k in 0..<2 { // two z's drifting up
                        let ph = (t * 0.5 + Double(k) * 0.5).truncatingRemainder(dividingBy: 1)
                        ctx.opacity = sin(ph * .pi)
                        ctx.draw(Text("z").font(.system(size: max(7, u * 0.34), weight: .bold, design: .rounded)).foregroundColor(inkColor),
                                 at: CGPoint(x: c.x + u * (0.5 + CGFloat(ph) * 0.3) + CGFloat(k) * u * 0.15, y: c.y - u * (0.35 + CGFloat(ph) * 0.45)))
                        ctx.opacity = 1
                    }
                case .eager: // "ooh": dot eyes, a small round mouth
                    for (k, sx) in [-1.0, 1.0].enumerated() {
                        if blinking {
                            wob([CGPoint(x: CGFloat(sx) * ex - u * 0.08, y: ey), CGPoint(x: CGFloat(sx) * ex + u * 0.08, y: ey)], 90 + k)
                        } else {
                            dot(CGFloat(sx) * ex, ey, u * 0.075, k * 2)
                        }
                    }
                    wob(arc(0, u * 0.17, u * 0.08, 0, 2 * .pi, 9), 22)
                case .content:
                    for (k, sx) in [-1.0, 1.0].enumerated() {
                        if blinking {
                            wob([CGPoint(x: CGFloat(sx) * ex - u * 0.08, y: ey), CGPoint(x: CGFloat(sx) * ex + u * 0.08, y: ey)], 95 + k)
                        } else {
                            dot(CGFloat(sx) * ex, ey, u * 0.07, k * 2)
                        }
                    }
                    wob(arc(0, u * 0.02, u * 0.2, 0.2 * .pi, 0.8 * .pi), 30)
                case .delighted:
                    for (k, sx) in [-1.0, 1.0].enumerated() {
                        wob(arc(CGFloat(sx) * ex, ey + u * 0.06, u * 0.1, 1.15 * .pi, 1.85 * .pi, 5), 40 + k * 7)
                    }
                    blush()
                    wob(arc(0, u * 0.08, u * 0.18, 0.1 * .pi, 0.9 * .pi) + [CGPoint(x: -u * 0.17, y: u * 0.13)], 70, closed: true, fill: true)
                case .enlightened:
                    for (k, sx) in [-1.0, 1.0].enumerated() {
                        wob(arc(CGFloat(sx) * ex, ey - u * 0.05, u * 0.1, 0.15 * .pi, 0.85 * .pi, 5), 40 + k * 7)
                    }
                    blush()
                    wob(arc(0, u * 0.08, u * 0.1, 0.2 * .pi, 0.8 * .pi), 80)
                    for k in 0..<5 { // twinkling sparkles around the cookie
                        let a = Double(k) * 1.3 + 0.5
                        let sp = CGPoint(x: canvas.width / 2 + CGFloat(cos(a)) * size * 0.56, y: canvas.height / 2 + CGFloat(sin(a)) * size * 0.56)
                        let sz = size * 0.07 * CGFloat(0.5 + 0.5 * sin(t * 2.4 + Double(k) * 1.9))
                        var star = Path()
                        star.move(to: CGPoint(x: sp.x, y: sp.y - sz)); star.addLine(to: CGPoint(x: sp.x, y: sp.y + sz))
                        star.move(to: CGPoint(x: sp.x - sz, y: sp.y)); star.addLine(to: CGPoint(x: sp.x + sz, y: sp.y))
                        ctx.stroke(star, with: .color(Color(red: 1, green: 0.84, blue: 0.48)), style: StrokeStyle(lineWidth: max(1, size / 50), lineCap: .round))
                    }
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
