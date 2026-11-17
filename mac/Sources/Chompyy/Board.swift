import SwiftUI
import AppKit

/// The board window: what's left at the top, the cards as a kanban, the selected card on the right.
struct BoardView: View {
    @EnvironmentObject var store: Store
    @State private var showFeedback = false

    var body: some View {
        VStack(spacing: 0) {
            QuotaHeader()
            Divider()
            if let error = store.error, store.state == nil {
                ContentUnavailableView("Can't reach Chompyy", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Column.allCases) { column in
                        ColumnView(column: column)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Brand.boardBackground)
            }
        }
        .overlay(alignment: .bottom) { Toast() }
        .sheet(isPresented: Binding(get: { store.selectedCard != nil }, set: { if !$0 { store.selectedCardID = nil } })) {
            if let card = store.selectedCard {
                CardDetail(card: card)
                    .environmentObject(store)
                    .frame(minWidth: 680, idealWidth: 760, minHeight: 460, idealHeight: 620)
            }
        }
        .toolbar {
            ToolbarItemGroup {
                ParkIdeaButton()
                Button { showFeedback = true } label: { Label("Feedback", systemImage: "bubble.left.and.text.bubble.right") }
                    .help("Everything Chompyy has recorded from you")
                AwayMenu()
                Button {
                    Task { await store.refresh(forceQuota: true) }
                } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                .help("Refresh the board and read live quota now")
            }
        }
        .sheet(isPresented: $showFeedback) { FeedbackView() }
        .frame(minWidth: 1080, minHeight: 560)
    }
}

/// The cookie, what's left in the 5-hour window, the week against an even pace, and whether away runs may start.
struct QuotaHeader: View {
    @EnvironmentObject var store: Store

    var body: some View {
        let q = store.state?.quota
        HStack(spacing: 18) {
            CookieView(left: store.fiveHourLeft, size: 54)
            VStack(alignment: .leading, spacing: 4) {
                if let five = q?.fiveHour, five.known, let left = five.leftPct {
                    Text("\(Int(left.rounded()))% of this window left")
                        .font(.title3.weight(.semibold))
                    Text("Resets \(relative(five.resetDate)) · about \(Int((five.pacePerHour ?? 0).rounded()))% per hour to use it all")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Window unknown").font(.title3.weight(.semibold))
                    Text(q?.note ?? "Refresh to read live quota from Anthropic.").foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let week = q?.sevenDay, week.known, let used = week.usedPct, let ms = week.msLeft {
                WeekPace(usedPct: used, elapsedPct: max(0, min(100, (1 - ms / (7 * 24 * 3600 * 1000)) * 100)))
                    .frame(width: 220)
            }
            GateBadge()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    private func relative(_ date: Date?) -> String {
        guard let date else { return "soon" }
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "en_US") // UI text is English for now; localization comes later
        f.unitsStyle = .full
        return f.localizedString(for: date, relativeTo: .now)
    }
}

/// The week as a bar, with a tick where an even pace would be.
struct WeekPace: View {
    let usedPct: Double
    let elapsedPct: Double

    var body: some View {
        let ahead = usedPct > elapsedPct
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("This week").font(.caption.weight(.semibold))
                Spacer()
                Text(ahead ? "⇡\(Int((usedPct - elapsedPct).rounded()))% fast" : "⇣\(Int((elapsedPct - usedPct).rounded()))% headroom")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(ahead ? Brand.warn : Brand.ok)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    Capsule().fill(ahead ? Brand.warn : Brand.doughEdge)
                        .frame(width: geo.size.width * usedPct / 100)
                    Rectangle().fill(.primary.opacity(0.6))
                        .frame(width: 2, height: 12)
                        .offset(x: geo.size.width * elapsedPct / 100 - 1)
                }
            }
            .frame(height: 8)
            Text("\(Int(usedPct.rounded()))% used · even pace \(Int(elapsedPct.rounded()))%")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .help("Chompyy only runs away cards while you're behind an even pace for the week, and never past 90%.")
    }
}

struct GateBadge: View {
    @EnvironmentObject var store: Store

