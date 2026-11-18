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

/// The cookie, eaten bite by bite from the top right, the way you'd eat a real one. `eaten` (0...1) is the
/// share of the 5-hour window used. The eaten side ends in a scalloped row of bites: at first one round bite
/// out of the top right, at the end a crescent. One parameter, `bite` (how far the bite edge has moved in), is
/// solved so the piece left is exactly the share left: the picture matches the number.
struct CookieShape: Shape {
    var eaten: Double

    var animatableData: Double {
        get { eaten }
        set { eaten = newValue }
    }

    /// Which way the bites come from (unit vector, y down: top right).
    static let from = (x: 0.72, y: -0.69)
    /// The row of bites along the edge: offset along the edge and size (cookie radii). Uneven like real bites.
    static let row: [(Double, Double)] = [(-1.5, 0.30), (-1.05, 0.34), (-0.55, 0.31), (0, 0.36), (0.5, 0.31), (1.0, 0.33), (1.5, 0.30)]
    static let maxBite = 2.8

    /// The bite edge for `bite` in 0...maxBite: everything past the line `p·from > edge` is eaten, plus the bites.
    static func bites(_ bite: Double) -> (edge: Double, circles: [(Double, Double, Double)]) {
        let edge = 1.36 - bite // the line the bites' centres sit on
        let px = -from.y, py = from.x // along the edge
        let circles = row.map { t, r in (from.x * edge + px * t, from.y * edge + py * t, r) }
        return (edge, circles)
    }

    static func isEaten(_ x: Double, _ y: Double, _ b: (edge: Double, circles: [(Double, Double, Double)])) -> Bool {
        x * from.x + y * from.y > b.edge || b.circles.contains(where: { (x - $0.0) * (x - $0.0) + (y - $0.1) * (y - $0.1) <= $0.2 * $0.2 })
    }

    /// The piece left for `bite` on a grid: its share of the cookie and its centre.
    static func piece(_ bite: Double, n: Int = 44) -> (left: Double, cx: Double, cy: Double) {
        let b = bites(bite)
        var kept = 0, total = 0, sx = 0.0, sy = 0.0
        for yi in 0..<n {
            for xi in 0..<n {
                let x = (Double(xi) + 0.5) / Double(n) * 2 - 1, y = (Double(yi) + 0.5) / Double(n) * 2 - 1
                guard x * x + y * y <= 1 else { continue }
                total += 1
                if !isEaten(x, y, b) { kept += 1; sx += x; sy += y }
            }
        }
        return (Double(kept) / Double(max(total, 1)), kept > 0 ? sx / Double(kept) : 0, kept > 0 ? sy / Double(kept) : 0)
    }

    nonisolated(unsafe) private static var cache: [Int: Double] = [:]

    /// The `bite` whose piece left is `left` of the cookie (bisection, cached per 0.1 %).
    static func bite(for left: Double) -> Double {
        let key = Int((left * 1000).rounded())
        if let hit = cache[key] { return hit }
        var lo = 0.0, hi = maxBite
        for _ in 0..<16 {
            let mid = (lo + hi) / 2
            if piece(mid).left > left { lo = mid } else { hi = mid }
        }
        let found = (lo + hi) / 2
        cache[key] = found
        return found
    }

