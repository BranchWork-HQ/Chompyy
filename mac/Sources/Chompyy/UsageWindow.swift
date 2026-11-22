import SwiftUI

// The Usage window: Chompyy's monitor as its own place, laid out like codeburn's dashboard (sidebar + pages;
// MIT, idea only). Data: `chompyy usage --json --app --period <p>` (cli/src/usage.ts).

enum UsageSection: String, CaseIterable, Identifiable {
    case overview, conversations, prs, projects, optimize
    var id: String { rawValue }
    var label: String {
        switch self {
        case .overview: "Overview"
        case .conversations: "Conversations"
        case .prs: "Pull requests"
        case .projects: "Projects & models"
        case .optimize: "Optimize"
        }
    }
    var icon: String {
        switch self {
        case .overview: "square.grid.2x2"
        case .conversations: "bubble.left.and.text.bubble.right"
        case .prs: "arrow.triangle.pull"
        case .projects: "folder"
        case .optimize: "wand.and.stars"
        }
    }
}

struct UsageWindow: View {
    @EnvironmentObject var store: Store
    @AppStorage("usageSection") private var section: UsageSection = .overview
    @AppStorage("usagePeriod") private var period = "7d"
    @AppStorage("usageMetric") private var metric: UsageMetric = .value

    var body: some View {
        NavigationSplitView {
            List(UsageSection.allCases, selection: Binding(get: { Optional(section) }, set: { if let s = $0 { section = s } })) { s in
                Label(s.label, systemImage: s.icon).tag(s)
            }
            .navigationSplitViewColumnWidth(min: 170, ideal: 190)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let u = store.usage {
                        UsagePage(section: section, usage: u, metric: metric)
                    } else {
                        HStack { ProgressView().controlSize(.small); Text("Reading your sessions…").foregroundStyle(.secondary) }
                            .frame(maxWidth: .infinity, minHeight: 300)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Brand.boardBackground)
            .navigationTitle(section.label)
            .toolbar {
                ToolbarItemGroup {
                    Picker("Period", selection: $period) {
                        Text("Today").tag("today")
                        Text("7D").tag("7d")
                        Text("30D").tag("30d")
                        Text("Month").tag("month")
                    }
                    .pickerStyle(.segmented)
                    Picker("Show", selection: $metric) {
                        ForEach(UsageMetric.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Button { Task { await store.loadUsage(force: true) } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                }
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .task { await store.loadUsage(force: true) }
        .onChange(of: period) { _, _ in Task { await store.loadUsage(force: true) } }
    }
}

/// One page of the window. Separate from the window so the off-screen render can draw it.
struct UsagePage: View {
    let section: UsageSection
    let usage: UsageData
    let metric: UsageMetric

    var body: some View {
        let view = usage.view
        switch section {
        case .overview:
            UsageOverview(usage: usage, metric: metric)
        case .conversations:
            if let v = view { ConversationsView(week: v.asWeek, metric: metric) } else { ConversationsView(week: usage.week, metric: metric) }
        case .prs:
            PullRequestsView(prs: view?.prs ?? [], metric: metric)
        case .projects:
            ProjectsView(week: view?.asWeek ?? usage.week, metric: metric)
        case .optimize:
            OptimizePlaceholder()
        }
    }
}

/// Today, this month, the calendar, the trend for the period, and what the work was.
struct UsageOverview: View {
    let usage: UsageData
    let metric: UsageMetric

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                TodayCard(today: usage.today, compare: usage.compare)
                if let m = usage.compare?.month { MonthCard(month: m) }
            }
            HStack(alignment: .top, spacing: 16) {
                UsageCard(title: "Last 12 weeks") { CalendarHeatmap(days: usage.days, metric: metric) }
                UsageCard(title: "What the work was") { KindsView(kinds: usage.view?.byKind ?? [], metric: metric) }
            }
            UsageCard(title: "Day by day") {
                let days = usage.view?.days ?? usage.week.days
                let shown = days.count >= 7 ? days : Array(usage.days.suffix(7))
                TrendView(days: shown, metric: metric, label: "Last \(shown.count) days")
            }
        }
    }
}

struct UsageCard<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Brand.cardBackground, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct TodayCard: View {
    let today: UsageData.Tally
    let compare: UsageData.Compare?

    var body: some View {
        UsageCard(title: "Today") {
            Text(UsageFormat.usd(today.costUsd)).font(.system(size: 34, weight: .semibold).monospacedDigit())
            Text("\(UsageFormat.tokens(today.tokens)) tokens · \(today.requests) requests").font(.caption).foregroundStyle(.secondary)
            if let c = compare {
                Divider()
                HStack(spacing: 18) {
                    Stat(label: "Yesterday", value: UsageFormat.usd(c.yesterday.costUsd))
                    Stat(label: "7-day average", value: UsageFormat.usd(c.avg7.costUsd))
                    if let p = c.vsYesterdayPct { Stat(label: "vs yesterday", value: "\(p > 0 ? "+" : "")\(p)%", tint: p > 0 ? Brand.warn : Brand.ok) }
                }
            }
        }
    }
}

struct MonthCard: View {
    let month: UsageData.Compare.Month

    var body: some View {
        UsageCard(title: "This month") {
            Text(UsageFormat.usd(month.toDate.costUsd)).font(.system(size: 34, weight: .semibold).monospacedDigit())
            Text("API-priced work so far · on pace for \(UsageFormat.usd(month.projectedUsd))").font(.caption).foregroundStyle(.secondary)
            Divider()
            if let plan = month.plan {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(plan.multiple, specifier: "%.1f")×").font(.title2.weight(.semibold)).foregroundStyle(Brand.ok)
                    Text("your \(plan.label) plan's $\(Int(plan.priceUsd)) so far · on pace for \(plan.projectedMultiple, specifier: "%.1f")×")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .help("List price for your plan; set yours with `chompyy plan-price <dollars>`. You pay the plan, not the API value.")
            }
            if let p = month.vsLastMonthPct {
                Text("\(p > 0 ? "+" : "")\(p)% vs the same days last month").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

struct Stat: View {
    let label: String
    let value: String
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold).monospacedDigit()).foregroundStyle(tint)
        }
    }
}

/// Where the tokens went by kind of work, judged from the tools each request used (any language, no text read).
struct KindsView: View {
    let kinds: [UsageData.KindTotal]
    let metric: UsageMetric

    var body: some View {
        let total = max(kinds.map { metric.of($0.total) }.reduce(0, +), 1e-9)
        VStack(alignment: .leading, spacing: 7) {
            ForEach(kinds) { k in
                HStack(spacing: 8) {
                    Text(k.kind).font(.caption).frame(width: 120, alignment: .leading)
                    GeometryReader { geo in
                        Capsule().fill(Brand.doughEdge).frame(width: max(3, geo.size.width * metric.of(k.total) / total))
                    }.frame(height: 7)
                    Text(metric.format(metric.of(k.total))).font(.caption.monospacedDigit()).frame(width: 64, alignment: .trailing)
                }
            }
            Text("By what each request did: edited files, ran commands, read code, searched the web, or just talked.")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// What each pull request cost: the conversation's requests from its previous PR (or its start) until this one.
struct PullRequestsView: View {
    let prs: [UsageData.PrCost]
    let metric: UsageMetric
    @State private var open: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if prs.isEmpty {
                Text("No pull requests opened in this period.").foregroundStyle(.secondary)
            }
            ForEach(prs) { p in
                HStack(spacing: 10) {
                    Image(systemName: "arrow.triangle.pull").foregroundStyle(Brand.doughEdge)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(p.repo.split(separator: "/").last.map(String.init) ?? p.repo) #\(p.number)")
                            .font(.callout.weight(.semibold)).foregroundStyle(Brand.doughEdge)
                            .onTapGesture { if let u = URL(string: p.url) { openURL(u) } }
                            .help(p.url)
                        Text("\(p.title ?? "Title hidden") · \(String(p.at.prefix(10))) · \(p.total.requests) requests")
                            .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    Text("Conversation ›").font(.caption).foregroundStyle(Brand.doughEdge)
                        .onTapGesture { open = p.session }
                        .help("Open the conversation turn by turn")
                    Text(metric == .tokens ? UsageFormat.tokens(p.total.tokens) : UsageFormat.usd(p.total.costUsd))
                        .font(.callout.monospacedDigit()).frame(width: 70, alignment: .trailing)
                }
                .padding(10)
                .background(Brand.cardBackground, in: RoundedRectangle(cornerRadius: 10))
            }
            Text("Cost = what the conversation spent from its previous pull request (or its start) until it opened this one. Follow-up fixes after that count toward the next one.")
                .font(.caption2).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
        }
        .sheet(item: Binding(get: { open.map { SessionRef(id: $0) } }, set: { open = $0?.id })) { ref in TraceSheet(session: ref.id) }
    }
}

struct SessionRef: Identifiable { let id: String }

struct OptimizePlaceholder: View {
    var body: some View {
        UsageCard(title: "Coming next: chompyy detect") {
            Text("The rulebook's findings on your real sessions: files re-read for nothing, oversized command output, cache misses, heavy startup context. Each with what it cost, whether that number is measured or estimated, and the turn where it happened.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}
