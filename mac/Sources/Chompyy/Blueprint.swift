import SwiftUI

/// A blueprint split into its sections (## Goal, ## Scope, ## Out of scope, ## Shape, ## How it's checked).
struct BlueprintDoc {
    struct Section: Identifiable {
        let id = UUID()
        let title: String
        let lines: [String]
        var bullets: [String] { lines.filter { $0.hasBullet }.map { $0.withoutBullet } }
        var prose: String { lines.filter { !$0.hasBullet }.joined(separator: " ").trimmingCharacters(in: .whitespaces) }
    }

    let sections: [Section]

    init(_ markdown: String) {
        var out: [Section] = []
        var title = "Overview"
        var lines: [String] = []
        func flush() {
            let kept = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            if !kept.isEmpty { out.append(Section(title: title, lines: kept)) }
            lines = []
        }
        for raw in markdown.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("#") {
                flush()
                title = line.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
            } else {
                lines.append(line)
            }
        }
        flush()
        sections = out
    }

    func section(_ names: String...) -> Section? {
        sections.first { s in names.contains { s.title.lowercased().hasPrefix($0) } }
    }
}

private extension String {
    var hasBullet: Bool { range(of: #"^([-*]|\d+\.)\s+"#, options: .regularExpression) != nil }
    var withoutBullet: String { replacingOccurrences(of: #"^([-*]|\d+\.)\s+"#, with: "", options: .regularExpression) }
}

/// Inline markdown (bold, code, links) for one line.
func md(_ text: String) -> AttributedString {
    (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
}

/// Picture first: the whole card on one line (goal → what changes → not touched → done when).
/// Details are one click away below; anything missing can be redrawn by asking Chompyy.
struct BlueprintMap: View {
    let doc: BlueprintDoc
    var onTap: (String) -> Void = { _ in }

    var body: some View {
        let goal = doc.section("goal")
        let scope = doc.section("scope")
        let out = doc.section("out of scope")
        let check = doc.section("how", "check", "done")
        HStack(alignment: .top, spacing: 0) {
            node("target", "Goal", firstSentence(goal?.prose ?? goal?.bullets.first ?? "—"), nil, Brand.dough, goal?.title)
            arrow
            node("hammer", "Changes", count(scope?.bullets.count, "step"), scope?.bullets.first, Brand.doughEdge, scope?.title)
            arrow
            node("hand.raised", "Won't touch", count(out?.bullets.count, "item"), out?.bullets.first, .secondary, out?.title)
            arrow
            node("checkmark.circle", "Done when", count(check?.bullets.count, "check"), check?.bullets.first, Brand.ok, check?.title)
        }
    }

    private var arrow: some View {
        Image(systemName: "arrow.right")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.tertiary)
            .padding(.top, 26)
            .padding(.horizontal, 4)
    }

    private func node(_ symbol: String, _ label: String, _ text: String, _ first: String?, _ tint: Color, _ target: String?) -> some View {
        Button {
            if let target { onTap(target) }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Label(label, systemImage: symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
                Text(md(text))
                    .font(.callout)
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let first {
                    Text(md("e.g. " + first))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .topLeading)
            .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(tint.opacity(0.25)))
        }
        .buttonStyle(.plain)
        .help(target == nil ? "" : "Jump to \(target!)")
    }

    private func firstSentence(_ s: String) -> String {
        if let r = s.range(of: #"[.!?](\s|$)"#, options: .regularExpression) { return String(s[..<r.upperBound]).trimmingCharacters(in: .whitespaces) }
        return s
    }

    private func count(_ n: Int?, _ noun: String) -> String {
        guard let n, n > 0 else { return "—" }
        return "\(n) \(noun)\(n == 1 ? "" : "s")"
    }
}

/// The sections, readable: headings, short prose, bullets.
struct BlueprintBody: View {
    let doc: BlueprintDoc

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(doc.sections) { s in
                VStack(alignment: .leading, spacing: 6) {
                    if s.title != "Overview" {
                        Text(s.title)
                            .font(.headline)
                            .id(s.title)
                    }
                    if !s.prose.isEmpty {
                        Text(md(s.prose)).textSelection(.enabled)
                    }
                    ForEach(Array(s.bullets.enumerated()), id: \.offset) { _, b in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Circle().fill(Brand.doughEdge).frame(width: 5, height: 5).offset(y: -2)
                            Text(md(b)).textSelection(.enabled)
                        }
                    }
                }
            }
        }
    }
}