    func path(in rect: CGRect) -> Path {
        let r = min(rect.width, rect.height) / 2
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let cookie = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        let left = 1 - max(0, min(1, eaten))
        if left > 0.995 { return cookie }
        if left < 0.01 { return Path() }
        let b = Self.bites(Self.bite(for: left))
        // Everything past the bite edge (a big quad on the far side of the line), unioned with the bites:
        // a union, not one path, or the overlaps cancel out.
        let (fx, fy) = (CGFloat(Self.from.x), CGFloat(Self.from.y)), (px, py) = (-fy, fx)
        let e = CGFloat(b.edge) * r, far = r * 4
        func pt(_ along: CGFloat, _ out: CGFloat) -> CGPoint { CGPoint(x: c.x + fx * out + px * along, y: c.y + fy * out + py * along) }
        var bites = Path()
        bites.move(to: pt(-far, e)); bites.addLine(to: pt(far, e)); bites.addLine(to: pt(far, far)); bites.addLine(to: pt(-far, far)); bites.closeSubpath()
        for (x, y, rr) in b.circles {
            let br = CGFloat(rr) * r
            let bc = CGPoint(x: c.x + CGFloat(x) * r, y: c.y + CGFloat(y) * r)
            bites = bites.union(Path(ellipseIn: CGRect(x: bc.x - br, y: bc.y - br, width: br * 2, height: br * 2)))
        }
        return cookie.subtracting(bites)
    }

    /// Where the face sits: the middle of the piece left (unit coordinates), and how big it can be (0...1).
    nonisolated(unsafe) private static var spots: [Int: (x: Double, y: Double, scale: Double)] = [:]

    static func faceSpot(left: Double) -> (x: Double, y: Double, scale: Double) {
        if left > 0.97 { return (0, 0.05, 1) }
        let key = Int((left * 1000).rounded())
        if let hit = spots[key] { return hit }
        let p = piece(bite(for: max(0.01, left)), n: 28)
        let spot = (p.cx, p.cy + 0.05, max(0.45, min(1, sqrt(left) * 1.1)))
        spots[key] = spot
        return spot
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

/// A chocolate-chip cookie that gets eaten as the 5-hour window is used, with Chompyy's eyes when there's room.
/// `left` is the fraction left (1 = whole cookie); nil = unknown (drawn faded). With `mood` set (any mood: it
/// only switches the face on), the eyes perform: random expressions, quick and lively at every quota level.
/// They follow your mouse throughout.
struct CookieView: View {
    var left: Double?
    var size: CGFloat = 64
    var mood: CookieMood? = nil
    /// Hold one expression, for previews and snapshots (no mouse, no clock).
    var still: String? = nil

    var eaten: Double { left.map { 1 - max(0, min(1, $0)) } ?? 0 }
    private var showsFace: Bool { mood != nil && size >= 40 }
    @State private var director = MascotDirector()
    @State private var eyes = EyeMotion()
    @State private var visible = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if showsFace {
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion || still != nil || !visible)) { tl in
                let t = tl.date.timeIntervalSinceReferenceDate
                let pose = still.map { MascotDirector.pose(named: $0) }
                    ?? director.step(t, reducedMotion: reduceMotion)
                let pupils = (still != nil || reduceMotion) ? [CGPoint.zero, .zero] : eyes.step(t, size: size)
                ZStack {
                    dough(face: true) // the same every frame: drawn once, then only moved
                    MascotEyes(pose: pose, pupils: pupils, center: CGPoint(x: spot.x, y: spot.y), scale: spot.scale, size: size)
                }
                    .rotationEffect(.degrees(pose.roll))
                    .scaleEffect(x: 1 + pose.squash * 0.5, y: 1 - pose.squash, anchor: .bottom)
                    .offset(y: pose.lift * size / 220)
            }
            // Finds the face on screen for the mouse, and pauses the animation while the window is hidden.
            .background { if still == nil { EyeAnchor(motion: eyes) { visible = $0 } } } // can't draw in snapshots
            .frame(width: size, height: size)
            .animation(.spring(duration: 0.6), value: eaten)
            .accessibilityLabel(label)
        } else {
            dough(face: false)
                .frame(width: size, height: size)
                .opacity(left == nil ? 0.45 : 1)
                .animation(.spring(duration: 0.6), value: eaten)
                .accessibilityLabel(label)
        }
    }

    private var label: String {
        left.map { "Cookie, \(Int($0 * 100)) percent of the 5-hour window left" } ?? "Cookie, quota unknown"
    }

    private var spot: (x: Double, y: Double, scale: Double) { CookieShape.faceSpot(left: left ?? 1) }

    /// The cookie without the eyes. With a face, chips near the eyes are left out so the eyes never read as chips.
    private func dough(face: Bool) -> some View {
        CookieDough(eaten: eaten, size: size, face: face, spot: CGPoint(x: spot.x, y: spot.y), scale: spot.scale)
            .equatable()
            .drawingGroup() // one bitmap instead of 20 shapes redrawn every frame
    }
}

