import SwiftUI

// Chompyy's eyes and how they perform, ported from open-mascot-studio (github.com/0oooh/open-mascot-studio,
// MIT, © 2026 0oooh): its capsule eyes, its 16 expressions (each eye posed on its own, plus gaze and a little
// body language), its easing curves, blink shape, ambient breathing and the tremble / drift motions.
// Chompyy's own part is the director: it picks expressions at random, and how often depends on energy.

/// One eye's pose: scale, offset (design units) and rotation (degrees). From open-mascot's `eyePose`.
struct EyePose {
    var sx = 1.0, sy = 1.0, x = 0.0, y = 0.0, rot = 0.0
    static func lerp(_ a: EyePose, _ b: EyePose, _ k: Double) -> EyePose {
        EyePose(sx: a.sx + (b.sx - a.sx) * k, sy: a.sy + (b.sy - a.sy) * k, x: a.x + (b.x - a.x) * k,
                y: a.y + (b.y - a.y) * k, rot: a.rot + (b.rot - a.rot) * k)
    }
}

/// A full pose: body (degrees, squash 0…, lift in design units), gaze (design units) and both eyes.
struct MascotPose {
    var pitch = 0.0, yaw = 0.0, roll = 0.0, squash = 0.0, lift = 0.0
    var gazeX = 0.0, gazeY = 0.0
    var left = EyePose(), right = EyePose()

    static func lerp(_ a: MascotPose, _ b: MascotPose, _ k: Double) -> MascotPose {
        func m(_ x: Double, _ y: Double) -> Double { x + (y - x) * k }
        return MascotPose(pitch: m(a.pitch, b.pitch), yaw: m(a.yaw, b.yaw), roll: m(a.roll, b.roll), squash: m(a.squash, b.squash),
                          lift: m(a.lift, b.lift), gazeX: m(a.gazeX, b.gazeX), gazeY: m(a.gazeY, b.gazeY),
                          left: .lerp(a.left, b.left, k), right: .lerp(a.right, b.right, k))
    }
}

struct MascotExpression {
    enum Motion { case none, tremble, slowDrift }
    let label: String
    let pose: MascotPose
    var body: Motion = .none
    var eyes: Motion = .none
}

/// open-mascot's easing curves.
enum MascotEasing {
    static func clamp(_ v: Double) -> Double { min(1, max(0, v)) }
    static func gentle(_ v: Double) -> Double { let t = clamp(v); return t * t * t * (t * (t * 6 - 15) + 10) }
    static func quick(_ v: Double) -> Double { 1 - pow(1 - clamp(v), 4) }
    static func spring(_ v: Double) -> Double {
        let t = clamp(v)
        return clamp(1 - pow(1 - t, 4) + sin(t * .pi * 2.45) * pow(1 - t, 3) * 0.13)
    }
}

/// Picks and plays expressions. Energy (0…1, the share of the window left) sets the tempo: a fresh window
/// swaps expressions every second or so with springy moves; a nearly used one holds each for many seconds
/// and moves gently.
final class MascotDirector {
    static let expressions: [String: MascotExpression] = {
        func e(_ sx: Double = 1, _ sy: Double = 1, _ x: Double = 0, _ y: Double = 0, _ r: Double = 0) -> EyePose { EyePose(sx: sx, sy: sy, x: x, y: y, rot: r) }
        func p(pitch: Double = 0, yaw: Double = 0, roll: Double = 0, squash: Double = 0, lift: Double = 0, gx: Double = 0, gy: Double = 0, l: EyePose = e(), r: EyePose = e()) -> MascotPose {
            MascotPose(pitch: pitch, yaw: yaw, roll: roll, squash: squash, lift: lift, gazeX: gx, gazeY: gy, left: l, right: r)
        }
        return [
            "neutral": MascotExpression(label: "Neutral", pose: p()),
            "focused": MascotExpression(label: "Focused", pose: p(pitch: -3, yaw: 10, roll: 4, gx: 3, l: e(0.95, 1.13), r: e(0.95, 1.13))),
            "curious": MascotExpression(label: "Curious", pose: p(pitch: -7, yaw: -14, roll: -7, gx: -4, gy: -2, l: e(0.92, 1.06, 0, 0, 17), r: e(0.82, 0.88, 0, 1, -13))),
            "skyward": MascotExpression(label: "Skyward", pose: p(pitch: 6, yaw: 20, roll: -10, gx: 5, gy: -10, l: e(1.02, 0.88), r: e(1.02, 0.88))),
            "soft-gaze": MascotExpression(label: "Soft gaze", pose: p(pitch: -10, yaw: -6, roll: -5, gy: 5, l: e(1.08, 0.82), r: e(1.08, 0.82))),
            "side-eye": MascotExpression(label: "Side-eye", pose: p(pitch: -7, yaw: 12, roll: -6, gx: 4, l: e(1.1, 0.34, 0, -1, -4), r: e(0.9, 1.08, 0, 1, 3))),
            "beaming": MascotExpression(label: "Beaming", pose: p(pitch: -4, yaw: -11, roll: 8, squash: 0.05, lift: -5, l: e(1.32, 1.4, 0, -2, -5), r: e(1.32, 1.4, 0, -2, 5))),
            "cheeky": MascotExpression(label: "Cheeky", pose: p(pitch: 2, yaw: 15, roll: -12, lift: -3, gx: 3, l: e(0.85, 0.86, 0, 0, 22), r: e(0.85, 0.86, 0, 0, -18))),
            "surprised": MascotExpression(label: "Surprised", pose: p(pitch: -3, yaw: -8, roll: -5, squash: -0.03, lift: -4, l: e(1.55, 0.72), r: e(1.55, 0.72))),
            "shy": MascotExpression(label: "Shy", pose: p(pitch: -12, yaw: 7, roll: 5, gx: -2, gy: 10, l: e(0.92, 0.66), r: e(0.92, 0.66))),
            "sleepy": MascotExpression(label: "Sleepy", pose: p(pitch: 5, yaw: 3, roll: 5, squash: 0.03, gy: 4, l: e(1.25, 0.18), r: e(1.25, 0.18))),
            "confident": MascotExpression(label: "Confident", pose: p(pitch: 8, yaw: 17, roll: -6, lift: -2, gx: 5, gy: -5, l: e(0.94, 0.82), r: e(0.94, 0.82))),
        ]
    }()
    static let order = ["neutral", "focused", "curious", "skyward", "soft-gaze", "side-eye", "beaming", "cheeky",
                        "surprised", "shy", "sleepy", "confident"]
    // Left out on purpose: open-mascot's Sad, Angry and Uneasy. A happy cookie doesn't need them (user, 2026-11-18).

