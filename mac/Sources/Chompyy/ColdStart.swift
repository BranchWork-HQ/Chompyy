import SwiftUI

// MARK: Data (mirrors `chompyy history --json` and `chompyy coldstart show --json`, cli/src/coldstart.ts)

struct HistoryInfo: Decodable {
    struct Retention: Decodable { let days: Int; let isDefault: Bool }
    struct Skipped: Decodable { let headless: Int; let temp: Int; let empty: Int }
    struct Digest: Decodable { let sessions: Int; let chars: Int }
    let sessions: Int
    let projects: Int
    let projectNames: [String]
    let from: String?
    let to: String?
    let skipped: Skipped
    let digest: Digest
    let retention: Retention
}

struct ColdStartResult: Decodable {
    struct Scanned: Decodable { let sessions: Int; let included: Int; let projects: Int }
    struct Taste: Decodable, Identifiable { let id: String; let scope: String; let text: String; let sessions: [String]; let status: String }
    struct CardIdea: Decodable, Identifiable { let id: String; let title: String; let idea: String; let project: String; let why: String; let quote: String; let status: String }
    struct Dropped: Decodable { let taste: Int; let cards: Int }
    let scanned: Scanned
    let taste: [Taste]
    let cards: [CardIdea]
    let dropped: Dropped
}

struct ColdStartState: Decodable {
    let status: String   // never | proposed | done
    let waiting: Int
}

// MARK: Banner on the board

/// Shown until the cold start is done: the first thing a new user sees on an empty board.
struct ColdStartBanner: View {
    @EnvironmentObject var store: Store
    @Binding var open: Bool

    var body: some View {
        if let cs = store.state?.coldStart, cs.status != "done" {
            HStack(spacing: 14) {
                CookieView(left: 1, size: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(cs.status == "never" ? "Let Chompyy get to know you" : "Your suggestions are ready")
                        .font(.headline)
                    Text(cs.status == "never"
                         ? "It reads your Claude Code history on this Mac, then suggests first tasks and how you like work done. You pick what to keep."
                         : "\(cs.waiting) suggestion\(cs.waiting == 1 ? "" : "s") from your history are waiting for you to pick.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button(cs.status == "never" ? "Get started" : "Review them") { open = true }
                    .buttonStyle(.borderedProminent)
                    .tint(Brand.doughEdge)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Brand.dough.opacity(0.16), in: RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal, 14).padding(.top, 12)
        }
    }
}

// MARK: The sheet: notice → reading → pick

struct ColdStartView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss

    enum Phase { case notice, reading, pick, failed(String) }
    @State private var phase: Phase = .notice
    @State private var info: HistoryInfo?
    @State private var result: ColdStartResult?
    @State private var pickedTaste: Set<String> = []
    @State private var pickedCards: Set<String> = []
    @State private var digest: String?
    @State private var keptHistory = false

    private var phaseKey: String {
        switch phase {
        case .notice: "notice"
        case .reading: "reading"
        case .pick: "pick"
        case .failed: "failed"
        }
    }

    private var windowActive: Bool { store.state?.quota.fiveHour.known ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Get to know you").font(.title3.weight(.semibold))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
            }
            .padding(16)
            Divider()
            ScrollViewReader { proxy in
            ScrollView {
                Color.clear.frame(height: 0).id("top")
                Group {
                    switch phase {
                    case .notice: notice
                    case .reading: reading
                    case .pick: pick
                    case .failed(let message): failed(message)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: phaseKey) { proxy.scrollTo("top", anchor: .top) }
            .onAppear { DispatchQueue.main.async { proxy.scrollTo("top", anchor: .top) } }
            }
        }
        .frame(minWidth: 640, idealWidth: 700, minHeight: 560, idealHeight: 680)
        .sheet(item: Binding(get: { digest.map { DiffText(text: $0) } }, set: { digest = $0?.text })) { d in
            DigestSheet(text: d.text)
        }
        .task { await load() }
    }

    // MARK: 1. The notice: picture first, then what it reads and keeps

    private var notice: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 8) {
                step("clock.arrow.circlepath", "Your Claude Code history", info.map { "\($0.sessions) sessions · \($0.projects) projects" } ?? "Looking…")
                arrow
                step("lock.laptopcomputer", "Read on this Mac", "secrets and emails removed")
                arrow
                step("text.bubble", "One summary to Claude", info.map { "≈\($0.digest.chars / 4 / 1000)k tokens, once" } ?? "")
                arrow
                step("checklist", "You choose", "nothing added until you tick it")
            }