struct CookieDough: View, Equatable {
    let eaten: Double
    let size: CGFloat
    let face: Bool
    let spot: CGPoint
    let scale: Double

    // Chip positions as fractions of the radius (x, y, size): a well-loaded cookie.
    static let chips: [(CGFloat, CGFloat, CGFloat)] = [
        (-0.40, -0.30, 0.30), (0.20, -0.48, 0.26), (0.42, 0.10, 0.30), (-0.05, 0.08, 0.28),
        (-0.50, 0.32, 0.24), (0.12, 0.52, 0.30), (-0.18, -0.70, 0.20), (0.68, -0.22, 0.20),
        (-0.72, -0.05, 0.22), (0.55, 0.50, 0.24), (-0.28, 0.68, 0.22), (0.35, -0.75, 0.18),
        (0.78, 0.18, 0.18), (-0.62, -0.55, 0.20), (0.02, -0.30, 0.18), (-0.30, 0.30, 0.16),
        (0.30, 0.32, 0.16), (-0.82, 0.30, 0.16), (0.10, 0.82, 0.18), (0.62, -0.55, 0.16),
    ]

    var body: some View {
        let shape = CookieShape(eaten: eaten)
        ZStack {
            shape.fill(RadialGradient(colors: [Brand.dough, Brand.doughEdge], center: .center, startRadius: 0, endRadius: size * 0.6))
            ZStack {
                ForEach(0..<Self.chips.count, id: \.self) { i in
                    let (x, y, s) = Self.chips[i]
                    let nearFace = face && abs(Double(x - spot.x)) < 0.55 * scale && abs(Double(y - spot.y) + 0.05) < 0.45 * scale
                    Ellipse()
                        .fill(Brand.chip)
                        .frame(width: size * s * 0.42, height: size * s * 0.34)
                        .rotationEffect(.degrees(Double(i) * 37))
                        .offset(x: x * size / 2, y: y * size / 2)
                        .opacity(nearFace ? 0 : face ? 0.8 : 1)
                }
            }
            .frame(width: size, height: size)
            .clipShape(shape)
            shape.stroke(Brand.chocolate.opacity(0.35), lineWidth: max(0.5, size / 40))
        }
        .frame(width: size, height: size)
    }
}

/// One googly pupil: a ball in a round socket, pulled toward where it wants to look, slowed by drag, bouncing off
/// the rim. Ported from Morkrom/googlyeyes (MIT, Michael Mork), which does this with UIKit dynamics and the
/// phone's tilt; here the pull is the mouse.
struct GooglyPupil {
    var p = CGPoint.zero
    var v = CGVector.zero
    let pull: Double      // spring toward the target
    let drag: Double
    let bounce: Double    // 0 = dead stop at the rim, 1 = perfect bounce

    mutating func step(to target: CGPoint, dt: Double) {
        v.dx += (pull * (target.x - p.x) - drag * v.dx) * dt
        v.dy += (pull * (target.y - p.y) - drag * v.dy) * dt
        p.x += v.dx * dt
        p.y += v.dy * dt
        let d = hypot(p.x, p.y)
        if d > 1 { // hit the rim: put it back on the edge and bounce the outward part of the velocity
            let n = CGVector(dx: p.x / d, dy: p.y / d)
            p = CGPoint(x: n.dx, y: n.dy)
            let out = v.dx * n.dx + v.dy * n.dy
            if out > 0 {
                v.dx -= (1 + bounce) * out * n.dx
                v.dy -= (1 + bounce) * out * n.dy
            }
        }
    }
}