    static func pose(named name: String) -> MascotPose { expressions[name]?.pose ?? MascotPose() }

    private var current = "neutral"
    private var next = "neutral"
    private var stepStart: Double?
    private var hold = 2.0
    private var transition = 0.6
    private var springy = true
    private var blinkStart = -10.0
    private var nextBlink = 0.0
    private var echo = false

    /// The pose to draw now.
    func step(_ now: Double, energy rawEnergy: Double, reducedMotion: Bool) -> MascotPose {
        let energy = MascotEasing.clamp(rawEnergy)
        if stepStart == nil { stepStart = now; plan(energy) }
        var local = now - stepStart!
        if local > hold + transition { // the move is done: pick the next expression
            current = next
            stepStart = now
            local = 0
            plan(energy)
        }
        var pose = Self.pose(named: current)
        var layers: [(MascotExpression, Double)] = [(Self.expressions[current]!, 1)]
        if local > hold {
            let k = (local - hold) / transition
            let eased = springy ? MascotEasing.spring(k) : MascotEasing.gentle(k)
            pose = .lerp(pose, Self.pose(named: next), eased)
            layers = [(Self.expressions[current]!, 1 - eased), (Self.expressions[next]!, eased)]
        }
        if reducedMotion { return pose }
        pose = ambient(pose, now, amount: 0.3 + 0.45 * energy, energy: energy)
        for (expr, strength) in layers { pose = Self.motion(pose, expr, now, strength) }
        return pose
    }

    /// Choose the next expression and the tempo for it.
    private func plan(_ energy: Double) {
        next = Self.order.filter { $0 != current }.randomElement() ?? "neutral"
        let calm = 1 - energy
        hold = (0.7 + calm * calm * 9.5) * .random(in: 0.7...1.3) // ~1 s when fresh, ~10 s near the end
        transition = 0.32 + calm * 0.5
        springy = energy > 0.5
    }

    /// open-mascot's ambient layer: breathing, a little sway, and blinks.
    private func ambient(_ source: MascotPose, _ now: Double, amount: Double, energy: Double) -> MascotPose {
        var p = source
        p.lift += sin(now * 0.79 + 0.4) * 2.1 * amount
        p.roll += sin(now * 0.53 + 1.1) * 0.72 * amount
        p.pitch += sin(now * 0.41 + 2.3) * 0.5 * amount
        p.squash += sin(now * 1.06) * 0.006 * amount
        p.gazeX += sin(now * 0.29 + 0.7) * 0.42 * amount
        p.gazeY += sin(now * 0.23 + 2.7) * 0.3 * amount

        // Blinks: brighter (more often, sometimes a double) with more energy, calmer as the window runs out.
        if now > nextBlink {
            blinkStart = now
            echo = energy > 0.6 && Double.random(in: 0...1) < 0.3
            nextBlink = now + (energy > 0.6 ? .random(in: 3.9...6.9) : energy > 0.25 ? .random(in: 4.3...7.2) : .random(in: 5.3...7.9))
        }
        func shape(_ k: Double) -> Double { // open-mascot's blink curve: snap shut, hold, ease open
            if k < 0.23 { return MascotEasing.quick(k / 0.23) }
            if k < 0.39 { return 1 }
            return 1 - MascotEasing.gentle((k - 0.39) / 0.61)
        }
        let within = now - blinkStart
        var blink = (0...0.205).contains(within) ? shape(within / 0.205) : 0
        let echoWithin = within - 0.205 - 0.118
        if echo, (0...0.17).contains(echoWithin) { blink = shape(echoWithin / 0.17) * 0.88 }
        p.left.sy *= max(0.055, 1 - blink * 0.95)
        p.right.sy *= max(0.055, 1 - blink * 0.96)
        p.left.y += blink * 1.25
        p.right.y += blink * 1.05
        return p
    }

