import SwiftUI
import AppKit

/// The board window: what's left at the top, the cards as a kanban, the selected card on the right.
struct BoardView: View {
    @EnvironmentObject var store: Store
    @Environment(\.openWindow) private var openWindow
    @State private var showFeedback = false
    @State private var showColdStart = false

    var body: some View {
        HStack(spacing: 0) {
            BoardSidebar(showFeedback: $showFeedback, showColdStart: $showColdStart)
            Divider()
            boardBody
        }
        .overlay { CardOverlay() }
        .overlay(alignment: .bottom) { Toast() }
        .dismissOnOutsideClick(isPresented: $showFeedback, width: 680, height: 680) { FeedbackView().environmentObject(store) }
        .dismissOnOutsideClick(isPresented: $showColdStart, width: 720, height: 700) { ColdStartView().environmentObject(store) }
        // The sidebar stays clickable over a pop-up, so opening one closes the others: one panel at a time.
        // (Usage is its own window since #51, so it isn't one of them.)
        .onChange(of: showFeedback) { _, on in if on { only(feedback: true) } }
        .onChange(of: showColdStart) { _, on in if on { only(coldStart: true) } }
        .onChange(of: store.selectedCardID) { _, id in if id != nil { only() } }
        .onAppear {
            // For testing: open a sheet straight away.
            if ProcessInfo.processInfo.environment["CHOMPYY_OPEN_COLDSTART"] != nil { showColdStart = true }
            if ProcessInfo.processInfo.environment["CHOMPYY_OPEN_FEEDBACK"] != nil { showFeedback = true }
            if ProcessInfo.processInfo.environment["CHOMPYY_OPEN_USAGE"] != nil { openWindow(id: "usage") }
        }
        .frame(minWidth: 1240, minHeight: 560)
    }

