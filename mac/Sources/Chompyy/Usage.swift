import SwiftUI

// The monitor (pillar B): what Claude Code did on this Mac, from the usage ledger (cli/src/usage.ts).
// Layout ideas from codeburn's menubar insights (Trend / Calendar pills) and AgentLimits' calendar heatmap
// (quartile levels); both MIT. Research: research/monitoring/PICKS.md.

enum UsageMetric: String, CaseIterable, Identifiable {
    case tokens, value
    var id: String { rawValue }
    var label: String { self == .tokens ? "Tokens" : "API value" }
    func of(_ t: UsageData.Tally) -> Double { self == .tokens ? t.tokens : t.costUsd }
    func format(_ n: Double) -> String { self == .tokens ? UsageFormat.tokens(n) : UsageFormat.usd(n) }
}

enum UsageTab: String, CaseIterable, Identifiable {
    case trend, calendar, projects, conversations
    var id: String { rawValue }
    var label: String {
        switch self {
        case .trend: "Trend"
        case .calendar: "Calendar"
        case .projects: "Projects"
        case .conversations: "Conversations"
        }
    }
}

/// The switcher and the chosen view. `compact` is the menu bar popover's size.
struct UsageInsights: View {
    @EnvironmentObject var store: Store
    var compact = false
    @AppStorage("usageTab") private var tab: UsageTab = .trend
    @AppStorage("usageMetric") private var metric: UsageMetric = .tokens

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                ForEach(compact ? [UsageTab.trend, .calendar] : UsageTab.allCases) { t in
                    Button(t.label) { tab = t }
                        .buttonStyle(.plain)
                        .font(.caption.weight(tab == t ? .semibold : .regular))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(tab == t ? Brand.doughEdge.opacity(0.25) : .clear))
                }
                Spacer()
                Picker("", selection: $metric) {
                    ForEach(UsageMetric.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().controlSize(.mini).fixedSize()
            }
            if let u = store.usage {
                let shown = compact && (tab == .projects || tab == .conversations) ? .trend : tab
                switch shown {
                case .trend: TrendView(days: Array(u.days.suffix(14)), metric: metric, compact: compact)
                case .calendar: CalendarHeatmap(days: u.days, metric: metric, compact: compact)
                case .projects: ProjectsView(week: u.week, metric: metric)
                case .conversations: ConversationsView(week: u.week, metric: metric)
                }
            } else {
                HStack { ProgressView().controlSize(.small); Text("Reading your sessions…").font(.caption).foregroundStyle(.secondary) }
                    .frame(maxWidth: .infinity, minHeight: compact ? 70 : 160)
            }
        }
        .task { await store.loadUsage() }
    }
}

/// Today's line: tokens, API value, requests.
struct UsageToday: View {
    let today: UsageData.Tally

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("Today").font(.caption.weight(.semibold))
            Text(UsageFormat.tokens(today.tokens)).font(.callout.weight(.semibold).monospacedDigit())
            Text("tokens ·").font(.caption).foregroundStyle(.secondary)
            Text(UsageFormat.usd(today.costUsd)).font(.callout.weight(.semibold).monospacedDigit())
            Text("API value").font(.caption).foregroundStyle(.secondary)
            Spacer()
        }
        .help("What today's Claude Code work would cost at API list prices. On a subscription you pay your plan, not this.")
    }
}

/// Day bars for the last 14 days, with the peak and the average.
struct TrendView: View {
    let days: [UsageData.Day]
    let metric: UsageMetric
    var compact = false

    var body: some View {
        let values = days.map { metric.of($0.total) }
        let peak = max(values.max() ?? 0, 1e-9)
        let active = values.filter { $0 > 0 }
        let avg = active.isEmpty ? 0 : active.reduce(0, +) / Double(active.count)
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .bottom, spacing: compact ? 3 : 5) {
                ForEach(Array(days.enumerated()), id: \.element.id) { i, d in
                    let v = values[i]
                    VStack(spacing: 2) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(i == days.count - 1 ? Brand.dough : Brand.doughEdge.opacity(v > 0 ? 0.85 : 0.2))
                            .frame(height: max(2, CGFloat(v / peak) * (compact ? 54 : 150)))
                        if !compact { Text(d.date?.formatted(.dateTime.day()) ?? "").font(.system(size: 9)).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity)
                    .help("\(d.day): \(UsageFormat.tokens(d.total.tokens)) tokens · \(UsageFormat.usd(d.total.costUsd)) · \(d.total.requests) requests")
                }
            }
            .frame(height: compact ? 56 : 168, alignment: .bottom)
            Text("Last 14 days · peak \(metric.format(peak)) · average \(metric.format(avg)) on days you worked")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }
}

