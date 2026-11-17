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
    let accepted: Picks?
    let declined: Picks?
    struct Picks: Decodable { let taste: [String]; let cards: [String] }
    var id: String { at + (card ?? "") + (kind ?? "rating") }
}

/// Everything Chompyy has recorded from you (ratings, blueprint edits, answers): the raw material for taste.
struct FeedbackView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var signals: [Signal] = []
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("What Chompyy heard from you").font(.title3.weight(.semibold))
                    Text("Saved on this Mac in ~/.chompyy/signals.jsonl. Nightly taste learning will turn these into taste.md.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(16)
            Divider()
            if loaded && signals.isEmpty {
                ContentUnavailableView("Nothing yet", systemImage: "bubble.left", description: Text("Rate a card, edit a blueprint or answer a question, and it shows up here."))
            } else {
                List(signals) { s in
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
                            if let t = s.reason ?? s.text, !t.isEmpty {
                                Text("“\(t)”").font(.callout)
                            } else if s.kind == nil && s.accepted == nil {
                                Text("No reason given").font(.caption).foregroundStyle(.tertiary)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .frame(minWidth: 560, minHeight: 440)
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
        default: "You rated a result"
        }
    }

    private func icon(_ s: Signal) -> String {
        switch s.kind {
        case "blueprint-edit": "pencil"
        case "answer": "bubble.left.fill"
        case "coldstart": "clock.arrow.circlepath"
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