    private var boardBody: some View {
        VStack(spacing: 0) {
            QuotaHeader()
            Divider()
            if let error = store.error, store.state == nil {
                ContentUnavailableView("Can't reach Chompyy", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ColdStartBanner(open: $showColdStart)
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
    }

    /// Keep the named pop-up open and close the rest, the open card included.
    private func only(feedback: Bool = false, coldStart: Bool = false) {
        if !feedback { showFeedback = false }
        if !coldStart { showColdStart = false }
        if feedback || coldStart { store.selectedCardID = nil }
    }
}

/// The cookie, what's left in the 5-hour window, the week against an even pace, and whether away runs may start.
struct QuotaHeader: View {
    @EnvironmentObject var store: Store

    var body: some View {
        let q = store.state?.quota
        HStack(spacing: 18) {
            CookieView(left: store.fiveHourLeft, size: 54, mood: store.cookieMood)
            VStack(alignment: .leading, spacing: 4) {
                if let five = q?.fiveHour, five.known, let left = five.leftPct {
                    Text("\(Int(left.rounded()))% of this window left")
                        .font(.title3.weight(.semibold))
                    Text("Resets \(relative(five.resetDate)) · about \(Int((five.pacePerHour ?? 0).rounded()))% per hour to use it all")
                        .foregroundStyle(.secondary)
                    if let age = q?.age() {
                        Text("Checked \(age)").font(.caption).foregroundStyle(.tertiary)
                    }
                } else if let five = q?.fiveHour, five.isFresh {
                    Text("100% of a fresh window").font(.title3.weight(.semibold))
                    Text(five.freshHint).foregroundStyle(.secondary)
                    if let age = q?.age() {
                        Text("Checked \(age)").font(.caption).foregroundStyle(.tertiary)
                    }
                } else {
                    Text("Window unknown").font(.title3.weight(.semibold))
                    Text(q?.note ?? "Refresh to read live quota from Anthropic.").foregroundStyle(.secondary)
                    if q?.askKeychain == true { AllowKeychainButton() }
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
    /// Folded to a thin strip; remembered across launches. Only Done can fold.
    @AppStorage private var collapsed: Bool
    @State private var showOlder = false
    /// The Later column's "+" opens the same Park-an-idea box as the toolbar.
    @State private var parking = false
    /// Same box, opened by clicking the empty Later column's "Nothing here".
    @State private var parkingFromPlaceholder = false

    init(column: Column) {
        self.column = column
        _collapsed = AppStorage(wrappedValue: false, "column.\(column.rawValue).collapsed")
    }

    /// Done keeps growing, so it shows the newest few and folds the rest behind a button.
    private var recentLimit: Int? { column == .done ? 5 : nil }

    /// Only Done folds: it is the one column that keeps growing. The others always stay open,
    /// even if an older build saved them as folded.
    private var canFold: Bool { column == .done }
    private var folded: Bool { canFold && collapsed }

    var body: some View {
        let all = store.cards(in: column)
        if folded { strip(all) } else { full(all) }
    }

    private func full(_ all: [Card]) -> some View {
        let sorted = column == .done ? all.sorted { $0.updatedAt > $1.updatedAt } : all
        let shown = showOlder || recentLimit == nil ? sorted : Array(sorted.prefix(recentLimit!))
        let older = sorted.count - shown.count
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: column.symbol)
                Text(column.title).font(.headline)
                countBadge(all)
                Spacer()
                if column == .later {
                    draftAllButton(all)
                    Button { parking = true } label: {
                        Image(systemName: "plus").font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .help("Park an idea for later")
                    .popover(isPresented: $parking, arrowEdge: .bottom) {
                        ParkIdeaPopover(open: $parking).environmentObject(store)
                    }
                }
                if canFold {
                    Button { withAnimation(.easeOut(duration: 0.15)) { collapsed = true } } label: {
                        Image(systemName: "chevron.right.2").font(.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tertiary)
                    .help("Fold \(column.title) into a thin strip")
                }
            }
            Text(column.hint).font(.caption).foregroundStyle(.secondary)
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(shown) { card in
                        CardTile(card: card, selected: store.selectedCardID == card.id)
                            .onTapGesture { store.selectedCardID = card.id }
                    }
                    if older > 0 || (showOlder && recentLimit != nil && sorted.count > recentLimit!) {
                        Button(showOlder ? "Show only the newest \(recentLimit!)" : "Show \(older) older") { showOlder.toggle() }
                            .buttonStyle(.link)
                            .font(.caption)
                            .padding(.top, 2)
                    }
                    if all.isEmpty { emptyPlaceholder }
                }
            }
        }
        .frame(minWidth: 170, maxWidth: .infinity)
        .padding(10)
        .background(Brand.columnBackground, in: RoundedRectangle(cornerRadius: 14))
    }

    /// The dashed "Nothing here" box. In Later only, clicking it opens the Park-an-idea box,
    /// anchored to the placeholder (its own flag, so it never opens a second copy at the "+").
    @ViewBuilder private var emptyPlaceholder: some View {
        let box = RoundedRectangle(cornerRadius: 12)
            .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4]))
            .foregroundStyle(.tertiary)
            .frame(height: 60)
        if column == .later {
            box
                .overlay(
                    VStack(spacing: 2) {
                        Text("Nothing here").font(.caption).foregroundStyle(.tertiary)
                        Text("Click to park an idea").font(.caption2).foregroundStyle(.secondary)
                    }
                )
                .contentShape(RoundedRectangle(cornerRadius: 12))
                .onTapGesture { if column == .later { parkingFromPlaceholder = true } }
                .help("Park an idea for later")
                .popover(isPresented: $parkingFromPlaceholder, arrowEdge: .bottom) {
                    ParkIdeaPopover(open: $parkingFromPlaceholder).environmentObject(store)
                }
        } else {
            box.overlay(Text("Nothing here").font(.caption).foregroundStyle(.tertiary))
        }
    }

    /// Drafts a blueprint for every later card that has none, one at a time (the CLI checks the 5-hour window).
    private func draftAllButton(_ all: [Card]) -> some View {
        let drafting = store.busy.contains("draftAllLater")
        let waiting = all.filter { ($0.blueprint ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
        return Button {
            Task { await store.act("draftAllLater", ["blueprint", "--all-later", "--quiet"]) }
        } label: {
            if drafting { ProgressView().controlSize(.small) } else { Label("Draft all", systemImage: "wand.and.stars").font(.caption) }
        }
        .buttonStyle(.borderless)
        .disabled(drafting || waiting == 0)
        .help(waiting == 0 ? "Every card here has a blueprint" : "Draft blueprints for the \(waiting) card\(waiting == 1 ? "" : "s") here without one, while your 5-hour window is active")
    }

    /// The folded column: icon, count, name written sideways. Click anywhere on it to open it again.
    private func strip(_ all: [Card]) -> some View {
        VStack(spacing: 10) {
            Image(systemName: column.symbol)
            countBadge(all)
            Text(column.title)
                .font(.headline)
                .fixedSize()
                .rotationEffect(.degrees(90))
                .frame(width: 20, height: 90)
            Spacer()
        }
        .padding(.vertical, 12)
        .frame(width: 44)
        .frame(maxHeight: .infinity)
        .background(Brand.columnBackground, in: RoundedRectangle(cornerRadius: 14))
        .contentShape(RoundedRectangle(cornerRadius: 14))
        .onTapGesture { withAnimation(.easeOut(duration: 0.15)) { collapsed = false } }
        .help("Show \(column.title)")
    }

    /// The count; orange when something in here is waiting for you, so a folded column can't hide it.
    private func countBadge(_ all: [Card]) -> some View {
        let waiting = all.contains(where: \.needsYou)
        return Text("\(all.count)")
            .font(.caption.monospacedDigit())
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(waiting ? AnyShapeStyle(Brand.warn.opacity(0.25)) : AnyShapeStyle(.quaternary), in: Capsule())
    }
}

/// The open card, over the board. Click the dimmed board around it, or press Esc, to close it.
struct CardOverlay: View {
    @EnvironmentObject var store: Store

    var body: some View {
        let open = Binding(get: { store.selectedCard != nil }, set: { if !$0 { store.selectedCardID = nil } })
        Color.clear
            .allowsHitTesting(false)
            .dismissOnOutsideClick(isPresented: open, width: 820, height: 760) {
                if let card = store.selectedCard {
                    CardDetail(card: card).environmentObject(store)
                }
            }
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
        if card.isAdvice, let a = card.advice, let r = a.result, r.verdict != "too-early" {
            switch r.verdict {
            case "worked": pill("It worked", "checkmark.seal.fill", Brand.ok)
            case "short": pill("Fell short", "circle.lefthalf.filled", Brand.warn)
            case "worse": pill("Went the wrong way", "arrow.down.right.circle.fill", Brand.warn)
            case "no-change": pill("No change", "minus.circle", .secondary)
            default: pill("Can't tell", "questionmark.circle", .secondary)
            }
        } else if card.isAdvice, let a = card.advice {
            switch a.state ?? "" {
            case "waiting": pill("Applies when you're idle", "hourglass", .secondary)
            case "applied": pill("Applied", "checkmark.seal.fill", Brand.ok)
            case "trying": pill("Trying it", "leaf", Brand.ok)
            case "done": pill("Done by you", "checkmark", Brand.ok)
            case "undone": pill("Undone", "arrow.uturn.backward", .secondary)
            case "failed": pill("Not applied", "exclamationmark.triangle", Brand.warn)
            default: pill(a.lane == "settings" ? "Advice · a settings change" : a.lane == "habit" ? "Advice · a habit" : "Advice · yours to do", "lightbulb", Brand.doughEdge)
            }
        } else if card.needsYou && card.hasQuestions {
            pill("Has a question", "questionmark.bubble.fill", Brand.warn)
        } else if card.needsYou && card.refreshing {
            // Main moved on since it ran; Chompyy is bringing it up to date (refresh.ts), nothing for you to do.
            pill(card.keepWhenRefreshed == true ? "Updating, then keeping…" : "Updating to main…", "arrow.triangle.2.circlepath", Brand.doughEdge)
        } else if card.needsYou && card.refresh?.state == "waiting" && card.clashes {
            pill("Updates after quota resets", "hourglass", .secondary)
        } else if card.needsYou && card.refresh?.state == "failed" && card.clashes {
            pill("Couldn't update to main", "exclamationmark.triangle", Brand.warn)
        } else if card.needsYou && card.clashes {
            pill("Behind main", "arrow.triangle.branch", .secondary)
        } else if card.needsYou && card.measured == "failed" {
            // Chompyy's own measurement (card vs main) leads; the agent's claim only shows when there's none.
            pill("Broke something", "exclamationmark.triangle.fill", Brand.warn)
        } else if card.needsYou && card.measured == "passed" {
            pill("Nothing broke", "checkmark.seal.fill", Brand.ok)
        } else if card.needsYou && card.run?.checks?.result == "failed" {
            pill("Says checks fail", "exclamationmark.triangle", Brand.warn)
        } else if card.needsYou && card.checksNotPassed {
            pill("Not checked", "magnifyingglass", Brand.warn)
        } else if card.needsYou && card.run?.checks?.result == "passed" {
            pill("Says checks pass", "checkmark.circle", Brand.ok)
        } else if card.needsYou {
            pill("Check it", "eyes", Brand.doughEdge)
        } else if let rating = card.rating {
            Text(String(repeating: "★", count: rating.score)).font(.caption).foregroundStyle(Brand.doughEdge)
        } else if let outcome = card.outcome {
            pill(outcome == "kept" ? "Kept" : "Undone", outcome == "kept" ? "tray.and.arrow.down" : "arrow.uturn.backward", .secondary)
        } else if card.column == "later" || card.column == "suggested" {
            if card.source == "history" && card.blueprint == nil && card.blueprintError == nil {
                pill("From your history", "clock.arrow.circlepath", Brand.doughEdge)
            } else if card.blueprint != nil {
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

/// Park an idea without leaving the app: the toolbar's way into `ParkIdeaPopover`.
/// The board's sidebar: every action with its name, in groups, instead of a row of bare icons.
struct BoardSidebar: View {
    @EnvironmentObject var store: Store
    @Environment(\.openWindow) private var openWindow
    @Binding var showFeedback: Bool
    @Binding var showColdStart: Bool
    @State private var parking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            group("Do") {
                item("New idea", "plus", help: "Park an idea for later; Chompyy drafts a blueprint") { parking = true }
                    .popover(isPresented: $parking, arrowEdge: .trailing) { ParkIdeaPopover(open: $parking).environmentObject(store) }
                item("Find savings", "magnifyingglass", busy: store.busy.contains("advise"),
                     help: "Read your Claude Code sessions and setup (chompyy detect) and turn what wastes tokens into cards to approve") {
                    Task { await store.act("advise", ["advise"]) }
                }
                item("Ideas from history", "clock.arrow.circlepath", help: "Read your Claude Code history and suggest tasks and taste lines") { showColdStart = true }
            }
            group("See") {
                item("Usage", "chart.bar.xaxis", help: "Tokens and API value of every Claude Code conversation on this Mac") { openWindow(id: "usage") }
                item("Heard from you", "bubble.left.and.text.bubble.right", badge: store.state?.taste?.waiting.count ?? 0,
                     help: "What Chompyy heard from you, and what it learned") { showFeedback = true }
            }
            group("Away") {
                AwayMenu().menuStyle(.borderlessButton).fixedSize()
            }
            Spacer()
            item("Refresh", "arrow.clockwise", busy: store.busy.contains("refresh"), help: "Refresh the board and read live quota now") {
                Task { await store.refresh(forceQuota: true) }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 16)
        .frame(width: 200, alignment: .topLeading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Brand.columnBackground.opacity(0.6))
    }

    private func group<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.tertiary).padding(.leading, 8)
            content()
        }
    }

    private func item(_ title: String, _ symbol: String, busy: Bool = false, badge: Int = 0, help: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().controlSize(.small).frame(width: 18) } else { Image(systemName: symbol).frame(width: 18) }
                Text(title).lineLimit(1)
                Spacer(minLength: 0)
                if badge > 0 {
                    Text("\(badge)").font(.caption2.weight(.bold)).foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 1).background(Brand.warn, in: Capsule())
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .help(help)
    }
}

/// The "Park an idea for later" box, shared by the toolbar button and the Later column's "+".
/// Opens with the cursor in the idea field. Asks which project folder it belongs to.
struct ParkIdeaPopover: View {
    @EnvironmentObject var store: Store
    @Binding var open: Bool
    // The draft lives in UserDefaults, not @State, so a stray click that closes the popover
    // doesn't throw away what you typed. It is cleared only after "Park it" succeeds.
    @AppStorage("parkDraft") private var idea = ""
    @AppStorage("lastProject") private var project = ""
    @State private var projects: [Project] = []
    @FocusState private var ideaFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Park an idea for later").font(.headline)
            TextField("e.g. add a CONTRIBUTING.md with 3 rules", text: $idea, axis: .vertical)
                .lineLimit(3...14)
                .textFieldStyle(.roundedBorder)
                .focused($ideaFocused)
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
                Button("Cancel") { idea = ""; open = false }
                    .keyboardShortcut(.cancelAction)
                Button("Park it") {
                    let text = idea
                    open = false
                    Task {
                        // Keep the draft if parking failed, or if a new one was typed meanwhile.
                        if await store.act("later", ["later", text], cwd: project), idea == text { idea = "" }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(idea.trimmingCharacters(in: .whitespaces).isEmpty || project.isEmpty)
            }
        }
        .padding(16)
        .frame(width: 380)
        .onAppear { ideaFocused = true }
        .task { await loadProjects() }
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

/// Live quota reads Claude Code's saved login from the Keychain only after you press this (#24). macOS then asks
/// once whether `security` may read the "Claude Code-credentials" item.
struct AllowKeychainButton: View {
    @EnvironmentObject var store: Store
    var body: some View {
        Button("Allow") { Task { await store.act("keychain", ["quota", "--allow-keychain"]) } }
            .disabled(store.busy.contains("keychain"))
            .help("Read Claude Code's saved login from your Keychain, only to ask Anthropic how much quota is left")
    }
}