    private static let bodyTremble: [(Double, Double, Double, Double)] = [(-0.82, 0.38, -0.28, 0.62), (0.54, -0.66, 0.43, -0.44), (1.08, 0.2, -0.24, 0.86), (-0.46, 0.72, 0.34, -0.58), (0.16, -0.31, -0.49, 0.22)]
    private static let eyeTremble: [(Double, Double)] = [(-1.12, 0.44), (0.67, -0.74), (1.28, 0.2), (-0.48, 0.8), (0.2, -0.36)]

    /// open-mascot's per-expression motions.
    private static func motion(_ source: MascotPose, _ expr: MascotExpression, _ now: Double, _ strength: Double) -> MascotPose {
        var p = source
        func loop<T>(_ frames: [T], _ pos: Double, _ mix: (T, T, Double) -> T) -> T {
            let n = Double(frames.count)
            let w = pos.truncatingRemainder(dividingBy: n)
            let i = Int(w)
            return mix(frames[i], frames[(i + 1) % frames.count], MascotEasing.gentle(w - Double(i)))
        }
        switch expr.body {
        case .slowDrift:
            p.yaw += sin(now * 0.73) * 1.4 * strength
            p.pitch += sin(now * 0.51) * 0.85 * strength
            p.roll += sin(now * 0.39) * 0.72 * strength
            p.lift += sin(now * 0.88) * 1.9 * strength
        case .tremble:
            let f = loop(bodyTremble, now * 8.4) { a, b, k in (a.0 + (b.0 - a.0) * k, a.1 + (b.1 - a.1) * k, a.2 + (b.2 - a.2) * k, a.3 + (b.3 - a.3) * k) }
            p.yaw += f.0 * strength; p.pitch += f.1 * strength; p.roll += f.2 * strength; p.lift += f.3 * strength
        case .none: break
        }
        if expr.eyes == .tremble {
            let f = loop(eyeTremble, now * 10.6) { a, b, k in (a.0 + (b.0 - a.0) * k, a.1 + (b.1 - a.1) * k) }
            p.gazeX += f.0 * strength; p.gazeY += f.1 * strength
        }
        return p
    }
}

/// The two capsule eyes, drawn the way open-mascot's 2D rig places them (yaw bends the face sideways, pitch
/// squeezes it; the body's roll, squash and lift are applied to the whole cookie by the caller). `pupils`
/// add the googly mouse-following on top.
struct MascotEyes: View {
    let pose: MascotPose
    let pupils: [CGPoint]
    /// The face's centre on the cookie (unit coordinates) and how big it can be (0…1).
    let center: CGPoint
    let scale: Double
    let size: CGFloat

    /// open-mascot's default face, in design units (its blob is 220 wide).
    static let eyeWidth = 23.0, eyeHeight = 56.0, eyeGap = 42.0, eyeY = -10.0
    static let color = Color(red: 0.24, green: 0.11, blue: 0.08) // the warm dark brown of open-mascot's preview

    var body: some View {
        Canvas { ctx, canvas in
            let k = size * 0.95 * CGFloat(scale) / 220 // design unit → points
            let origin = CGPoint(x: canvas.width / 2 + center.x * size / 2, y: canvas.height / 2 + center.y * size / 2)
            let yawScale = max(0.8, 1 - abs(pose.yaw) * 0.005)
            let pitchScale = max(0.9, 1 - abs(pose.pitch) * 0.0025)
            for (i, eye) in [pose.left, pose.right].enumerated() {
                let dir = i == 0 ? -1.0 : 1.0
                let googly = i < pupils.count ? pupils[i] : .zero
                let x = dir * Self.eyeGap / 2 + pose.gazeX + eye.x + Double(googly.x) * 9
                let y = Self.eyeY + pose.gazeY + eye.y + Double(googly.y) * 7
                let vp = y / 135
                let cx = x * yawScale + pose.yaw * vp * 0.18 + pose.yaw * 0.16
                let cy = y * pitchScale
                let w = max(2, Self.eyeWidth * eye.sx * yawScale) * k
                let h = max(2, Self.eyeHeight * eye.sy * pitchScale) * k
                var e = ctx
                e.translateBy(x: origin.x + CGFloat(cx) * k, y: origin.y + CGFloat(cy) * k)
                e.rotate(by: .degrees(eye.rot))
                let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
                e.fill(Path(roundedRect: rect, cornerRadius: min(w, h) / 2), with: .color(Self.color))
            }
        }
        .frame(width: size, height: size)
        .allowsHitTesting(false)
    }
}
