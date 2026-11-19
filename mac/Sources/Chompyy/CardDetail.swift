import AppKit
import SwiftUI

/// One card: the picture first (blueprint map), then the details, then the one thing to do.
struct CardDetail: View {
    @State private var allowed: Set<String> = []
    @EnvironmentObject var store: Store
    let card: Card
    @State private var editing = false
    @State private var draft = ""
    @State private var answer = ""
    @State private var why = ""
    @State private var diff: String?
    @State private var confirmUndo = false

    var column: Column { Column(rawValue: card.column) ?? .later }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    // Picture first: what this card will do, before any text.
                    if card.blueprint != nil && !editing { picture }
                    if card.needsYou { reviewSection }
                    blueprintSection(proxy)
                    WhereItWorks(card: card)
                    if card.run != nil && !card.needsYou { runFacts }
                    if card.column == "review" || card.column == "done" { ratingSection }
                }
                .padding(20)
            }
        }
        .sheet(item: Binding(get: { diff.map { DiffText(text: $0) } }, set: { diff = $0?.text })) { d in
            DiffSheet(text: d.text)
        }
        .id(card.id)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Label(column.title, systemImage: column.symbol)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Brand.dough.opacity(0.2), in: Capsule())
                Text("#\(card.id)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                Button { store.selectedCardID = nil } label: { Image(systemName: "xmark") }
                    .buttonStyle(.borderless)
            }
            Text(card.title).font(.title2.weight(.semibold)).textSelection(.enabled)
            Label((card.cwd as NSString).abbreviatingWithTildeInPath, systemImage: "folder")
                .font(.caption).foregroundStyle(.secondary)
            if card.idea != card.title {
                Text(card.idea).foregroundStyle(.secondary).textSelection(.enabled)
            }
            if let why = card.why {
                Label("Suggested because: \(why)", systemImage: "clock.arrow.circlepath")
                    .font(.callout).foregroundStyle(Brand.doughEdge)
            }
            if let plan = card.permissionPlan, !plan.isEmpty, column == .later || column == .suggested {
                permissionPlan(plan)
            }
            actions
        }
    }

    /// What the run may need beyond the box. Nothing is allowed unless you tick it; allowed commands still run
    /// inside the box. An away run can't ask at 3 AM, so it asks here.
    private func permissionPlan(_ plan: [PlannedPermission]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("This run may need", systemImage: "lock.open").font(.headline)
            ForEach(plan) { item in
                Toggle(isOn: Binding(
                    get: { allowed.contains(item.id) },
                    set: { on in if on { allowed.insert(item.id) } else { allowed.remove(item.id) } }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.label)
                        Text(item.why).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
            }
            Text("Nothing is allowed unless you tick it. Allowed commands still run inside the sandbox.")
                .font(.caption).foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Brand.columnBackground))
    }

    @ViewBuilder private var actions: some View {
        HStack(spacing: 8) {
            switch column {
            case .later, .suggested:
                Button {
                    let allow = (card.permissionPlan ?? []).filter { allowed.contains($0.id) }.flatMap { ["--allow", $0.id] }
                    Task { await store.act("approve\(card.id)", ["approve", card.id] + allow) }
                } label: { Label(allowed.isEmpty ? "Approve" : "Approve with \(allowed.count) allowed", systemImage: "checkmark") }
                .buttonStyle(.borderedProminent).tint(Brand.ok)
                .disabled(card.blueprint == nil)
                .help(card.blueprint == nil ? "Needs a blueprint first" : "Run it on your next away run")
                dropButton
            case .approved:
                Text(card.permissions?.isEmpty == false ? "Runs on your next away run, with \(card.permissions!.joined(separator: ", ")) allowed." : "Runs on your next away run.")
                    .font(.callout).foregroundStyle(.secondary)
                Spacer()
                dropButton
            case .running:
                ProgressView().controlSize(.small)
                Text("Working on it…").font(.callout).foregroundStyle(.secondary)
            case .review, .done:
                EmptyView()
            }
            if busy { ProgressView().controlSize(.small) }
        }
        .padding(.top, 4)
    }

    private var busy: Bool { store.busy.contains { $0.hasSuffix(card.id) } }

    private var dropButton: some View {
        Button(role: .destructive) {
            Task { await store.act("drop\(card.id)", ["drop", card.id]) ; store.selectedCardID = nil }
        } label: { Label("Drop", systemImage: "trash") }
        .help("Remove it from the board (kept in the archive)")
    }

    // MARK: Review (the card needs you)

    /// Main moved on since the card ran (other cards were kept): what Chompyy is doing about it (refresh.ts).
    @ViewBuilder private var refreshNote: some View {
        let files = (card.clashFiles ?? []).joined(separator: ", ")
        if card.refreshing {
            Label("Other cards were kept since this ran. Chompyy is bringing it up to date\(card.keepWhenRefreshed == true ? ", then keeping it if nothing broke" : "")…", systemImage: "arrow.triangle.2.circlepath")
                .font(.callout).foregroundStyle(Brand.doughEdge)
        } else if card.clashes, let r = card.refresh, r.state == "waiting" || r.state == "failed" {
            Label("It clashes with main in \(files). \(r.state == "waiting" ? "Chompyy updates it when quota is back" : "Chompyy couldn't update it"): \(r.why ?? "")", systemImage: r.state == "failed" ? "exclamationmark.triangle" : "hourglass")
                .font(.callout).foregroundStyle(r.state == "failed" ? Brand.warn : .secondary)
        } else if card.clashes {
            Label("Other cards were kept since this ran, and it now clashes with main in \(files). Press Update & keep: Chompyy fits the two together and checks it again.", systemImage: "arrow.triangle.branch")
                .font(.callout).foregroundStyle(.secondary)
        } else if let r = card.refresh, r.state == "done", r.by != nil {
            Label("Up to date with main: \(r.why ?? "")", systemImage: "checkmark.circle")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var reviewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(card.hasQuestions ? "It has a question for you" : "It's done. Check it, then keep or undo",
                  systemImage: card.hasQuestions ? "questionmark.bubble.fill" : "eyes")
                .font(.headline)
                .foregroundStyle(card.hasQuestions ? Brand.warn : Brand.chocolate)

            refreshNote

            // Chompyy's measurement leads; the agent's own words are a claim, shown under it.
            if let v = card.run?.verified, v.result != "not run" {
                Label {
                    Text(v.result == "passed" ? "Chompyy checked it: nothing broke" : "Chompyy checked it: this change broke something")
                        .font(.callout.weight(.semibold))
                    + Text(v.why.isEmpty ? "" : ": \(v.why)").font(.callout)
                } icon: {
                    Image(systemName: v.result == "passed" ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                }
                .foregroundStyle(v.result == "passed" ? Brand.ok : Brand.warn)
                if let checks = card.run?.checks, !checks.why.isEmpty {
                    Text("It said: \(checks.why)").font(.caption).foregroundStyle(.secondary)
                }
            } else if let checks = card.run?.checks {
                Label {
                    Text(checks.result == "passed" ? "It says its checks pass" : checks.result == "failed" ? "It says its checks fail" : "It couldn't check its work")
                        .font(.callout.weight(.semibold))
                    + Text(checks.why.isEmpty ? "" : ": \(checks.why)").font(.callout)
                    + Text(card.run?.verified.map { " (Chompyy couldn't check it: \($0.why))" } ?? " (not checked by Chompyy)").font(.caption)
                } icon: {
                    Image(systemName: checks.result == "passed" ? "checkmark.circle" : "exclamationmark.triangle")
                }
                .foregroundStyle(checks.result == "passed" ? Brand.ok : Brand.warn)
            }

            if let t = card.run?.tokens {
                Label(t.line, systemImage: "number")
                    .font(.caption).foregroundStyle(.secondary)
                    .help(t.breakdown + ". Subscription plans don't pay API prices; this is the value of the work.")
            }

            if let run = card.run, !run.summary.isEmpty {
                Text(md(run.summary)).textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
            }

            if card.hasQuestions, let q = card.questionsText {
                BlueprintBody(doc: BlueprintDoc(q))
                    .padding(12)
                    .background(Brand.warn.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                TextField("Your answer. The card goes back to approved and continues on the next away run.", text: $answer, axis: .vertical)
                    .lineLimit(3...8)
                    .textFieldStyle(.roundedBorder)
                Button {
                    let text = answer
                    answer = ""
                    Task { await store.act("answer\(card.id)", ["answer", card.id], stdin: text) }
                } label: { Label("Send answer", systemImage: "paperplane.fill") }
                .buttonStyle(.borderedProminent).tint(Brand.chocolate)
                .disabled(answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            filesList

            HStack(spacing: 8) {
                Button {
                    Task {
                        let id = card.id
                        let r = try? await Task.detached { try CLI.run(["diff", id]) }.value
                        diff = r?.out ?? "Couldn't load the change."
                    }
                } label: { Label("See the change", systemImage: "doc.text.magnifyingglass") }
                Spacer()
                Button {
                    Task { await store.finish("keep\(card.id)", ["keep", card.id], card: card.id) }
                } label: { Label(card.clashes ? "Update & keep" : "Keep", systemImage: "tray.and.arrow.down.fill") }
                .buttonStyle(.borderedProminent).tint(Brand.ok)
                .disabled(card.refreshing || card.keepWhenRefreshed == true)
                .help(card.clashes ? "Other cards were kept since this ran. Chompyy brings it up to date, checks it again, and keeps it if nothing broke." : "Merge it into \(card.folderBranch ?? "your branch")")
                Button {
                    Task { await store.finish("redo\(card.id)", ["redo", card.id], card: card.id) }
                } label: { Label("Run again", systemImage: "arrow.clockwise") }
                .help("Throw this attempt away and run it again from your latest code (answers are kept)")
                Button(role: .destructive) { confirmUndo = true } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                    .confirmationDialog("Throw this run away?", isPresented: $confirmUndo) {
                        Button("Undo the run", role: .destructive) {
                            Task { await store.finish("undo\(card.id)", ["undo", card.id], card: card.id) }
                        }
                    } message: { Text("Removes its branch and folder. Your own branches are never touched.") }
            }
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Brand.doughEdge.opacity(0.4)))
    }

    @ViewBuilder private var filesList: some View {
        if !card.files.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Changed \(card.files.count) file\(card.files.count == 1 ? "" : "s")").font(.caption.weight(.semibold))
                ForEach(card.files.prefix(8), id: \.self) { f in
                    Label(f, systemImage: "doc").font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                if card.files.count > 8 { Text("+\(card.files.count - 8) more").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    // MARK: Blueprint (picture first)

    /// The picture of what this card will do (diagram-design), with its state and a redraw.
    @ViewBuilder private var picture: some View {
        let drawing = card.drawingAt != nil || store.busy.contains("picture\(card.id)")
        if let pic = card.picture {
            PictureView(picture: pic)
        }
        HStack(spacing: 10) {
            if drawing {
                ProgressView().controlSize(.small)
                Text(card.picture == nil ? "Drawing the picture…" : "Redrawing the picture…").font(.caption).foregroundStyle(.secondary)
            } else if let err = card.pictureError {
                Label("Couldn't draw the picture: \(err)", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(Brand.warn).lineLimit(2)
            } else if card.pictureStale == true {
                Label("The blueprint changed since this was drawn", systemImage: "clock.arrow.circlepath").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if !drawing && card.column != "running" {
                Button {
                    Task { await store.act("picture\(card.id)", ["picture", card.id, "--quiet"]) }
                } label: { Label(card.picture == nil ? "Draw the picture" : "Redraw picture", systemImage: "scribble.variable") }
                .buttonStyle(.borderless)
                .font(.caption)
                .help("Draw a diagram of what this card will do (diagram-design)")
            }
            if let pic = card.picture {
                Button { NSWorkspace.shared.open(URL(fileURLWithPath: pic.path)) } label: { Label("Open", systemImage: "arrow.up.forward.square") }
                    .buttonStyle(.borderless).font(.caption)
                    .help("Open the picture in your browser")
            }
        }
    }

    @ViewBuilder private func blueprintSection(_ proxy: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Blueprint").font(.headline)
                Spacer()
                if card.column != "running" && card.blueprint != nil && !editing {
                    Button { draft = card.blueprint ?? ""; editing = true } label: { Label("Edit", systemImage: "pencil") }
                        .buttonStyle(.borderless)
                        .help("Your edits are the strongest signal of your taste")
                }
                if card.column == "later" || card.column == "suggested" {
                    Button {
                        Task { await store.act("blueprint\(card.id)", ["blueprint", card.id, "--quiet"]) }
                    } label: { Label(card.blueprint == nil ? "Draft it" : "Redraw", systemImage: "wand.and.stars") }
                    .buttonStyle(.borderless)
                    .help("Ask Chompyy to draft the blueprint again")
                }
            }
            if editing {
                TextEditor(text: $draft)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 260)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
                HStack {
                    Spacer()
                    Button("Cancel") { editing = false }
                    Button("Save") {
                        let text = draft
                        editing = false
                        Task { await store.act("edit\(card.id)", ["edit-blueprint", card.id], stdin: text) }
                    }
                    .buttonStyle(.borderedProminent).tint(Brand.chocolate)
                }
            } else if let bp = card.blueprint {
                let doc = BlueprintDoc(bp)
                if card.picture == nil {
                    // Until the picture is drawn, the blueprint at a glance stands in for it.
                    BlueprintMap(doc: doc) { target in withAnimation { proxy.scrollTo(target, anchor: .top) } }
                }
                DisclosureGroup("Details") {
                    VStack(alignment: .leading, spacing: 12) {
                        if card.picture != nil {
                            BlueprintMap(doc: doc) { target in withAnimation { proxy.scrollTo(target, anchor: .top) } }
                        }
                        BlueprintBody(doc: doc)
                    }
                    .padding(.top, 8)
                }
            } else if let err = card.blueprintError {
                Label("Drafting failed: \(err)", systemImage: "exclamationmark.triangle").foregroundStyle(Brand.warn)
            } else {
                HStack { ProgressView().controlSize(.small); Text("Drafting the blueprint…").foregroundStyle(.secondary) }
            }
            if let answers = card.answers, !answers.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your answers").font(.caption.weight(.semibold))
                    ForEach(answers, id: \.at) { a in Text(a.text).font(.callout).foregroundStyle(.secondary) }
                }
            }
        }
    }

    // MARK: After the run

    private var runFacts: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Last run").font(.headline)
            if let run = card.run {
                Text("\(run.status) · took \(Int(run.durationMs / 60000)) min").foregroundStyle(.secondary)
                if !run.summary.isEmpty { Text(md(run.summary)).font(.callout).textSelection(.enabled) }
            }
            filesList
        }
    }

    @State private var stars = 0
    @State private var options: [String] = []
    @State private var picked: Set<String> = []
    @State private var loadingOptions = false

    private var ratingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("How close was it to the blueprint?").font(.headline)
            HStack(spacing: 4) {
                ForEach(1...5, id: \.self) { n in
                    Button { stars = n } label: {
                        Image(systemName: n <= shownStars ? "star.fill" : "star")
                            .font(.title3)
                            .foregroundStyle(Brand.doughEdge)
                    }
                    .buttonStyle(.plain)
                }
            }
            if shownStars > 0 && shownStars < 5 {
                Text("What would have made it a 5?").font(.subheadline.weight(.semibold))
                if loadingOptions {
                    HStack { ProgressView().controlSize(.small); Text("Thinking of likely options…").font(.caption).foregroundStyle(.secondary) }
                }
                FlowChips(options: options, picked: $picked)
                TextField("Something else…", text: $why, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
            } else if shownStars == 5 {
                TextField("What made it great? (optional, so Chompyy keeps doing it)", text: $why, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
            }
            HStack {
                Button {
                    let reason = why.trimmingCharacters(in: .whitespacesAndNewlines)
                    let score = shownStars
                    let toFive = score < 5 ? options.filter { picked.contains($0) } : []
                    var args = ["rate", card.id, String(score)] + (reason.isEmpty ? [] : [reason])
                    for t in toFive { args += ["--to-five", t] }
                    Task { await store.act("rate\(card.id)", args) }
                } label: { Label(card.rating == nil ? "Save rating" : "Update rating", systemImage: "checkmark") }
                .buttonStyle(.borderedProminent).tint(Brand.chocolate)
                .disabled(shownStars == 0)
                Spacer()
                if let r = card.rating {
                    Label(recordedText(r), systemImage: "checkmark.seal.fill")
                        .font(.caption).foregroundStyle(Brand.ok).lineLimit(2)
                }
            }
        }
        .onAppear {
            stars = card.rating?.score ?? 0
            why = card.rating?.reason ?? ""
            picked = Set(card.rating?.toFive ?? [])
        }
        .task(id: shownStars < 5 && shownStars > 0) { await loadOptions() }
    }

    private func recordedText(_ r: Rating) -> String {
        var parts = ["Recorded: \(r.score)★"]
        if let t = r.toFive, !t.isEmpty { parts.append("to make it a 5: " + t.joined(separator: "; ")) }
        if let reason = r.reason { parts.append("“\(reason)”") }
        return parts.joined(separator: " · ")
    }

    private func loadOptions() async {
        guard shownStars > 0 && shownStars < 5, options.isEmpty, !loadingOptions else { return }
        loadingOptions = true
        defer { loadingOptions = false }
        let id = card.id
        if let r = try? await Task.detached(operation: { try CLI.run(["five-star", id]) }).value, r.ok,
           let list = try? JSONDecoder().decode([String].self, from: Data(r.out.utf8)) {
            // Keep earlier picks visible even if they aren't in the new list.
            options = list + (card.rating?.toFive ?? []).filter { !list.contains($0) }
        }
    }

    private var shownStars: Int { stars > 0 ? stars : (card.rating?.score ?? 0) }
}

/// Tap-to-pick options, wrapping onto new lines.
struct FlowChips: View {
    let options: [String]
    @Binding var picked: Set<String>

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(options, id: \.self) { o in
                let on = picked.contains(o)
                Button {
                    if on { picked.remove(o) } else { picked.insert(o) }
                } label: {
                    Label(o, systemImage: on ? "checkmark.circle.fill" : "circle")
                        .font(.callout)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background((on ? Brand.doughEdge : Color.secondary).opacity(on ? 0.22 : 0.10), in: Capsule())
                        .foregroundStyle(on ? Brand.chocolate : .primary)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 600
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > width, x > 0 { x = 0; y += row + spacing; row = 0 }
            x += s.width + spacing
            row = max(row, s.height)
        }
        return CGSize(width: width, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += row + spacing; row = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            row = max(row, s.height)
        }
    }
}

struct DiffText: Identifiable { let text: String; var id: Int { text.hashValue } }

struct DiffSheet: View {
    let text: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("The change").font(.headline)
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(12)
            Divider()
            ScrollView([.vertical, .horizontal]) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(text.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                        Text(line.isEmpty ? " " : line)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(color(line))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(bg(line))
                    }
                }
                .textSelection(.enabled)
                .padding(12)
            }
        }
        .frame(minWidth: 720, minHeight: 480)
    }

    private func color(_ l: String) -> Color {
        if l.hasPrefix("+++") || l.hasPrefix("---") { return .secondary }
        if l.hasPrefix("+") { return Brand.ok }
        if l.hasPrefix("-") { return .red }
        if l.hasPrefix("@@") { return Brand.doughEdge }
        return .primary
    }

    private func bg(_ l: String) -> Color {
        if l.hasPrefix("+") && !l.hasPrefix("+++") { return Brand.ok.opacity(0.08) }
        if l.hasPrefix("-") && !l.hasPrefix("---") { return Color.red.opacity(0.07) }
        return .clear
    }
}