    var body: some View {
        if let gate = store.state?.gate {
            Label(gate.ok ? "Ready to run" : "Holding", systemImage: gate.ok ? "checkmark.circle.fill" : "pause.circle.fill")
                .font(.callout.weight(.medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background((gate.ok ? Brand.ok : Brand.warn).opacity(0.14), in: Capsule())
                .foregroundStyle(gate.ok ? Brand.ok : Brand.warn)
                .help((gate.reasons + gate.notes).joined(separator: "\n"))
        }
    }
}

struct ColumnView: View {
    @EnvironmentObject var store: Store
    let column: Column

    var body: some View {
        let cards = store.cards(in: column)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: column.symbol)
                Text(column.title).font(.headline)
                Text("\(cards.count)")
                    .font(.caption.monospacedDigit())
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .background(.quaternary, in: Capsule())
                Spacer()
            }
            Text(column.hint).font(.caption).foregroundStyle(.secondary)
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(cards) { card in
                        CardTile(card: card, selected: store.selectedCardID == card.id)
                            .onTapGesture { store.selectedCardID = card.id }
                    }
                    if cards.isEmpty {
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4]))
                            .foregroundStyle(.tertiary)
                            .frame(height: 60)
                            .overlay(Text("Nothing here").font(.caption).foregroundStyle(.tertiary))
                    }
                }
            }
        }
        .frame(minWidth: 170, maxWidth: .infinity)
        .padding(10)
        .background(Brand.columnBackground, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct CardTile: View {
    let card: Card
    let selected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(card.title)
                .font(.body.weight(.medium))
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 6) {
                Label(card.projectName, systemImage: "folder")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                status.layoutPriority(1)
            }
        }
        .padding(12)
        .background(Brand.cardBackground, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(selected ? Brand.doughEdge : Color.primary.opacity(0.08), lineWidth: selected ? 2 : 1)
        )
        .shadow(color: .black.opacity(0.06), radius: 3, y: 1)
        .contentShape(Rectangle())
    }

    @ViewBuilder private var status: some View {
        if card.needsYou && card.hasQuestions {
            pill("Has a question", "questionmark.bubble.fill", Brand.warn)
        } else if card.needsYou && card.run?.checks?.result == "failed" {
            pill("Checks fail", "exclamationmark.triangle.fill", Brand.warn)
        } else if card.needsYou && card.checksNotPassed {
            pill("Not checked", "magnifyingglass", Brand.warn)
        } else if card.needsYou && card.run?.checks?.result == "passed" {
            pill("Checks pass", "checkmark.circle.fill", Brand.ok)
        } else if card.needsYou {
            pill("Check it", "eyes", Brand.doughEdge)
        } else if let rating = card.rating {
            Text(String(repeating: "★", count: rating.score)).font(.caption).foregroundStyle(Brand.doughEdge)
        } else if let outcome = card.outcome {
            pill(outcome == "kept" ? "Kept" : "Undone", outcome == "kept" ? "tray.and.arrow.down" : "arrow.uturn.backward", .secondary)
        } else if card.column == "later" || card.column == "suggested" {
            if card.blueprint != nil {
                pill("Ready", "doc.text", Brand.ok)
            } else if card.blueprintError != nil {
                pill("Blueprint failed", "exclamationmark.triangle", Brand.warn)
            } else {
                pill("Drafting…", "hourglass", .secondary)
            }
        }
    }

    private func pill(_ text: String, _ symbol: String, _ tint: Color) -> some View {
        Label(text, systemImage: symbol)
            .font(.caption2.weight(.medium))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(tint.opacity(0.13), in: Capsule())
            .foregroundStyle(tint)
    }
}

/// Park an idea without leaving the app. Asks which project folder it belongs to.
struct ParkIdeaButton: View {
    @EnvironmentObject var store: Store
    @State private var open = false
    @State private var idea = ""
    @AppStorage("lastProject") private var project = ""
    @State private var projects: [Project] = []

    var body: some View {
        Button { open = true } label: { Label("Park an idea", systemImage: "plus") }
            .popover(isPresented: $open, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Park an idea for later").font(.headline)
                    TextField("e.g. add a CONTRIBUTING.md with 3 rules", text: $idea, axis: .vertical)
                        .lineLimit(2...5)
                        .textFieldStyle(.roundedBorder)
                    HStack(spacing: 8) {
                        Text("Project").font(.caption.weight(.semibold))
                        Menu {
                            ForEach(projects, id: \.path) { p in
                                Button {
                                    project = p.path
                                } label: {
                                    Text("\(p.name)  ·  \((p.path as NSString).deletingLastPathComponent.replacingOccurrences(of: NSHomeDirectory(), with: "~"))")
                                }
                            }
                            if !projects.isEmpty { Divider() }
                            Button("Other folder…") { choose() }
                        } label: {
                            Label(project.isEmpty ? "Pick a project" : (project as NSString).lastPathComponent, systemImage: "folder")
                        }
                        .fixedSize()
                        Spacer()
                    }
                    if !project.isEmpty {
                        Text((project as NSString).abbreviatingWithTildeInPath)
                            .font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    }
                    Text("Chompyy drafts a blueprint in the background. Approve it when it looks right.")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Spacer()
                        Button("Park it") {
                            let text = idea
                            idea = ""
                            open = false
                            Task { await store.act("later", ["later", text], cwd: project) }
                        }
                        .keyboardShortcut(.defaultAction)
                        .disabled(idea.trimmingCharacters(in: .whitespaces).isEmpty || project.isEmpty)
                    }
                }
                .padding(16)
                .frame(width: 380)
                .task { await loadProjects() }
            }
    }

    /// Recent projects from Claude Code history, past cards and the usual code folders (`chompyy projects`).
    private func loadProjects() async {
        guard let r = try? await Task.detached(operation: { try CLI.run(["projects", "--json"]) }).value, r.ok,
              let list = try? JSONDecoder().decode([Project].self, from: Data(r.out.utf8)) else { return }
        projects = list
        if project.isEmpty || !FileManager.default.fileExists(atPath: project) { project = list.first?.path ?? "" }
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Use this folder"
        if panel.runModal() == .OK, let url = panel.url { project = url.path }
    }
}

struct AwayMenu: View {
    @EnvironmentObject var store: Store

    var body: some View {
        if store.awayProcess != nil {
            Button { store.stopAway() } label: { Label("Stop away run", systemImage: "stop.circle") }
        } else {
            Menu {
                ForEach(["30m", "1h", "2h"], id: \.self) { d in
                    Button("Away for \(d)") { store.startAway(d) }
                }
                Divider()
                Button("Going to sleep (until morning, 8h)") { store.startAway("8h") }
            } label: { Label("I'm away", systemImage: "moon.zzz") }
            .help("Run approved cards one at a time while you're away")
        }
    }
}

struct Toast: View {
    @EnvironmentObject var store: Store

    var body: some View {
        if let toast = store.toast {
            Text(toast)
                .font(.callout)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                .shadow(radius: 6)
                .padding(.bottom, 18)
                .frame(maxWidth: 560)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .onTapGesture { store.toast = nil }
        }
    }
}