/// GitHub-style calendar of the last 12 weeks. Levels are quartiles of the days you worked (AgentLimits), so one
/// huge day doesn't wash out the rest.
struct CalendarHeatmap: View {
    let days: [UsageData.Day]
    let metric: UsageMetric
    var compact = false

    var body: some View {
        let cell: CGFloat = compact ? 11 : 16
        let weeks = columns()
        let cuts = quartiles()
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 3) {
                VStack(alignment: .trailing, spacing: 3) {
                    ForEach(0..<7, id: \.self) { row in
                        Text(row == 0 ? "Mon" : row == 2 ? "Wed" : row == 4 ? "Fri" : "")
                            .font(.system(size: 8)).foregroundStyle(.secondary).frame(height: cell)
                    }
                }
                ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                    VStack(spacing: 3) {
                        ForEach(0..<7, id: \.self) { row in
                            if let d = week[row] {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(color(level(metric.of(d.total), cuts)))
                                    .frame(width: cell, height: cell)
                                    .help("\(d.day): \(UsageFormat.tokens(d.total.tokens)) tokens · \(UsageFormat.usd(d.total.costUsd))")
                            } else {
                                Color.clear.frame(width: cell, height: cell)
                            }
                        }
                    }
                }
            }
            HStack(spacing: 3) {
                Text("Less").font(.system(size: 8)).foregroundStyle(.secondary)
                ForEach(0..<5, id: \.self) { RoundedRectangle(cornerRadius: 2).fill(color($0)).frame(width: 8, height: 8) }
                Text("More").font(.system(size: 8)).foregroundStyle(.secondary)
            }
        }
    }

    /// Weeks Monday to Sunday, oldest first; days outside the range are empty.
    private func columns() -> [[UsageData.Day?]] {
        var cal = Calendar(identifier: .gregorian)
        cal.firstWeekday = 2
        var out: [[UsageData.Day?]] = []
        var week: [UsageData.Day?] = Array(repeating: nil, count: 7)
        var started = false
        for d in days {
            guard let date = d.date else { continue }
            let row = (cal.component(.weekday, from: date) + 5) % 7 // Monday = 0
            if row == 0 && started { out.append(week); week = Array(repeating: nil, count: 7) }
            week[row] = d
            started = true
        }
        if started { out.append(week) }
        return out
    }

    private func quartiles() -> [Double] {
        let v = days.map { metric.of($0.total) }.filter { $0 > 0 }.sorted()
        guard !v.isEmpty else { return [] }
        return [0.25, 0.5, 0.75].map { v[min(v.count - 1, Int(Double(v.count) * $0))] }
    }

    private func level(_ v: Double, _ cuts: [Double]) -> Int {
        guard v > 0, cuts.count == 3 else { return 0 }
        return v < cuts[0] ? 1 : v < cuts[1] ? 2 : v < cuts[2] ? 3 : 4
    }

    private func color(_ level: Int) -> Color {
        level == 0 ? Color.primary.opacity(0.08) : Brand.doughEdge.opacity([0, 0.3, 0.5, 0.75, 1.0][level])
    }
}

/// This week by project and by model.
struct ProjectsView: View {
    let week: UsageData.Week
    let metric: UsageMetric