/// Where the card works, so you can see your own folder is safe and look at the copy any time.
struct WhereItWorks: View {
    let card: Card

    private var copyPath: String { card.run?.workdir ?? CLI.home.appendingPathComponent("worktrees/\(card.id)").path }
    private var branch: String { card.run?.branch ?? "chompyy/\(card.id)" }
    private var hasCopy: Bool { FileManager.default.fileExists(atPath: copyPath) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Where it works", systemImage: "shield.lefthalf.filled").font(.headline)
            Text(explanation).font(.callout).foregroundStyle(.secondary)
            HStack(spacing: 6) {
                pathRow("Your folder", (card.cwd as NSString).abbreviatingWithTildeInPath, card.folderBranch.map { "Keep lands it on \($0); this folder is only changed if it has \($0) open" } ?? "untouched until you press Keep")
            }
            HStack(spacing: 6) {
                pathRow("Its copy", (copyPath as NSString).abbreviatingWithTildeInPath, "branch \(branch)")
            }
            HStack {
                Button { reveal(card.cwd) } label: { Label("Show your folder", systemImage: "folder") }
                if hasCopy {
                    Button { reveal(copyPath) } label: { Label("Show its copy", systemImage: "folder.badge.gearshape") }
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.ok.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private var explanation: String {
        switch card.column {
        case "later", "suggested", "approved":
            return "When it runs, Chompyy makes a separate copy of your repo on its own branch and works only there, in a sandbox with no internet. Nothing changes in your folder."
        case "running":
            return "Working in its own copy right now. Open the copy to watch files appear; your folder isn't touched."
        default:
            return card.outcome == "kept" ? "Kept: its branch was merged into \(card.folderBranch ?? "your branch")." : "Its work is in the copy on its own branch, started from the latest \(card.folderBranch ?? "main"). Keep lands it on \(card.folderBranch ?? "your branch"); Undo deletes the copy."
        }
    }

    private func pathRow(_ label: String, _ path: String, _ note: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(label).font(.caption.weight(.semibold)).frame(width: 74, alignment: .leading)
            Text(path).font(.caption.monospaced()).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
            Text("· \(note)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    private func reveal(_ path: String) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }
}
