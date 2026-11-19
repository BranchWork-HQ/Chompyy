import Foundation

/// Mirrors `chompyy state --json` (cli/src/appstate.ts). The app keeps no logic of its own.
struct AppState: Decodable {
    let generatedAt: String
    let quota: Quota
    let gate: Gate
    let cards: [Card]
    let coldStart: ColdStartState?
    /// Set only after a forced refresh: what the live quota check did.
    let quotaRefresh: QuotaRefresh?
}

struct QuotaRefresh: Decodable {
    let ok: Bool
    let message: String
}

struct Quota: Decodable {
    let source: String
    let capturedAt: String?
    let plan: String?
    let note: String?
    let fiveHour: WindowView
    let sevenDay: WindowView

    var capturedDate: Date? {
        guard let capturedAt else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: capturedAt) ?? ISO8601DateFormatter().date(from: capturedAt)
    }

    /// "just now", "4 min ago", "2 h ago": how old the numbers on screen are.
    func age(now: Date = Date()) -> String? {
        guard let d = capturedDate else { return nil }
        let s = max(0, now.timeIntervalSince(d))
        if s < 90 { return "just now" }
        if s < 3600 { return "\(Int(s / 60)) min ago" }
        return "\(Int(s / 3600)) h ago"
    }
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

    /// The last window has reset and no new one has started: all of it is left, and the next
    /// Claude Code message starts the clock. (Chompyy never sends one just to check.)
    var isFresh: Bool { !known && reason == "stale" }

    /// One line under the % for a fresh window.
    var freshHint: String {
        let at = resetDate.map { " · the last one reset at \($0.formatted(date: .omitted, time: .shortened))" } ?? ""
        return "A new window starts with your next Claude Code message\(at)"
    }
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
    /// Chompyy's own measurement: the repo's checks on the card vs on the main it started from.
    let verified: Verified?
    /// Exact tokens the agent used, and their value at API prices.
    let tokens: RunTokens?
}

/// Exact tokens of one run, from the run's own log (tokens.ts).
struct RunTokens: Decodable {
    let input: Int
    let output: Int
    let cacheRead: Int
    let cacheWrite: Int
    let costUsd: Double
    let turns: Int

    var total: Int { input + output + cacheRead + cacheWrite }
    static func compact(_ n: Int) -> String {
        n < 1000 ? "\(n)" : n < 1_000_000 ? String(format: n < 10_000 ? "%.1fk" : "%.0fk", Double(n) / 1000) : String(format: "%.1fM", Double(n) / 1_000_000)
    }
    var line: String { "Used \(Self.compact(total)) tokens · $\(String(format: "%.2f", costUsd)) at API prices · \(turns) turns" }
    var breakdown: String { "\(Self.compact(output)) written · \(Self.compact(cacheRead)) read from cache · \(Self.compact(cacheWrite)) written to cache · \(Self.compact(input)) fresh input" }
}

/// Chompyy bringing a card in review up to date after other cards were kept (refresh.ts).
struct Refresh: Decodable {
    let state: String    // waiting | running | done | failed
    let by: String?      // git | agent
    let why: String?
    let files: [String]?
    let at: String
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
    /// The branch your folder is on now, which Keep merges into (cards waiting for review only).
    let folderBranch: String?
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
    let picture: PictureInfo?
    let pictureError: String?
    let drawingAt: String?
    let pictureStale: Bool?
    /** What its run may need beyond the box (ticked when approving), and what you allowed. */
    let permissionPlan: [PlannedPermission]?
    let permissions: [String]?
    /// Files that would clash with main if kept now; Chompyy brings the card up to date by itself.
    let clashFiles: [String]?
    let refresh: Refresh?
    /// You pressed Keep while it clashed: it keeps itself once it's up to date and its checks pass.
    let keepWhenRefreshed: Bool?

    static func == (a: Card, b: Card) -> Bool { a.id == b.id && a.updatedAt == b.updatedAt }
    func hash(into h: inout Hasher) { h.combine(id) }

    var hasQuestions: Bool { !(questionsText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Cards that need you: ran and not decided yet.
    var needsYou: Bool { column == "review" && outcome == nil }

    /// Finished, but its own checks didn't pass.
    /// What Chompyy measured after the run (passed / failed), or nil when it couldn't check.
    var measured: String? { run?.verified.flatMap { $0.result == "not run" ? nil : $0.result } }
    var checksNotPassed: Bool { run?.status == "ok" && (run?.checks.map { $0.result != "passed" } ?? false) }

    var clashes: Bool { !(clashFiles ?? []).isEmpty }
    var refreshing: Bool { refresh?.state == "running" }

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

/// One item on a card's permission plan (research/away-readiness.md, step 3).
struct PlannedPermission: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let value: String
    let why: String
    let source: String

    var label: String {
        kind == "network" ? "Let the shell reach \(value)" : "Let it run \(value.replacingOccurrences(of: " *", with: ""))"
    }
}

/// What Chompyy measured after the run (research/away-readiness.md, step 4).
struct Verified: Decodable {
    let result: String   // passed | failed | not run
    let why: String
    let command: String?
}
