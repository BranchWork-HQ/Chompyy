import AppKit
import Charts
import SwiftUI

/// An Advice card's picture: what Chompyy saw → what changes → how it's checked, then your own numbers as bars.
/// (The blueprint map is for away runs; advice has no Goal / Won't touch.)
struct AdviceView: View {
    let card: Card

    var body: some View {
        let a = card.advice!
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 0) {
                step("eye", "What Chompyy saw", a.saw ?? "—", Brand.dough)
                arrow
                step(a.lane == "settings" ? "slider.horizontal.3" : a.lane == "habit" ? "figure.walk" : "hand.point.up.left",
                     a.lane == "settings" ? "What changes" : a.lane == "habit" ? "What you do" : "Yours to do", a.doing ?? "—", Brand.doughEdge)
                arrow
                step("ruler", "How it's checked", a.checkShort ?? a.check, Brand.ok)
            }
            if let r = a.result { AdviceResultView(result: r) }
            if let chart = a.chart { AdviceChart(chart: chart) }
            if let plan = card.blueprint {
                DisclosureGroup("Details: the evidence, what it doesn't prove, the exact change") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(plan.components(separatedBy: "\n\n").enumerated()), id: \.offset) { _, para in
                            Text(md(para)).font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.top, 8)
                }
            }
        }
    }

    private var arrow: some View {
        Image(systemName: "arrow.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            .padding(.top, 26).padding(.horizontal, 4)
    }

    private func step(_ symbol: String, _ label: String, _ text: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: symbol).font(.caption.weight(.semibold)).foregroundStyle(tint)
            Text(md(text)).font(.callout).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .topLeading)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(tint.opacity(0.25)))
    }
}

/// Did it work? The verdict, the method behind it (re-count is the strongest), and the weaker reading beside it.
struct AdviceResultView: View {
    let result: CardAdvice.Result

    private var look: (String, String, Color) {
        switch result.verdict {
        case "worked": return ("It worked", "checkmark.seal.fill", Brand.ok)
        case "too-early": return ("Too early to tell", "hourglass", .secondary)
        case "short": return ("Fell short", "circle.lefthalf.filled", Brand.warn)
        case "no-change": return ("No change", "minus.circle", .secondary)
        case "worse": return ("Went the wrong way", "arrow.down.right.circle.fill", Brand.warn)
        default: return ("Can't tell", "questionmark.circle", .secondary)
        }
    }

    var body: some View {
        let (label, symbol, tint) = look
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label("Did it work? \(label)", systemImage: symbol).font(.callout.weight(.semibold)).foregroundStyle(tint)
                Spacer()
                Text(result.method == "recount" ? "Re-counted" : "Before vs after").font(.caption).foregroundStyle(.secondary)
                    .help(result.method == "recount" ? "The thing that changed, counted again: the strongest check." : "Weeks compared: can't separate the fix from anything else that changed.")
            }
            Text(md(result.line)).font(.callout).fixedSize(horizontal: false, vertical: true)
            if let also = result.also { Text(also).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(tint.opacity(0.25)))
    }
}

/// Bars of your own numbers (tokens). The highlighted bar is where the fix aims.
struct AdviceChart: View {
    let chart: CardAdvice.Chart

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(chart.title).font(.headline)
            Chart(Array(chart.bars.enumerated()), id: \.offset) { _, bar in
                BarMark(x: .value("When", bar.label), y: .value("Tokens", bar.value))
                    .foregroundStyle(bar.highlight == true ? Brand.ok : Brand.doughEdge)
                    .annotation(position: .top) {
                        Text(UsageFormat.tokens(Double(bar.value))).font(.caption2).foregroundStyle(.secondary)
                    }
            }
            .chartYAxis {
                AxisMarks { v in
                    AxisGridLine()
                    AxisValueLabel { if let n = v.as(Int.self) { Text(UsageFormat.tokens(Double(n))) } }
                }
            }
            .frame(height: 160)
            if let note = chart.note { Text(note).font(.caption).foregroundStyle(.secondary) }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Brand.columnBackground))
    }
}

/// `CHOMPYY_RENDER_ADVICE=/path/advice.png Chompyy`: draws the sidebar and the advice cards on the board (dark and
/// light) off-screen and quits. For checking the look without a window.
@MainActor
func renderAdviceSheet(to path: String) {
    guard let r = try? CLI.run(["state"]), r.ok, let state = try? JSONDecoder().decode(AppState.self, from: Data(r.out.utf8)) else { return }
    let cards = state.cards.filter(\.isAdvice)
    let store = Store()
    func page(_ scheme: ColorScheme) -> some View {
        HStack(alignment: .top, spacing: 0) {
            BoardSidebar(showFeedback: .constant(false), showColdStart: .constant(false)).frame(height: 900)
            VStack(alignment: .leading, spacing: 28) {
                ForEach(cards) { c in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(c.title).font(.title2.weight(.semibold))
                        AdviceView(card: c)
                    }
                }
            }
            .padding(24)
            .frame(width: 900)
        }
        .background(scheme == .dark ? Color(red: 0.11, green: 0.10, blue: 0.09) : Color(red: 0.98, green: 0.95, blue: 0.90))
        .environment(\.colorScheme, scheme)
        .environmentObject(store)
    }
    let renderer = ImageRenderer(content: VStack(spacing: 0) { page(.dark); page(.light) })
    renderer.scale = 1.5
    if let tiff = renderer.nsImage?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: path))
    }
}
