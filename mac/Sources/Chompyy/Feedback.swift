import SwiftUI

struct Signal: Decodable, Identifiable {
    let at: String
    let card: String?
    let title: String?
    let kind: String?
    let rating: Int?
    let reason: String?
    let text: String?
    let toFive: [String]?
    let quote: String?
    let workspace: String?
    let accepted: Picks?
    let declined: Picks?
    struct Picks: Decodable { let taste: [String]; let cards: [String] }
    var id: String { at + (card ?? "") + (kind ?? "rating") }
}

/// Everything Chompyy has recorded from you (ratings, blueprint edits, answers): the raw material for taste.
struct FeedbackView: View {
    @Environment(\.closePopup) private var dismiss
    @EnvironmentObject var store: Store
    @State private var signals: [Signal] = []
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("What Chompyy heard from you").font(.title3.weight(.semibold))
                    Text("Saved on this Mac. Chompyy turns what you say and do into rules; a rule only reaches your agents after your yes.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(16)
            Divider()
            let waiting = store.state?.taste?.waiting ?? []
            let learned = store.state?.taste?.learned ?? []
            if loaded && signals.isEmpty && waiting.isEmpty && learned.isEmpty {
                ContentUnavailableView("Nothing yet", systemImage: "bubble.left", description: Text("Rate a card, edit a blueprint or answer a question, and it shows up here."))
            } else {
                List {
                    if !waiting.isEmpty {
                        Section {
                            ForEach(waiting) { TasteRow(item: $0, waiting: true) }
                        } header: {
                            Label("Chompyy noticed", systemImage: "sparkles").font(.headline).foregroundStyle(Brand.chocolate)
                        } footer: {
                            Text("Yes adds it to taste.md, and every agent follows it from then on. Not now waits for more evidence. Never stops Chompyy from asking.")
                                .font(.caption).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if !learned.isEmpty {
                        Section {
                            ForEach(learned) { TasteRow(item: $0, waiting: false) }
                        } header: {
                            Label("What Chompyy learned", systemImage: "checkmark.seal").font(.headline).foregroundStyle(Brand.chocolate)
                        }
                    }
                    Section {
                    ForEach(signals) { s in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: icon(s)).foregroundStyle(Brand.doughEdge).frame(width: 18)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(label(s)).font(.callout.weight(.semibold))
                                if let r = s.rating { Text(String(repeating: "★", count: r)).foregroundStyle(Brand.doughEdge) }
                                Spacer()
                                Text(date(s.at)).font(.caption).foregroundStyle(.secondary)
                            }
                            if let card = s.card {
                                Text("#\(card) \(s.title ?? "")").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            if let a = s.accepted, let d = s.declined {
                                Text("Kept \(a.taste.count + a.cards.count), left out \(d.taste.count + d.cards.count)").font(.caption).foregroundStyle(.secondary)
                                ForEach(a.taste + a.cards, id: \.self) { Text("✓ \($0)").font(.callout) }
                                ForEach(d.taste + d.cards, id: \.self) { Text("✗ \($0)").font(.callout).foregroundStyle(.secondary) }
                            }
                            if let t = s.toFive, !t.isEmpty {
                                Text("To make it a 5: " + t.joined(separator: " · ")).font(.callout).foregroundStyle(Brand.doughEdge)
                            }
                            if s.kind == "chat", let w = s.workspace {
                                Text("In a session in \((w as NSString).lastPathComponent)").font(.caption).foregroundStyle(.secondary)
                            }
                            if let t = s.reason ?? s.text ?? s.quote, !t.isEmpty {
                                Text("“\(t)”").font(.callout)
                            } else if s.kind == nil && s.accepted == nil {
                                Text("No reason given").font(.caption).foregroundStyle(.tertiary)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    }
                    } header: {
                        Label("What you said and did", systemImage: "bubble.left").font(.headline).foregroundStyle(Brand.chocolate)
                    }
                    if let d = store.state?.dream, !d.workspaces.isEmpty { NightlyReadSection(dream: d) }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            if let r = try? await Task.detached(operation: { try CLI.run(["signals", "--json"]) }).value, r.ok {
                signals = (try? JSONDecoder().decode([Signal].self, from: Data(r.out.utf8))) ?? []
            }
            loaded = true
        }
    }

    private func label(_ s: Signal) -> String {
        switch s.kind {
        case "blueprint-edit": "You edited a blueprint"
        case "answer": "You answered its question"
        case "coldstart": "You picked suggestions from your history"
        case "chat": "You said it while working"
        default: "You rated a result"
        }
    }

    private func icon(_ s: Signal) -> String {
        switch s.kind {
        case "blueprint-edit": "pencil"
        case "answer": "bubble.left.fill"
        case "coldstart": "clock.arrow.circlepath"
        case "chat": "text.bubble"
        default: "star.fill"
        }
    }

    private func date(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) else { return String(iso.prefix(16)) }
        return d.formatted(date: .abbreviated, time: .shortened)
    }
}


/// The nightly read: tick which workspaces Chompyy may learn from. Coding folders start ticked; desktop-app chats don't.
struct NightlyReadSection: View {
    @EnvironmentObject var store: Store
    let dream: DreamState

    var body: some View {
        Section {
            ForEach(dream.workspaces) { w in
                Toggle(isOn: Binding(get: { w.ticked }, set: { on in
                    Task { await store.act("dream\(w.path)", ["dream", on ? "tick" : "untick", w.path]) }
                })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(w.name).font(.callout).lineLimit(1).truncationMode(.middle)
                        Text("\(w.kindLabel) · \(w.sessions) session\(w.sessions == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
                .disabled(!dream.on || store.busy.contains("dream\(w.path)"))
            }
        } header: {
            HStack {
                Label("What Chompyy reads at night", systemImage: "moon.zzz").font(.headline).foregroundStyle(Brand.chocolate)
                Spacer()
                Toggle("On", isOn: Binding(get: { dream.on }, set: { on in
                    Task { await store.act("dream-on", ["dream", on ? "on" : "off"]) }
                })).toggleStyle(.switch).controlSize(.mini)
            }
        } footer: {
            Text(footer).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var footer: String {
        var s = "After an away night, Chompyy reads what you and Claude said in the ticked workspaces (no tool output or file contents), on your subscription with \(dream.model.capitalized). Anything it learns comes to you here first."
        if let l = dream.last {
            s += l.error != nil ? " Last read stopped: \(l.error!)" : " Last read: \(l.sessions) session\(l.sessions == 1 ? "" : "s"), ~\(l.readTokens / 1000)k tokens, \(l.signals) thing\(l.signals == 1 ? "" : "s") you said."
        }
        return s
    }
}

/// One rule: what Chompyy noticed, the rule itself, and its receipts in your own words.
/// Waiting rules get yes / not now / never; learned ones get retire.
struct TasteRow: View {
    @EnvironmentObject var store: Store
    let item: TasteItem
    let waiting: Bool
    @State private var showReceipts = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if waiting {
                Text(item.noticed).font(.callout)
                Text("From now on: “\(item.text)”").font(.callout.weight(.semibold))
            } else {
                Text(item.text).font(.callout.weight(.semibold))
            }
            HStack(spacing: 6) {
                Text(item.scope == "Everywhere" ? "Everywhere" : "Only in \(item.scope)")
                if let since = item.since { Text("· since \(String(since.prefix(10)))") }
                Text("·")
                Button(showReceipts ? "Hide receipts" : "Receipts: \(item.evidence)") { withAnimation(.easeOut(duration: 0.15)) { showReceipts.toggle() } }
                    .buttonStyle(.link)
            }
            .font(.caption).foregroundStyle(.secondary)
            if showReceipts {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(item.receipts, id: \.self) { r in
                        HStack(alignment: .top, spacing: 6) {
                            Text(String(r.at.prefix(10))).font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
                            Text(r.said).font(.caption).textSelection(.enabled)
                        }
                    }
                }
                .padding(8)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
            }
            HStack(spacing: 8) {
                if waiting {
                    Button { answer("yes") } label: { Label("Yes", systemImage: "checkmark") }
                        .buttonStyle(.borderedProminent).tint(Brand.ok)
                    Button("Not now") { answer("not-now") }
                    Button("Never", role: .destructive) { answer("never") }
                } else {
                    Button("Retire") { answer("retire") }
                        .help("Stop following it. It's kept with the reason, never silently deleted.")
                }
            }
            .controlSize(.small)
            .disabled(store.busy.contains("taste\(item.id)"))
        }
        .padding(.vertical, 6)
    }

    private func answer(_ how: String) {
        Task { await store.act("taste\(item.id)", ["taste", how, item.id]) }
    }
}