    var body: some View {
        let peak = max(week.byWorkspace.map { metric.of($0.total) }.max() ?? 0, 1e-9)
        VStack(alignment: .leading, spacing: 8) {
            Text("This week · \(UsageFormat.tokens(week.total.tokens)) tokens · \(UsageFormat.usd(week.total.costUsd)) API value")
                .font(.caption.weight(.semibold))
            ForEach(week.byWorkspace.prefix(8)) { p in
                HStack(spacing: 8) {
                    Text((p.workspace as NSString).abbreviatingWithTildeInPath).font(.caption).lineLimit(1).truncationMode(.middle)
                        .frame(width: 260, alignment: .leading)
                    GeometryReader { geo in
                        Capsule().fill(Brand.doughEdge).frame(width: max(3, geo.size.width * metric.of(p.total) / peak))
                    }.frame(height: 6)
                    Text(metric.format(metric.of(p.total))).font(.caption.monospacedDigit()).frame(width: 64, alignment: .trailing)
                }
            }
            if !week.byModel.isEmpty {
                Text("By model: " + week.byModel.map { "\($0.model.replacingOccurrences(of: "claude-", with: "")) \(metric.format(metric.of($0.total)))" }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

/// This week's costliest conversations. Titles of folders you didn't tick for the nightly read stay hidden.
struct ConversationsView: View {
    let week: UsageData.Week
    let metric: UsageMetric

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(week.conversations) { c in
                HStack(spacing: 8) {
                    Image(systemName: c.away ? "moon.zzz" : c.private ? "lock" : "bubble.left.and.text.bubble.right")
                        .foregroundStyle(Brand.doughEdge).frame(width: 16)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(c.private ? "Title hidden (a workspace you didn't tick)" : c.title ?? "Untitled conversation")
                            .font(.callout).lineLimit(1)
                            .foregroundStyle(c.private ? .secondary : .primary)
                        Text("\((c.workspace as NSString).lastPathComponent) · \(c.requests) request\(c.requests == 1 ? "" : "s") · \(String(c.start.prefix(10)))")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(metric == .tokens ? UsageFormat.tokens(c.tokens) : UsageFormat.usd(c.costUsd)).font(.callout.monospacedDigit())
                }
            }
            Text("Away runs: cost as Claude Code recorded it. Everything else: calculated from list prices, each reply counted once.")
                .font(.caption2).foregroundStyle(.tertiary)
        }
    }
}

/// The board's usage sheet: today, the switcher, and a note on what the numbers mean.
struct UsageSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Usage").font(.title3.weight(.semibold))
                    Text("Every Claude Code conversation on this Mac. API value is what the work would cost at list prices; on a subscription you pay your plan, not this.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            if let t = store.usage?.today { UsageToday(today: t) }
            UsageInsights()
            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(minWidth: 680, minHeight: 460)
        .task { await store.loadUsage(force: true) }
    }
}

/// For checking the look without opening a window: `CHOMPYY_RENDER_USAGE=/path/usage.png Chompyy` reads the
/// ledger once, draws every usage view (dark, then light) and quits.
@MainActor
func renderUsageSheet(to path: String) {
    guard let r = try? CLI.run(["usage", "--json", "--app"]), r.ok,
          let u = try? JSONDecoder().decode(UsageData.self, from: Data(r.out.utf8)) else { return }
    func page(_ scheme: ColorScheme) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            UsageToday(today: u.today)
            TrendView(days: Array(u.days.suffix(14)), metric: .tokens)
            HStack(alignment: .top, spacing: 30) {
                CalendarHeatmap(days: u.days, metric: .tokens)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Menu bar size").font(.caption).foregroundStyle(.secondary)
                    TrendView(days: Array(u.days.suffix(14)), metric: .value, compact: true).frame(width: 300)
                    CalendarHeatmap(days: u.days, metric: .value, compact: true)
                }
            }
            ProjectsView(week: u.week, metric: .value)
            ConversationsView(week: u.week, metric: .value)
        }
        .padding(24)
        .frame(width: 760)
        .background(scheme == .dark ? Color(red: 0.11, green: 0.10, blue: 0.09) : Color(red: 0.98, green: 0.95, blue: 0.90))
        .environment(\.colorScheme, scheme)
    }
    let renderer = ImageRenderer(content: HStack(spacing: 0) { page(.dark); page(.light) })
    renderer.scale = 2
    if let tiff = renderer.nsImage?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: path))
    }
}