            if let info, info.sessions == 0 {
                Label("No Claude Code sessions on this Mac yet. Use Claude Code for a while, then come back.", systemImage: "info.circle")
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 10) {
                fact("eye", "What it reads", "What you typed in Claude Code and the last thing Claude said in each session, from ~/.claude/projects\(info.map { ", \(dateRange($0))" } ?? ""). Headless runs (Chompyy's own, scripts, benchmarks) are skipped.")
                fact("eye.slash", "What it leaves out", "Tool output and file contents. Pasted code, logs and error traces become [pasted text]. Keys, tokens, passwords, email addresses and phone numbers are removed. Pasted plain text looks like typing, so each message is cut to 300 characters.")
                fact("paperplane", "Where it goes", "One summary goes to Claude through your own Claude Code, the same service that saw those sessions. Nothing goes to Chompyy or anyone else.")
                fact("tray.full", "What it keeps", "Only what you tick: lines in taste.md and cards in Suggested. Change your mind any time: edit taste.md, drop a card, or `chompyy coldstart forget`.")
            }

            Button { Task { await loadDigest() } } label: { Label("See exactly what's sent", systemImage: "doc.text.magnifyingglass") }
                .buttonStyle(.link)

            if let r = info?.retention, r.isDefault, !keptHistory {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "calendar.badge.clock").foregroundStyle(Brand.warn)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Claude Code deletes sessions after 30 days by default, so there's less to learn from over time.")
                            .font(.callout)
                        Button("Keep a year of history") {
                            Task {
                                await store.act("keep-history", ["keep-history", "365"])
                                keptHistory = true
                            }
                        }
                        .controlSize(.small)
                    }
                }
                .padding(12)
                .background(Brand.warn.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }

            if !windowActive {
                Label("No 5-hour window is active right now. Reading your history is one model call, so it would start one.", systemImage: "hourglass")
                    .font(.callout).foregroundStyle(.secondary)
            }

            HStack {
                Button("Not now") { dismiss() }
                Spacer()
                Button(windowActive ? "Read my history" : "Read anyway") { Task { await run() } }
                    .buttonStyle(.borderedProminent)
                    .tint(Brand.doughEdge)
                    .keyboardShortcut(.defaultAction)
                    .disabled((info?.sessions ?? 0) == 0)
            }
        }
    }

    // MARK: 2. Reading

    private var reading: some View {
        VStack(spacing: 14) {
            ProgressView().controlSize(.large)
            Text("Reading \(info?.digest.sessions ?? 0) sessions…").font(.headline)
            Text("Usually 10 to 60 seconds.").foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 300)
    }

    // MARK: 3. Pick what to keep

    private var pick: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let r = result {
                Text("Read \(r.scanned.included) sessions in \(r.scanned.projects) projects. Tick what's right; the rest is left out.")
                    .foregroundStyle(.secondary)

                section("How you like work done", "Each one showed up in 3 or more separate sessions. Goes into taste.md.")
                if pendingTaste.isEmpty {
                    Text("Nothing showed up often enough yet. It'll learn from your ratings instead.").font(.callout).foregroundStyle(.tertiary)
                }
                ForEach(pendingTaste) { t in
                    Toggle(isOn: binding(t.id, in: $pickedTaste)) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(t.text)
                            Text("\(t.scope) · seen in \(t.sessions.count) sessions").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .toggleStyle(.checkbox)
                }

                section("Tasks you might want done", "From things you said you'd do later, or offers you never took up. Goes into Suggested.")
                if pendingCards.isEmpty {
                    Text("No grounded ideas found. Park your own with + Park an idea.").font(.callout).foregroundStyle(.tertiary)
                }
                ForEach(pendingCards) { c in
                    Toggle(isOn: binding(c.id, in: $pickedCards)) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Text(c.title).font(.body.weight(.medium))
                                Label((c.project as NSString).lastPathComponent, systemImage: "folder").font(.caption).foregroundStyle(.secondary)
                            }
                            Text(c.why).font(.callout).foregroundStyle(.secondary)
                            Text("You said: “\(c.quote)”").font(.caption).foregroundStyle(Brand.doughEdge)
                        }
                    }
                    .toggleStyle(.checkbox)
                }

                if r.dropped.taste + r.dropped.cards > 0 {
                    Text("Left out \(r.dropped.taste + r.dropped.cards) more whose evidence didn't check out.")
                        .font(.caption).foregroundStyle(.tertiary)
                }

                HStack {
                    Button("Not now") { dismiss() }
                    Spacer()
                    Button(addLabel) { Task { await accept() } }
                        .buttonStyle(.borderedProminent)
                        .tint(Brand.doughEdge)
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
    }

    private func failed(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Couldn't read your history", systemImage: "exclamationmark.triangle").font(.headline).foregroundStyle(Brand.warn)
            Text(message).textSelection(.enabled)
            HStack {
                Button("Close") { dismiss() }
                Spacer()
                Button("Try again") { phase = .notice }
            }
        }
    }

    // MARK: Pieces

    private var pendingTaste: [ColdStartResult.Taste] { result?.taste.filter { $0.status == "proposed" } ?? [] }
    private var pendingCards: [ColdStartResult.CardIdea] { result?.cards.filter { $0.status == "proposed" } ?? [] }

    private var addLabel: String {
        let n = pickedTaste.count + pickedCards.count
        return n == 0 ? "Keep none" : "Add \(n) selected"
    }

    private func step(_ symbol: String, _ title: String, _ detail: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).font(.title2).foregroundStyle(Brand.doughEdge)
            Text(title).font(.caption.weight(.semibold)).multilineTextAlignment(.center)
            Text(detail).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(10)
        .background(Brand.cardBackground, in: RoundedRectangle(cornerRadius: 10))
    }

    private var arrow: some View { Image(systemName: "arrow.right").foregroundStyle(.tertiary) }

    private func fact(_ symbol: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(Brand.doughEdge).frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.callout.weight(.semibold))
                Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func section(_ title: String, _ hint: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.headline)
            Text(hint).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.top, 4)
    }

    private func binding(_ id: String, in set: Binding<Set<String>>) -> Binding<Bool> {
        Binding(get: { set.wrappedValue.contains(id) }, set: { on in
            if on { set.wrappedValue.insert(id) } else { set.wrappedValue.remove(id) }
        })
    }

    private func dateRange(_ i: HistoryInfo) -> String {
        guard let f = i.from, let t = i.to else { return "" }
        return "\(f.prefix(10)) to \(t.prefix(10))"
    }

    // MARK: Actions

    private func load() async {
        // Proposals already waiting? Go straight to picking.
        if store.state?.coldStart?.status == "proposed",
           let r = try? await Task.detached(operation: { try CLI.run(["coldstart", "show", "--json"]) }).value, r.ok,
           let cs = try? JSONDecoder().decode(ColdStartResult.self, from: Data(r.out.utf8)) {
            show(cs)
        }
        if let r = try? await Task.detached(operation: { try CLI.run(["history", "--json"]) }).value, r.ok {
            info = try? JSONDecoder().decode(HistoryInfo.self, from: Data(r.out.utf8))
        }
    }

    private func loadDigest() async {
        if let r = try? await Task.detached(operation: { try CLI.run(["history", "--digest"]) }).value, r.ok { digest = r.out }
    }

    private func run() async {
        phase = .reading
        let args = windowActive ? ["coldstart", "--json"] : ["coldstart", "--json", "--force"]
        do {
            let r = try await Task.detached { try CLI.run(args) }.value
            guard r.ok else { phase = .failed(r.message); return }
            show(try JSONDecoder().decode(ColdStartResult.self, from: Data(r.out.utf8)))
            await store.refresh()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func show(_ cs: ColdStartResult) {
        result = cs
        pickedTaste = Set(cs.taste.filter { $0.status == "proposed" }.map(\.id))
        pickedCards = Set(cs.cards.filter { $0.status == "proposed" }.map(\.id))
        phase = .pick
    }

    private func accept() async {
        await store.act("coldstart", ["coldstart", "accept", "--taste", pickedTaste.sorted().joined(separator: ","), "--cards", pickedCards.sorted().joined(separator: ",")])
        dismiss()
    }
}

/// The exact digest that would be sent, so nothing about the cold start is hidden.
struct DigestSheet: View {
    let text: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Exactly what would be sent").font(.headline)
                    Text("\(text.count) characters, newest session first. Built on this Mac just now.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(14)
            Divider()
            ScrollView {
                Text(text)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            }
        }
        .frame(minWidth: 680, minHeight: 520)
    }
}