/// Where each pupil sits in its socket, frame to frame: follows the mouse anywhere on screen; when the mouse
/// rests a while, glances around on its own (after bluey-by-riley, rbrown101010, public domain).
final class EyeMotion {
    weak var anchor: NSView?
    // Slightly different per eye, so they jiggle a little out of step, like real googly eyes.
    private var eyes = [GooglyPupil(pull: 160, drag: 9, bounce: 0.55), GooglyPupil(pull: 150, drag: 8, bounce: 0.6)]
    private var lastTime: Double?
    private var lastMouse = CGPoint(x: CGFloat.nan, y: CGFloat.nan)
    private var lastMove = -100.0

    /// The mouse relative to the face's centre in points (y down), or nil when the face isn't in a window.
    private func mouse() -> CGPoint? {
        guard let v = anchor, let w = v.window else { return nil }
        let p = v.convert(w.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil)
        let dy = p.y - v.bounds.midY
        return CGPoint(x: p.x - v.bounds.midX, y: v.isFlipped ? dy : -dy)
    }

    /// Each pupil's place in its socket, -1...1. Zero while the mouse rests: the expression leads then.
    func step(_ now: Double, size: CGFloat) -> [CGPoint] {
        let dt = min(now - (lastTime ?? now), 1.0 / 30)
        lastTime = now
        var want = CGPoint.zero
        if let m = mouse() {
            if hypot(m.x - lastMouse.x, m.y - lastMouse.y) > 0.5 || lastMouse.x.isNaN { lastMove = now; lastMouse = m }
            let d = hypot(m.x, m.y)
            let reach = min(1, d / (size * 2)) // near the face it looks a little; far away, all the way
            if now - lastMove < 4, d > 0.1 { want = CGPoint(x: m.x / d * reach, y: m.y / d * reach) }
        }
        for i in eyes.indices { eyes[i].step(to: want, dt: dt) }
        return eyes.map(\.p)
    }
}

/// Lets the face find itself on screen, so the eyes can follow the mouse, and says when its window is hidden
/// (closed, minimised or covered), so the animation can pause instead of drawing for nobody.
struct EyeAnchor: NSViewRepresentable {
    let motion: EyeMotion
    var onVisible: (Bool) -> Void = { _ in }

    final class Anchor: NSView {
        var onVisible: (Bool) -> Void = { _ in }
        private var token: NSObjectProtocol?
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let token { NotificationCenter.default.removeObserver(token) }
            guard let window else { return }
            token = NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main) { [weak self] _ in
                guard let self, let w = self.window else { return }
                self.onVisible(w.occlusionState.contains(.visible))
            }
            onVisible(window.occlusionState.contains(.visible))
        }
        deinit { if let token { NotificationCenter.default.removeObserver(token) } }
    }

    func makeNSView(context: Context) -> NSView {
        let v = Anchor()
        v.onVisible = onVisible
        motion.anchor = v
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {
        (nsView as? Anchor)?.onVisible = onVisible
        motion.anchor = nsView
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

/// A sheet of every expression, for checking the look without the app:
/// `CHOMPYY_RENDER_COOKIES=/path/sheet.png Chompyy` writes it and quits.
@MainActor
func renderCookieSheet(to path: String) {
    let names = MascotDirector.order
    let cols = 4
    let sheet = VStack(alignment: .leading, spacing: 16) {
        ForEach(0..<(names.count + cols - 1) / cols, id: \.self) { r in
            HStack(spacing: 26) {
                ForEach(0..<cols, id: \.self) { c in
                    let i = r * cols + c
                    if i < names.count {
                        VStack(spacing: 4) {
                            CookieView(left: [1, 0.93, 0.7, 0.45][(r + c) % 4], size: 110, mood: .content, still: names[i])
                            Text(MascotDirector.expressions[names[i]]!.label).font(.caption).foregroundStyle(.white)
                        }
                    }
                }
            }
        }
        HStack(spacing: 26) {
            ForEach([1, 0.85, 0.6, 0.35, 0.15], id: \.self) { l in CookieView(left: l, size: 18) }
            Text("menu bar").font(.caption).foregroundStyle(.gray)
        }
    }
    .padding(24)
    .background(Color(red: 0.13, green: 0.12, blue: 0.11))
    let renderer = ImageRenderer(content: sheet)
    renderer.scale = 2
    if let tiff = renderer.nsImage?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: path))
    }
}

