import Foundation

/// Mirrors `chompyy state --json` (cli/src/appstate.ts). The app keeps no logic of its own.
struct AppState: Decodable {
    let generatedAt: String
    let quota: Quota
    let gate: Gate
    let cards: [Card]
    let coldStart: ColdStartState?
}

struct Quota: Decodable {
    let source: String
    let capturedAt: String?
    let plan: String?
    let note: String?
    let fiveHour: WindowView
    let sevenDay: WindowView
}

struct WindowView: Decodable {
    let known: Bool
    let reason: String?
    let usedPct: Double?
    let leftPct: Double?
    let msLeft: Double?
    let pacePerHour: Double?
    let resetsAt: Double?

    var resetDate: Date? { resetsAt.map { Date(timeIntervalSince1970: $0) } }
}

struct Gate: Decodable {
    let ok: Bool
    let reasons: [String]
    let notes: [String]
}

struct RunInfo: Decodable {
    let status: String
    let startedAt: String
    let finishedAt: String
    let durationMs: Double
    let workdir: String
    let branch: String?
    let summary: String
    let checks: Checks?
}

struct Checks: Decodable {
    let result: String   // passed | failed | not run
    let why: String
}

struct Rating: Decodable {
    let score: Int
    let reason: String?
    let toFive: [String]?
}

struct Answer: Decodable {
    let at: String
    let text: String
}

struct Card: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let idea: String
    let cwd: String
    let column: String
    let blueprint: String?
    let blueprintError: String?
    let createdAt: String
    let updatedAt: String
    let run: RunInfo?
    let outcome: String?
    let rating: Rating?
    let answers: [Answer]?
    let files: [String]
    let questionsText: String?
    let source: String?
    let why: String?

    static func == (a: Card, b: Card) -> Bool { a.id == b.id && a.updatedAt == b.updatedAt }
    func hash(into h: inout Hasher) { h.combine(id) }

    var hasQuestions: Bool { !(questionsText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Cards that need you: ran and not decided yet.
    var needsYou: Bool { column == "review" && outcome == nil }

    /// Finished, but its own checks didn't pass.
    var checksNotPassed: Bool { run?.status == "ok" && (run?.checks.map { $0.result != "passed" } ?? false) }

    var projectName: String { (cwd as NSString).lastPathComponent }
}

struct Project: Decodable, Hashable {
    let path: String
    let name: String
    let lastUsed: String
}

enum Column: String, CaseIterable, Identifiable {
    case suggested, later, approved, running, review, done
    var id: String { rawValue }

    var title: String {
        switch self {
        case .suggested: "Suggested"
        case .later: "Later"
        case .approved: "Approved"
        case .running: "Running"
        case .review: "Review"
        case .done: "Done"
        }
    }

    var symbol: String {
        switch self {
        case .suggested: "lightbulb"
        case .later: "tray"
        case .approved: "checkmark.seal"
        case .running: "gearshape.2"
        case .review: "eyes"
        case .done: "star"
        }
    }

    var hint: String {
        switch self {
        case .suggested: "Ideas Chompyy prepared for you"
        case .later: "Parked ideas. Approve to run"
        case .approved: "Runs when you're away"
        case .running: "Working right now"
        case .review: "Waiting for you"
        case .done: "Kept, undone or rated"
        }
    }
}