/// Frames of a real performance for the website and slides: `CHOMPYY_RENDER_FRAMES=/dir Chompyy` writes
/// PNGs at 30 fps and quits (turn them into video with ffmpeg). Two scenes, back to back:
/// 1. a fresh window, lively, the eyes following a cursor that drifts around;
/// 2. the window being used up from 100% to 12%, the cookie getting eaten (same lively tempo).
@MainActor
func renderCookieFrames(to dir: String, width: CGFloat = 960, height: CGFloat = 540) {
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let director = MascotDirector()
    var pupils = [GooglyPupil(pull: 160, drag: 9, bounce: 0.55), GooglyPupil(pull: 150, drag: 8, bounce: 0.6)]
    let size: CGFloat = 300
    let bg = Color(red: 0.09, green: 0.08, blue: 0.07)
    let fps = 30.0, scene1 = 9.0, scene2 = 9.0
    let total = Int((scene1 + scene2) * fps)
    let center = CGPoint(x: width / 2, y: height / 2)
    for f in 0..<total {
        let t = Double(f) / fps
        let inScene2 = t >= scene1
        let left = inScene2 ? 1 - 0.88 * min(1, (t - scene1) / (scene2 - 1)) : 0.93
        // The cursor: wanders on a looping path in scene 1, rests in scene 2 (so the expressions lead).
        let mouse = CGPoint(x: center.x + CGFloat(sin(t * 0.9) * 360 + sin(t * 2.3) * 60),
                            y: center.y + CGFloat(sin(t * 0.7 + 1) * 200))
        let rel = CGPoint(x: mouse.x - center.x, y: mouse.y - center.y)
        let d = hypot(rel.x, rel.y)
        let reach = min(1, d / (size * 2))
        let want = inScene2 || d < 0.1 ? CGPoint.zero : CGPoint(x: rel.x / d * reach, y: rel.y / d * reach)
        for i in pupils.indices { pupils[i].step(to: want, dt: 1 / fps) }
        let pose = director.step(t, reducedMotion: false)
        let spot = CookieShape.faceSpot(left: left)
        let eaten = 1 - left
        let frame = ZStack {
            bg
            ZStack {
                CookieDough(eaten: eaten, size: size, face: true, spot: CGPoint(x: spot.x, y: spot.y), scale: spot.scale)
                MascotEyes(pose: pose, pupils: pupils.map(\.p), center: CGPoint(x: spot.x, y: spot.y), scale: spot.scale, size: size)
            }
            .frame(width: size, height: size)
            .rotationEffect(.degrees(pose.roll))
            .scaleEffect(x: 1 + pose.squash * 0.5, y: 1 - pose.squash, anchor: .bottom)
            .offset(y: pose.lift * size / 220)
            if inScene2 {
                Text("\(Int((left * 100).rounded()))% of the 5-hour window left")
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .foregroundStyle(Brand.cream.opacity(0.85))
                    .offset(y: size / 2 + 48)
            } else {
                Image(systemName: "cursorarrow")
                    .font(.system(size: 34))
                    .foregroundStyle(.white)
                    .shadow(radius: 2)
                    .position(x: mouse.x + 10, y: mouse.y + 14)
            }
        }
        .frame(width: width, height: height)
        let renderer = ImageRenderer(content: frame)
        renderer.scale = 2
        if let tiff = renderer.nsImage?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
            try? png.write(to: URL(fileURLWithPath: String(format: "%@/f%04d.png", dir, f)))
        }
    }
}
